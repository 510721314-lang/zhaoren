// payment-mock 入口层契约测试（withdraw / fast_withdraw）
// 覆盖点：金额格式 / 最低额 / 极速单笔上限 / 余额不足 / 极速当日累计 / 成功落单
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
  delete require.cache[require.resolve('../payment-mock/index.js')];
  return require('../payment-mock/index.js');
}

const OPENID = 'o_partner_1';
function baseStore(extra = {}) {
  return { admin_config: { global: Object.assign({ env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 }, extra) } };
}
// 模拟已结算收入 50000 分(500元), 无提现占用
function baseAgg(extra = {}) {
  return Object.assign({
    order_main: [{ total: 50000, tip: 0 }],
    withdraw_record: []
  }, extra);
}

// 1. 金额格式错误 → wd_amount（锁前返回，无 DB 依赖）
test('withdraw: 非法金额 → wd_amount', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 'abc', mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_amount');
});

// 2. 低于最低 10 元 → wd_too_small
test('withdraw: 低于 10 元 → wd_too_small', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 500, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_too_small');
});

// 3. 极速单笔超 200 元 → wd_fast_cap
test('fast_withdraw: 超单笔上限 → wd_fast_cap', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'fast_withdraw', amount_fen: 30000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_fast_cap');
});

// 4. 余额不足 → wd_insufficient（聚合返回空 → available=0）
test('withdraw: 余额不足 → wd_insufficient', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore(), agg: { order_main: [], withdraw_record: [] } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 5000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_insufficient');
});

// 5. 极速提现成功 → 即时到账 status=success
test('fast_withdraw: 合法极速提现 → ok + status=success(即时到账)', async () => {
  const sdk = makeSdk({
    openid: OPENID, store: baseStore(),
    agg: { order_main: [{ total: 500000, tip: 0 }], withdraw_record: [] }
  });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'fast_withdraw', amount_fen: 5000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'success');
  assert.strictEqual(r.data.type, 'fast');
});

// 6. 普通提现成功 → processing + 写 withdraw_record
test('withdraw: 合法提现 → ok + 落 withdraw_record(status=processing)', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore(), agg: baseAgg() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 5000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'processing');
  assert.strictEqual(r.data.amount_fen, 5000);
  const rec = (sdk.writes.withdraw_record || []).find((w) => w.add);
  assert.ok(rec, '应写入 withdraw_record');
  assert.strictEqual(rec.data.type, 'normal');
});

// ── #22 结算: balance_info(可提现 = Σ已结算基数 − 提现占用) + T+1 到账回写 ──

// 7. 已结算 50000 − 处理中 10000 − 已提现 5000 → 可提现 35000
test('balance_info: 结算口径 → withdrawable=35000 + 触发到账回写', async () => {
  const sdk = makeSdk({
    openid: OPENID, store: baseStore(),
    agg: { order_main: [{ total: 50000, tip: 0 }], withdraw_record: [{ _id: 'processing', total: 10000 }, { _id: 'success', total: 5000 }] }
  });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'balance_info', mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.total_income_fen, 50000);
  assert.strictEqual(r.data.processing_fen, 10000);
  assert.strictEqual(r.data.withdrawable_fen, 35000);
  // 结算入口应调用 settleDueWithdrawals: 对 processing 且到期的提现单回写
  const settleUpd = (sdk.writes.withdraw_record || []).find((w) => w.where && w.where.status === 'processing');
  assert.ok(settleUpd, 'balance_info 应触发 T+1 到账回写(due processing → success)');
});

// 8. 无已结算收入 → 可提现 0
test('balance_info: 无收入 → withdrawable=0', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore(), agg: { order_main: [], withdraw_record: [] } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'balance_info', mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.withdrawable_fen, 0);
});

// 9. 提现占用 ≥ 已结算 → 可提现钳为 0(不为负)
test('balance_info: 提现占用超已结算 → withdrawable 钳为 0', async () => {
  const sdk = makeSdk({
    openid: OPENID, store: baseStore(),
    agg: { order_main: [{ total: 5000, tip: 0 }], withdraw_record: [{ _id: 'processing', total: 99999 }] }
  });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'balance_info', mock_openid: OPENID }, {});
  assert.strictEqual(r.data.withdrawable_fen, 0);
});

// 10. 打赏(tip)计入可结算收入
test('balance_info: 打赏计入可结算收入', async () => {
  const sdk = makeSdk({
    openid: OPENID, store: baseStore(),
    agg: { order_main: [{ total: 50000, tip: 2000 }], withdraw_record: [] }
  });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'balance_info', mock_openid: OPENID }, {});
  assert.strictEqual(r.data.total_income_fen, 52000);
  assert.strictEqual(r.data.tip_income_fen, 2000);
  assert.strictEqual(r.data.withdrawable_fen, 52000);
});

// 11. P2-12/13: 今日待履约只计今日 start_time 且状态未完成(S2/S3/S3.5); 本周收入为新增字段
test('balance_info: today_pending 只计今日 start_time 且状态未完成', async () => {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const store = baseStore();
  store.order_main = {
    o1: { _id: 'o1', partner_openid: OPENID, status: 'S3', start_time: t0 + 3600000 },
    o2: { _id: 'o2', partner_openid: OPENID, status: 'S2', start_time: t0 + 7200000 },
    o3: { _id: 'o3', partner_openid: OPENID, status: 'S5', start_time: t0 + 10800000 },
    o4: { _id: 'o4', partner_openid: OPENID, status: 'S3', start_time: t0 - 86400000 },
    o5: { _id: 'o5', partner_openid: 'o_other', status: 'S3', start_time: t0 + 3600000 }
  };
  const sdk = makeSdk({ openid: OPENID, store, agg: baseAgg({ order_main: [{ total: 12000, tip: 800 }] }), countFromStore: true });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'balance_info', mock_openid: OPENID }, {});
  assert.strictEqual(r.data.today_pending, 2);
  assert.strictEqual(r.data.week_income_fen, 12800);
});

test.after(() => { Module._load = origLoad; });
