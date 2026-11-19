// admin-web 网关入口契约测试（#8 挂账项落地，2026-11-14）
// 覆盖点：CORS preflight / 健康检查 / 缺 action / 非法路径 / 三级鉴权
//（missing_key·bad_key·key_not_initialized）/ bootstrap 收紧放行 / admin_login 免 key /
// 会话令牌优先与回退 / 鉴权通过 proxy 转发 admin-action。全部零副作用（mock SDK）。
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadIndex(sdk) {
  activeSdk = sdk;
  // mock callFunction：_mock_sdk 未含该字段（既有用例零影响），网关 proxy 断言专用
  sdk.callFunction = async ({ name, data }) => ({ result: { ok: true, __proxied: name, __data: data } });
  for (const f of ['../admin-web/index.js', '../admin-web/admin-login.js', '../admin-web/audit.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../admin-web/index.js');
}

const KEY = 'k_unit_test_key_1';
const ADMIN = 'o_admin_1';

function apiEvent(body, headers) {
  return {
    requestContext: { elb: 'test' },
    path: '/api', httpMethod: 'POST',
    headers: headers || {}, query: {},
    body: JSON.stringify(body || {})
  };
}
function cfgWith(key, openids) {
  const g = {};
  if (key !== undefined) g.admin_web_key = key;
  if (openids) g.admin_openids = openids;
  return { admin_config: { global: g } };
}
async function run(sdk, event) {
  const { main } = loadIndex(sdk);
  const r = await main(event, {});
  return { statusCode: r.statusCode, body: JSON.parse(r.body || '{}'), headers: r.headers || {} };
}

// 1. CORS preflight
test('web: OPTIONS preflight → 204 + CORS 头', async () => {
  const { statusCode, headers } = await run(makeSdk({ openid: '' }), { requestContext: {}, path: '/api', httpMethod: 'OPTIONS', headers: {}, query: {} });
  assert.strictEqual(statusCode, 204);
  assert.strictEqual(headers['Access-Control-Allow-Origin'] || headers['access-control-allow-origin'], '*');
});

// 2. 健康检查免鉴权
test('web: GET /health → 200 ok(免鉴权)', async () => {
  const { statusCode, body } = await run(makeSdk({ openid: '' }), { requestContext: {}, path: '/health', httpMethod: 'GET', headers: {}, query: {} });
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.ok, true);
});

// 3. /api 非 POST → 404
test('web: GET /api → 404 not_found', async () => {
  const { statusCode, body } = await run(makeSdk({ openid: '' }), { requestContext: {}, path: '/api', httpMethod: 'GET', headers: {}, query: {} });
  assert.strictEqual(statusCode, 404);
  assert.strictEqual(body.code, 'not_found');
});

// 4. POST /api 缺 action → 400
test('web: POST /api 缺 action → 400 no_action', async () => {
  const { statusCode, body } = await run(makeSdk({ openid: '' }), apiEvent({}));
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(body.code, 'no_action');
});

// 5. 缺 key → 401 missing_key + gateway_bad_key(missing_key) 留痕
test('web: 缺 key → 401 missing_key + gateway_bad_key 留痕', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'list_orders' }));
  assert.strictEqual(statusCode, 401);
  assert.strictEqual(body.code, 'missing_key');
  const ev = (sdk.writes.platform_event || []).map((w) => w.data);
  assert.ok(ev.some((e) => e.type === 'gateway_bad_key' && e.payload.reason === 'missing_key'), '应留 gateway_bad_key(missing_key) 事件');
});

// 6. bad key → 401 bad_key（payload 不含 key 本体，防泄密）
test('web: bad key → 401 bad_key + 事件不含 key 本体', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'list_orders' }, { 'x-admin-key': 'wrong_key' }));
  assert.strictEqual(statusCode, 401);
  assert.strictEqual(body.code, 'bad_key');
  const ev = (sdk.writes.platform_event || []).map((w) => w.data);
  const hit = ev.find((e) => e.type === 'gateway_bad_key');
  assert.ok(hit, '应留 gateway_bad_key 事件');
  assert.ok(!JSON.stringify(hit).includes('wrong_key'), '事件不得包含提交的 key 本体');
});

