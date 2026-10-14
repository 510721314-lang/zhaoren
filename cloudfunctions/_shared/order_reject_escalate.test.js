// order_reject_escalate.test.js · 阶段G(G1, 2026-10-15) 「连续 2 次拒绝/不确认 → S10.5 争议」守护测试
// 依据: 状态机 no.26 guard「15min 超时未响应(或连续2次拒绝)」/ no.30 guard「30min 超时未响应(或连续2次不确认)」
// 锁定: order-action start_reject / finish_reject 计数达 2 时目标态由 S2/S3 改 S10.5,
//       事件改 start_apply_timeout / finish_confirm_timeout, 并写争议正交位。
//   ① start_reject 首次(count 0→1) → S2(行为不变, 回归锚点)
//   ② start_reject 连续第 2 次(order.start_reject_count=1) → S10.5 + escalated + 争议正交位
//   ③ finish_reject 首次 → S3(行为不变)
//   ④ finish_reject 连续第 2 次(order.finish_reject_count=1) → S10.5 + escalated
//   ⑤ start_reject 非需求方 → perm(不落库)
// 说明: mock OPENID 非空(=真实调用面); 首次分支为既有行为锚点(防回退)。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);

function store(status, extra) {
  const o = {
    _id: OID, order_no: 'ORD-1', status: status,
    user_openid: USER, partner_openid: PARTNER, total_fen: 1000
  };
  Object.assign(o, extra || {});
  return { order_main: { [OID]: o }, order_status_log: {}, system_notice: {}, audit_log: {}, admin_config: { global: {} } };
}

function loadOrderAction(sdk) {
  const orig = Module._load;
  Module._load = function (r) { if (r === 'wx-server-sdk') return sdk; return orig.apply(this, arguments); };
  const full = path.join(__dirname, '..', 'order-action', 'index.js');
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  Module._load = orig;
  return mod;
}

test('start_reject 首次 → S2(行为不变, 回归锚点)', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S2_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_reject', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true);
  assert.equal(r.data.status, 'S2');
  assert.equal(r.data.start_reject_count, 1);
  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S2');
  assert.ok(w, '应 CAS 写 S2');
});

test('start_reject 连续第 2 次 → S10.5 转争议(escalated)', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S2_6', { start_reject_count: 1 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_reject', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true);
  assert.equal(r.data.status, 'S10.5');
  assert.equal(r.data.escalated, true);
  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S10.5');
  assert.ok(w, '应 CAS 写 S10.5');
  assert.equal(w.data.dispute_state, 'open');
  assert.equal(w.data.dispute_type, 'start_timeout');
  assert.ok(w.data.dispute_opened_at > 0);
  assert.equal(w.data.start_reject_count, 2);
});

test('finish_reject 首次 → S3(行为不变, 回归锚点)', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S3_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'finish_reject', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true);
  assert.equal(r.data.status, 'S3');
  assert.equal(r.data.finish_reject_count, 1);
});

test('finish_reject 连续第 2 次 → S10.5 转争议(escalated)', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S3_6', { finish_reject_count: 1 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'finish_reject', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true);
  assert.equal(r.data.status, 'S10.5');
  assert.equal(r.data.escalated, true);
  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S10.5');
  assert.ok(w, '应 CAS 写 S10.5');
  assert.equal(w.data.dispute_type, 'finish_timeout');
});

test('start_reject 非需求方 → oa_start_reject_perm(不落库)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S2_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_reject', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'oa_start_reject_perm');
  assert.equal((sdk.writes.order_main || []).length, 0);
});
