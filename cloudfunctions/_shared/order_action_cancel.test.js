// order-action · action_cancel 测试(2026-11-24 W3, 零依赖 node:test)
// 两层: ①cancelCfgOf 纯函数(配置映射兜底) ②入口契约(makeSdk mock: 输入→返回码 + 落库形状)
// 守护: 协商型取消四 action(cancel_request/confirm/reject/withdraw) — A/B KNOWN_EVOLUTION 登记的行为守护面
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');
const { cancelCfgOf } = require('../order-action/action_cancel');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);
const NOW = Date.now();
const H = 3600e3;

// ───────── ① cancelCfgOf 纯函数 ─────────
test('cancelCfgOf: 全缺省 → 开关关/窗口120/冷却60+1440, 档位字段 undefined(由规则函数兜底)', () => {
  const c = cancelCfgOf(null);
  assert.strictEqual(c.enable, false);
  assert.strictEqual(c.windowMin, 120);
  assert.strictEqual(c.withdrawCooldownMin, 60);
  assert.strictEqual(c.rejectedCooldownMin, 1440);
  assert.strictEqual(c.refund.far_hours, undefined);
  assert.strictEqual(c.refund.far_rate, undefined);
  assert.strictEqual(c.penalty.s3, undefined);
});

test('cancelCfgOf: 完整配置映射 + 百分数→小数(80→0.8)', () => {
  const c = cancelCfgOf({
    cancel_enable: true, cancel_confirm_window_min: 90,
    cancel_cooldown_withdraw_min: 30, cancel_cooldown_rejected_min: 720,
    cancel_refund_far_hours: 24, cancel_refund_mid_hours: 4,
    cancel_refund_far_rate_pct: 100, cancel_refund_mid_rate_pct: 80, cancel_refund_near_rate_pct: 50,
    cancel_penalty_s2_far: 5, cancel_penalty_s2_mid: 15, cancel_penalty_s2_near: 25,
    cancel_penalty_s3: 30, cancel_penalty_fulfill: 20
  });
  assert.strictEqual(c.enable, true);
  assert.strictEqual(c.windowMin, 90);
  assert.strictEqual(c.refund.far_rate, 1);
  assert.strictEqual(c.refund.mid_rate, 0.8);
  assert.strictEqual(c.refund.near_rate, 0.5);
  assert.strictEqual(c.penalty.s2_near, 25);
  assert.strictEqual(c.penalty.far_hours, 24);   // 档线与退款梯度同源
});

test('cancelCfgOf: 非法数值 → undefined(交由规则函数兜底), 负数窗口回退 120', () => {
  const c = cancelCfgOf({ cancel_confirm_window_min: -5, cancel_refund_far_rate_pct: 'x', cancel_penalty_s3: NaN });
  assert.strictEqual(c.windowMin, 120);
  assert.strictEqual(c.refund.far_rate, undefined);
  assert.strictEqual(c.penalty.s3, undefined);
});

test('cancelCfgOf 与 money_rules 兜底链衔接: 缺省 cfg 经 normalize 回退 §0.1 默认', () => {
  const { normalizeCancelRefundCfg, cancelRefundFen } = require('../order-action/money_rules');
  const cfg = cancelCfgOf({});
  const n = normalizeCancelRefundCfg(cfg.refund);
  assert.strictEqual(n.far_rate, 1.0);
  assert.strictEqual(n.mid_rate, 0.8);
  assert.strictEqual(n.near_rate, 0.5);
  assert.strictEqual(cancelRefundFen(20000, 10 * H, cfg.refund), 16000);
});

