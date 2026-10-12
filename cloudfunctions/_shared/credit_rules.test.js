// 共享规则单测：credit_rules.starCreditDelta(星级 → 信用分增量, 防口径漂移 SSOT)
const test = require('node:test');
const assert = require('node:assert');
const { starCreditDelta } = require('./credit_rules');

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
