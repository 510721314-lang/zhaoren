// im-conv 入口层契约测试（open / messages / kefu_messages / my_convs）
// 覆盖点：身份 / 未知动作 / ID 格式 / 越权(非参与方) / 会话不存在
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
  delete require.cache[require.resolve('../im-conv/index.js')];
  return require('../im-conv/index.js');
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
  const r = await main({ action: 'messages' }, {});
  assert.strictEqual(r.code, 'im_no_openid');
});

test('未知动作 → im_unknown_action', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'bogus', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_unknown_action');
});

test('open 非法 order_id → im_bad_order_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'open', order_id: 'ORD123', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_bad_order_id');
});

test('open 订单不存在 → im_not_found', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'open', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_not_found');
});

test('open 非参与方 → im_not_participant', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, user_openid: OTHER, partner_openid: 'p', status: 'S2' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'open', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_not_participant');
});

test('messages 非法 conv_id → im_bad_conv_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'messages', conv_id: 'bad', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_bad_conv_id');
});

test('messages 会话不存在 → im_conv_not_found', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'messages', conv_id: CID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_conv_not_found');
});

test('messages 非参与方 → im_not_participant', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    im_conversation: { [CID]: { _id: CID, user_openid: OTHER, partner_openid: 'p', is_deleted: false } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'messages', conv_id: CID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_not_participant');
});

test('kefu_messages 非法 conv_id → im_bad_conv_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'kefu_messages', conv_id: 'bad', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'im_bad_conv_id');
});

test('my_convs 成功返回列表', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'my_convs', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
});

// 会话关联订单含 demand_id → 批量反查 demand 拆出 demand_title/demand_desc(2026-10-17 新增展示)
test('my_convs: 会话关联订单 → demand.remark 拆为 demand_title/demand_desc', async () => {
  const DID = 'd'.repeat(32);
  const sdk = makeSdk({ openid: USER, store: baseStore({
    im_conversation: { [CID]: { _id: CID, order_id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: OTHER, is_deleted: false, last_msg_at: 1, user_unread: 0, partner_unread: 0 } },
    order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: OTHER, content_options: ['遛狗'], demand_id: DID } },
    demand: { [DID]: { _id: DID, remark: '帮我遛狗｜每天两次，每次 30 分钟' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'my_convs', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const c = (r.data.list || [])[0];
  assert.ok(c, '应返回会话');
  assert.strictEqual(c.demand_title, '帮我遛狗');
  assert.strictEqual(c.demand_desc, '每天两次，每次 30 分钟');
  assert.strictEqual(c.order_id, OID, '既有字段不受影响');
});

test.after(() => { Module._load = origLoad; });
