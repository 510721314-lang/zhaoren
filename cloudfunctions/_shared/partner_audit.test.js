// partner_audit.js 最小单测(纯逻辑, 无依赖) · 运行: node cloudfunctions/_shared/partner_audit.test.js
// 覆盖 buildAuditPatch 四主路径: 通过 / 驳回 / 锁判定(部分通过保持锁、全部通过解锁) / 判空(仅图片)
const assert = require('assert');
const { buildAuditPatch, isFieldEmpty } = require('./partner_audit');

const baseProfile = () => ({
  bio_pending: '简介A',
  skills_pending: ['技能A'],
  highlights_pending: [],
  qualifications_pending: { titles: [], photos: ['cloud://p1'] }, // 仅图片
  honors_pending: { titles: [], photos: [] }
});

let passed = 0;

function t(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

console.log('partner_audit 单测');
try {
  // 1. 仅图片的 qualifications 判空: 有任一(photos)即非空
  t('判空-仅图片qualifications非空', () => {
    assert.strictEqual(isFieldEmpty('qualifications', { titles: [], photos: ['x'] }), false);
    assert.strictEqual(isFieldEmpty('qualifications', { titles: [], photos: [] }), true);
  });

  // 2. 全部通过 → 解锁 approved
  t('全通过→解锁approved', () => {
    const r = buildAuditPatch(baseProfile(), [
      { field: 'bio', pass: true },
      { field: 'skills', pass: true },
      { field: 'qualifications', pass: true }
    ], 1000, 'op-abcdef');
    assert.strictEqual(r.anyPatched, true);
    assert.strictEqual(r.hasRemainingPending, false);
    assert.strictEqual(r.patch.profile_audit_status, 'approved');
    assert.strictEqual(r.hist.length, 3);
    // 快照已合并
    assert.strictEqual(r.patch['profile_audited_snapshot.bio'], '简介A');
    assert.deepStrictEqual(r.patch['profile_audited_snapshot.qualifications'].photos, ['cloud://p1']);
    // 清 pending
    assert.deepStrictEqual(r.patch.skills_pending, []);
  });

  // 3. 部分通过(仅bio) → 保持锁, 未置 approved
  t('部分通过→保持锁', () => {
    const r = buildAuditPatch(baseProfile(), [{ field: 'bio', pass: true }], 2000, 'op-abcdef');
    assert.strictEqual(r.hasRemainingPending, true);
    assert.strictEqual(r.patch.profile_audit_status, undefined);
  });

  // 4. 驳回某栏目 → 清 pending + 保持锁 + hist 带 reason/scope
  t('驳回→清pending留reason+保持锁', () => {
    const r = buildAuditPatch(baseProfile(), [
      { field: 'bio', pass: false, reason: '含联系方式' }
    ], 3000, 'op-abcdef');
    assert.strictEqual(r.patch.bio_pending, '');
    assert.strictEqual(r.hasRemainingPending, true);
    assert.strictEqual(r.hist[0].result, 'rejected');
    assert.strictEqual(r.hist[0].reason, '含联系方式');
    assert.strictEqual(r.hist[0].scope, 'bio');
    // 操作人脱敏(末6位)
    assert.strictEqual(r.hist[0].by, 'abcdef');
  });

  // 5. 非法字段被白名单拦截
  t('非法字段白名单拦截', () => {
    const r = buildAuditPatch(baseProfile(), [{ field: 'admin_openids', pass: true }], 4000, 'op');
    assert.strictEqual(r.anyPatched, false);
    assert.strictEqual(r.hist.length, 0);
  });

  console.log(`\nALL PASS (${passed})`);
  process.exit(0);
} catch (e) {
  console.error('\nFAIL:', e.message);
  process.exit(1);
}
