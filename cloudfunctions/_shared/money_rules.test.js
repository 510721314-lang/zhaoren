// money_rules.js 资金规则单测(零依赖 node:test)
// 覆盖: 分账公式(含 0 费率免佣修正) / 打赏金额校验 / 提现校验两段 / 余额口径
// 运行: 根目录 `npm test`  或  `node --test cloudfunctions/_shared/money_rules.test.js`
const test = require('node:test');
const assert = require('node:assert');
const {
  TIP_MIN_FEN, TIP_MAX_FEN, WD_MIN_FEN, DEFAULT_FEE_RATE_FEN,
  splitOrderAmount, isValidTipAmount,
  validateWithdrawBasic, validateWithdrawBalance,
  computeBalance, aggRowSum
} = require('./money_rules');

// ── splitOrderAmount(分账) ──
test('分账: 标准十抽 220 元 → 佣金 22 元 / 实收 198 元', () => {
  assert.deepStrictEqual(splitOrderAmount(22000, 1000),
    { totalFen: 22000, feeFen: 2200, partnerIncomeFen: 19800 });
});
test('分账: 四舍五入 33.33 元 × 10% → 佣金 3.33 元', () => {
  const r = splitOrderAmount(3333, 1000);
  assert.strictEqual(r.feeFen, 333);
  assert.strictEqual(r.partnerIncomeFen, 3000);
});
test('分账: 费率缺省(null/undefined) → 默认 1000', () => {
  assert.strictEqual(splitOrderAmount(20000, null).feeFen, 2000);
  assert.strictEqual(splitOrderAmount(20000, undefined).feeFen, 2000);
});
test('分账: 显式 0 = 免佣(修正原 || 1000 吞 0 的隐患)', () => {
  const r = splitOrderAmount(20000, 0);
  assert.strictEqual(r.feeFen, 0);
  assert.strictEqual(r.partnerIncomeFen, 20000);
});
test('分账: 费率 10000 = 全抽', () => {
  assert.deepStrictEqual(splitOrderAmount(10000, 10000),
    { totalFen: 10000, feeFen: 10000, partnerIncomeFen: 0 });
});
test('分账: total 0 / 非法 → 全 0 不产 NaN', () => {
  assert.strictEqual(splitOrderAmount(0, 1000).feeFen, 0);
  assert.strictEqual(splitOrderAmount(undefined, 1000).partnerIncomeFen, 0);
  assert.ok(Number.isFinite(splitOrderAmount('abc', 1000).feeFen));
});
test('分账: 费率负数/非数值 → 回退默认 1000(防御)', () => {
  assert.strictEqual(splitOrderAmount(20000, -5).feeFen, 2000);
  assert.strictEqual(splitOrderAmount(20000, 'x').feeFen, 2000);
});

// ── isValidTipAmount(打赏 1-500 元整数) ──
test('打赏: 下界 100 / 上界 50000 通过', () => {
  assert.strictEqual(isValidTipAmount(TIP_MIN_FEN), true);
  assert.strictEqual(isValidTipAmount(TIP_MAX_FEN), true);
});
test('打赏: 99 / 50001 拒绝', () => {
  assert.strictEqual(isValidTipAmount(99), false);
  assert.strictEqual(isValidTipAmount(50001), false);
});
test('打赏: 非整数 / NaN / undefined 拒绝', () => {
  assert.strictEqual(isValidTipAmount(150.5), false);
  assert.strictEqual(isValidTipAmount(NaN), false);
  assert.strictEqual(isValidTipAmount(undefined), false);
});
test('打赏: 数字字符串 "100" 与线上 Number 预转换行为一致可通过', () => {
  assert.strictEqual(isValidTipAmount('100'), true);
  assert.strictEqual(isValidTipAmount('abc'), false);
});

// ── validateWithdrawBasic(基础段: 格式/最低额/极速单笔) ──
test('提现基础: 非整数/0/负数 → wd_amount', () => {
  for (const v of [NaN, 0, -1000, 100.5, undefined]) {
    assert.strictEqual(validateWithdrawBasic(v, {}).code, 'wd_amount');
  }
});
test('提现基础: 999 → wd_too_small; 1000 通过', () => {
  assert.strictEqual(validateWithdrawBasic(999, {}).code, 'wd_too_small');
  assert.strictEqual(validateWithdrawBasic(WD_MIN_FEN, {}), null);
});
test('提现基础: 极速超单笔 200 元 → wd_fast_cap', () => {
  assert.strictEqual(validateWithdrawBasic(20001, { isFast: true, perOrderMaxFen: 20000 }).code, 'wd_fast_cap');
  assert.strictEqual(validateWithdrawBasic(20000, { isFast: true, perOrderMaxFen: 20000 }), null);
});
test('提现基础: 非 fast 不受极速单笔上限约束', () => {
  assert.strictEqual(validateWithdrawBasic(50000, { isFast: false, perOrderMaxFen: 20000 }), null);
});
test('提现基础: 限额未传/非法 → 回退默认 20000', () => {
  assert.strictEqual(validateWithdrawBasic(20001, { isFast: true }).code, 'wd_fast_cap');
  assert.strictEqual(validateWithdrawBasic(20000, { isFast: true, perOrderMaxFen: 0 }), null);
});
test('提现基础: 优先级 格式 > 最低额 > 单笔上限', () => {
  assert.strictEqual(validateWithdrawBasic(999, { isFast: true, perOrderMaxFen: 1 }).code, 'wd_too_small');
  assert.strictEqual(validateWithdrawBasic(-1, { isFast: true }).code, 'wd_amount');
});

