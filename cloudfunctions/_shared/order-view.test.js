// order-view 纯映射函数单测（批 5.4）· 从 order-detail.js 抽离的 computeNextStep 全分支覆盖
const test = require('node:test');
const assert = require('node:assert');
const { computeNextStep, pad, buildModifyTs, buildPrepCountdown } = require('../../miniprogram/utils/order-view.js');

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

// ── 拆分阶段1 C1（2026-10-15）：buildModifyTs / buildPrepCountdown ──
test('buildModifyTs 合法日期时分 → 本地时间戳', () => {
  assert.strictEqual(buildModifyTs('2026-10-20', '14:30'), new Date(2026, 9, 20, 14, 30, 0, 0).getTime());
});
test('buildModifyTs 缺日期/缺时间 → 0', () => {
  assert.strictEqual(buildModifyTs('', '14:30'), 0);
  assert.strictEqual(buildModifyTs('2026-10-20', ''), 0);
});
test('buildModifyTs 非法字段 → 0', () => {
  assert.strictEqual(buildModifyTs('2026-10-x', '14:30'), 0);
  assert.strictEqual(buildModifyTs('2026-10-20', 'ab:30'), 0);
});
test('buildPrepCountdown 45 分钟 → 分钟档', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 45 * 60000 }, now), '还有 45 分钟开始');
});
test('buildPrepCountdown 120 分钟 → 小时档', () => {
  const now = new Date(2026, 9, 20, 12, 30, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 120 * 60000 }, now), '还有 2 小时 0 分钟开始');
});
test('buildPrepCountdown 90 分钟 → Math.round 旧行为 2 小时 30 分', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 90 * 60000 }, now), '还有 2 小时 30 分钟开始');
});
test('buildPrepCountdown 2880 分钟 → 天档', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 2880 * 60000 }, now), '还有 2 天开始');
});
test('buildPrepCountdown 已过开始时间 → 0 分钟（不显示负数）', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now - 100000 }, now), '还有 0 分钟开始');
});
test('buildPrepCountdown 无 service_start_ts 时由 service_date/time 推导（单位数小时补零）', () => {
  const now = new Date(2026, 9, 20, 8, 5, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_date: '2026-10-20', service_time: '9:05' }, now), '还有 1 小时 0 分钟开始');
});
test('buildPrepCountdown 无任何时间信息 → 0 分钟', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({}, now), '还有 0 分钟开始');
});
test('buildPrepCountdown 不传 now → 不抛错且返回字符串（默认 Date.now 旧行为）', () => {
  assert.strictEqual(typeof buildPrepCountdown({ service_start_ts: Date.now() + 600000 }), 'string');
});
