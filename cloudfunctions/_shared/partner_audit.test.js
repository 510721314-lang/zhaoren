// partner_audit.js 纯逻辑单测(零依赖, 使用 Node 内置 node:test runner)
// 运行: 根目录 `npm test`  或  `node --test cloudfunctions/_shared/partner_audit.test.js`
// 覆盖 buildAuditPatch 主路径: 通过 / 驳回 / 锁判定(部分通过保持锁、全部通过解锁) / 判空(仅图片) / 白名单
const test = require('node:test');
const assert = require('node:assert');
const { buildAuditPatch, isFieldEmpty } = require('./partner_audit');

const baseProfile = () => ({
  bio_pending: '简介A',
  skills_pending: ['技能A'],
  highlights_pending: [],
  qualifications_pending: { titles: [], photos: ['cloud://p1'] }, // 仅图片
  honors_pending: { titles: [], photos: [] }
});

test('判空: 仅图片的 qualifications 视为非空(titles与photos都空才算空)', () => {
  assert.strictEqual(isFieldEmpty('qualifications', { titles: [], photos: ['x'] }), false);
  assert.strictEqual(isFieldEmpty('qualifications', { titles: [], photos: [] }), true);
  assert.strictEqual(isFieldEmpty('honors', undefined), true);
});

test('全部通过 → 解锁 approved + 快照合并 + 清 pending', () => {
  const r = buildAuditPatch(baseProfile(), [
    { field: 'bio', pass: true },
    { field: 'skills', pass: true },
    { field: 'qualifications', pass: true }
  ], 1000, 'op-abcdef');
  assert.strictEqual(r.anyPatched, true);
  assert.strictEqual(r.hasRemainingPending, false);
  assert.strictEqual(r.patch.profile_audit_status, 'approved');
  assert.strictEqual(r.hist.length, 3);
  assert.strictEqual(r.patch['profile_audited_snapshot.bio'], '简介A');
  assert.deepStrictEqual(r.patch['profile_audited_snapshot.qualifications'].photos, ['cloud://p1']);
  assert.deepStrictEqual(r.patch.skills_pending, []);
});

test('部分通过(仅bio) → 保持锁, 不置 approved', () => {
  const r = buildAuditPatch(baseProfile(), [{ field: 'bio', pass: true }], 2000, 'op-abcdef');
  assert.strictEqual(r.hasRemainingPending, true);
  assert.strictEqual(r.patch.profile_audit_status, undefined);
});

test('驳回某栏目 → 清 pending + 保持锁 + hist 带 reason/scope + 操作人脱敏', () => {
  const r = buildAuditPatch(baseProfile(), [
    { field: 'bio', pass: false, reason: '含联系方式' }
  ], 3000, 'op-abcdef');
  assert.strictEqual(r.patch.bio_pending, '');
  assert.strictEqual(r.hasRemainingPending, true);
  assert.strictEqual(r.hist[0].result, 'rejected');
  assert.strictEqual(r.hist[0].reason, '含联系方式');
  assert.strictEqual(r.hist[0].scope, 'bio');
  assert.strictEqual(r.hist[0].by, 'abcdef'); // 操作人末6位
});

test('非法字段被白名单拦截', () => {
  const r = buildAuditPatch(baseProfile(), [{ field: 'admin_openids', pass: true }], 4000, 'op');
  assert.strictEqual(r.anyPatched, false);
  assert.strictEqual(r.hist.length, 0);
});