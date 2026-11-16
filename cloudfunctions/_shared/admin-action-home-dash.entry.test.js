// admin-action 入口契约测试 · 批6 首页活动 + 看板族
// 只增不改：拦截 wx-server-sdk，断言「event 输入 → 返回 code」契约，零运行时改动。
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
  for (const f of ['../admin-action/index.js', '../admin-action/openid.js', '../admin-action/logger.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../admin-action/index.js');
}

const ADMIN = 'o_admin_1';

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// ── home_activity_create ──
test('home_activity_create: 标题为空/超长 → act_bad_title', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_create', activity: { title: '', type: 'banner', jump_to: 'scene_list' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_bad_title');
});

test('home_activity_create: type 非法 → act_bad_type', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_create', activity: { title: 't', type: 'xxx', jump_to: 'scene_list' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_bad_type');
});

test('home_activity_create: jump_to 非法 → act_bad_jump', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_create', activity: { title: 't', type: 'banner', jump_to: 'xxx' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_bad_jump');
});

test('home_activity_create: 开始>=结束 → act_bad_time', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_create', activity: { title: 't', type: 'banner', jump_to: 'scene_list', start_at: 2000, end_at: 1000 }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_bad_time');
});

test('home_activity_create: content.rules 非字符串数组 → act_bad_content', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_create', activity: { title: 't', type: 'banner', jump_to: 'scene_list', content: { rules: [1, 2] } }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_bad_content');
});

// ── home_activity_update ──
test('home_activity_update: 缺 id → act_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_update', id: '', patch: { title: 'x' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_bad_id');
});

test('home_activity_update: id 不存在 → act_not_found', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_update', id: 'ghost', patch: { title: 'x' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_not_found');
});

// ── home_activity_delete ──
test('home_activity_delete: 缺 id → act_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_delete', id: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_bad_id');
});

test('home_activity_delete: id 不存在 → act_not_found', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'home_activity_delete', id: 'ghost', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'act_not_found');
});

// ── dashboard（无 fail 码，验证成功路径不崩溃）──
test('dashboard: 成功路径返回 ok:true', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = {};
  store.partner_profile = {};
  store.demand = {};
  store.order_main = {};
  store.safety_report = {};
  store.pay_transaction = {};
  const sdk = makeSdk({ openid: '', store, countFromStore: true });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dashboard', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, true);
});

test.after(() => { Module._load = origLoad; });
