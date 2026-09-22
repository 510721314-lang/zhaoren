// 统一的 openid 解析器 + 环境开关缓存(安全优先 fail-closed)
// - prod 环境: 强制用 wxCtx.OPENID, 忽略 event.mock_openid(防冒充)
// - dev 环境: event.mock_openid 优先(云端测试面板需要模拟身份)
// - 两者都空: 返回 null(调用方必须处理)
// - admin_config 读失败: 按 prod 处理(只短缓存 10s, 兼顾 DB 恢复), 绝不默认 dev 放开 mock
// admin_config.env 模块级缓存 5 分钟, logger 等模块通过 getCachedEnv 共享同一缓存

let _cachedEnv = null;
let _cacheUntil = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const FAIL_CACHE_TTL_MS = 10 * 1000; // 读配置失败只短缓存, 便于 DB 恢复后重新读取

async function _readEnv(cloud) {
  const now = Date.now();
  if (_cachedEnv !== null && now < _cacheUntil) return _cachedEnv;
  try {
    const db = cloud.database();
    const r = await db.collection('admin_config').doc('global').get();
    // 配置存在但 env 字段缺失也按 prod 处理(禁止隐式放开 mock)
    _cachedEnv = (r.data && r.data.env === 'dev') ? 'dev' : 'prod';
    _cacheUntil = now + CACHE_TTL_MS;
  } catch (e) {
    // fail-closed: 读不到配置时按 prod, mock_openid 旁路全关
    _cachedEnv = 'prod';
    _cacheUntil = now + FAIL_CACHE_TTL_MS;
  }
  return _cachedEnv;
}

// 仅预热环境缓存, 不解析身份(定时器/首页等无 mock 场景用)
async function warmEnv(cloud) {
  return _readEnv(cloud);
}

// 同步读取最近一次缓存的环境(null=尚未预热, 调用方按非 prod 处理)
function getCachedEnv() {
  return _cachedEnv;
}

// 强制清 env 缓存 (force_set_env 更新 DB 后立即生效)
function invalidateEnvCache() {
  _cachedEnv = null;
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
