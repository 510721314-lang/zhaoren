// safety-report 入口层契约测试（全部 11 个 action）
// 覆盖点：身份 / 未知动作 / 举报对象校验 / 举报成功+幂等 / ID 格式 / 越权 / 状态门 / 管理员权限
// 补充：silent_sos / cancel_silent_sos / resolve / checkin / status / free_sos_status
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

// ───────── 订单内求助: 静默求助 / 撤销 / 解除 / 报备 / 状态 ─────────
const SID = 'b'.repeat(32);

test('silent_sos 成功 → 写 sub_type=silent 且置 help_flag', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2', scene: 'W2' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'silent_sos', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.help_flag, true);
  const add = (sdk.writes.safety_report || []).find((w) => w.add);
  assert.ok(add && add.data.sub_type === 'silent' && add.data.status === 'active', '应写 sub_type=silent 的进行中求助');
  const upd = (sdk.writes.order_main || []).find((w) => w.doc === OID);
  assert.ok(upd && upd.data.help_flag === true, '应置订单 help_flag');
});

test('cancel_silent_sos 发起人撤销 → cancelled + help_flag=false', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2' } },
    safety_report: { [SID]: {
      _id: SID, order_id: OID, reporter_openid: USER, reporter_role: 'user', type: 'sos', sub_type: 'silent',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel_silent_sos', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.help_flag, false);
  const upd = (sdk.writes.safety_report || []).find((w) => w.doc === SID);
  assert.ok(upd && upd.data.status === 'cancelled', '静默求助应置 cancelled');
});

test('cancel_silent_sos 一键求助 → sr_not_silent', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2' } },
    safety_report: { [SID]: {
      _id: SID, order_id: OID, reporter_openid: USER, reporter_role: 'user', type: 'sos', sub_type: '',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel_silent_sos', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_not_silent');
});

test('resolve 发起人解除 → resolved + help_flag=false', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2' } },
    safety_report: { [SID]: {
      _id: SID, order_id: OID, reporter_openid: USER, reporter_role: 'user', type: 'sos', sub_type: '',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'resolve', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.help_flag, false);
  const upd = (sdk.writes.safety_report || []).find((w) => w.doc === SID);
  assert.ok(upd && upd.data.status === 'resolved', '求助应置 resolved');
});

test('resolve 非求助发起人的参与方 → sr_resolve_not_reporter', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2' } },
    safety_report: { [SID]: {
      _id: SID, order_id: OID, reporter_openid: OTHER, reporter_role: 'partner', type: 'sos', sub_type: '',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'resolve', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_resolve_not_reporter');
});

test('checkin 成功(W1) → 写 checkin 记录并返回下次报备时间', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2', scene: 'W1' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'checkin', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.type, 'checkin');
  assert.strictEqual(typeof r.data.next_checkin_at, 'number', 'W1 应返回下次报备时间');
  const add = (sdk.writes.safety_report || []).find((w) => w.add);
  assert.ok(add && add.data.type === 'checkin' && add.data.status === 'done', '应写 done 状态报备记录');
});

test('checkin 60s 内重复 → sr_checkin_too_frequent', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2' } },
    safety_report: { [SID]: {
      _id: SID, order_id: OID, reporter_openid: USER, reporter_role: 'user', type: 'checkin',
      status: 'done', is_deleted: false, created_at: Date.now() - 10 * 1000
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'checkin', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_checkin_too_frequent');
});

test('status 参与方 → 返回 help_flag / 最近报备 / 联系人', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: 'p', status: 'S2', help_flag: true } },
    safety_report: { [SID]: {
      _id: SID, order_id: OID, reporter_openid: USER, reporter_role: 'user', type: 'checkin',
      status: 'done', is_deleted: false, created_at: Date.now(), location: { latitude: 39.9, longitude: 116.4 }, note: '平安'
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'status', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.order_id, OID);
  assert.strictEqual(r.data.help_flag, true);
  assert.strictEqual(r.data.active_sos, null, '无进行中求助时应为 null');
  assert.strictEqual(r.data.checkins.length, 1);
  assert.strictEqual(r.data.checkins[0].has_location, true);
  assert.ok(Array.isArray(r.data.my_contacts));
});

test('status 非参与方 → sr_not_participant', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', user_openid: OTHER, partner_openid: 'p', status: 'S2' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'status', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_not_participant');
});

// ───────── P2-11 自由求助(无订单) ─────────
const FREE_ID = 'f'.repeat(32);

test('free_sos 首次上报 → 写 safety_report + platform_event(P0)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.ok((sdk.writes.safety_report || []).some((w) => w.add), '应新增自由求助记录');
  const ev = (sdk.writes.platform_event || []).find((w) => w.add);
  assert.ok(ev && ev.data.level === 'P0' && ev.data.type === 'safety_sos_free', '应写 P0 自由求助事件');
});

test('free_sos 已有进行中 → 幂等且不重复写记录', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    safety_report: { [FREE_ID]: {
      _id: FREE_ID, order_id: '', reporter_openid: USER, type: 'sos', sub_type: 'free',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.idempotent, true);
  assert.strictEqual((sdk.writes.safety_report || []).filter((w) => w.add).length, 0, '幂等不应新增记录');
});

test('free_sos 解除后 10 分钟内 → sr_free_cooldown', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    safety_report: { [FREE_ID]: {
      _id: FREE_ID, order_id: '', reporter_openid: USER, type: 'sos', sub_type: 'free',
      status: 'resolved', is_deleted: false, created_at: Date.now() - 60 * 1000
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_free_cooldown');
});

test('free_sos_resolve 本人解除 → active→resolved', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    safety_report: { [FREE_ID]: {
      _id: FREE_ID, order_id: '', reporter_openid: USER, type: 'sos', sub_type: 'free',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos_resolve', report_id: FREE_ID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'resolved');
  assert.strictEqual(r.data.resolved_by, 'self');
});

test('free_sos_resolve 他人记录且非管理员 → sr_not_admin', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    safety_report: { [FREE_ID]: {
      _id: FREE_ID, order_id: '', reporter_openid: OTHER, type: 'sos', sub_type: 'free',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos_resolve', report_id: FREE_ID, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_not_admin');
});

test('free_sos_resolve 无进行中求助 → sr_no_active_sos', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos_resolve', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'sr_no_active_sos');
});

test('free_sos_status 无进行中 → active=false 且 report_id 为空', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos_status', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.active, false);
  assert.strictEqual(r.data.report_id, '');
  assert.ok(Array.isArray(r.data.my_contacts));
});

test('free_sos_status 有进行中 → active=true 且返回 report_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    safety_report: { [FREE_ID]: {
      _id: FREE_ID, order_id: '', reporter_openid: USER, type: 'sos', sub_type: 'free',
      status: 'active', is_deleted: false, created_at: Date.now()
    } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'free_sos_status', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.active, true);
  assert.strictEqual(r.data.report_id, FREE_ID);
  assert.strictEqual(typeof r.data.created_at, 'number');
});

test.after(() => { Module._load = origLoad; });
