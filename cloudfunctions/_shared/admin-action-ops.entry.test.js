// admin-action 入口契约测试 · 批3 运营族（notice/kefu/im/dispute/noshow/audit/report）
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
const DOC = 'a'.repeat(32); // 合法 docId（32 hex）

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// ── notice_send ──
test('notice_send: 空标题 → notice_bad_title', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_send', title: '', body: 'b', audience: 'all', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'notice_bad_title');
});

test('notice_send: 空正文 → notice_bad_body', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_send', title: 't', body: '', audience: 'all', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'notice_bad_body');
});

test('notice_send: audience 非法 → notice_bad_audience', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_send', title: 't', body: 'b', audience: 'xxx', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'notice_bad_audience');
});

test('notice_send: audience=one 但 openid 非法 → notice_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_send', title: 't', body: 'b', audience: 'one', target_openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'notice_bad_openid');
});

test('notice_send: audience=all 无目标用户 → notice_no_target', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_send', title: 't', body: 'b', audience: 'all', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'notice_no_target');
});

test('notice_send: 10 分钟内重复群发 → notice_too_frequent', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = { u1: { _id: 'u1', openid: 'o1' }, u2: { _id: 'u2', openid: 'o2' } };
  store.platform_event = {
    e1: { _id: 'e1', type: 'notice_send', openid: ADMIN, created_at: Date.now() - 60000 }
  };
  const sdk = makeSdk({ openid: '', store, countFromStore: true });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_send', title: 't', body: 'b', audience: 'all', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'notice_too_frequent');
});

// ── kefu_conv_reply ──
test('kefu_conv_reply: conv_id 非法 → kefu_bad_conv', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'kefu_conv_reply', conv_id: 'bad', text: 'hi', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'kefu_bad_conv');
});

test('kefu_conv_reply: 空文本 → kefu_empty', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'kefu_conv_reply', conv_id: DOC, text: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'kefu_empty');
});

test('kefu_conv_reply: 文本超长 → kefu_too_long', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'kefu_conv_reply', conv_id: DOC, text: 'x'.repeat(501), mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'kefu_too_long');
});

test('kefu_conv_reply: 会话不存在 → kefu_conv_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.im_conversation = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'kefu_conv_reply', conv_id: DOC, text: 'hi', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'kefu_conv_not_found');
});

test('kefu_conv_reply: 引用消息 ID 非法 → kefu_bad_quote', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.im_conversation = { [DOC]: { _id: DOC, is_deleted: false } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'kefu_conv_reply', conv_id: DOC, text: 'hi', quote: { msg_id: 'bad' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'kefu_bad_quote');
});

// ── im_message_admin_list ──
test('im_message_admin_list: 无目标 → im_no_target', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'im_message_admin_list', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'im_no_target');
});

test('im_message_admin_list: order_no 不存在 → im_conv_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'im_message_admin_list', order_no: 'NO999', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'im_conv_not_found');
});

// ── dispute_handle ──
test('dispute_handle: order_id 非法 → dispute_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dispute_handle', order_id: 'bad', decision: 'open', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'dispute_bad_id');
});

test('dispute_handle: 订单不存在 → dispute_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dispute_handle', order_id: DOC, decision: 'open', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'dispute_not_found');
});

test('dispute_handle: decision 非法 → dispute_bad_decision', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = { [DOC]: { _id: DOC, status: 'S10' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dispute_handle', order_id: DOC, decision: 'xxx', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'dispute_bad_decision');
});

test('dispute_handle: 状态流转非法 → dispute_bad_transition', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = { [DOC]: { _id: DOC, status: 'S5' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dispute_handle', order_id: DOC, decision: 'open', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'dispute_bad_transition');
});

test('dispute_handle: 无处置说明 → dispute_no_note', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = { [DOC]: { _id: DOC, status: 'S10' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dispute_handle', order_id: DOC, decision: 'open', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'dispute_no_note');
});

// ── dispute_detail ──
test('dispute_detail: order_id 非法 → dispute_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dispute_detail', order_id: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'dispute_bad_id');
});

test('dispute_detail: 订单不存在 → dispute_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'dispute_detail', order_id: DOC, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'dispute_not_found');
});

// ── no_show_decide ──
test('no_show_decide: report_id 非法 → ns_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'no_show_decide', report_id: 'bad', verdict: 'upheld', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ns_bad_id');
});

test('no_show_decide: verdict 非法 → ns_bad_verdict', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'no_show_decide', report_id: DOC, verdict: 'xxx', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ns_bad_verdict');
});

test('no_show_decide: 无裁定说明 → ns_no_note', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'no_show_decide', report_id: DOC, verdict: 'upheld', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ns_no_note');
});

test('no_show_decide: 申诉不存在 → ns_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.no_show_report = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'no_show_decide', report_id: DOC, verdict: 'upheld', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ns_not_found');
});

// ── no_show_report_list ──
test('no_show_report_list: report_id 非法 → ns_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'no_show_report_list', report_id: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ns_bad_id');
});

test('no_show_report_list: 申诉不存在 → ns_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.no_show_report = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'no_show_report_list', report_id: DOC, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ns_not_found');
});

// ── audit_query ──
test('audit_query: openid 非法 → aq_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'audit_query', openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'aq_bad_openid');
});

// ── audit_verify ──
test('audit_verify: openid 非法 → av_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'audit_verify', openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'av_bad_openid');
});

// ── report_handle ──
test('report_handle: report_id 非法 → report_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'report_handle', report_id: 'bad', note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'report_bad_id');
});

test('report_handle: 无处理说明 → report_no_note', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'report_handle', report_id: DOC, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'report_no_note');
});

test('report_handle: 举报不存在 → report_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.safety_report = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'report_handle', report_id: DOC, note: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'report_not_found');
});

// ── sop_project_*（批1，feature-plan-service-sop-20261121）：入参校验在查库前返回，零副作用 ──
test('sop_project_save: scene_code 空 → sop_bad_scene', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.admin_config.global.scene_list = [{ code: 'W1', name: '测试' }];
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sop_project_save', name: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'sop_bad_scene');
});

test('sop_project_save: scene_code 不在白名单 → sop_scene_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.admin_config.global.scene_list = [{ code: 'W1', name: '测试' }];
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sop_project_save', scene_code: 'W999', name: 'n', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'sop_scene_not_found');
});

test('sop_project_delete: _id 空 → sop_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sop_project_delete', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'sop_bad_id');
});

test('sop_project_status: status 非法 → sop_bad_status', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sop_project_status', _id: DOC, status: 'xxx', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'sop_bad_status');
});

test.after(() => { Module._load = origLoad; });
