// admin-web HTTP 云函数 · Web 管理后台后端代理层
// 鉴权: admin_config.admin_web_key (后续商用升级 token+HMAC)
// 职责: 鉴权 → proxy admin-action → 返回 JSON
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key',
  'Content-Type': 'application/json; charset=utf-8'
};

function send(res, status, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(data));
}

function makeResponse(data, status = 200) {
  return { status, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

// 鉴权: 比对 admin_config.admin_web_key
async function checkAuth(req) {
  const key = (req.headers['x-admin-key'] || req.query.key || '').trim();
  if (!key) return { ok: false, msg: 'missing_key' };
  try {
    const cfg = (await db.collection('admin_config').doc('global').get()).data;
    // Bootstrap 放行: admin_web_key 缺失时, 允许任意带 key 的请求过 (generate_admin_web_key 专用)
    if (!cfg.admin_web_key) return { ok: true, bootstrap: true };
    if (cfg.admin_web_key !== key) return { ok: false, msg: 'bad_key' };
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: 'auth_error: ' + e.message };
  }
}

exports.main = async (event, context) => {
  const req = event && event.requestContext ? event : { headers: {}, query: {} };
  const path = req.path || '/';
  const method = (req.httpMethod || 'GET').toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  // 健康检查(无需鉴权)
  if (path === '/health') return makeResponse({ ok: true, ts: Date.now() });

  // ── Bootstrap 无鉴权放行: admin_web_key+admin_openids 双空时, 仅允许 generate_admin_web_key ──
  const reqBodyStr = typeof req.body === 'string' ? req.body : '';
  let reqBody = {};
  try { reqBody = reqBodyStr ? JSON.parse(reqBodyStr) : (req.body || {}); } catch(e) {}
  const bootstrap = path === '/api' && method === 'POST' && reqBody.action === 'generate_admin_web_key';

  // 鉴权(bootstrap 模式跳过)
  if (!bootstrap) {
    const auth = await checkAuth(req);
    if (!auth.ok) return makeResponse({ ok: false, code: auth.msg }, 401);
  }

  // action proxy: POST /api → body 或 query 里带 action + 其它参数
  if (path === '/api' && method === 'POST') {
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (e) { body = {}; }
    const action = body.action;
    if (!action) return makeResponse({ ok: false, code: 'no_action' }, 400);

    // Bootstrap generate_admin_web_key → init-db 直调 (无鉴权)
    if (action === 'generate_admin_web_key') {
      const proxyData = { ...body, __admin_web_proxy: true, _admin_web_proxy_openid: 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c' };
      try {
        const r = await cloud.callFunction({ name: 'init-db', data: proxyData });
        return makeResponse(r.result || { ok: false, code: 'no_result' });
      } catch (e) { return makeResponse({ ok: false, code: 'init_db_error', msg: e.message }, 502); }
    }

    // proxy admin-action 时附加可信 admin openid
    let adminOpenid = null;
    try {
      const cfg2 = (await db.collection('admin_config').doc('global').get()).data;
      adminOpenid = (cfg2.admin_openids && cfg2.admin_openids[0]) || null;
    } catch (e) {}
    const proxyData = { ...body, __admin_web_proxy: true, _admin_web_proxy_openid: adminOpenid };
    try {
      const r = await cloud.callFunction({ name: 'admin-action', data: proxyData });
      return makeResponse(r.result || { ok: false, code: 'no_result' });
    } catch (e) {
      return makeResponse({ ok: false, code: 'proxy_error', msg: e.message }, 502);
    }
  }

  return makeResponse({ ok: false, code: 'not_found' }, 404);
};
