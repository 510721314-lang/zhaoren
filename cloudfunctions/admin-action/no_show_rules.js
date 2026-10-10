// 共享：爽约申诉/举证/裁定 纯规则库(规范源/单一实现) —— 第三批 3B(2026-10-07)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-no-show-rules.ps1 同步复制到:
//   cloudfunctions/order-action/no_show_rules.js
//   cloudfunctions/admin-action/no_show_rules.js
// 单测: 同目录 no_show_rules.test.js (node --test)
// 口径来源: docs/design-20261007-pricing-noshow-flows.md §2.2-2.5 / §2.11
//   (N1 可申诉=S2/S3.5(2026-10-10 起不再要求开始时间已过); N2 逾期不自动关闭; N3 滚动窗口分角色计数;
//    N6 同订单单方上限; N10 全部数值后台可配, 服务端读实配值)
//   N8 变更(2026-10-10): 撤回通道由「一期不做」变更为「做」→ 新增 WITHDRAWN 状态与 canWithdrawReport
//   实现方案: .trae/documents/3B爽约申诉-撤销能力-实现方案.md

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// 爽约 9 键读取: 服务端一律读实配值, 未配置回退默认(与 admin-action CONFIG_SCHEMA def 同源);
// 越界一并向 schema min/max 钳制(防脏配置入库后放大处罚)
function noShowCfg(config) {
  const c = config || {};
  const int = (v, def, min, max) => {
    if (v === null || v === undefined || v === '') return def;   // 显式空值=未配置 → 回退默认(防 null→0 被误当显式值)
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(Math.max(Math.round(n), min), max);
  };
  return {
    reportWindowH: int(c.no_show_report_window_h, 48, 1, 168),
    defenseWindowH: int(c.no_show_defense_window_h, 48, 1, 168),
    scoreDeduct: int(c.no_show_score_deduct, 20, 0, 100),
    suspendThreshold: int(c.no_show_suspend_threshold, 3, 1, 10),
    suspendDays: int(c.no_show_suspend_days, 7, 1, 90),
    countWindowDays: int(c.no_show_count_window_days, 180, 7, 365),
    evidenceMax: int(c.no_show_evidence_max, 3, 1, 9),
    reasonMinLen: int(c.no_show_reason_min_len, 10, 5, 200),
    maxPerOrder: int(c.no_show_max_per_order, 1, 1, 3)
  };
}

// 可申诉资格(N1, 2026-10-10 口径变更): 订单须为 S2(已支付未开始)/S3.5(履约中断), 且在「约定开始时间
//   + reportWindowH 小时」时限内。**已取消「约定开始时间未到不可申诉」限制 → S2 付款后即可发起申诉**
//   (原 N1 的防预告式申诉限制经用户确认放宽; 变更后无需再等开始时间)
function canSubmitReport(order, now, cfg) {
  const c = cfg || noShowCfg(null);
  if (!order) return { ok: false, code: 'no_show_order_missing', msg: '订单不存在' };
  if (order.status !== 'S2' && order.status !== 'S3.5') {
    return { ok: false, code: 'no_show_bad_status', msg: `订单当前状态(${order.status})不可提交爽约申诉(仅 S2 已支付未开始 / S3.5 履约中断)` };
  }
  const start = Number(order.start_time) || 0;
  if (!start) return { ok: false, code: 'no_show_no_start', msg: '订单缺少约定开始时间' };
  if (now > start + c.reportWindowH * HOUR_MS) {
    return { ok: false, code: 'no_show_window_closed', msg: `已超过申诉时限(约定开始时间后 ${c.reportWindowH} 小时内可提交)` };
  }
  return { ok: true };
}

// 举证截止时间 = 受理时间 + 举证窗口(N2: 逾期不自动关闭, 管理员可径行裁定;
// 逾期后仍允许提交举证, 但标记 overdue 供管理端参考)
function defenseDeadlineOf(createdAt, cfg) {
  const c = cfg || noShowCfg(null);
  return (Number(createdAt) || 0) + c.defenseWindowH * HOUR_MS;
}

// 裁定成立时的处罚结果(N3/N10): priorCount=滚动窗口内既有 no_show 次数(不含本次)
// 返回: times 本次是第几次; scoreDelta 扣分(负数, 0=仅计次不扣分); suspend 是否触发停用;
//       suspendUntil 停用到期时间(未触发为 null)
function verdictOutcome(cfg, priorCount, now) {
  const c = cfg || noShowCfg(null);
  const times = Math.max(0, Number(priorCount) || 0) + 1;
  const suspend = times >= c.suspendThreshold;
  return {
    times,
    scoreDelta: c.scoreDeduct === 0 ? 0 : -c.scoreDeduct,   // 0 扣分时避免产出 -0(严格相等/落库口径)
    suspend,
    suspendUntil: suspend ? now + c.suspendDays * DAY_MS : null,
    suspendDays: c.suspendDays
  };
}

const REPORT_STATUS = { RECEIVED: 'received', DEFENSE: 'defense', DECIDED: 'decided', WITHDRAWN: 'withdrawn' };
const VERDICTS = ['upheld', 'rejected'];

// 撤回资格(N8 由「一期不做」变更为「做」, 2026-10-10): 仅申诉人本人, 且裁定前(received/defense)可撤;
// 已裁定(decided)不可撤; already-withdrawn 的幂等短路由调用方先行处理(此处按不可撤返回 false)。
// 注: 撤回占用 N6 配额(不写 is_deleted), 故撤回后同单同人不可再提交。
function canWithdrawReport(status, isReporter) {
  if (!isReporter) return false;
  return status === REPORT_STATUS.RECEIVED || status === REPORT_STATUS.DEFENSE;
}

module.exports = {
  DAY_MS, HOUR_MS,
  noShowCfg, canSubmitReport, defenseDeadlineOf, verdictOutcome, canWithdrawReport,
  REPORT_STATUS, VERDICTS
};