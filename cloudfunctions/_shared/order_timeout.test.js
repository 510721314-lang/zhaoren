// order_timeout.test.js · 阶段G(2026-10-15) 履约双确认两中间态超时守护测试(零依赖 node:test)
// 依据: docs/线下陪伴履约流程规范与流程图.md §C8(S2.6 开始履约申请 15min / S3.6 完毕确认 30min)
//       状态机 no.26(S2_6 --start_apply_timeout--> S10.5) / no.30(S3_6 --finish_confirm_timeout--> S10.5)
// 锁定 order-timer 扫描段落 processStartApplyTimeout / processFinishConfirmTimeout:
//   ① S2_6 时间锚(start_apply_at)超阈 → S10.5 + 争议正交位 + 双方 system_notice(dispute_open)
//   ② S2_6 未到阈值 → 不处理(守卫)
//   ③ S3_6 时间锚(finish_apply_at)超阈 → S10.5 + dispute_type=finish_timeout
//   ④ 状态不符(非待确认中间态) → 不处理
//   ⑤ 阈值走 admin_config(后台改配生效, 非写死 15min)
// 说明: 该函数(段落)不使用 A/B 等价证明, 故用入口层契约测试(mock SDK)。
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
  delete require.cache[require.resolve('../order-timer/index.js')];
  return require('../order-timer/index.js');
}

const ADMIN = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const MIN = 60 * 1000, H = 3600 * 1000;

function baseStore(orders = {}) {
  return {
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * H, admin_openids: [ADMIN] } },
    order_main: orders,
    demand: {}, order_status_log: {}, system_notice: {}, evaluation: {},
    credit_score_log: {}, user_account: {}, platform_event: {}, audit_log: {}, withdraw_record: {}
  };
}
function ord(id, status, extra = {}) {
  return Object.assign({ _id: id, order_no: 'ORD-' + id, user_openid: USER, partner_openid: PARTNER, total_fen: 1000 }, extra, { status });
}
async function run(store) {
  const sdk = makeSdk({ openid: ADMIN, store });
  const { main } = loadIndex(sdk);
  const r = await main({}, {});
  return { r, sdk };
}

// ① S2_6 开始履约申请超 15min → S10.5 争议
test('S2_6 超时 → start_apply_timeout=1 且转 S10.5 + 争议正交位 + 通知双方', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ P1: ord('P1', 'S2_6', { start_apply_at: now - 20 * MIN }) }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.data.counts.start_apply_timeout, 1);
  assert.deepStrictEqual(r.data.start_apply_timeout, ['ORD-P1']);
  // G3(2026-10-20): 提醒段先于超时段执行, 故 order_main 首写为提醒标记位; 按 status 定位超时 CAS 写
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'P1' && w.data && w.data.status === 'S10.5');
  assert.ok(upd, '应 CAS 写 order_main(S10.5)');
  assert.strictEqual(upd.data.status, 'S10.5');
  assert.strictEqual(upd.data.dispute_state, 'open');
  assert.strictEqual(upd.data.dispute_type, 'start_timeout');
  assert.ok(upd.data.dispute_opened_at > 0, '应写争议开立时间');
  assert.strictEqual(upd.data.complaint_by, '', '#01争议升级 complaint_by 应为空串(系统自动转)');
  assert.strictEqual(upd.data.complaint_from_status, 'S2_6', '#01 complaint_from_status 应记录起源态');
  assert.strictEqual(upd.data.frozen, true, '#01争议升级应置 frozen:true 对齐主动投诉路径');
  assert.strictEqual(upd.data.help_flag, true, '#03争议升级应置 help_flag:true 对齐主动投诉路径');
  // 提醒段到期会额外写 remind_sr* 通知, 故按 type 过滤仅统计争议通知
  const notices = (sdk.writes.system_notice || []).filter((w) => w.add && w.data.type === 'dispute_open');
  assert.strictEqual(notices.length, 2, '应通知双方');
});

// ② S2_6 未到阈值 → 不处理
test('S2_6 未超时 → start_apply_timeout=0', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ P2: ord('P2', 'S2_6', { start_apply_at: now - 5 * MIN }) }));
  assert.strictEqual(r.data.counts.start_apply_timeout, 0);
});

// ③ S3_6 完毕确认超 30min → S10.5 争议
test('S3_6 超时 → finish_confirm_timeout=1 且转 S10.5 + dispute_type=finish_timeout', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ P3: ord('P3', 'S3_6', { finish_apply_at: now - 40 * MIN }) }));
  assert.strictEqual(r.data.counts.finish_confirm_timeout, 1);
  assert.deepStrictEqual(r.data.finish_confirm_timeout, ['ORD-P3']);
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'P3' && w.data && w.data.status === 'S10.5');
  assert.strictEqual(upd.data.status, 'S10.5');
  assert.strictEqual(upd.data.dispute_type, 'finish_timeout');
  assert.strictEqual(upd.data.complaint_by, '', '#01争议升级 complaint_by 应为空串');
  assert.strictEqual(upd.data.complaint_from_status, 'S3_6', '#01 complaint_from_status 应记录起源态');
  assert.strictEqual(upd.data.frozen, true, '#01争议升级应置 frozen:true');
  assert.strictEqual(upd.data.help_flag, true, '#03争议升级应置 help_flag:true');
});

