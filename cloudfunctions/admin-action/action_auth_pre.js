// admin-action · 免鉴权前置组（claim_admin / admin_login / admin_logout，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。
// (2026-10-19) admin_login / admin_logout 已抽到 _shared/admin-login.js(经 sync-admin-login.ps1 复制本地副本), admin-web 亦引同一份
// (2026-10-13) admin_login 防爆破锁定: 复用 security_policy.js 纯策略函数(与 user-login 同源, SHA 门禁守护)
const { admin_login, admin_logout } = require('./admin-login');

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

// admin_login / admin_logout 已抽到 _shared/admin-login.js 单一真相源(与 admin-web 共享本地副本)
module.exports = { claim_admin, admin_login, admin_logout };
