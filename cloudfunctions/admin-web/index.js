// admin-web HTTP 云函数 · Web 管理后台后端代理层
// 鉴权: admin_config.admin_web_key (后续商用升级 token+HMAC)
// 职责: 静态文件服务 (Vue SPA) + 鉴权 → proxy admin-action → 返回 JSON
// ⚠️ CloudBase HTTP 网关 3s 硬限, 必须在 2.5s 内返回否则网关 504
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
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

  // 鉴权: 一律校验 X-Admin-Key(含 generate_admin_web_key)。
  // 修复: 原 bootstrap 跳过导致任何人可无凭据重置后台密钥并明文获取新 key(活体高危)。
  // 首次建钥(admin_web_key 缺失)仍由 checkAuth bootstrap 分支放行——此时库中无密钥,无保护对象;
  // key 一旦生成,重置必须携带当前有效 key。后续真实环境初始化走 IDE 控制台 init-db。
  {
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

  // 种子数据代理: 调用 zz-seed-orders (run / cleanup / count / simulate / cleanup_sim / count_sim / service_orders / night_orders)
  // 云函数间调用 OPENID 为空, 用固定 seed openid 标识(幂等+清理用)
  if (action === 'seed_run' || action === 'seed_cleanup' || action === 'seed_count'
      || action === 'seed_simulate' || action === 'seed_cleanup_sim' || action === 'seed_count_sim'
      || action === 'seed_service_orders' || action === 'seed_night_orders' || action === 'seed_cleanup_seed_orders'
      || action === 'seed_backfill_matched' || action === 'seed_scene_demands' || action === 'seed_fix_sdm_city') {
    const SEED_MAP = {
      seed_run: 'run', seed_cleanup: 'cleanup', seed_count: 'count',
      seed_simulate: 'simulate', seed_cleanup_sim: 'cleanup_sim', seed_count_sim: 'count_sim',
      seed_service_orders: 'service_orders', seed_night_orders: 'night_orders',
      seed_cleanup_seed_orders: 'cleanup_seed_orders', seed_backfill_matched: 'backfill_matched',
      seed_scene_demands: 'scene_demands', seed_fix_sdm_city: 'fix_sdm_city'
    };
    const seedAction = SEED_MAP[action];
    const seedOpenid = body.seed_openid || 'seed_admin';
    const seedData = { action: seedAction, mock_openid: seedOpenid };
    if (seedAction === 'run' && body.per) seedData.per = body.per;
    if (seedAction === 'service_orders' || seedAction === 'night_orders' || seedAction === 'cleanup_seed_orders' || seedAction === 'scene_demands') {
      if (body.partner_openid) seedData.partner_openid = body.partner_openid;
      if (body.count) seedData.count = body.count;
      if (seedAction === 'night_orders' && body.with_orders === false) seedData.with_orders = false;
      if (seedAction === 'night_orders' && body.cleanup === true) seedData.cleanup = true;
      if (seedAction === 'scene_demands') {
        if (body.per) seedData.per = body.per;
        if (body.per_sub === true) seedData.per_sub = true;
        if (body.owner_openid) seedData.owner_openid = body.owner_openid;
        if (body.owner_city) seedData.owner_city = body.owner_city;
        if (body.exclude_scenes) seedData.exclude_scenes = body.exclude_scenes;
        if (body.cleanup === true) seedData.cleanup = true;
      }
      if (seedAction === 'fix_sdm_city' && body.city) seedData.city = body.city;
    }
    try {
      const r = await withTimeout(cloud.callFunction({ name: 'zz-seed-orders', data: seedData }), PROXY_TIMEOUT_MS);
      return makeJson(r.result || { ok: false, code: 'no_result' });
    } catch (e) {
      if (e && e.message && e.message.startsWith('proxy_timeout_')) {
        return makeJson({ ok: false, code: 'gateway_timeout', action, hint: '网关响应慢, 请稍后重试', timeout_ms: PROXY_TIMEOUT_MS }, 504);
      }
      return makeJson({ ok: false, code: 'proxy_error', msg: e.message }, 502);
    }
  }

  // 打赏数据探活: 指令单 tip_total_fen 与 pay_transaction 流水(二分"未打赏 vs 数据不一致"), 受 X-Admin-Key 保护
  if (action === 'order_probe_tip') {
    try {
      const oid = String(body.order_id || '');
      const oidOk = /^[a-f0-9]{32}$/i.test(oid);
      // 按双方 openid 反查该用户有打赏的订单(用于定位"打赏过但看不到明细")
      const openid = String(body.openid || '');
      if (!oidOk && !openid) return makeJson({ ok: false, code: 'bad_param', msg: '需要 order_id(32位) 或 openid' });
      let rows = [];
      if (oidOk) {
        const o = await db.collection('order_main').doc(oid).get().catch(() => null);
        if (o && o.data) rows = [o.data];
      } else {
        const r = await db.collection('order_main').where(_.or([
          { user_openid: openid }, { partner_openid: openid }
        ]).and({ tip_total_fen: _.gt(0), is_deleted: _.neq(true) })).orderBy('updated_at', 'desc').limit(10).get().catch(() => ({ data: [] }));
        rows = r.data || [];
      }
      const out = [];
      for (const o of rows) {
        const txs = await db.collection('pay_transaction').where({ order_id: o._id, type: 'tip', is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(100).get().catch(() => ({ data: [] }));
        out.push({
          _id: o._id, order_no: o.order_no || '', status: o.status || '',
          user_openid: o.user_openid || '', partner_openid: o.partner_openid || '',
          tip_total_fen: o.tip_total_fen || 0, updated_at: o.updated_at || null,
          tip_count: (txs.data || []).length,
          tips: (txs.data || []).map((t) => ({ pay_no: t.pay_no, amount_fen: t.amount_fen, note: t.note || '', created_at: t.created_at }))
        });
      }
      return makeJson({ ok: true, data: { orders: out } });
    } catch (e) {
      return makeJson({ ok: false, code: 'probe_error', msg: e && e.message }, 502);
    }
  }

  // 网关模拟身份直调 payment-mock tip_list(云函数间 OPENID 为空 → mock_openid 生效), 二分权限/数据问题
  if (action === 'fn_probe_tip_list') {
    const oid = String(body.order_id || '');
    if (!/^[a-f0-9]{32}$/i.test(oid) || !body.mock_openid) {
      return makeJson({ ok: false, code: 'bad_param', msg: '需要 order_id(32位) 与 mock_openid' });
    }
    try {
      const r = await withTimeout(cloud.callFunction({
        name: 'payment-mock',
        data: { action: 'tip_list', order_id: oid, mock_openid: String(body.mock_openid) }
      }), PROXY_TIMEOUT_MS);
      return makeJson(r.result || { ok: false, code: 'no_result' });
    } catch (e) {
      return makeJson({ ok: false, code: 'fn_probe_error', msg: e && e.message }, 502);
    }
  }

  // 运维回填: 历史打赏流水补 partner_openid/scene(幂等)。直查 DB 绕开 payment-mock 身份门控(prod 下 mock_openid 失效)
  if (action === 'fn_migrate_tip_partner') {
    try {
      const cursor = await db.collection('pay_transaction').where({
        type: 'tip', status: 'success', partner_openid: _.exists(false)
      }).limit(100).get();
      let fixed = 0;
      for (const t of (cursor.data || [])) {
        let order = null;
        try { order = (await db.collection('order_main').doc(t.order_id).get()).data; } catch (e) { order = null; }
        if (!order) continue;
        await db.collection('pay_transaction').doc(t._id).update({
          data: { partner_openid: order.partner_openid || '', scene: order.scene || '' }
        }).catch(() => {});
        fixed++;
      }
      return makeJson({ ok: true, data: { fixed } });
    } catch (e) {
      return makeJson({ ok: false, code: 'fn_migrate_error', msg: e && e.message }, 502);
    }
  }

  // 排查探活: 网关视角(云函数间调用 OPENID 为空 → home-action 走游客视角, 不做耍伴级过滤)拉广场列表,
  // 用于二分「服务端数据 vs 前端展示」问题; 受 X-Admin-Key 保护
  if (action === 'home_probe_square') {
    try {
      const r = await withTimeout(cloud.callFunction({ name: 'home-action', data: { action: 'square', limit: Math.min(Number(body.limit) || 20, 50) } }), PROXY_TIMEOUT_MS);
      return makeJson(r.result || { ok: false, code: 'no_result' });
    } catch (e) {
      return makeJson({ ok: false, code: 'home_probe_error', msg: e && e.message }, 502);
    }
  }
  // 排查探活: 直查 system_notice / audit_log 集合(改期通知回归排查)
  if (action === 'home_probe_system_notice') {
    try {
      const t = String(body.type || 'modify_confirm');
      const hours = Math.min(Number(body.hours) || 48, 24 * 30);
      const since = Date.now() - hours * 3600000;
      const r = await db.collection('system_notice').where({
        type: t, created_at: _.gte(since)
      }).orderBy('created_at', 'desc').limit(10).get();
      return makeJson({ ok: true, data: { type: t, hours, count: r.data.length, list: r.data.map((n) => ({ order_id: n.order_id, to_openid: n.to_openid, read: !!n.read, created_at: n.created_at, title: n.title })) } });
    } catch (e) {
      return makeJson({ ok: false, code: 'probe_notice_error', msg: e && e.message }, 502);
    }
  }
  if (action === 'home_probe_modify_audit') {
    try {
      const hours = Math.min(Number(body.hours) || 48, 24 * 30);
      const since = Date.now() - hours * 3600000;
      const r = await db.collection('audit_log').where({
        action: _.in(['order_modify_apply', 'order_modify_confirm', 'order_modify_reject']),
        created_at: _.gte(since)
      }).orderBy('created_at', 'desc').limit(10).get();
      return makeJson({ ok: true, data: { hours, count: r.data.length, list: r.data.map((a) => ({ action: a.action, openid: a.openid, role: a.role, target_id: a.target_id, result: a.result, created_at: a.created_at })) } });
    } catch (e) {
      return makeJson({ ok: false, code: 'probe_audit_error', msg: e && e.message }, 502);
    }
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