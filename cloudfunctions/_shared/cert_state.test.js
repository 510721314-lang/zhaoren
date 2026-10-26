// cert_state.js 单测(零依赖 node:test)
// 覆盖: 配置解析 / 有效期 / 派生态 / 最新证书语义 / apply 场景门禁 / take base+场景门禁 / 发证文档 / 读证书降级
// 运行: 根目录 `npm test` 或 `node --test cloudfunctions/_shared/cert_state.test.js`
const test = require('node:test');
const assert = require('node:assert');
const {
  BASE_SUBJECT,
  DEFAULT_W1_CERT_VALID_DAYS,
  DAY_MS,
  CERT_STATE,
  readCertConfig,
  certExpiresAt,
  latestCertOf,
  activeCertOf,
  computeCertState,
  requireCertForApply,
  requireCertForTake,
  buildCertRecord,
  loadCerts
} = require('./cert_state');

const NOW = Date.UTC(2026, 9, 26, 0, 0); // 2026-10-26
const cert = (subject, over) => Object.assign({
  subject, issued_at: NOW - 1000, expires_at: 0, status: 'active', is_deleted: false
}, over || {});

// ── readCertConfig ──
test('配置: 缺省 → 门禁关 / W1 365 天 / base 永久', () => {
  assert.deepStrictEqual(readCertConfig(null), {
    enabled: false, w1CertValidDays: 365, baseCertPermanent: true
  });
});
test('配置: cert_gate_enabled 仅严格 true 才开闸', () => {
  assert.strictEqual(readCertConfig({ cert_gate_enabled: 'true' }).enabled, false);
  assert.strictEqual(readCertConfig({ cert_gate_enabled: true }).enabled, true);
});
test('配置: 非法天数回退 365 / base_cert_permanent=false 生效', () => {
  const c = readCertConfig({ w1_cert_valid_days: -3, base_cert_permanent: false });
  assert.strictEqual(c.w1CertValidDays, 365);
  assert.strictEqual(c.baseCertPermanent, false);
});
test('配置: 合法自定义有效期', () => {
  assert.strictEqual(readCertConfig({ w1_cert_valid_days: 180 }).w1CertValidDays, 180);
});

// ── certExpiresAt ──
test('有效期: base 永久=0', () => {
  assert.strictEqual(certExpiresAt('base', NOW), 0);
});
test('有效期: W1 = now + 365 天', () => {
  assert.strictEqual(certExpiresAt('W1', NOW), NOW + 365 * DAY_MS);
});
test('有效期: base_cert_permanent=false 时 base 也按天', () => {
  assert.strictEqual(certExpiresAt('base', NOW, { baseCertPermanent: false }), NOW + 365 * DAY_MS);
});
test('有效期: 自定义天数 + 非法天数回退', () => {
  assert.strictEqual(certExpiresAt('W1', NOW, { w1CertValidDays: 10 }), NOW + 10 * DAY_MS);
  assert.strictEqual(certExpiresAt('W1', NOW, { w1CertValidDays: 0 }), NOW + DEFAULT_W1_CERT_VALID_DAYS * DAY_MS);
});

// ── 最新证书 / 有效性 ──
test('latestCertOf: 按 issued_at 取最新, 忽略软删与其它科目', () => {
  const certs = [
    cert('W1', { issued_at: NOW - 5000 }),
    cert('W1', { issued_at: NOW - 100 }),
    cert('W1', { issued_at: NOW, is_deleted: true }),
    cert('base', { issued_at: NOW - 10 })
  ];
  assert.strictEqual(latestCertOf(certs, 'W1').issued_at, NOW - 100);
});
test('isCertActive: active+未过期; 吊销/过期/软删均无效', () => {
  assert.strictEqual(activeCertOf([cert('base')], 'base', NOW) !== null, true);
  assert.strictEqual(activeCertOf([cert('base', { status: 'revoked' })], 'base', NOW), null);
  assert.strictEqual(activeCertOf([cert('W1', { expires_at: NOW - 1 })], 'W1', NOW), null);
  assert.strictEqual(activeCertOf([cert('base', { is_deleted: true })], 'base', NOW), null);
});
test('最新一张被吊销时旧证书不得复活(取最新语义)', () => {
  const certs = [
    cert('W1', { issued_at: NOW - 9000 }),
    cert('W1', { issued_at: NOW - 10, status: 'revoked' })
  ];
  assert.strictEqual(activeCertOf(certs, 'W1', NOW), null);
});

// ── computeCertState ──
test('派生态: 无分数无证书无进度 → UNTRAINED', () => {
  assert.strictEqual(computeCertState({ scores: {}, certs: [], subject: 'W1', now: NOW }), CERT_STATE.UNTRAINED);
});
test('派生态: 有分数(含 0 分失败) → TRAINED', () => {
  assert.strictEqual(computeCertState({ scores: { W1: 0 }, certs: [], subject: 'W1', now: NOW }), CERT_STATE.TRAINED);
});
test('派生态: 学习完成 → TRAINED', () => {
  assert.strictEqual(computeCertState({ scores: {}, certs: [], subject: 'W1', now: NOW, studyCompleted: true }), CERT_STATE.TRAINED);
});
test('派生态: 有效证书 → CERTIFIED', () => {
  assert.strictEqual(computeCertState({ scores: {}, certs: [cert('W1')], subject: 'W1', now: NOW }), CERT_STATE.CERTIFIED);
});
test('派生态: 最新证书已过期 → EXPIRED', () => {
  const certs = [cert('W1', { expires_at: NOW - 1 })];
  assert.strictEqual(computeCertState({ scores: { W1: 100 }, certs, subject: 'W1', now: NOW }), CERT_STATE.EXPIRED);
});
test('派生态: 证书被吊销 → 退回 TRAINED(非 EXPIRED)', () => {
  const certs = [cert('W1', { status: 'revoked', expires_at: NOW - 1 })];
  assert.strictEqual(computeCertState({ scores: { W1: 100 }, certs, subject: 'W1', now: NOW }), CERT_STATE.TRAINED);
});
test('派生态: cheatSuspended 优先于一切 → CHEAT_SUSPENDED', () => {
  const certs = [cert('W1')];
  assert.strictEqual(computeCertState({ scores: { W1: 100 }, certs, subject: 'W1', now: NOW, cheatSuspended: true }), CERT_STATE.CHEAT_SUSPENDED);
});
test('派生态: 只认本科目证书(其它科目不算)', () => {
  assert.strictEqual(computeCertState({ scores: {}, certs: [cert('base')], subject: 'W1', now: NOW }), CERT_STATE.UNTRAINED);
});

