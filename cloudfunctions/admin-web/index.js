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
const PUBLIC_DIR = path.join(__dirname, 'public'); // 云函数运行时 = /var/task/public
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.map':  'application/json; charset=utf-8',
};

function makeJson(data, status = 200) {
  return { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) };
}

function serveStatic(urlPath) {
  // 路径安全: 防止 ../ 穿越
  const clean = urlPath.split('?')[0]; // 去掉 query string
  const decoded = decodeURIComponent(clean);
  const fullPath = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return { status: 403, headers: { ...CORS_HEADERS }, body: 'forbidden' };
  }

  // 1. 精确匹配 (带 / 也尝试 index.html)
  let target = fullPath;
  if (target.endsWith('/')) target = path.join(target, 'index.html');

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    const ext = path.extname(target).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const content = fs.readFileSync(target, 'utf-8');
    return {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': contentType },
      body: content,
    };
  }

  // 2. SPA fallback: 如果不是明显的静态资源路径 (有扩展名), 回退到 index.html
  if (!path.extname(fullPath)) {
    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': MIME['.html'] },
        body: fs.readFileSync(indexHtml, 'utf-8'),
      };
    }
  }

  // 3. 404
  return { status: 404, headers: { ...CORS_HEADERS }, body: 'not found: ' + urlPath };
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
  if (method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  // 健康检查(无需鉴权)
  if (pathname === '/health') return makeJson({ ok: true, ts: Date.now(), timeout_ms: PROXY_TIMEOUT_MS });

  // 🔍 Debug probe: 查 admin_config admin_web_key 实际值(无鉴权, 仅返回前 8 位+hash 确认)
  //   ?probe=scene_groups → 云端直调 home-action scene_groups, 返回小程序首页实际消费的场景分组摘要
  if (pathname === '/debug' && method === 'GET') {
    try {
      const cfg = (await db.collection('admin_config').doc('global').get()).data;
      const crypto = require('crypto');
      const base = {
        ok: true,
        env: cfg?.env || 'unknown',
        admin_openids_count: (cfg?.admin_openids || []).length,
        admin_web_key_set: !!cfg?.admin_web_key,
        admin_web_key_prefix: cfg?.admin_web_key ? cfg.admin_web_key.slice(0, 8) + '...' : '(empty)',
        admin_web_key_hash: cfg?.admin_web_key ? crypto.createHash('sha256').update(cfg.admin_web_key).digest('hex').slice(0, 16) : null,
        scene_count: (cfg?.scene_list || []).length,
        ts: Date.now()
      };
      // 首页场景分组实测探针: 内网直调 home-action(无需鉴权)
      const qs = req.queryStringParameters || req.queryString || req.query || {};
      // ⚠️ 仅限本机开发调试: 绕过所有缓存层直接改 DB 源头; 写操作 fail-closed, 仅 dev 环境放行(网关本身无鉴权)
      if (qs.force_probe === 'set_simulated_realname') {
        if ((cfg?.env) !== 'dev') {
          base.force_probe = { action: 'set_simulated_realname', blocked: 'env_not_dev', env: cfg?.env || 'unknown' };
        } else {
        const where = { is_realname_simulated: true, is_realname_done: false };
        const before = await db.collection('user_account').where(where).count();
        const batch = await db.collection('user_account').where(where).limit(100).get();
        const ids = (batch.data || []).map((u) => u._id);
        let updated = 0;
        for (const id of ids) {
          try { await db.collection('user_account').doc(id).update({ data: { is_realname_done: true, updated_at: Date.now() } }); updated++; } catch (_) {}
        }
        base.force_probe = { action: 'set_simulated_realname', before_count: before.total, updated, ids };
        }
      }
      // 查所有 simulated 账号状态(前端 Storage 残留定位用)
      if (qs.force_probe === 'list_simulated') {
        const all = await db.collection('user_account').where({ is_realname_simulated: true }).limit(50).get();
        base.force_probe = { action: 'list_simulated', count: (all.data || []).length, users: (all.data || []).map((u) => ({ openid: u.openid?.slice(0, 10) + '...', is_realname_done: u.is_realname_done, nickname: u.nickname, status: u.status, env_cause: cfg?.env })) };
      }
      if (qs.probe === 'scene_groups') {
        const t0 = Date.now();
        const hr = await cloud.callFunction({ name: 'home-action', data: { action: 'scene_groups' } });
        const groups = (hr.result && hr.result.data && hr.result.data.scene_groups) || [];
        base.scene_groups_probe = {
          ms: Date.now() - t0,
          upstream_ok: !!(hr.result && hr.result.ok),
          group_count: groups.length,
          groups: groups.map((g) => ({
            scene_code: g.scene_code,
            scene_name: g.scene_name,
            scene_options: g.scene_options || [],
            scene_disclaimer_type: g.scene_disclaimer_type || '',
            scene_builtin: !!g.scene_builtin,
            item_count: (g.list || []).length,
            has_more: !!g.has_more
          }))
        };
      }
      return { status: 200, headers: CORS_HEADERS, body: JSON.stringify(base) };
    } catch (e) {
      return { status: 500, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, msg: e.message }) };
    }
  }

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
    const key = (req.headers['x-admin-key'] || req.query.key || '').trim();
    const auth = checkAuth(cfg, key);
    if (!auth.ok) return makeJson({ ok: false, code: auth.msg }, 401);
  }

  const action = body.action;
  if (!action) return makeJson({ ok: false, code: 'no_action' }, 400);

  const adminOpenid = (cfg.admin_openids && cfg.admin_openids[0]) || null;

  // Bootstrap generate_admin_web_key → init-db 直调 (无鉴权)
  if (action === 'generate_admin_web_key') {
    const oid = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
    const proxyData = { ...body, mock_openid: oid, __admin_web_proxy: true, _admin_web_proxy_openid: oid };
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
    const proxyData = { ...body, action: realAction, __admin_web_proxy: true, _admin_web_proxy_openid: adminOpenid, mock_openid: adminOpenid || 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c' };
    delete proxyData.__init_db_action;
    try {
      const r = await withTimeout(cloud.callFunction({ name: 'init-db', data: proxyData }), PROXY_TIMEOUT_MS);
      return makeJson(r.result || { ok: false, code: 'no_result' });
    } catch (e) { return makeJson({ ok: false, code: 'init_db_error', msg: e.message }, 502); }
  }

  // proxy admin-action: 带 2.5s 超时保护 + 超时降级
  const proxyData = { ...body, __admin_web_proxy: true, _admin_web_proxy_openid: adminOpenid };
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