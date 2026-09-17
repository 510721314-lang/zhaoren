// partner_profile 历史坏文档容错读取 + 惰性治愈(早期 apply 漏写 is_deleted)
// is_deleted 缺省视为有效并补写 false; 仅显式 true 拒绝。
// 部署注意: CloudBase 按函数目录独立打包, 本文件需复制到各云函数目录, require('./heal')。

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
  return profile;
}

module.exports = { getHealedPartnerProfile };
