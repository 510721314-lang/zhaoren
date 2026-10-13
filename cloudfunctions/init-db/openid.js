// 统一的 openid 解析器 + 环境开关缓存(安全优先 fail-closed)
// - prod 环境: 强制用 wxCtx.OPENID, 忽略 event.mock_openid(防冒充)
// - dev 环境: event.mock_openid 优先(云端测试面板需要模拟身份)
//   · 批4.1 加固: dev 必须带 admin_config.dev_until(未来时间戳) 才生效;
//     过期/缺失 → fail-closed 回 prod。dev_bypass=true 为回滚开关(显式跳过过期校验, 旧逻辑)。
// - 两者都空: 返回 null(调用方必须处理)
// - admin_config 读失败: 按 prod 处理(只短缓存 10s, 兼顾 DB 恢复), 绝不默认 dev 放开 mock
// admin_config 模块级缓存 5 分钟, logger 等模块通过 getCachedEnv 共享同一缓存
// 2026-10-13 收敛: 全量 17 个业务函数统一用本规范源(原 admin-action 超集 / init-db 变体已合并归零),
//   admin-action 的 admin-web 网关代理密钥校验上移到其 index.js 包装层; init-db 需要的 invalidateEnvCache 在此导出。

let _cachedRaw = null;     // { env, devUntil, devBypass }
let _cacheUntil = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const FAIL_CACHE_TTL_MS = 10 * 1000; // 读配置失败只短缓存, 便于 DB 恢复后重新读取

// 由原始配置计算生效环境: dev 仅当 env=dev 且(未过期 或 回滚开关开)
function _effective(raw, now) {
  if (!raw || raw.env !== 'dev') return 'prod';
  if (raw.devBypass) return 'dev';
  return (raw.devUntil > 0 && now < raw.devUntil) ? 'dev' : 'prod';
}

async function _readEnv(cloud) {
  const now = Date.now();
  if (_cachedRaw && now < _cacheUntil) return _effective(_cachedRaw, now);
  try {
    const db = cloud.database();
    const r = await db.collection('admin_config').doc('global').get();
    const d = (r && r.data) || {};
    // 配置存在但 env 字段缺失也按 prod 处理(禁止隐式放开 mock)
    _cachedRaw = {
      env: d.env === 'dev' ? 'dev' : 'prod',
      devUntil: Number(d.dev_until) || 0,
      devBypass: d.dev_bypass === true,
    };
    _cacheUntil = now + CACHE_TTL_MS;
  } catch (e) {
    // fail-closed: 读不到配置时按 prod, mock_openid 旁路全关
    _cachedRaw = { env: 'prod', devUntil: 0, devBypass: false };
    _cacheUntil = now + FAIL_CACHE_TTL_MS;
  }
  return _effective(_cachedRaw, now);
}

// 仅预热环境缓存, 不解析身份(定时器/首页等无 mock 场景用)
async function warmEnv(cloud) {
  return _readEnv(cloud);
}

// 同步读取最近一次缓存的生效环境(null=尚未预热, 调用方按非 prod 处理)
function getCachedEnv() {
  return _cachedRaw ? _effective(_cachedRaw, Date.now()) : null;
}

// 强制清 env 缓存(init-db force_set_env 更新 DB 后立即生效; 只清本进程, 跨函数靠 5 分钟短缓存自然过期)
function invalidateEnvCache() {
  _cachedRaw = null;
  _cacheUntil = 0;
}

// 主入口: 云函数统一用这个
async function resolveOpenid(cloud, event) {
  const wxCtx = cloud.getWXContext();
  const realOpenid = wxCtx.OPENID;
  const mockOpenid = event && event.mock_openid;

  // 无条件预热环境缓存(顺带供 logger 门控), 有缓存时仅一次内存读取
  const env = await _readEnv(cloud);

  // 没有 mock_openid: 直接用真实 OPENID(小程序前端永远走这条)
  if (!mockOpenid) return realOpenid || null;

  // 有 mock_openid + 有真实 OPENID: prod 强制用真实 OPENID 防冒充, dev 允许 mock
  if (realOpenid) {
    if (env === 'prod') return realOpenid;
    return mockOpenid;
  }

  // 有 mock_openid + 无真实 OPENID: 仅 dev 云端测试面板放行; prod fail-closed 返回 null
  return env === 'dev' ? mockOpenid : null;
}

module.exports = { resolveOpenid, warmEnv, getCachedEnv, invalidateEnvCache };
