// order_extend_confirm.test.js · 评审第一档(2026-11-14) 加时确认「金额冻结」守护测试(零依赖 node:test)
// 背景: MVP 无加时补付通道(pay_transaction 无 extend 流水), 原 hourly 加时确认直接把 add_amount_fen
//       并入 total_fen/fee_fen/partner_income_fen → 未付金额进入结算基数(可提现余额)与退款上限。
// 修复: 加时只加时长不加金额(与 fixed 口径统一), fee/income 沿用订单现值。
// 本测试锁定:
//   ① hourly 加时确认 → duration_h 增加而 total_fen/fee_fen/partner_income_fen 冻结为订单现值;
//   ② 确认通知文案不再宣称「金额已合并进结算」;
//   ③ fixed 加时确认 → 金额本就不变(回归锚, 与 ab_equivalence extend_confirm_ok 口径一致)。
// 说明: mock OPENID 非空(=真实调用面), 走 fail-closed 分支; mock_openid 旁路仅用于云端测试面板。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);

function store(extra) {
  const o = {
    _id: OID, order_no: 'ORD-1', status: 'S3',
    user_openid: USER, partner_openid: PARTNER,
    total_fen: 1000, fee_fen: 100, partner_income_fen: 900, duration_h: 2
  };
  Object.assign(o, extra || {});
  o.pending_extend = o.pending_extend || {
    add_hours: 2, add_amount_fen: 500, by_openid: PARTNER,
    created_at: 1, expire_at: Date.now() + 86400000
  };
  return {
    order_main: { [OID]: o },
    order_status_log: {}, order_confirmations: {}, system_notice: {}, audit_log: {},
    admin_config: { global: {} }
  };
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

test('hourly 加时确认 → 时长+2h 而金额三字段冻结(不进入结算基数)', async () => {
  const sdk = makeSdk({ openid: USER, store: store({ pricing_type: 'hourly' }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'extend_confirm', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.duration_h, 4, '时长应 +2h');
  assert.equal(r.data.total_fen, 1000, 'total_fen 必须冻结为订单现值(未付金额不得并入)');

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.duration_h === 4);
  assert.ok(w, 'CAS 应写入 duration_h=4');
  assert.equal(w.data.total_fen, 1000);
  assert.equal(w.data.fee_fen, 100, 'fee_fen 沿用现值');
  assert.equal(w.data.partner_income_fen, 900, 'partner_income_fen 沿用现值(可提现基数不得膨胀)');
});

test('确认通知不再宣称「金额合并进结算」(改述加时暂不计费)', async () => {
  const sdk = makeSdk({ openid: USER, store: store({ pricing_type: 'hourly' }) });
  const mod = loadOrderAction(sdk);
  await mod.main({ action: 'extend_confirm', order_id: OID, mock_openid: USER }, {});
  const n = (sdk.writes.system_notice || []).find((x) => x.data && x.data.type === 'extend_confirm');
  assert.ok(n, '应写确认通知');
  assert.ok(!/合并进结算/.test(n.data.body || ''), '旧文案「已合并进结算」必须消失');
  assert.ok(/加时暂不计费/.test(n.data.body || ''), '新文案应注明加时暂不计费');
});

test('fixed 加时确认 → 金额不变(回归锚)', async () => {
  const sdk = makeSdk({ openid: USER, store: store({ pricing_type: 'fixed' }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'extend_confirm', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.duration_h, 4);
  assert.equal(r.data.total_fen, 1000);
  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.duration_h === 4);
  assert.ok(w && w.data.total_fen === 1000 && w.data.partner_income_fen === 900);
});

test('发起者本人确认 → oa_extend_self(只能由对方确认)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store({ pricing_type: 'hourly' }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'extend_confirm', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_extend_self');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});
