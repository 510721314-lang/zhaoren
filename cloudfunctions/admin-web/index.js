// admin-web HTTP 云函数 · Web 管理后台后端代理层
// 鉴权: admin_config.admin_web_key (后续商用升级 token+HMAC)
// 职责: 静态文件服务 (Vue SPA) + 鉴权 → proxy admin-action → 返回 JSON
// ⚠️ CloudBase HTTP 网关 3s 硬限, 必须在 2.5s 内返回否则网关 504
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const fs = require('fs');
const path = require('path');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key',
};

const GATEWAY_HARD_TIMEOUT_MS = 3000;
const SAFE_MARGIN_MS = 500;
const PROXY_TIMEOUT_MS = GATEWAY_HARD_TIMEOUT_MS - SAFE_MARGIN_MS; // 2500ms

// ── 静态文件服务 ──
const PUBLIC_DIR = path.join(__dirname, 'public'); // 常规布局: /var/user/public/
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.map':  'application/json; charset=utf-8',
};

// 静态文件索引: 请求路径('/index.html'、'/assets/xx.js') → 运行时绝对路径
// 兼容两种部署布局:
//   1) 正常目录布局  public/index.html → /var/user/public/index.html
//   2) DevTools Windows 打包把嵌套条目拍平为反斜杠文件名(public\index.html / public\assets\xx.js),
//      运行时文件直接躺在函数根下, 文件名里带字面量反斜杠 —— 按 'public/' 前缀去映射回请求路径
const STATIC_MAP = {};
function buildStaticMap() {
  const put = (key, abs) => { if (!STATIC_MAP[key]) STATIC_MAP[key] = abs; };
  const walkDir = (base, relPrefix) => {
    let ents;
    try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { return; }
    for (const it of ents) {
      const abs = path.join(base, it.name);
      if (it.isDirectory()) walkDir(abs, relPrefix + '/' + it.name);
      else put(relPrefix + '/' + it.name, abs);
    }
  };
  if (fs.existsSync(PUBLIC_DIR)) walkDir(PUBLIC_DIR, '');
  let ents;
  try { ents = fs.readdirSync(__dirname, { withFileTypes: true }); } catch (e) { return; }
  for (const it of ents) {
    if (it.isFile() && it.name.indexOf('\\') >= 0) {
      const rel = '/' + it.name.replace(/\\/g, '/'); // '/public/index.html' → '/index.html'
      const key = rel.indexOf('/public') === 0 ? rel.slice('/public'.length) : rel;
      put(key, path.join(__dirname, it.name));
    }
  }
}
buildStaticMap();

function serveStatic(urlPath) {
  let clean;
  try { clean = decodeURIComponent(String(urlPath).split('?')[0]); } catch (e) { clean = String(urlPath); }
  let norm = clean === '/' ? '/index.html' : clean;
  if (!norm.startsWith('/')) norm = '/' + norm;
  const hasExt = path.extname(norm).length > 0;
  if (!hasExt && !norm.endsWith('/')) norm += '/index.html';
  if (norm.endsWith('/')) norm += 'index.html';

  let abs = STATIC_MAP[norm];
  // SPA fallback: 非静态资源路径(无扩展名/目录)未命中 → 回退 index.html
  if (!abs && !hasExt) abs = STATIC_MAP['/index.html'];
  if (!abs) return { statusCode: 404, headers: { ...CORS_HEADERS }, body: 'not found: ' + urlPath };
  try {
    if (!fs.statSync(abs).isFile()) return { statusCode: 404, headers: { ...CORS_HEADERS }, body: 'not found: ' + urlPath };
    const ext = path.extname(abs).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': contentType }, body: fs.readFileSync(abs, 'utf-8') };
  } catch (e) {
    return { statusCode: 404, headers: { ...CORS_HEADERS }, body: 'not found: ' + urlPath };
  }
}

function makeJson(data, statusCode = 200) {
  return { statusCode, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) };
}

// ── proxy 工具 ──
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('proxy_timeout_' + ms)), ms))
  ]);
}

async function loadConfig() {
  try {
    const cfg = (await db.collection('admin_config').doc('global').get()).data;
    return cfg || {};
  } catch (e) {
    return {};
  }
}

function checkAuth(cfg, key) {
  if (!key) return { ok: false, msg: 'missing_key' };
  if (!cfg.admin_web_key) return { ok: true, bootstrap: true };
  if (cfg.admin_web_key !== key) return { ok: false, msg: 'bad_key' };
  return { ok: true };
}

