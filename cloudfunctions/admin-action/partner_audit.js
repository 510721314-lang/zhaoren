// 共享：耍伴资料审核逻辑(规范源/单一实现)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需同步复制到:
//   cloudfunctions/partner-action/partner_audit.js
//   cloudfunctions/admin-action/partner_audit.js
// (两函数用本地 ./partner_audit.js, 与本项目 ./logger 惯例一致)
// 字段语义:
//   items = [{ field, pass, reason }]
//   field ∈ { bio, skills, highlights, qualifications, honors }(白名单)
//   通过 → 该栏目 pending 并入快照并清 pending; 驳回 → 清 pending 留 reason
//   全部处理完(无剩余 pending) → 解锁(approved); 有驳回/未清 → 保持 pending 锁

const FIELD_PENDING = {
  bio: 'bio_pending', skills: 'skills_pending', highlights: 'highlights_pending',
  qualifications: 'qualifications_pending', honors: 'honors_pending'
};
const SNAPSHOT_KEY = {
  bio: 'bio', skills: 'skills', highlights: 'highlights',
  qualifications: 'qualifications', honors: 'honors'
};
const FIELD_EMPTY = {
  bio: '', skills: [], highlights: [],
  qualifications: { titles: [], photos: [] }, honors: { titles: [], photos: [] }
};

function emptyVal(field) {
  const e = FIELD_EMPTY[field];
  return Array.isArray(e) ? [] : (typeof e === 'object' ? { titles: [], photos: [] } : '');
}
// 判空: array 看长度; object(资质/荣誉) titles 与 photos 都空才算空(有任一即有待审)
function isFieldEmpty(field, val) {
  const e = FIELD_EMPTY[field];
  if (Array.isArray(e)) return !(val && val.length > 0);
  if (typeof e === 'object') return !(val && ((val.titles && val.titles.length) || (val.photos && val.photos.length)));
  return !val;
}

// 核心: 由 profile 文档 + items 计算审核增量(patch)+审核历史(hist)+是否有剩余 pending
// 返回 { patch, hist, hasRemainingPending, anyPatched }
function buildAuditPatch(profile, items, now, operatorOpenid) {
  const patch = {};
  const hist = [];
  let hasRemainingPending = false;
  let anyPatched = false;
  const passedFields = new Set();   // 本批 items 中 pass 的栏目(复核剩余时视为已清空)
  for (const it of items) {
    const field = it && it.field;
    if (!field || !FIELD_PENDING[field]) continue;      // 非法字段跳过(白名单)
    const pendingKey = FIELD_PENDING[field];
    const pendingVal = profile[pendingKey];
    if (isFieldEmpty(field, pendingVal)) continue;       // 该栏目无待审内容
    if (it.pass) {
      patch[`profile_audited_snapshot.${SNAPSHOT_KEY[field]}`] = pendingVal;
      patch[pendingKey] = emptyVal(field);
      passedFields.add(field);
      hist.push({ at: now, result: 'approved', by: operatorOpenid ? String(operatorOpenid).slice(-6) : '', reason: '', scope: field });
    } else {
      patch[pendingKey] = emptyVal(field);
      hist.push({ at: now, result: 'rejected', by: operatorOpenid ? String(operatorOpenid).slice(-6) : '', reason: String(it.reason || '').slice(0, 100), scope: field });
      hasRemainingPending = true;
    }
    anyPatched = true;
  }
  // 复核是否仍有栏目 pending(本批已通过的视为已清空; 未覆盖且原本有待审 → 仍有剩余)
  for (const k of Object.keys(FIELD_PENDING)) {
    if (passedFields.has(k)) continue;
    if (!isFieldEmpty(k, profile[FIELD_PENDING[k]])) hasRemainingPending = true;
  }
  if (anyPatched) {
    patch.updated_at = now;
    if (!hasRemainingPending) {
      patch.profile_audit_status = 'approved';
      patch.profile_reject_reason = '';
    }
  }
  // 注意: profile_audit_history 的 push 由调用方用其各自 db.command 完成(共享模块不持有 command 实例)
  return { patch, hist, hasRemainingPending, anyPatched };
}

module.exports = { FIELD_PENDING, SNAPSHOT_KEY, FIELD_EMPTY, emptyVal, isFieldEmpty, buildAuditPatch };