// _shared/admin-login.js · admin_login / admin_logout 单一真相源(canonical 规范源)
// 被 admin-action 与 admin-web 共同引用 —— 经 `sync-admin-login.ps1` 复制为各函数本地副本后 require('./admin-login')。
// 动机(2026-10-19): admin-web 登录原先 proxy 到 admin-action, 双云函数冷启动叠加 > 网关 3s 硬限 → 504;
//   改为 admin-web 本地直调本模块, 只需自身冷启动, 稳在 2.5s 内。
// 签名: fn(ctx) → Promise<{ok, ...}>
// ctx 必需字段: event, openid, ensureAdminColls, col, _, hashAdminPassword, crypto, logEvent, log
// ⚠️ 本目录文件不随云函数打包上传(CloudBase 按单函数目录打包), 禁止 require('../_shared/...')。
//    依赖同目录的 ./security_policy.js(亦由 sync 脚本复制), 改本文件后须重跑 sync-admin-login.ps1 并重新部署两个函数。

const { evalPasswordLock } = require('./security_policy');

const PWD_MAX_FAIL = 5;              // 连续失败达 5 次锁定（与 user-login password_login 同口径）
const PWD_LOCK_MS = 10 * 60 * 1000;  // 锁定 10 分钟

async function admin_login(ctx) {
  const { event, openid, ensureAdminColls, col, _, hashAdminPassword, crypto, logEvent, log } = ctx;
  await ensureAdminColls();
  const acc = String(event.account || '').trim();
  const password = event.password || '';
  if (!acc || !password) return { ok: false, code: 'login_invalid', msg: '账号和密码必填' };
  const accR = await col('admin_accounts').where({ account: acc, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const u = (accR.data && accR.data[0]) || null;
  // 公网匿名试密码防护: 失败落 P1 事件(admin_login_fail), 供 order-timer errorScan 巡检项①推送管理员, 爆破可见; payload 不含密码。
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
    // 失败计数原子 +1(并发安全); 达上限由「条件写」置锁并清零计数(仅当计数≥阈值才命中, 并发下幂等), 写入失败留痕不阻断
    await col('admin_accounts').doc(u._id).update({ data: { pwd_fail_count: _.inc(1), updated_at: Date.now() } })
      .catch((e) => { if (log && log.w) log.w('admin_login pwd_fail 计数写入失败:', e && e.message); });
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

module.exports = { admin_login, admin_logout };
