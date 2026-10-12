// order-timer 入口层契约测试（定时巡检 8 类状态超时/归档）
// 覆盖点：鉴权门 + S1/S0 超时取消、S3.5 中断转部分、S2_5 改期自动拒绝、
//         S3 里程碑自动确认、S5 超时默认评价、S8 售后归档、S4 裁定期升级 + 冻结/未到期守卫
// 该函数未参与 index.js 拆分，故用契约测试(mock SDK)而非 A/B 等价证明。
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
  delete require.cache[require.resolve('../order-timer/index.js')];
  return require('../order-timer/index.js');
}

const ADMIN = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const MIN = 60 * 1000, H = 3600 * 1000, D = 24 * H;

function baseStore(orders = {}, extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000, admin_openids: [ADMIN] } },
    order_main: orders,
    demand: {}, order_status_log: {}, system_notice: {}, evaluation: {},
    credit_score_log: {}, user_account: {}, platform_event: {}, audit_log: {}, withdraw_record: {}
  }, extra);
}
function ord(id, status, extra = {}) {
  return Object.assign({ _id: id, order_no: 'ORD-' + id, user_openid: USER, partner_openid: PARTNER, total_fen: 1000 }, extra, { status });
}
async function run(store, openid = ADMIN, event = {}) {
  const sdk = makeSdk({ openid, store });
  const { main } = loadIndex(sdk);
  const r = await main(event, {});
  return { r, sdk };
}

// 0. 鉴权门：非管理员、非定时器 → ot_forbidden
test('auth: 非管理员 → ot_forbidden', async () => {
  const { r } = await run(baseStore(), USER);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ot_forbidden');
});

// 1. S1 待确认超时(15min) → S6 取消 + 释放需求
test('S1 超时 → s1_cancel=1 且订单转 S6', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ A1: ord('A1', 'S1', { created_at: now - 20 * MIN, demand_id: 'd'.repeat(32) }) }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.counts.s1_cancel, 1);
  assert.deepStrictEqual(r.data.s1_cancel, ['ORD-A1']);
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'A1');
  assert.strictEqual(upd.data.status, 'S6');
});

// 2. S0 待支付超时 → S6 + 释放需求
test('S0 支付超时 → s0_close=1 且释放需求', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ B1: ord('B1', 'S0', { pay_expire_at: now - 1000, demand_id: 'e'.repeat(32) }) }));
  assert.strictEqual(r.data.counts.s0_close, 1);
  const dUpd = (sdk.writes.demand || []).find((w) => w.where && w.where._id === 'e'.repeat(32));
  assert.ok(dUpd, '应释放需求回 matching');
});

// 3. S3.5 中断超 24h → S4 部分完成
test('S3.5 中断超时 → interrupt_partial=1', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ C1: ord('C1', 'S3.5', { interrupted_at: now - 25 * H }) }));
  assert.strictEqual(r.data.counts.interrupt_partial, 1);
  assert.deepStrictEqual(r.data.interrupt_partial, ['ORD-C1']);
});

// 4. S2_5 改期确认超时 → 自动拒绝回原状态
test('S2_5 改期超时 → modify_auto_reject=1', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ D1: ord('D1', 'S2_5', { pending_modify: { from_status: 'S2', expire_at: now - 1000, by_openid: PARTNER } }) }));
  assert.strictEqual(r.data.counts.modify_auto_reject, 1);
});

// 5. S3 里程碑提交超 15min 未确认 → 全部自动确认
test('S3 里程碑超时 → milestone_auto_confirm=1', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ E1: ord('E1', 'S3', { milestone: { current: 1, submitted_at: now - 20 * MIN, confirmed: [false, false, false] } }) }));
  assert.strictEqual(r.data.counts.milestone_auto_confirm, 1);
  const upd = (sdk.writes.order_main || []).find((w) => w.doc === 'E1');
  assert.deepStrictEqual(upd.data['milestone.confirmed'], [true, true, true]);
});

// 6. S5 完成超 48h 未评价 → 默认 4 星 → S9 + 写系统评价
test('S5 超时 → auto_eval=1 + 系统默认评价 star=4', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ F1: ord('F1', 'S5', { service_completed_at: now - 49 * H }) }));
  assert.strictEqual(r.data.counts.auto_eval, 1);
  const ev = (sdk.writes.evaluation || []).find((w) => w.add);
  assert.ok(ev, '应写系统默认评价');
  assert.strictEqual(ev.data.star, 4);
  assert.strictEqual(ev.data.is_system, true);
});

// 7. S8 售后窗口(15d)届满 → S10 归档
test('S8 售后届满 → s8_archive=1 且转 S10', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ G1: ord('G1', 'S8', { evaluated_at: now - 16 * D }) }));
  assert.strictEqual(r.data.counts.s8_archive, 1);
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'G1');
  assert.strictEqual(upd.data.status, 'S10');
});

// 8. 守卫：S8 冻结中不归档
test('S8 冻结中 → 不归档(s8_archive=0)', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ H1: ord('H1', 'S8', { evaluated_at: now - 16 * D, frozen: true }) }));
  assert.strictEqual(r.data.counts.s8_archive, 0);
});

// 9. S4 裁定期(7d)届满 → 平台介入工单
test('S4 裁定期届满 → s4_escalate=1 + 写 platform_event', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ I1: ord('I1', 'S4', { updated_at: now - 8 * D }) }));
  assert.strictEqual(r.data.counts.s4_escalate, 1);
  const pe = (sdk.writes.platform_event || []).find((w) => w.add);
  assert.ok(pe, '应写 P1 平台事件');
  assert.strictEqual(pe.data.type, 's4_stale_escalate');
});

// 10. 守卫：S5 未到评价时限不处理
test('S5 未到时限 → auto_eval=0', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ J1: ord('J1', 'S5', { service_completed_at: now - 1000 }) }));
  assert.strictEqual(r.data.counts.auto_eval, 0);
});

test.after(() => { Module._load = origLoad; });