// ── 主入口 ──
exports.main = async (event, context) => {
  const req = event && event.requestContext ? event : { headers: {}, query: {} };
  const pathname = req.path || '/';
  const method = (req.httpMethod || 'GET').toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS };

  // 健康检查(无需鉴权)
  if (pathname === '/health') return makeJson({ ok: true, ts: Date.now(), timeout_ms: PROXY_TIMEOUT_MS });

  // 🟢 静态文件: 所有 GET / 非 /api 路径 → serveStatic
  if (method === 'GET' && !pathname.startsWith('/api')) {
    return serveStatic(pathname);
  }

  // ── 以下为 /api POST 代理逻辑 ──
  if (pathname !== '/api' || method !== 'POST') {
    return makeJson({ ok: false, code: 'not_found' }, 404);
  }

  const cfg = await loadConfig();
  const reqBodyStr = typeof req.body === 'string' ? req.body : '';
  let body = {};
  try { body = reqBodyStr ? JSON.parse(reqBodyStr) : (req.body || {}); } catch(e) {}

  // Bootstrap 无鉴权放行: admin_web_key 缺失时, 仅允许 generate_admin_web_key
  const bootstrap = body.action === 'generate_admin_web_key';

  // 鉴权(bootstrap 跳过)
  if (!bootstrap) {
    // CloudBase HTTP 事件查询参数字段为 queryStringParameters (无 query 字段, 直接访问会抛异常)
    const qs = req.queryStringParameters || req.query || {};
    const key = (req.headers['x-admin-key'] || qs.key || '').trim();
    const auth = checkAuth(cfg, key);
    if (!auth.ok) return makeJson({ ok: false, code: auth.msg }, 401);
  }

  const action = body.action;
  if (!action) return makeJson({ ok: false, code: 'no_action' }, 400);

  const adminOpenid = (cfg.admin_openids && cfg.admin_openids[0]) || null;

  // Bootstrap generate_admin_web_key → init-db 直调 (无鉴权)
  // 身份取 admin_openids[0]，不再硬编码；空则拒绝(不留死兜底)
  if (action === 'generate_admin_web_key') {
    const oid = adminOpenid || '';
    if (!oid) return makeJson({ ok: false, code: 'no_admin_openid', msg: '后台未初始化管理员' }, 400);
    const proxyData = { ...body, mock_openid: oid, __admin_web_proxy: true, _admin_web_proxy_openid: oid, _admin_web_proxy_key: cfg.admin_web_key || '' };
    try {
      const r = await cloud.callFunction({ name: 'init-db', data: proxyData });
      return makeJson(r.result || { ok: false, code: 'no_result' });
    } catch (e) { return makeJson({ ok: false, code: 'init_db_error', msg: e.message }, 502); }
  }

  // init_db → init-db 通用代理 (鉴权通过, init-db 内部有 admin_openids 门控)
  // ⚠️ action 字段名冲突: admin-web 用 action 判断路由, init-db 也用 action 找具体动作
  //    所以 init_db proxy 的真实 init-db action 放在 __init_db_action 里
  if (action === 'init_db') {
    const realAction = body.__init_db_action || 'quick_check';
    const proxyData = { ...body, action: realAction, __admin_web_proxy: true, _admin_web_proxy_openid: adminOpenid, _admin_web_proxy_key: cfg.admin_web_key || '', mock_openid: adminOpenid || '' };
    delete proxyData.__init_db_action;
    try {
      const r = await withTimeout(cloud.callFunction({ name: 'init-db', data: proxyData }), PROXY_TIMEOUT_MS);
      return makeJson(r.result || { ok: false, code: 'no_result' });
    } catch (e) { return makeJson({ ok: false, code: 'init_db_error', msg: e.message }, 502); }
  }

  // proxy admin-action: 带 2.5s 超时保护 + 超时降级
  const proxyData = { ...body, __admin_web_proxy: true, _admin_web_proxy_openid: adminOpenid, _admin_web_proxy_key: cfg.admin_web_key || '' };
  try {
    const r = await withTimeout(cloud.callFunction({ name: 'admin-action', data: proxyData }), PROXY_TIMEOUT_MS);
    return makeJson(r.result || { ok: false, code: 'no_result' });
  } catch (e) {
    if (e && e.message && e.message.startsWith('proxy_timeout_')) {
      return makeJson({
        ok: false, code: 'gateway_timeout',
        action, hint: '网关响应慢, 请稍后重试',
        timeout_ms: PROXY_TIMEOUT_MS
      }, 504);
    }
    return makeJson({ ok: false, code: 'proxy_error', msg: e.message }, 502);
  }
};