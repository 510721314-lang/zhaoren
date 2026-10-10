// admin-action · 管理员名单管理（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

function admin_list(ctx) {
  const { adminOpenids, ok } = ctx;
  return ok({ admins: adminOpenids, count: adminOpenids.length });
}

async function admin_add(ctx) {
  const { event, openid, adminOpenids, isOpenid, col, now, logEvent, ok, fail } = ctx;
  const { target_openid } = event;
  if (!isOpenid(target_openid)) return fail('admin_bad_openid', 'openid 格式不正确');
  if (adminOpenids.indexOf(target_openid) >= 0) return fail('admin_exists', '该 openid 已是管理员');
  const next = adminOpenids.concat([target_openid]);
  await col('admin_config').where({ _id: 'global' }).update({
    data: { admin_openids: next, updated_at: now }
  });
  await logEvent('P2', 'admin_add', openid, { target_openid });
  return ok({ admins: next });
}

async function admin_remove(ctx) {
  const { event, openid, adminOpenids, isOpenid, col, now, logEvent, ok, fail } = ctx;
  const { target_openid } = event;
  if (!isOpenid(target_openid)) return fail('admin_bad_openid', 'openid 格式不正确');
  if (target_openid === openid) return fail('admin_cannot_remove_self', '不能移除当前登录的管理员自己');
  if (adminOpenids.length <= 1) return fail('admin_last_one', '至少保留 1 名管理员');
  const next = adminOpenids.filter((x) => x !== target_openid);
  if (next.length === adminOpenids.length) return fail('admin_not_found', '该 openid 不在管理员名单');
  await col('admin_config').where({ _id: 'global' }).update({
    data: { admin_openids: next, updated_at: now }
  });
  await logEvent('P2', 'admin_remove', openid, { target_openid });
  return ok({ admins: next });
}

module.exports = { admin_list, admin_add, admin_remove };
