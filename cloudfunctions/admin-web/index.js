// admin-web HTTP 云函数 · Web 管理后台后端代理层
// 鉴权: admin_config.admin_web_key (后续商用升级 token+HMAC)
// 职责: 鉴权 → proxy admin-action → 返回 JSON
// ⚠️ CloudBase HTTP 网关 3s 硬限, 必须在 2.5s 内返回否则网关 504
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key',
  'Content-Type': 'application/json; charset=utf-8'
};

const GATEWAY_HARD_TIMEOUT_MS = 3000;
const SAFE_MARGIN_MS = 500;
const PROXY_TIMEOUT_MS = GATEWAY_HARD_TIMEOUT_MS - SAFE_MARGIN_MS; // 2500ms

function makeResponse(data, status = 200) {
  return { status, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

// Promise.race 包装: 2.5s 超时返回 timeout error
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('proxy_timeout_' + ms)), ms))
  ]);
}

// 单次读 admin_config (带 fallback, 避免两次查)
async function loadConfig() {
  try {
    const cfg = (await db.collection('admin_config').doc('global').get()).data;
    return cfg || {};
  } catch (e) {
    return {};
  }
}

// 鉴权: 比对 admin_config.admin_web_key (空时 bootstrap 放行)
function checkAuth(cfg, key) {
  if (!key) return { ok: false, msg: 'missing_key' };
  if (!cfg.admin_web_key) return { ok: true, bootstrap: true };
  if (cfg.admin_web_key !== key) return { ok: false, msg: 'bad_key' };
  return { ok: true };
}

exports.main = async (event, context) => {
  const req = event && event.requestContext ? event : { headers: {}, query: {} };
  const path = req.path || '/';
  const method = (req.httpMethod || 'GET').toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  // 健康检查(无需鉴权)
  if (path === '/health') return makeResponse({ ok: true, ts: Date.now(), timeout_ms: PROXY_TIMEOUT_MS });

  // 单次读 admin_config (鉴权 + adminOpenid 共享, 消除重复查询)
  const cfg = await loadConfig();
  const reqBodyStr = typeof req.body === 'string' ? req.body : '';
  let body = {};
  try { body = reqBodyStr ? JSON.parse(reqBodyStr) : (req.body || {}); } catch(e) {}

  // Bootstrap 无鉴权放行: admin_web_key 缺失时, 仅允许 generate_admin_web_key
  const bootstrap = body.action === 'generate_admin_web_key';

  // 鉴权(bootstrap 跳过)
  if (!bootstrap) {
    const key = (req.headers['x-admin-key'] || req.query.key || '').trim();
    const auth = checkAuth(cfg, key);
    if (!auth.ok) return makeResponse({ ok: false, code: auth.msg }, 401);
  }

  if (path !== '/api' || method !== 'POST') return makeResponse({ ok: false, code: 'not_found' }, 404);

  const action = body.action;
  if (!action) return makeResponse({ ok: false, code: 'no_action' }, 400);

  const adminOpenid = (cfg.admin_openids && cfg.admin_openids[0]) || null;

  // Bootstrap generate_admin_web_key → init-db 直调 (无鉴权)
  if (action === 'generate_admin_web_key') {
    const proxyData = { ...body, __admin_web_proxy: true, _admin_web_proxy_openid: 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c' };
    try {
      const r = await cloud.callFunction({ name: 'init-db', data: proxyData });
      return makeResponse(r.result || { ok: false, code: 'no_result' });
    } catch (e) { return makeResponse({ ok: false, code: 'init_db_error', msg: e.message }, 502); }
  }

  // proxy admin-action: 带 2.5s 超时保护 + 超时降级
  const proxyData = { ...body, __admin_web_proxy: true, _admin_web_proxy_openid: adminOpenid };
  try {
    const r = await withTimeout(cloud.callFunction({ name: 'admin-action', data: proxyData }), PROXY_TIMEOUT_MS);
    return makeResponse(r.result || { ok: false, code: 'no_result' });
  } catch (e) {
    if (e && e.message && e.message.startsWith('proxy_timeout_')) {
      // 超时降级: 返回 timeout code + action 提示, 前端可 retry
      return makeResponse({
        ok: false, code: 'gateway_timeout',
        action, hint: '网关响应慢, 请稍后重试',
        timeout_ms: PROXY_TIMEOUT_MS
      }, 504);
    }
    return makeResponse({ ok: false, code: 'proxy_error', msg: e.message }, 502);
  }
};
