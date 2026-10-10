// admin-action · 后台账号管理（admin_account_list/create/set_status，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function admin_account_list(ctx) {
  const { col, _, ok } = ctx;
  const r = await col('admin_accounts').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  return ok({ list: (r.data || []).map((a) => ({
    account: a.account, role: a.role, display_name: a.display_name || '',
    status: a.status || 'active', created_at: a.created_at
  })) });
}

async function admin_account_create(ctx) {
  const { event, ensureAdminColls, col, _, ADMIN_ROLES, crypto, hashAdminPassword, openid, operatorAccount, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const acc = String(event.account || '').trim();
  const { password, role, display_name } = event;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(acc)) return fail('acc_bad_account', '登录名需 3-20 位字母/数字/下划线');
  if (!password || String(password).length < 8) return fail('acc_bad_pwd', '密码至少 8 位');
  if (!ADMIN_ROLES.includes(role)) return fail('acc_bad_role', '角色只能是 R1/R2/R3');
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    await col('admin_accounts').add({ data: {
      account: acc, password_hash: hashAdminPassword(password, salt), password_salt: salt,
      role, display_name: String(display_name || '').slice(0, 30),
      status: 'active', created_at: Date.now(), updated_at: Date.now(), is_deleted: false
    } });
    await logEvent('P2', 'admin_account_create', openid, { account: acc, role, by: operatorAccount });
    return ok({ account: acc, role });
  } catch (e) { return fail('acc_fail', '创建失败: ' + ((e && e.errCode) || (e && e.message) || e)); }
}

async function admin_account_set_status(ctx) {
  const { event, col, _, openid, operatorAccount, logEvent, ok, fail } = ctx;
  const { account, status } = event;
  const acc = String(account || '').trim();
  if (!['active', 'disabled'].includes(status)) return fail('acc_bad_status', '状态只能是 active/disabled');
  if (acc === operatorAccount && status === 'disabled') return fail('acc_self', '不能禁用自己');
  const r = await col('admin_accounts').where({ account: acc, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  if (!(r.data && r.data[0])) return fail('acc_not_found', '账号不存在');
  await col('admin_accounts').doc(r.data[0]._id).update({ data: { status, updated_at: Date.now() } });
  if (status === 'disabled') {
    await col('admin_web_sessions').where({ account: acc, is_deleted: _.neq(true) }).update({
      data: { is_deleted: true, updated_at: Date.now() }
    }).catch(() => {});
  }
  await logEvent('P2', 'admin_account_set_status', openid, { account: acc, status, by: operatorAccount });
  return ok({ account: acc, status });
}

module.exports = { admin_account_list, admin_account_create, admin_account_set_status };