// ④ 状态不符(非待确认中间态) → 不处理
test('S3 状态(非 S3_6) → finish_confirm_timeout=0', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ P4: ord('P4', 'S3', { finish_apply_at: now - 40 * MIN }) }));
  assert.strictEqual(r.data.counts.finish_confirm_timeout, 0);
});

// ⑤ 阈值走 admin_config(改配 30min 后, 20min 不触发)
test('admin_config 配 start_apply_timeout_min=30 → 20min 不触发', async () => {
  const now = Date.now();
  const store = baseStore({ P5: ord('P5', 'S2_6', { start_apply_at: now - 20 * MIN }) });
  store.admin_config.global.start_apply_timeout_min = 30;
  const { r } = await run(store);
  assert.strictEqual(r.data.counts.start_apply_timeout, 0);
});

// ⑤b finish 侧对称守护: 配 finish_confirm_timeout_min=30 → 20min 不触发
test('admin_config 配 finish_confirm_timeout_min=30 → 20min 不触发', async () => {
  const now = Date.now();
  const store = baseStore({ P5B: ord('P5B', 'S3_6', { finish_apply_at: now - 20 * MIN }) });
  store.admin_config.global.finish_confirm_timeout_min = 30;
  const { r } = await run(store);
  assert.strictEqual(r.data.counts.finish_confirm_timeout, 0);
});

// ── G3(2026-10-20) 超时前提醒守护(PRD: docs/prd-g3-timeout-reminder-20261019.md) ──
// ⑥ S2_6 超 5min → 第 1 档提醒(站内信 remind_sr1 + 写幂等标记 start_apply_remind1_at), 未转争议
test('G3: S2_6 超 5min → start_apply_remind=1 (remind_sr1) 且未转争议', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ R1: ord('R1', 'S2_6', { start_apply_at: now - 6 * MIN }) }));
  assert.strictEqual(r.data.counts.start_apply_remind, 1);
  assert.deepStrictEqual(r.data.start_apply_remind, ['ORD-R1:sr1']);
  assert.strictEqual(r.data.counts.start_apply_timeout, 0);
  const mark = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'R1' && w.data && w.data.start_apply_remind1_at > 0);
  assert.ok(mark, '应写幂等标记 start_apply_remind1_at');
  const n = (sdk.writes.system_notice || []).find((w) => w.add && w.data.type === 'remind_sr1');
  assert.ok(n, '应发 remind_sr1 站内信');
  assert.strictEqual(n.data.to_openid, USER);
});

// ⑦ S2_6 超 11min → 两档齐发(仍在 15min 超时前)
test('G3: S2_6 超 11min → start_apply_remind=2 (sr1+sr2)', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ R2: ord('R2', 'S2_6', { start_apply_at: now - 11 * MIN }) }));
  assert.strictEqual(r.data.counts.start_apply_remind, 2);
  assert.deepStrictEqual(r.data.start_apply_remind, ['ORD-R2:sr1', 'ORD-R2:sr2']);
  assert.strictEqual(r.data.counts.start_apply_timeout, 0);
});

// ⑧ 幂等: 已写 remind1 → 本轮仅补 sr2
test('G3: S2_6 已标记 remind1 → 仅补 sr2', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ R3: ord('R3', 'S2_6', { start_apply_at: now - 11 * MIN, start_apply_remind1_at: now - 6 * MIN }) }));
  assert.deepStrictEqual(r.data.start_apply_remind, ['ORD-R3:sr2']);
});

// ⑨ S3_6 超 12min → fr1(30min 窗口第 1 档 10min)
test('G3: S3_6 超 12min → finish_confirm_remind=1 (fr1)', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ R4: ord('R4', 'S3_6', { finish_apply_at: now - 12 * MIN }) }));
  assert.strictEqual(r.data.counts.finish_confirm_remind, 1);
  assert.deepStrictEqual(r.data.finish_confirm_remind, ['ORD-R4:fr1']);
  assert.strictEqual(r.data.counts.finish_confirm_timeout, 0);
  const mark = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'R4' && w.data && w.data.finish_confirm_remind1_at > 0);
  assert.ok(mark, '应写幂等标记 finish_confirm_remind1_at');
});

// ⑩ 互斥: 取消挂起 → 不提醒
test('G3: S2_6 取消挂起 → 不提醒', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ R5: ord('R5', 'S2_6', { start_apply_at: now - 11 * MIN, cancel_request: { status: 'pending' } }) }));
  assert.strictEqual(r.data.counts.start_apply_remind, 0);
});

// ⑪ 可配: start_apply_remind1_min=0 / remind2_min=30 / 超时 60 → 20min 仅 sr1
test('G3: 后台改配提醒时刻生效', async () => {
  const now = Date.now();
  const store = baseStore({ R6: ord('R6', 'S2_6', { start_apply_at: now - 20 * MIN }) });
  store.admin_config.global.start_apply_remind1_min = 0;
  store.admin_config.global.start_apply_remind2_min = 30;
  store.admin_config.global.start_apply_timeout_min = 60;
  const { r } = await run(store);
  assert.deepStrictEqual(r.data.start_apply_remind, ['ORD-R6:sr1']);
});

test.after(() => { Module._load = origLoad; });
