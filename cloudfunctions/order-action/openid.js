// 统一的 openid 解析器 + 环境开关缓存(安全优先 + 环境敏感)
// - prod 环境: 强制用 wxCtx.OPENID, 忽略 event.mock_openid(防冒充)
// - dev 环境: event.mock_openid 优先(云端测试面板需要模拟身份)
// - 两者都空: 返回 null(调用方必须处理)
// admin_config.env 模块级缓存 5 分钟, logger 等模块通过 getCachedEnv 共享同一缓存

let _cachedEnv = null;
let _cacheUntil = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

async function _readEnv(cloud) {
  const now = Date.now();
  if (_cachedEnv !== null && now < _cacheUntil) return _cachedEnv;
  try {
    const db = cloud.database();
    const r = await db.collection('admin_config').doc('global').get();
    _cachedEnv = (r.data && r.data.env) || 'dev';
  } catch (e) {
    _cachedEnv = 'dev'; // 读不到配置时保守按 dev 处理
  }
  _cacheUntil = now + CACHE_TTL_MS;
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

  // 有 mock_openid + 无真实 OPENID: 云端测试面板场景, 无冒充对象, 一律放行
  return mockOpenid;
}

module.exports = { resolveOpenid, warmEnv, getCachedEnv };