// ── validateWithdrawBalance(余额段: 余额/当日累计) ──
test('提现余额: 超余额 → wd_insufficient; 恰好等于 → 通过', () => {
  assert.strictEqual(validateWithdrawBalance(5000, { availableFen: 4999 }).code, 'wd_insufficient');
  assert.strictEqual(validateWithdrawBalance(5000, { availableFen: 5000 }), null);
});
test('提现余额: availableFen 缺省/非法按 0 → 任何正额 insufficient', () => {
  assert.strictEqual(validateWithdrawBalance(1000, {}).code, 'wd_insufficient');
});
test('提现余额: 极速当日累计超 2000 元 → wd_fast_daily', () => {
  const r = validateWithdrawBalance(20000, { isFast: true, perDayMaxFen: 200000, todayFastFen: 190000, availableFen: 1e9 });
  assert.strictEqual(r.code, 'wd_fast_daily');
  assert.ok(r.msg.includes('2000'));
});
test('提现余额: 当日恰好 2000 元整(边界含等于) → 通过', () => {
  assert.strictEqual(validateWithdrawBalance(20000, { isFast: true, perDayMaxFen: 200000, todayFastFen: 180000, availableFen: 1e9 }), null);
});
test('提现余额: 非 fast 不做当日累计校验', () => {
  assert.strictEqual(validateWithdrawBalance(50000, { isFast: false, todayFastFen: 999999, availableFen: 1e9 }), null);
});
test('提现余额: 优先级 余额不足 > 当日累计', () => {
  assert.strictEqual(
    validateWithdrawBalance(20000, { isFast: true, todayFastFen: 190000, availableFen: 100 }).code,
    'wd_insufficient');
});

// ── computeBalance(余额口径: balance_info 与 withdraw 共用) ──
test('余额: settled(服务+打赏) - 占用(processing+success) = 可提现', () => {
  const r = computeBalance({
    settledAgg: { total: 19800, tip: 500 },
    withdrawGroups: [{ _id: 'processing', total: 1000 }, { _id: 'success', total: 2000 }]
  });
  assert.strictEqual(r.settledFen, 20300);
  assert.strictEqual(r.usedFen, 3000);
  assert.strictEqual(r.availableFen, 17300);
  assert.strictEqual(r.tipFen, 500);
});
test('余额: 聚合结果缺失/异常 → 全 0 容错', () => {
  const r = computeBalance({ settledAgg: null, withdrawGroups: null });
  assert.strictEqual(r.availableFen, 0);
  assert.strictEqual(r.settledFen, 0);
});
test('余额: 占用超过已结算 → 可提现钳 0 不出负数', () => {
  const r = computeBalance({ settledAgg: { total: 1000 }, withdrawGroups: [{ _id: 'success', total: 5000 }] });
  assert.strictEqual(r.availableFen, 0);
});
test('余额: 无提现记录 → 可提现 = 已结算', () => {
  const r = computeBalance({ settledAgg: { total: 8800, tip: 200 }, withdrawGroups: [] });
  assert.strictEqual(r.availableFen, 9000);
});
test('余额: processing 与 success 之外状态(如 fail)不计占用', () => {
  const r = computeBalance({ settledAgg: { total: 5000 }, withdrawGroups: [{ _id: 'fail', total: 999999 }] });
  assert.strictEqual(r.availableFen, 5000);
});

// ── aggRowSum ──
test('aggRowSum: total+tip 求和 / 空行 0', () => {
  assert.strictEqual(aggRowSum({ total: 120, tip: 30 }), 150);
  assert.strictEqual(aggRowSum(null), 0);
  assert.strictEqual(aggRowSum({}), 0);
});
test('常量: 与线上默认口径一致', () => {
  assert.strictEqual(DEFAULT_FEE_RATE_FEN, 1000);
  assert.strictEqual(WD_MIN_FEN, 1000);
  assert.deepStrictEqual([TIP_MIN_FEN, TIP_MAX_FEN], [100, 50000]);
});
