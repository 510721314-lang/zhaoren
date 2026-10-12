// order-create 入口层契约测试（create_from_take / sign_disclaimer / check_signed / check_take_result）
// 覆盖点：身份 / 未知动作 / 参数校验 / 接单结果兜底查询 / 免责签署(成功+幂等) / 平台开关
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadIndex(sdk) {
  activeSdk = sdk;
  delete require.cache[require.resolve('../order-create/index.js')];
  return require('../order-create/index.js');
}

const USER = 'o_user_1';
const OID = 'a'.repeat(32);
const DID = 'd'.repeat(32);

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    user_account: { u1: { _id: 'u1', openid: USER } },
    demand: {}, disclaimer_signature: {}, order_main: {}
  }, extra);
}

// 1. 无身份
test('无 OPENID 且无 mock_openid → order_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'create_from_take', demand_id: DID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_no_openid');
});

// 2. 未知动作
test('未知动作 → order_unknown_action', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'bogus', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_unknown_action');
});

// 3. check_signed 缺场景
test('check_signed 缺 scene → check_no_scene', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'check_signed', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'check_no_scene');
});

// 4. sign_disclaimer 缺场景
test('sign_disclaimer 缺 scene → sign_no_scene', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sign_disclaimer', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'sign_no_scene');
});

// 5. check_take_result 非法 demand_id
test('check_take_result 非法 id → order_bad_demand_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'check_take_result', demand_id: 'ORD123', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_bad_demand_id');
});

// 6. check_take_result 需求不存在 → gone
test('check_take_result 需求不存在 → state=gone', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'check_take_result', demand_id: DID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.state, 'gone');
});

// 7. check_take_result 需求被他人接走 → not_mine
test('check_take_result 非本人接单 → state=not_mine', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ demand: { [DID]: { _id: DID, matched_openid: 'other' } } }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'check_take_result', demand_id: DID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.state, 'not_mine');
});

// 8. create_from_take 缺 demand_id
test('create_from_take 缺 demand_id → order_no_demand', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'create_from_take', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_no_demand');
});

// 9. create_from_take 非法 demand_id
test('create_from_take 非法 demand_id → order_bad_demand_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'create_from_take', demand_id: 'ORD123', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_bad_demand_id');
});

// 10. create_from_take 平台开关关闭 → access_disabled
test('create_from_take 平台交易关闭 → access_disabled', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000, switch_access: false } },
    demand: { [DID]: { _id: DID } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'create_from_take', demand_id: DID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'access_disabled');
});

// 11. sign_disclaimer 成功 → 落库 + signed
test('sign_disclaimer 成功 → signed 且写 disclaimer_signature', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sign_disclaimer', scene: 'W2', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.signed, true);
  assert.ok((sdk.writes.disclaimer_signature || []).some((w) => w.add), '应新增免责签署记录');
});

// 12. sign_disclaimer 幂等 → 已有记录返回 idempotent
test('sign_disclaimer 已签 → idempotent', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    disclaimer_signature: { s1: { _id: 's1', openid: USER, role: 'partner', scene: 'W2', is_deleted: false, signature_hash: 'realhash' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sign_disclaimer', scene: 'W2', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.idempotent, true);
});

test.after(() => { Module._load = origLoad; });