// ───────── ② 入口契约(makeSdk mock) ─────────
function store(over) {
  return Object.assign({
    order_main: { [OID]: Object.assign({
      _id: OID, order_no: 'ORD-C1', status: 'S2',
      user_openid: USER, partner_openid: PARTNER,
      fund: { paid_fen: 20000, refunded_fen: 0 },
      tip_total_fen: 1000,
      start_time: NOW - 1 * H   // 履约开始已过 1h → lead=0 → 近档(50%)
    }, over && over.order) },
    user_account: over && over.userAccount ? over.userAccount : {
      u1: { _id: 'u1', openid: USER, user_credit_score: 800, partner_credit_score: 800 }
    },
    order_status_log: {}, system_notice: {}, audit_log: {}, pay_transaction: {}, credit_score_log: {},
    admin_config: { global: over && over.config ? over.config : { cancel_enable: true } }
  }, over && over.extra);
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

test('cancel_request: cancel_enable=false → oa_cancel_disabled(不落库)', async () => {
  const sdk = makeSdk({ openid: USER, store: store({ config: {} }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'cancel_request', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'oa_cancel_disabled');
  assert.equal((sdk.writes.order_main || []).length, 0);
});

test('cancel_request: S2 用户发起 → ok pending + 写挂起(frozen=true) + 通知对方', async () => {
  const sdk = makeSdk({ openid: USER, store: store(), docUpdateWritesBack: true });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'cancel_request', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.pending, true);
  const w = (sdk.writes.order_main || [])[0];
  assert.ok(w, '应写 order_main');
  assert.equal(w.data.cancel_request.status, 'pending');
  assert.equal(w.data.cancel_request.by, 'user');
  assert.equal(w.data.frozen, true);
  const notice = (sdk.writes.system_notice || []).find((x) => x.add && x.data.to_openid === PARTNER);
  assert.ok(notice, '应通知对方');
  assert.equal(notice.data.type, 'cancel_request');
});

test('cancel_request: 自己已有 pending → 幂等 ok; 对方已有 pending → oa_cancel_pending', async () => {
  const crPending = { status: 'pending', by: 'user', by_openid: USER, at: NOW, deadline: NOW + 2 * H };
  const sdk1 = makeSdk({ openid: USER, store: store({ order: { cancel_request: crPending } }) });
  const mod1 = loadOrderAction(sdk1);
  const r1 = await mod1.main({ action: 'cancel_request', order_id: OID, mock_openid: USER }, {});
  assert.equal(r1.ok, true);
  assert.equal(r1.data.idempotent, true);
  const sdk2 = makeSdk({ openid: PARTNER, store: store({ order: { cancel_request: crPending } }) });
  const mod2 = loadOrderAction(sdk2);
  const r2 = await mod2.main({ action: 'cancel_request', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'oa_cancel_pending');
});

test('cancel_request: frozen → oa_order_frozen; 冷却期 → oa_cancel_cooldown', async () => {
  const sdk1 = makeSdk({ openid: USER, store: store({ order: { frozen: true } }) });
  const r1 = await loadOrderAction(sdk1).main({ action: 'cancel_request', order_id: OID, mock_openid: USER }, {});
  assert.equal(r1.code, 'oa_order_frozen');
  const sdk2 = makeSdk({ openid: USER, store: store({ order: { cancel_cooldown_until: NOW + 30 * 60000 } }) });
  const r2 = await loadOrderAction(sdk2).main({ action: 'cancel_request', order_id: OID, mock_openid: USER }, {});
  assert.equal(r2.code, 'oa_cancel_cooldown');
});

test('cancel_confirm: 发起方自确认 → oa_cancel_self_confirm', async () => {
  const sdk = makeSdk({ openid: USER, store: store({ order: { cancel_request: { status: 'pending', by: 'user', by_openid: USER, at: NOW, deadline: NOW + 2 * H } } }) });
  const r = await loadOrderAction(sdk).main({ action: 'cancel_confirm', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'oa_cancel_self_confirm');
});

test('cancel_confirm: 对方同意 → S7 + 单条 refund 流水(单款10500=订单10000+tip500) + 发起方扣25 + 清 frozen', async () => {
  const sdk = makeSdk({
    openid: PARTNER,
    store: store({ order: { cancel_request: { status: 'pending', by: 'user', by_openid: USER, at: NOW, deadline: NOW + 2 * H } } }),
    docUpdateWritesBack: true
  });
  const r = await loadOrderAction(sdk).main({ action: 'cancel_confirm', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.status, 'S7');
  assert.equal(r.data.refund_fen, 10000);        // lead=0 → 近档 50% × 20000
  assert.equal(r.data.tip_refund_fen, 500);      // tip 1000 × (10000/20000)
  assert.equal(r.data.total_refund_fen, 10500);
  assert.equal(r.data.credit_delta, -25);        // 近档默认扣 25
  // CAS 串行门 patch: 主轴 S7 + fund.refunded_fen _.inc + agreed + 清 frozen
  const w = (sdk.writes.order_main || [])[0];
  assert.ok(w && w.data.status === 'S7');
  assert.ok(w.data['fund.refunded_fen'] && w.data['fund.refunded_fen'].__sentinel === 'inc');
  assert.equal(w.data['cancel_request.status'], 'agreed');
  assert.equal(w.data.frozen, false);
  // 单条 refund 流水(D18): amount=10500, note 明细字段 refund_fen/tip_refund_fen
  const txn = (sdk.writes.pay_transaction || []).find((x) => x.add && x.data.type === 'refund');
  assert.ok(txn, '应写 refund 流水');
  assert.equal(txn.data.amount_fen, 10500);
  assert.equal(txn.data.refund_fen, 10000);
  assert.equal(txn.data.tip_refund_fen, 500);
  assert.equal(txn.data.is_mock, true);
  // 扣分: user_account 800-25=775 + credit_score_log(type=cancel)
  const ua = (sdk.writes.user_account || []).find((x) => x.doc);
  assert.ok(ua && ua.data.user_credit_score === 775);
  const cl = (sdk.writes.credit_score_log || []).find((x) => x.add);
  assert.ok(cl && cl.data.delta === -25 && cl.data.type === 'cancel' && cl.data.score === 775);
});

test('cancel_reject: 对方拒绝 → S10.5 + rejected + 写 24h 冷却 + pre_dispute_status', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store({ order: { cancel_request: { status: 'pending', by: 'user', by_openid: USER, at: NOW, deadline: NOW + 2 * H } } }), docUpdateWritesBack: true });
  const r = await loadOrderAction(sdk).main({ action: 'cancel_reject', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.status, 'S10.5');
  const w = (sdk.writes.order_main || [])[0];
  assert.equal(w.data.status, 'S10.5');
  assert.equal(w.data['cancel_request.status'], 'rejected');
  assert.equal(w.data.pre_dispute_status, 'S2');
  assert.ok(w.data.cancel_cooldown_until > NOW);
  assert.equal(w.data.dispute_type, 'cancel');
});

test('cancel_withdraw: 发起方撤回 → withdrawn + 清 frozen(主轴不变) + 写 1h 冷却', async () => {
  const sdk = makeSdk({ openid: USER, store: store({ order: { cancel_request: { status: 'pending', by: 'user', by_openid: USER, at: NOW, deadline: NOW + 2 * H } } }), docUpdateWritesBack: true });
  const r = await loadOrderAction(sdk).main({ action: 'cancel_withdraw', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.withdrawn, true);
  assert.equal(r.data.status, 'S2');
  const w = (sdk.writes.order_main || [])[0];
  assert.equal(w.data['cancel_request.status'], 'withdrawn');
  assert.equal(w.data.frozen, false);
  const cd = w.data.cancel_cooldown_until;
  assert.ok(cd > NOW && cd - NOW <= 61 * 60000);
});

test('cancel_withdraw: 非发起方 → oa_cancel_not_initiator', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store({ order: { cancel_request: { status: 'pending', by: 'user', by_openid: USER, at: NOW, deadline: NOW + 2 * H } } }) });
  const r = await loadOrderAction(sdk).main({ action: 'cancel_withdraw', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'oa_cancel_not_initiator');
});