// 7. bootstrap 收紧：key 未初始化 + 非 generate_admin_web_key → 401
test('web: bootstrap 时非建钥动作 → 401 key_not_initialized', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(undefined, [ADMIN]) });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'list_orders' }, { 'x-admin-key': 'any_key' }));
  assert.strictEqual(statusCode, 401);
  assert.strictEqual(body.code, 'key_not_initialized');
});

// 8. bootstrap 放行 generate_admin_web_key → 转发 init-db
test('web: bootstrap 建钥动作 → 放行转发 init-db', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(undefined, [ADMIN]) });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'generate_admin_web_key', reason: '首次建钥' }, { 'x-admin-key': 'any_key' }));
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.__proxied, 'init-db');
  assert.strictEqual(body.__data.__admin_web_proxy, true);
});

// 9. admin_login 免 key 放行（账号密码由 admin-action 侧校验，此处仅证鉴权门放行）
test('web: admin_login 免 key → 非 401', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const { statusCode } = await run(sdk, apiEvent({ action: 'admin_login', username: 'u', password: 'p' }));
  assert.notStrictEqual(statusCode, 401);
});

// 10. 有效会话令牌放行 → proxy 转发 admin-action
test('web: 有效 X-Admin-Token → 放行转发 admin-action', async () => {
  const store = cfgWith(KEY, [ADMIN]);
  store.admin_web_sessions = { tok_ok: { expires_at: Date.now() + 60000, is_deleted: false } };
  const sdk = makeSdk({ openid: '', store });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'list_orders' }, { 'x-admin-token': 'tok_ok' }));
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.__proxied, 'admin-action');
});

// 11. 无效 token 回退静态 key 校验（有效 key → 放行）
test('web: 无效 token + 有效 key → 回退放行', async () => {
  const store = cfgWith(KEY, [ADMIN]);
  store.admin_web_sessions = { tok_dead: { expires_at: 1, is_deleted: true } };
  const sdk = makeSdk({ openid: '', store });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'list_orders' }, { 'x-admin-token': 'tok_dead', 'x-admin-key': KEY }));
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.__proxied, 'admin-action');
});

// 12. 鉴权通过未知 action → 统一 proxy admin-action（由下游裁定 unsupported）
test('web: 已鉴权未知 action → 转发 admin-action', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'not_exist_action' }, { 'x-admin-key': KEY }));
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.__proxied, 'admin-action');
  assert.strictEqual(body.__data._admin_web_proxy_openid, ADMIN);
});

// 13. fn_migrate_tip_partner(2026-11-19 评审修复#3): 鉴权通过 → 直查回填 partner_openid/scene + audit_log 留痕
test('web: fn_migrate_tip_partner → 回填 partner_openid/scene + 审计留痕', async () => {
  const store = cfgWith(KEY, [ADMIN]);
  store.pay_transaction = {
    t1: { _id: 't1', type: 'tip', status: 'success', order_id: 'o1' }, // 缺 partner_openid → 命中回填
    t2: { _id: 't2', type: 'tip', status: 'success', order_id: 'o_missing' } // 订单缺失 → 跳过
  };
  store.order_main = { o1: { _id: 'o1', partner_openid: 'op_1', scene: 'W1' } };
  const sdk = makeSdk({ openid: '', store });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'fn_migrate_tip_partner' }, { 'x-admin-key': KEY }));
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.data.fixed, 1, '仅 o1 一条被回填');
  const upd = (sdk.writes.pay_transaction || []).find((w) => w.doc === 't1');
  assert.ok(upd, '应对 t1 执行 doc.update');
  assert.strictEqual(upd.data.partner_openid, 'op_1');
  assert.strictEqual(upd.data.scene, 'W1');
  const aud = (sdk.writes.audit_log || []).map((w) => w.data).find((a) => a && a.action === 'fn_migrate_tip_partner');
  assert.ok(aud, '应写 audit_log 留痕');
  assert.strictEqual(aud.result, 'ok');
});

