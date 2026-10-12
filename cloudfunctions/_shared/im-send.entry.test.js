// im-send 入口层契约测试（send_kefu / send_template / send_text）
// 覆盖点：身份 / 未知动作 / ID 格式 / 越权 / 空文本
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
  delete require.cache[require.resolve('../im-send/index.js')];
  return require('../im-send/index.js');
}

const USER = 'o_user_1';
const OTHER = 'o_other';
const OID = 'a'.repeat(32);
const CID = 'c'.repeat(32);

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    order_main: {}, im_conversation: {}
  }, extra);
}

test('无 OPENID → im_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'send_text' }, {});
  assert.strictEqual(r.code, 'im_no_openid');
});

test('未知动作 → im_unknown_action', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'bogus', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_unknown_action');
});

test('send_kefu 非法 conv_id → im_bad_conv_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'send_kefu', conv_id: 'bad', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_bad_conv_id');
});

test('send_kefu 非会话参与方 → im_not_participant', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'send_kefu', conv_id: CID, text: 'hi', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_not_participant');
});

test('send_kefu 空文本 → im_empty_text', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    im_conversation: { [CID]: { _id: CID, kefu_openid: USER, is_deleted: false } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'send_kefu', conv_id: CID, text: '', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_empty_text');
});

test('send_text 非法 order_id → im_bad_order_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'send_text', order_id: 'ORD123', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_bad_order_id');
});

test('send_text 订单不存在 → im_not_found', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'send_text', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_not_found');
});

test('send_text 非参与方 → im_not_participant', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, user_openid: OTHER, partner_openid: 'p', status: 'S3' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'send_text', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_not_participant');
});

test.after(() => { Module._load = origLoad; });
