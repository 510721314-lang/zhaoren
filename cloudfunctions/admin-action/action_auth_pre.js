// admin-action · 免鉴权前置组（claim_admin / admin_login / admin_logout，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function claim_admin(ctx) {
  const { openid, action, db, logEvent } = ctx;
  if (!openid) return { ok: false, code: 'admin_no_openid', msg: '未获取到登录身份' };
  let now = Date.now();
  try {
    const txRes = await db.runTransaction(async (t) => {
      const docR = await t.collection('admin_config').doc('global').get();
      const list = (docR.data && docR.data.admin_openids) || [];
      if (list.length > 0) {
        const err = new Error('admin already initialized');
        err.bizCode = 'admin_forbidden';
        throw err;
      }
      now = Date.now();
      await t.collection('admin_config').doc('global').update({
        data: { admin_openids: [openid], updated_at: now }
      });
      return { at: now };
    });
    await logEvent('P2', 'admin_bootstrap', openid, { at: txRes.at });
    return { ok: true, data: { admin_openids: [openid], msg: '管理员初始化成功' } };
  } catch (e) {
    if (e && e.bizCode === 'admin_forbidden') {
      await logEvent('P1', 'admin_probe', openid, { action, reason: 'claim_after_init' });
      return { ok: false, code: 'admin_forbidden', msg: '无权限' };
    }
    return { ok: false, code: 'admin_claim_fail', msg: '初始化失败' };
  }
}

async function admin_login(ctx) {
  const { event, openid, ensureAdminColls, col, _, hashAdminPassword, crypto, logEvent } = ctx;
  await ensureAdminColls();
  const acc = String(event.account || '').trim();
  const password = event.password || '';
  if (!acc || !password) return { ok: false, code: 'login_invalid', msg: '账号和密码必填' };
  const accR = await col('admin_accounts').where({ account: acc, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const u = (accR.data && accR.data[0]) || null;
  if (!u || u.status !== 'active') return { ok: false, code: 'login_bad', msg: '账号或密码错误' };
  if (hashAdminPassword(password, u.password_salt) !== u.password_hash) {
    return { ok: false, code: 'login_bad', msg: '账号或密码错误' };
  }
  const token = 'ADMT-' + crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const expires_at = now + 12 * 3600 * 1000;
  await col('admin_web_sessions').doc(token).set({
    data: { account: acc, role: u.role, openid: openid || '', created_at: now, expires_at, is_deleted: false }
  });
  await logEvent('P2', 'admin_login', openid, { account: acc, role: u.role });
  return { ok: true, data: { token, role: u.role, account: acc, display_name: u.display_name || acc, expires_at } };
}

async function admin_logout(ctx) {
  const { event, col } = ctx;
  const t = String(event.__admin_token || '');
  if (t) await col('admin_web_sessions').doc(t).update({ data: { is_deleted: true, updated_at: Date.now() } }).catch(() => {});
  return { ok: true, data: {} };
}

module.exports = { claim_admin, admin_login, admin_logout };
