// security_policy.js 安全策略单测(零依赖 node:test)
// 覆盖: 密码锁定阈值/evalPasswordLock、失败计数补丁/passwordFailPatch、
//       紧急联系人 30 天冷却/evalEmergencyCooldown、bootstrap CAS 决策/resolveAdminBootstrap
const test = require('node:test');
const assert = require('node:assert');
const {
  evalPasswordLock, passwordFailPatch, evalEmergencyCooldown, resolveAdminBootstrap
} = require('./security_policy');

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LOCK_MS = 10 * 60 * 1000; // 10 分钟
const COOLDOWN_MS = 30 * DAY;

// ── evalPasswordLock ──
test('锁定中(lockUntil > now) → locked=true 且返回剩余毫秒', () => {
  const r = evalPasswordLock(0, NOW + 300000, NOW);
  assert.strictEqual(r.locked, true);
  assert.strictEqual(r.remainingMs, 300000);
});

test('未锁定(lockUntil 已过期/为 0/undefined) → locked=false', () => {
  assert.strictEqual(evalPasswordLock(0, NOW - 1, NOW).locked, false);
  assert.strictEqual(evalPasswordLock(0, 0, NOW).locked, false);
  assert.strictEqual(evalPasswordLock(undefined, undefined, NOW).locked, false);
  assert.strictEqual(evalPasswordLock(null, null, NOW).locked, false);
});

// ── passwordFailPatch ──
test('失败未达上限 → pwd_fail_count +1, 不锁定', () => {
  const patch = passwordFailPatch(2, { maxFail: 5, lockMs: LOCK_MS, now: NOW });
  assert.strictEqual(patch.pwd_fail_count, 3);
  assert.strictEqual(patch.pwd_lock_until, undefined);
  assert.strictEqual(patch.updated_at, NOW);
});

test('失败达上限 → 置锁定并清零计数(第 5 次失败触发)', () => {
  const patch = passwordFailPatch(4, { maxFail: 5, lockMs: LOCK_MS, now: NOW });
  assert.strictEqual(patch.pwd_fail_count, 0);
  assert.strictEqual(patch.pwd_lock_until, NOW + LOCK_MS);
});

test('首错(无历史) → pwd_fail_count=1', () => {
  const patch = passwordFailPatch(undefined, { maxFail: 5, lockMs: LOCK_MS, now: NOW });
  assert.strictEqual(patch.pwd_fail_count, 1);
  assert.strictEqual(patch.pwd_lock_until, undefined);
});

// ── evalEmergencyCooldown ──
test('30 天冷却内变更 → blocked=true 且给出下次可变更时间', () => {
  const r = evalEmergencyCooldown(NOW - 10 * DAY, NOW, COOLDOWN_MS);
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.nextAtMs, NOW - 10 * DAY + COOLDOWN_MS);
});

test('首次设置(无 lastChanged) → 不阻塞', () => {
  assert.strictEqual(evalEmergencyCooldown(undefined, NOW, COOLDOWN_MS).blocked, false);
  assert.strictEqual(evalEmergencyCooldown(0, NOW, COOLDOWN_MS).blocked, false);
});

test('已过 30 天 → 不阻塞', () => {
  assert.strictEqual(evalEmergencyCooldown(NOW - 31 * DAY, NOW, COOLDOWN_MS).blocked, false);
});

// ── resolveAdminBootstrap ──
test('白名单为空 + 调用者 → bootstrap=true, 调用者成为首位管理员且被放行', () => {
  const d = resolveAdminBootstrap([], 'OID_A');
  assert.strictEqual(d.bootstrapped, true);
  assert.deepStrictEqual(d.allowed, ['OID_A']);
  assert.strictEqual(d.permitted, true);
});

test('白名单非空 + 白名单内调用者 → 不 bootstrap, 放行, 白名单不变', () => {
  const d = resolveAdminBootstrap(['OID_A', 'OID_B'], 'OID_A');
  assert.strictEqual(d.bootstrapped, false);
  assert.deepStrictEqual(d.allowed, ['OID_A', 'OID_B']);
  assert.strictEqual(d.permitted, true);
});

test('白名单非空 + 非白名单调用者 → 不 bootstrap, 拒绝', () => {
  const d = resolveAdminBootstrap(['OID_A'], 'OID_EVIL');
  assert.strictEqual(d.bootstrapped, false);
  assert.deepStrictEqual(d.allowed, ['OID_A']);
  assert.strictEqual(d.permitted, false);
});

test('bootstrap 并发语义: 两个调用者各自在事务内重读, 仅首个能 bootstrap(模拟两轮顺序决策)', () => {
  // 调用者 A 先决策(空名单 → bootstrap 为 [A])
  const d1 = resolveAdminBootstrap([], 'OID_A');
  assert.strictEqual(d1.bootstrapped, true);
  // 调用者 B 后决策(看到 [A] → 不 bootstrap, 且 B 不在名单内 → 拒绝)
  const d2 = resolveAdminBootstrap(d1.allowed, 'OID_B');
  assert.strictEqual(d2.bootstrapped, false);
  assert.strictEqual(d2.permitted, false);
});
