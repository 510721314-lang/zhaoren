// admin-action · 免鉴权前置组（claim_admin / admin_login / admin_logout，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。
// (2026-10-13) admin_login 防爆破锁定: 复用 _shared/security_policy.js 纯策略函数(与 user-login 同源, SHA 门禁守护)
// (2026-10-13) 留存负债闭环: 失败计数由「读-改-写」改为原子自增 + 达阈值条件写(并发下不丢计数), 锁定判断内联, 不再用 passwordFailPatch
const { evalPasswordLock } = require('./security_policy');

const PWD_MAX_FAIL = 5;              // 连续失败达 5 次锁定（与 user-login password_login 同口径）
const PWD_LOCK_MS = 10 * 60 * 1000;  // 锁定 10 分钟

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
  const { event, openid, ensureAdminColls, col, _, hashAdminPassword, crypto, logEvent, log } = ctx;
  await ensureAdminColls();
  const acc = String(event.account || '').trim();
  const password = event.password || '';
  if (!acc || !password) return { ok: false, code: 'login_invalid', msg: '账号和密码必填' };
  const accR = await col('admin_accounts').where({ account: acc, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const u = (accR.data && accR.data[0]) || null;
  // 评审修复(2026-10-12): 网关层 admin_login 免 key 放行后, 公网可匿名试密码。
  // 失败必须落 P1 事件(admin_login_fail) → order-timer errorScan 巡检项①捕获推送管理员, 爆破可见;
  // 复用批2.2 收敛(同签名连续两轮静默), 管理员自己输错不会逐次轰炸。payload 不含密码。
  if (!u || u.status !== 'active') {
    await logEvent('P1', 'admin_login_fail', openid || '', { account: acc.slice(0, 40), reason: !u ? 'not_found' : 'inactive' }).catch(() => {});
    return { ok: false, code: 'login_bad', msg: '账号或密码错误' };
  }
  // 防爆破锁定(fail-closed: 锁定中一律拒绝, 不再验密; 与 user-login password_login 同口径)
  const lock = evalPasswordLock(u.pwd_fail_count, u.pwd_lock_until, Date.now());
  if (lock.locked) {
    await logEvent('P1', 'admin_login_fail', openid || '', { account: acc.slice(0, 40), reason: 'locked' }).catch(() => {});
    return { ok: false, code: 'login_locked', msg: '密码错误次数过多,请10分钟后再试' };
  }
  if (hashAdminPassword(password, u.password_salt) !== u.password_hash) {
    // 失败计数原子 +1(2026-10-13 留存负债闭环: 原读-改-写并发下会丢计数, 锁定阈值可被绕过);
    // 达上限由「条件写」置锁并清零计数(仅当计数≥阈值才命中, 并发下幂等), 写入失败留痕不阻断
    await col('admin_accounts').doc(u._id).update({ data: { pwd_fail_count: _.inc(1), updated_at: Date.now() } })
      .catch((e) => { log.w('admin_login pwd_fail 计数写入失败:', e && e.message); });
    const lockUpd = await col('admin_accounts').where({ _id: u._id, pwd_fail_count: _.gte(PWD_MAX_FAIL) })
      .update({ data: { pwd_lock_until: Date.now() + PWD_LOCK_MS, pwd_fail_count: 0 } })
      .catch(() => null);
    const locked = !!(lockUpd && lockUpd.stats && lockUpd.stats.updated === 1);
    await logEvent('P1', 'admin_login_fail', openid || '', { account: acc.slice(0, 40), reason: 'bad_password', locked }).catch(() => {});
    return { ok: false, code: 'login_bad', msg: '账号或密码错误' };
  }
  // 验密通过: 清零失败计数与锁定
  if (u.pwd_fail_count || u.pwd_lock_until) {
    await col('admin_accounts').doc(u._id).update({ data: { pwd_fail_count: 0, pwd_lock_until: 0 } }).catch(() => {});
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
