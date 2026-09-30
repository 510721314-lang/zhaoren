// 安全策略纯函数(零依赖, 可单测) · 单一实现: user-login / init-db 引用本模块, 勿在业务函数内复制实现
// 设计目标: 将"锁定阈值/冷却窗口/bootstrap CAS 决策"等安全判定集中于此, 用 node:test 全覆盖

// ── 密码登录防爆破 ──
// 输入当前失败计数与锁定截止时间, 输出是否锁定 + 剩余毫秒
function evalPasswordLock(failCount, lockUntil, now) {
  const f = Number(failCount) || 0;
  const lu = Number(lockUntil) || 0;
  if (lu > now) return { locked: true, remainingMs: lu - now };
  return { locked: false, remainingMs: 0 };
}

// 一次密码校验失败后的状态补丁: 达上限置锁定并清零计数, 否则 +1
function passwordFailPatch(failCount, opts) {
  const { maxFail, lockMs, now } = opts;
  const fails = (Number(failCount) || 0) + 1;
  const patch = { pwd_fail_count: fails, updated_at: now };
  if (fails >= maxFail) {
    patch.pwd_lock_until = now + lockMs;
    patch.pwd_fail_count = 0;
  }
  return patch;
}

// ── 紧急联系人 30 天变更冷却 ──
// 输入上次变更时间, 输出是否冷却中 + 下次可变更毫秒时间戳
function evalEmergencyCooldown(lastChangedAt, now, cooldownMs) {
  const lc = Number(lastChangedAt) || 0;
  if (lc > 0 && (now - lc) < cooldownMs) {
    return { blocked: true, nextAtMs: lc + cooldownMs };
  }
  return { blocked: false, nextAtMs: null };
}

// ── init-db bootstrap CAS 决策 ──
// 输入当前白名单与调用者, 输出是否 bootstrap(白名单为空且调用者成为首位管理员) + 决策后的白名单
// 并发安全由调用方在事务内执行: 事务内重读白名单 → 本函数决策 → 写回, 保证仅首个调用者成功
function resolveAdminBootstrap(allowedOpenids, callerOpenid) {
  const allowed = Array.isArray(allowedOpenids) ? allowedOpenids.slice() : [];
  const bootstrapped = allowed.length === 0;
  if (bootstrapped) allowed.push(callerOpenid);
  const permitted = allowed.indexOf(callerOpenid) >= 0;
  return { bootstrapped, allowed, permitted };
}

module.exports = { evalPasswordLock, passwordFailPatch, evalEmergencyCooldown, resolveAdminBootstrap };
