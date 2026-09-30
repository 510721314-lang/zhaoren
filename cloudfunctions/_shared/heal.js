// partner_profile 历史坏文档容错读取 + 惰性治愈(早期 apply 漏写 is_deleted)
// is_deleted 缺省视为有效并补写 false; 仅显式 true 拒绝。
// 审核死锁治愈: status=pending 但所有栏目待审内容为空(旧版"部分通过"锁判定 bug 遗留)
//   → 自动解锁 approved, 避免前端整份锁定且后台队列无内容的死锁。
// 部署注意: CloudBase 按函数目录独立打包, 本文件需复制到各云函数目录, require('./heal')。
const { FIELD_PENDING, isFieldEmpty } = require('./partner_audit');

async function healAuditLock(profile, col, _) {
  if (profile && profile.profile_audit_status === 'pending') {
    const allEmpty = Object.keys(FIELD_PENDING).every((f) => isFieldEmpty(f, profile[FIELD_PENDING[f]]));
    if (allEmpty) {
      const patch = { profile_audit_status: 'approved', profile_reject_reason: '', updated_at: Date.now() };
      await col('partner_profile').doc(profile._id).update({ data: patch }).catch(() => {});
      profile.profile_audit_status = 'approved';
      profile.profile_reject_reason = '';
      return true;
    }
  }
  return false;
}

async function getHealedPartnerProfile(col, _, openid) {
  const r = await col('partner_profile')
    .where({ openid, is_deleted: _.neq(true) })
    .limit(1).get().catch(() => ({ data: [] }));
  const profile = (r.data && r.data[0]) || null;
  if (profile && profile.is_deleted === undefined) {
    const patch = { is_deleted: false, updated_at: Date.now() };
    if (profile.accept_switch === undefined) patch.accept_switch = true;
    await col('partner_profile').doc(profile._id).update({ data: patch }).catch(() => {});
    Object.assign(profile, { is_deleted: false });
    if (profile.accept_switch === undefined) profile.accept_switch = true;
  }
  // 审核死锁惰性治愈(读取侧自动修复, 不阻塞)
  if (profile) await healAuditLock(profile, col, _);
  return profile;
}

module.exports = { getHealedPartnerProfile, healAuditLock };