// 14. fn_probe_tip_list(评审修复#3): 参数门 —— 缺 mock_openid / order_id 非 32 位 → bad_param 不转发
test('web: fn_probe_tip_list 参数不全 → bad_param', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const r1 = await run(sdk, apiEvent({ action: 'fn_probe_tip_list', order_id: 'a'.repeat(32) }, { 'x-admin-key': KEY }));
  assert.strictEqual(r1.body.code, 'bad_param');
  const r2 = await run(sdk, apiEvent({ action: 'fn_probe_tip_list', order_id: 'short', mock_openid: 'o_x' }, { 'x-admin-key': KEY }));
  assert.strictEqual(r2.body.code, 'bad_param');
});

// 15. home_probe_system_notice(评审修复#3): 受鉴权保护 + 直查返回 count/list
test('web: home_probe_system_notice → 未鉴权 401; 鉴权后直查 count', async () => {
  const store = cfgWith(KEY, [ADMIN]);
  store.system_notice = { n1: { _id: 'n1', type: 'modify_confirm', order_id: 'o1', to_openid: 'u1', read: false, created_at: Date.now(), title: '改期通知' } };
  const sdkNoAuth = makeSdk({ openid: '', store });
  const r401 = await run(sdkNoAuth, apiEvent({ action: 'home_probe_system_notice' }));
  assert.strictEqual(r401.statusCode, 401);
  const sdk = makeSdk({ openid: '', store });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'home_probe_system_notice' }, { 'x-admin-key': KEY }));
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.data.count, 1);
});

// 16. bad-key 限频(评审修复#5): 同进程连续坏 key → 窗口内 gateway_bad_key 留痕封顶 5 条
test('web: 连续 7 次坏 key → gateway_bad_key 留痕限频至 5 条', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const { main } = loadIndex(sdk); // 单次加载, 复用同一内存限频窗口
  for (let i = 0; i < 7; i++) {
    await main(apiEvent({ action: 'list_orders' }, { 'x-admin-key': 'wrong_key' }), {});
  }
  const ev = (sdk.writes.platform_event || []).filter((w) => w.data.type === 'gateway_bad_key');
  assert.strictEqual(ev.length, 5, '窗口内最多留痕 5 条, 防公网刷库放大用量');
});

// 17. admin_login 失败留痕限频(同步审核 N1): 免 key 端点连续失败 → P1 admin_login_fail 留痕封顶 5 条
test('web: 连续 7 次 admin_login 失败 → admin_login_fail 留痕限频至 5 条', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const { main } = loadIndex(sdk);
  for (let i = 0; i < 7; i++) {
    const r = await main(apiEvent({ action: 'admin_login', account: 'ghost', password: 'x' }), {});
    assert.strictEqual(JSON.parse(r.body).code, 'login_bad', '限频只拦留痕, 登录响应不变');
  }
  const ev = (sdk.writes.platform_event || []).filter((w) => w.data.type === 'admin_login_fail');
  assert.strictEqual(ev.length, 5, 'P1 admin_login_fail 留痕窗口内封顶 5 条');
});

// 18. order_probe_tip(同步审核 N2): 参数门 —— 缺 order_id 且缺 openid → bad_param; 32 位 order_id → 直查返回 orders
test('web: order_probe_tip → bad_param / order_id 直查', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const r1 = await run(sdk, apiEvent({ action: 'order_probe_tip' }, { 'x-admin-key': KEY }));
  assert.strictEqual(r1.body.code, 'bad_param');
  const store2 = cfgWith(KEY, [ADMIN]);
  store2.order_main = { ['a'.repeat(32)]: { _id: 'a'.repeat(32), order_no: 'NO1', status: 'S5', user_openid: 'u1', partner_openid: 'p1', tip_total_fen: 500 } };
  const sdk2 = makeSdk({ openid: '', store: store2 });
  const r2 = await run(sdk2, apiEvent({ action: 'order_probe_tip', order_id: 'a'.repeat(32) }, { 'x-admin-key': KEY }));
  assert.strictEqual(r2.body.ok, true);
  assert.strictEqual(r2.body.data.orders.length, 1);
  assert.strictEqual(r2.body.data.orders[0].tip_total_fen, 500);
});

