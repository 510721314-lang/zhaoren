// safety-report 入口层契约测试（report_user / sos / resolve_sos）
// 覆盖点：身份 / 未知动作 / 举报对象校验 / 举报成功+幂等 / ID 格式 / 越权 / 状态门 / 管理员权限
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
  delete require.cache[require.resolve('../safety-report/index.js')];
  return require('../safety-report/index.js');
}

const USER = 'o_user_1';
const OTHER = 'o_other';
const OID = 'a'.repeat(32);

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    order_main: {}, safety_report: {}
  }, extra);
}

test('无 OPENID → sr_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sos' }, {});
  assert.strictEqual(r.code, 'sr_no_openid');
});

test('未知动作 → sr_unknown_action', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'bogus', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_unknown_action');
});

test('report_user 对象类型非法 → sr_bad_target', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'report_user', target_type: 'order', target_id: 'x', reason: 'r', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_bad_target');
});

test('report_user 缺原因 → sr_report_missing', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'report_user', target_type: 'partner_profile', target_id: 't1', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_report_missing');
});

test('report_user 成功 → 写 safety_report', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'report_user', target_type: 'partner_profile', target_id: 't1', reason: '正常举报', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.ok((sdk.writes.safety_report || []).some((w) => w.add), '应新增举报记录');
});

test('report_user 10 分钟内重复 → 幂等', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    safety_report: { r1: { _id: 'r1', reporter_openid: USER, target_type: 'partner_profile', target_id: 't1', type: 'user_report', is_deleted: false, created_at: Date.now() } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'report_user', target_type: 'partner_profile', target_id: 't1', reason: '正常举报', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.idempotent, true);
});

test('sos 非法 order_id → sr_bad_order_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sos', order_id: 'ORD123', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_bad_order_id');
});

test('sos 订单不存在 → sr_not_found', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sos', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_not_found');
});

test('sos 非参与方 → sr_not_participant', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, user_openid: OTHER, partner_openid: 'p', status: 'S2' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sos', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_not_participant');
});

test('sos 非活跃状态 → sr_status_not_allowed', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, user_openid: USER, partner_openid: 'p', status: 'S8' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sos', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_status_not_allowed');
});

test('resolve_sos 非管理员 → sr_not_admin', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, user_openid: USER, partner_openid: 'p', status: 'S2' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'resolve_sos', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_not_admin');
});

test.after(() => { Module._load = origLoad; });
