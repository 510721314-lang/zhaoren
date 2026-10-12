// demand-publish 入口层契约测试（publish / cancel / detail / save_draft / delete_draft）
// 覆盖点：身份 / 未知动作 / 场景白名单 / 时间校验 / ID 格式 / 草稿空内容
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
  delete require.cache[require.resolve('../demand-publish/index.js')];
  return require('../demand-publish/index.js');
}

const USER = 'o_user_1';
const DID = 'd'.repeat(32);

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    user_account: { u1: { _id: 'u1', openid: USER } },
    demand: {}
  }, extra);
}

test('无 OPENID → publish_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish' }, {});
  assert.strictEqual(r.code, 'publish_no_openid');
});

test('未知动作 → publish_unknown_action', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'bogus', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'publish_unknown_action');
});

test('publish 场景不在白名单 → publish_scene_invalid', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish', scene: 'ZZZ', start_time: Date.now() + 3600000, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'publish_scene_invalid');
});

test('publish 开始时间非未来 → publish_start_time', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish', scene: 'W1', start_time: Date.now() - 1000, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'publish_start_time');
});

test('cancel 缺 demand_id → cancel_no_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'cancel_no_id');
});

test('cancel 非法 id → cancel_bad_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel', demand_id: 'DR123', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'cancel_bad_id');
});

test('detail 缺 demand_id → detail_no_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'detail', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'detail_no_id');
});

test('detail 非法 id → detail_bad_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'detail', demand_id: 'DR123', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'detail_bad_id');
});

test('save_draft 空内容 → draft_no_data', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'save_draft', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'draft_no_data');
});

test('delete_draft 缺 draft_id → draft_no_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'delete_draft', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'draft_no_id');
});

test.after(() => { Module._load = origLoad; });
