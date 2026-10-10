// no_show_rules.js 爽约申诉/举证/裁定规则单测(零依赖 node:test)
// 覆盖: 9 键读取与钳制 / 申诉资格(S2·S3.5+时限) / 举证截止 / 裁定处罚(第 N 次·阈值停用) / 撤回资格
// 运行: 根目录 `npm test`  或  `node --test cloudfunctions/_shared/no_show_rules.test.js`
const test = require('node:test');
const assert = require('node:assert');
const {
  DAY_MS, HOUR_MS,
  noShowCfg, canSubmitReport, defenseDeadlineOf, verdictOutcome, canWithdrawReport,
  REPORT_STATUS, VERDICTS
} = require('./no_show_rules');

const NOW = Date.UTC(2026, 9, 7, 12, 0);

// ── noShowCfg(9 键读取: 默认值 / 越界钳制 / 非法回退) ──
test('配置: 未配置 → 全部走 schema 默认(48/48/20/3/7/180/3/10/1)', () => {
  assert.deepStrictEqual(noShowCfg({}), {
    reportWindowH: 48, defenseWindowH: 48, scoreDeduct: 20,
    suspendThreshold: 3, suspendDays: 7, countWindowDays: 180,
    evidenceMax: 3, reasonMinLen: 10, maxPerOrder: 1
  });
});
test('配置: 显式 0 扣分是合法值(仅计次不扣分, 禁 || 兜底)', () => {
  const c = noShowCfg({ no_show_score_deduct: 0 });
  assert.strictEqual(c.scoreDeduct, 0);
});
test('配置: 越界按 schema min/max 钳制(防脏配置放大处罚)', () => {
  const c = noShowCfg({ no_show_suspend_days: 999, no_show_suspend_threshold: 0, no_show_evidence_max: 100 });
  assert.strictEqual(c.suspendDays, 90);
  assert.strictEqual(c.suspendThreshold, 1);
  assert.strictEqual(c.evidenceMax, 9);
});
test('配置: 非法值(字符串/NaN→非有限数)回退默认', () => {
  const c = noShowCfg({ no_show_report_window_h: 'abc', no_show_reason_min_len: null });
  assert.strictEqual(c.reportWindowH, 48);
  assert.strictEqual(c.reasonMinLen, 10);
});

// ── canSubmitReport(N1: 仅 S2/S3.5 + 开始时间已过 + 时限内) ──
test('申诉: S2 且开始时间已过且在窗口内 → 通过', () => {
  const r = canSubmitReport({ status: 'S2', start_time: NOW - 2 * HOUR_MS }, NOW, noShowCfg({}));
  assert.strictEqual(r.ok, true);
});
test('申诉: S3.5 履约中断同样可申诉', () => {
  const r = canSubmitReport({ status: 'S3.5', start_time: NOW - 1 * HOUR_MS }, NOW, noShowCfg({}));
  assert.strictEqual(r.ok, true);
});
test('申诉: 非 S2/S3.5(如 S3 履约中/S5 已完成)拒绝', () => {
  for (const st of ['S0', 'S1', 'S3', 'S4', 'S5', 'S6', 'S10.5']) {
    const r = canSubmitReport({ status: st, start_time: NOW - HOUR_MS }, NOW, noShowCfg({}));
    assert.strictEqual(r.ok, false, `status=${st} 应拒绝`);
    assert.strictEqual(r.code, 'no_show_bad_status');
  }
});
test('申诉: 开始时间未到 → 拒绝(不可预告式申诉)', () => {
  const r = canSubmitReport({ status: 'S2', start_time: NOW + HOUR_MS }, NOW, noShowCfg({}));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no_show_not_started');
});
test('申诉: 缺 start_time → 拒绝', () => {
  const r = canSubmitReport({ status: 'S2' }, NOW, noShowCfg({}));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no_show_no_start');
});
test('申诉: 恰好窗口边界(48h)放行, 超 1ms 拒绝', () => {
  const cfg = noShowCfg({ no_show_report_window_h: 48 });
  assert.strictEqual(canSubmitReport({ status: 'S2', start_time: NOW - 48 * HOUR_MS }, NOW, cfg).ok, true);
  const late = canSubmitReport({ status: 'S2', start_time: NOW - 48 * HOUR_MS - 1 }, NOW, cfg);
  assert.strictEqual(late.ok, false);
  assert.strictEqual(late.code, 'no_show_window_closed');
});

