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
