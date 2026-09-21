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
    if (!cfg.admin_web_key) return { ok: false, msg: 'admin_web_key_not_set' };
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

  // 鉴权
  const auth = await checkAuth(req);
  if (!auth.ok) return makeResponse({ ok: false, code: auth.msg }, 401);

  // action proxy: POST /api → body 或 query 里带 action + 其它参数
  if (path === '/api' && method === 'POST') {
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (e) { body = {}; }
    const action = body.action;
    if (!action) return makeResponse({ ok: false, code: 'no_action' }, 400);

    // proxy 时附加可信 admin openid (X-Admin-Key 已通过 checkAuth 校验)
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