// ── defenseDeadlineOf(受理 + 举证窗口) ──
test('举证: 截止 = 受理时间 + 48h(默认)', () => {
  assert.strictEqual(defenseDeadlineOf(NOW, noShowCfg({})), NOW + 48 * HOUR_MS);
});
test('举证: 窗口可配(no_show_defense_window_h=1 → 1h)', () => {
  assert.strictEqual(defenseDeadlineOf(NOW, noShowCfg({ no_show_defense_window_h: 1 })), NOW + HOUR_MS);
});
test('举证: createdAt 缺省按 0 容错(不产 NaN)', () => {
  assert.strictEqual(defenseDeadlineOf(undefined, noShowCfg({})), 48 * HOUR_MS);
});

// ── verdictOutcome(裁定成立: 第 N 次 + 阈值停用 + 停用天数) ──
test('裁定: 默认阈值 3, 前两次不停用、第 3 次停用 7 天', () => {
  const cfg = noShowCfg({});
  const r1 = verdictOutcome(cfg, 0, NOW);
  assert.strictEqual(r1.times, 1);
  assert.strictEqual(r1.scoreDelta, -20);
  assert.strictEqual(r1.suspend, false);
  assert.strictEqual(r1.suspendUntil, null);
  const r2 = verdictOutcome(cfg, 1, NOW);
  assert.strictEqual(r2.suspend, false);
  const r3 = verdictOutcome(cfg, 2, NOW);
  assert.strictEqual(r3.times, 3);
  assert.strictEqual(r3.suspend, true);
  assert.strictEqual(r3.suspendUntil, NOW + 7 * DAY_MS);
});
test('裁定: 扣分 0 → scoreDelta 0 且仍计次(仅停用口径生效)', () => {
  const cfg = noShowCfg({ no_show_score_deduct: 0 });
  const r = verdictOutcome(cfg, 0, NOW);
  assert.strictEqual(r.scoreDelta, 0);
  assert.strictEqual(r.times, 1);
});
test('裁定: 阈值与停用天数可配(阈值1 → 首次即停用 30 天)', () => {
  const cfg = noShowCfg({ no_show_suspend_threshold: 1, no_show_suspend_days: 30 });
  const r = verdictOutcome(cfg, 0, NOW);
  assert.strictEqual(r.suspend, true);
  assert.strictEqual(r.suspendUntil, NOW + 30 * DAY_MS);
});
test('裁定: 既有次数非法值(负/NaN)按 0 容错', () => {
  assert.strictEqual(verdictOutcome(noShowCfg({}), -5, NOW).times, 1);
  assert.strictEqual(verdictOutcome(noShowCfg({}), 'x', NOW).times, 1);
});

// ── canWithdrawReport(N8 变更 2026-10-10: 仅申诉人本人 + 裁定前可撤) ──
test('撤回: 申诉人在 received/defense 可撤', () => {
  assert.strictEqual(canWithdrawReport(REPORT_STATUS.RECEIVED, true), true);
  assert.strictEqual(canWithdrawReport(REPORT_STATUS.DEFENSE, true), true);
});
test('撤回: 非申诉人一律不可撤(全状态矩阵)', () => {
  [REPORT_STATUS.RECEIVED, REPORT_STATUS.DEFENSE, REPORT_STATUS.DECIDED, REPORT_STATUS.WITHDRAWN].forEach((st) => {
    assert.strictEqual(canWithdrawReport(st, false), false);
  });
});
test('撤回: 已裁定/已撤回/状态缺失不可撤', () => {
  assert.strictEqual(canWithdrawReport(REPORT_STATUS.DECIDED, true), false);
  assert.strictEqual(canWithdrawReport(REPORT_STATUS.WITHDRAWN, true), false);
  assert.strictEqual(canWithdrawReport('', true), false);
});

// ── 常量口径 ──
test('常量: 状态词串与裁定枚举锁定(与设计稿 §2.5 一致)', () => {
  assert.deepStrictEqual(REPORT_STATUS, { RECEIVED: 'received', DEFENSE: 'defense', DECIDED: 'decided', WITHDRAWN: 'withdrawn' });
  assert.deepStrictEqual(VERDICTS, ['upheld', 'rejected']);
});