// ── requireCertForApply: 只校场景证书 ──
test('入驻: W1 无证书 → apply_w1_exam_failed', () => {
  const r = requireCertForApply({}, ['W1'], { certs: [], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, true);
  assert.strictEqual(r.code, 'apply_w1_exam_failed');
});
test('入驻: W1 有效证书 → 放行; 过期证书 → 拦截', () => {
  const ok = requireCertForApply({}, ['W1'], { certs: [cert('W1')], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(ok.locked, false);
  const bad = requireCertForApply({}, ['W1'], { certs: [cert('W1', { expires_at: NOW - 1 })], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(bad.locked, true);
  assert.strictEqual(bad.code, 'apply_w1_exam_failed');
});
test('入驻: 无考试科目场景不校证书(W2 放行)', () => {
  const r = requireCertForApply({}, ['W2'], { certs: [], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, false);
});
test('入驻: 有考试科目场景(W11)缺证书 → apply_scene_exam_failed', () => {
  const r = requireCertForApply({}, ['W11'], { certs: [], now: NOW, examSubjects: ['base', 'W1', 'W11'] });
  assert.strictEqual(r.locked, true);
  assert.strictEqual(r.code, 'apply_scene_exam_failed');
});
test('入驻: 不校 base 证书(仅场景)', () => {
  const r = requireCertForApply({}, ['W1'], { certs: [cert('W1')], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, false);
});

// ── requireCertForTake: base + 场景 ──
test('接单: 无 base 证书 → order_base_exam_required', () => {
  const r = requireCertForTake({}, ['W2'], 'base', { certs: [], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, true);
  assert.strictEqual(r.code, 'order_base_exam_required');
});
test('接单: base 有效但 W1 场景缺证书 → order_scene_exam_required', () => {
  const r = requireCertForTake({}, ['W1'], 'base', { certs: [cert('base')], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, true);
  assert.strictEqual(r.code, 'order_scene_exam_required');
});
test('接单: base + 场景证书齐全 → 放行', () => {
  const r = requireCertForTake({}, ['W1'], 'base', { certs: [cert('base'), cert('W1')], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, false);
});
test('接单: 无考试科目场景(W2)只需 base', () => {
  const r = requireCertForTake({}, ['W2'], 'base', { certs: [cert('base')], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, false);
});
test('接单: baseSubject=null 跳过 base 校验', () => {
  const r = requireCertForTake({}, ['W2'], null, { certs: [], now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, false);
});
test('接单: W1 证书过期 → 拦截', () => {
  const certs = [cert('base'), cert('W1', { expires_at: NOW - 1 })];
  const r = requireCertForTake({}, ['W1'], 'base', { certs, now: NOW, examSubjects: ['base', 'W1'] });
  assert.strictEqual(r.locked, true);
  assert.strictEqual(r.code, 'order_scene_exam_required');
});

// ── buildCertRecord ──
test('发证: base 永久 + 快照字段', () => {
  const d = buildCertRecord({ openid: 'o1', subject: 'base', score: 100, sessionId: 's1', contentVersion: 'v1', now: NOW });
  assert.strictEqual(d.expires_at, 0);
  assert.strictEqual(d.status, 'active');
  assert.strictEqual(d.backfilled, false);
  assert.strictEqual(d.session_id, 's1');
  assert.strictEqual(d.content_version, 'v1');
  assert.strictEqual(d.issued_at, NOW);
});
test('发证: W1 365 天 + 回填标记/原考试时间', () => {
  const d = buildCertRecord({
    openid: 'o1', subject: 'W1', score: 100, now: NOW,
    backfilled: true, sourceExamAt: NOW - 99999
  });
  assert.strictEqual(d.expires_at, NOW + 365 * DAY_MS);
  assert.strictEqual(d.backfilled, true);
  assert.strictEqual(d.source_exam_at, NOW - 99999);
});

// ── loadCerts ──
test('读证书: 正常返回过滤软删', async () => {
  const fakeCol = () => ({
    where: () => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => ({ data: [cert('base'), cert('W1', { is_deleted: true })] })
        })
      })
    })
  });
  const list = await loadCerts(fakeCol, 'o1');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].subject, 'base');
});
test('读证书: 读失败 fail-closed 返回空数组', async () => {
  const fakeCol = () => ({
    where: () => ({
      orderBy: () => ({
        limit: () => ({ get: async () => { throw new Error('db down'); } })
      })
    })
  });
  assert.deepStrictEqual(await loadCerts(fakeCol, 'o1'), []);
});
test('读证书: 无 openid 直接返回空(不发查询)', async () => {
  let called = false;
  const fakeCol = () => { called = true; return {}; };
  assert.deepStrictEqual(await loadCerts(fakeCol, ''), []);
  assert.strictEqual(called, false);
});
