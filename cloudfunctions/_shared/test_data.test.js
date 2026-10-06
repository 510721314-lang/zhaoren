// test_data.js 测试数据打标单测(零依赖 node:test)
const test = require('node:test');
const assert = require('node:assert');
const { isTestOpenid, isTestPair } = require('./test_data');

test('白名单命中 → true', () => {
  assert.strictEqual(isTestOpenid({ test_openids: ['test_partner_001'] }, 'test_partner_001'), true);
});
test('未命中 → false', () => {
  assert.strictEqual(isTestOpenid({ test_openids: ['test_partner_001'] }, 'real_user'), false);
});
test('config 缺失 / 字段非数组 → false(宁漏勿错)', () => {
  assert.strictEqual(isTestOpenid(undefined, 'test_partner_001'), false);
  assert.strictEqual(isTestOpenid(null, 'test_partner_001'), false);
  assert.strictEqual(isTestOpenid({}, 'test_partner_001'), false);
  assert.strictEqual(isTestOpenid({ test_openids: 'test_partner_001' }, 'test_partner_001'), false);
});
test('openid 缺失/空串/非字符串 → false', () => {
  assert.strictEqual(isTestOpenid({ test_openids: ['a'] }, undefined), false);
  assert.strictEqual(isTestOpenid({ test_openids: ['a'] }, ''), false);
  assert.strictEqual(isTestOpenid({ test_openids: ['a'] }, 123), false);
});
test('isTestPair: 任一命中即 true, 双真实 → false', () => {
  const cfg = { test_openids: ['t1'] };
  assert.strictEqual(isTestPair(cfg, 't1', 'real'), true);
  assert.strictEqual(isTestPair(cfg, 'real', 't1'), true);
  assert.strictEqual(isTestPair(cfg, 'realA', 'realB'), false);
});
