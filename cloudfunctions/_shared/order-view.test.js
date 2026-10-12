// order-view 纯映射函数单测（批 5.4）· 从 order-detail.js 抽离的 computeNextStep 全分支覆盖
const test = require('node:test');
const assert = require('node:assert');
const { computeNextStep, pad } = require('../../miniprogram/utils/order-view.js');

const U = (over) => Object.assign({ status: 'S2', my_role: 'user', service_date: '10-12', service_time: '20:00' }, over);

test('pad 补零', () => {
  assert.strictEqual(pad(5), '05');
  assert.strictEqual(pad(12), '12');
});

test('加时在途且可响应 → extend_respond', () => {
  const r = computeNextStep(U({ pending_extend: { can_respond: true, add_hours: 2, add_amount_fen: 1000, expire_text: '2小时内' } }));
  assert.strictEqual(r.action.key, 'extend_respond');
  assert.strictEqual(r.tone, 'primary');
});

test('加时在途(己方发起) → info 无 action', () => {
  const r = computeNextStep(U({ my_role: 'partner', pending_extend: { can_respond: false, add_hours: 1, add_amount_fen: 500 } }));
  assert.strictEqual(r.tone, 'info');
  assert.strictEqual(r.action, undefined);
});

test('改期在途且可响应 → modify_respond(确定性 now)', () => {
  const now = 1_700_000_000_000;
  const r = computeNextStep(U({ pending_modify: { can_respond: true, new_date: '10-13', new_time: '09:00', expire_at: now + 2 * 3600000 } }), now);
  assert.strictEqual(r.action.key, 'modify_respond');
  assert.ok(r.subtitle.includes('2小时内'));
});

test('S0 发单人 → 去支付', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S0', my_role: 'user' })).action.key, 'pay');
});
test('S0 耍伴 → 等待支付(无 action)', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S0', my_role: 'partner' })).action, undefined);
});
test('S1 → 进入聊天', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S1' })).action.key, 'chat');
});
test('S2 耍伴 → 准备履约', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S2', my_role: 'partner' })).title, '准备履约');
});
test('S3 耍伴有下一里程碑 → 提交 N%', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3', my_role: 'partner', nextPercent: 30 })).action.key, 'milestone');
});
test('S3 耍伴无下一里程碑 → 履约完成', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3', my_role: 'partner', nextPercent: 0 })).action.key, 'finish');
});
test('S3 发单人 → 安全报备', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3', my_role: 'user' })).action.key, 'safety');
});
test('S3_5 耍伴 → 恢复履约', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3_5', my_role: 'partner' })).action.key, 'resume');
});
test('S5 发单人 → 去评价', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S5', my_role: 'user' })).action.key, 'eval');
});
test('终态 S6/S7/S8/S9/S10/S10_5 均无 action', () => {
  for (const s of ['S6', 'S7', 'S8', 'S9', 'S10', 'S10_5']) {
    assert.strictEqual(computeNextStep(U({ status: s })).action, undefined, s);
  }
});
test('未知状态 → null', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S99' })), null);
});
