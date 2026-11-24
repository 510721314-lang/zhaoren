// 共享规则单测：credit_rules.starCreditDelta(星级 → 信用分增量, 防口径漂移 SSOT)
// 2026-11-24 W2: 新增 cancelCreditDelta(取消扣分梯度, 方案 cancel-fulfillment-v2.2.md §5.1)
const test = require('node:test');
const assert = require('node:assert');
const { starCreditDelta, cancelCreditDelta, CANCEL_PENALTY_DEFAULTS } = require('./credit_rules');

test('starCreditDelta: 各星数映射 5→+2 / 4→+1 / 3→0 / 2→-2 / 1→-5', () => {
  assert.strictEqual(starCreditDelta(5), 2);
  assert.strictEqual(starCreditDelta(4), 1);
  assert.strictEqual(starCreditDelta(3), 0);
  assert.strictEqual(starCreditDelta(2), -2);
  assert.strictEqual(starCreditDelta(1), -5);
});

test('starCreditDelta: 越界/异常值回退 -5(与原实现一致)', () => {
  assert.strictEqual(starCreditDelta(6), 2);   // >=5 同一档
  assert.strictEqual(starCreditDelta(0), -5);
  assert.strictEqual(starCreditDelta(-1), -5);
  assert.strictEqual(starCreditDelta(undefined), -5);
  assert.strictEqual(starCreditDelta('5'), 2); // 字符串数字归一
});

// ── cancelCreditDelta(取消扣分梯度, 2026-11-24 W2) ──
const H = 3600e3;
test('cancelCreditDelta: S2/S2_6 按 leadMs 三档 -5/-15/-25(默认档线 24h/4h)', () => {
  assert.strictEqual(cancelCreditDelta('S2', 25 * H, null), -5);
  assert.strictEqual(cancelCreditDelta('S2', 10 * H, null), -15);
  assert.strictEqual(cancelCreditDelta('S2', 1 * H, null), -25);
  assert.strictEqual(cancelCreditDelta('S2_6', 24 * H, null), -5);   // 边界含等于
  assert.strictEqual(cancelCreditDelta('S2_6', 4 * H - 1, null), -25);
});
test('cancelCreditDelta: S3 -30 / 履约档(S2_5/S3_6/S3.5/S4) -20 / S0·S1 恒 0(D5)', () => {
  assert.strictEqual(cancelCreditDelta('S3', 0, null), -30);
  for (const st of ['S2_5', 'S3_6', 'S3.5', 'S4']) {
    assert.strictEqual(cancelCreditDelta(st, 0, null), -20, st);
  }
  assert.strictEqual(cancelCreditDelta('S0', 0, null), 0);
  assert.strictEqual(cancelCreditDelta('S1', 0, null), 0);
});
test('cancelCreditDelta: cfg 覆盖生效(后台可配, 正数幅度→负增量)', () => {
  const cfg = { s2_far: 1, s2_mid: 2, s2_near: 3, s3: 9, fulfill: 7, far_hours: 48, mid_hours: 2 };
  assert.strictEqual(cancelCreditDelta('S2', 48 * H, cfg), -1);
  assert.strictEqual(cancelCreditDelta('S2', 3 * H, cfg), -2);
  assert.strictEqual(cancelCreditDelta('S2', 0, cfg), -3);
  assert.strictEqual(cancelCreditDelta('S3', 0, cfg), -9);
  assert.strictEqual(cancelCreditDelta('S4', 0, cfg), -7);
});
test('cancelCreditDelta: 非法 cfg 数值回退默认(负数/NaN 防御)', () => {
  const cfg = { s2_far: -5, s2_mid: NaN, s2_near: 'x', s3: undefined, fulfill: 0 };
  assert.strictEqual(cancelCreditDelta('S2', 25 * H, cfg), -5);   // s2_far 非法→默认 5
  assert.strictEqual(cancelCreditDelta('S2', 10 * H, cfg), -15);  // s2_mid NaN→默认 15
  assert.strictEqual(cancelCreditDelta('S2', 1 * H, cfg), -25);   // s2_near 'x'→默认 25
  assert.strictEqual(cancelCreditDelta('S3', 0, cfg), -30);       // s3 undefined→默认 30
  assert.strictEqual(cancelCreditDelta('S4', 0, cfg), 0);         // 显式 0 = 免罚合法(fail-closed 反例: 0 允许)
});
test('cancelCreditDelta: 默认值与方案 §0.1 一致(防漂移)', () => {
  assert.deepStrictEqual(CANCEL_PENALTY_DEFAULTS, { s2_far: 5, s2_mid: 15, s2_near: 25, s3: 30, fulfill: 20 });
});