// 19. home_probe_square(同步审核 N2): 代理 home-action 且 limit 钳制 ≤50
test('web: home_probe_square → 代理 home-action + limit 钳制', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const r1 = await run(sdk, apiEvent({ action: 'home_probe_square', limit: 99 }, { 'x-admin-key': KEY }));
  assert.strictEqual(r1.body.__proxied, 'home-action');
  assert.strictEqual(r1.body.__data.limit, 50, 'limit 超限钳制到 50');
  const r2 = await run(sdk, apiEvent({ action: 'home_probe_square' }, { 'x-admin-key': KEY }));
  assert.strictEqual(r2.body.__data.limit, 20, '缺省 limit=20');
});

// 20. home_probe_modify_audit(同步审核 N2): 直查 audit_log 改期类留痕
test('web: home_probe_modify_audit → 直查 count', async () => {
  const store = cfgWith(KEY, [ADMIN]);
  store.audit_log = { a1: { _id: 'a1', action: 'order_modify_apply', openid: 'u1', role: 'user', target_id: 'o1', result: 'ok', created_at: Date.now() } };
  const sdk = makeSdk({ openid: '', store });
  const { statusCode, body } = await run(sdk, apiEvent({ action: 'home_probe_modify_audit' }, { 'x-admin-key': KEY }));
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.data.count, 1);
});

// 21. init_db(同步审核 N2): 代理 init-db, 真实 action 走 __init_db_action(缺省 quick_check)
test('web: init_db → 代理 init-db + __init_db_action 透传', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const r1 = await run(sdk, apiEvent({ action: 'init_db' }, { 'x-admin-key': KEY }));
  assert.strictEqual(r1.body.__proxied, 'init-db');
  assert.strictEqual(r1.body.__data.action, 'quick_check', '缺省 quick_check');
  const r2 = await run(sdk, apiEvent({ action: 'init_db', __init_db_action: 'lookup' }, { 'x-admin-key': KEY }));
  assert.strictEqual(r2.body.__data.action, 'lookup', '__init_db_action 透传');
  assert.ok(!('__init_db_action' in r2.body.__data), '透传后删除冲突键');
});

// 22. seed_* 群 12 个 action(同步审核 N2): SEED_MAP 逐一映射 → 代理 zz-seed-orders
test('web: seed_* 12 action → SEED_MAP 全量映射代理 zz-seed-orders', async () => {
  const sdk = makeSdk({ openid: '', store: cfgWith(KEY, [ADMIN]) });
  const expect = {
    seed_run: 'run', seed_cleanup: 'cleanup', seed_count: 'count',
    seed_simulate: 'simulate', seed_cleanup_sim: 'cleanup_sim', seed_count_sim: 'count_sim',
    seed_service_orders: 'service_orders', seed_night_orders: 'night_orders',
    seed_cleanup_seed_orders: 'cleanup_seed_orders', seed_backfill_matched: 'backfill_matched',
    seed_scene_demands: 'scene_demands', seed_fix_sdm_city: 'fix_sdm_city'
  };
  for (const [act, mapped] of Object.entries(expect)) {
    const { body } = await run(sdk, apiEvent({ action: act }, { 'x-admin-key': KEY }));
    assert.strictEqual(body.__proxied, 'zz-seed-orders', `${act} 应代理 zz-seed-orders`);
    assert.strictEqual(body.__data.action, mapped, `${act} → ${mapped}`);
    assert.strictEqual(body.__data.__admin_web_proxy, true, '携代理握手键');
  }
});
