// 统一的 openid 解析器: 安全优先 + 环境敏感
// - prod 环境: 强制用 wxCtx.OPENID, 忽略 event.mock_openid(防冒充)
// - dev 环境: event.mock_openid 优先(云端测试面板需要模拟身份)
// - 两者都空: 返回 null(调用方必须处理)
// admin_config.env 结果模块级缓存 5 分钟, 避免每次 callFunction 多一次 DB 查询

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

// 主入口: 14 个云函数统一用这个
async function resolveOpenid(cloud, event) {
  const wxCtx = cloud.getWXContext();
  const realOpenid = wxCtx.OPENID;
  const mockOpenid = event && event.mock_openid;

  // 没有 mock_openid: 直接用真实 OPENID(小程序前端永远走这条)
  if (!mockOpenid) return realOpenid || null;

  // 有 mock_openid: 读环境开关决定是否放行
  const env = await _readEnv(cloud);
  if (env === 'prod') {
    // 生产环境强制忽略 mock_openid
    if (!realOpenid) return null;
    return realOpenid;
  }

  // dev 环境: 测试面板传什么就用什么
  return mockOpenid;
}

module.exports = { resolveOpenid };
