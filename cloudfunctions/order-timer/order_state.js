// 共享：订单履约状态机(规范源/单一实现)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-order-state.ps1 同步复制到:
//   cloudfunctions/order-action/order_state.js
//   cloudfunctions/order-timer/order_state.js
// 单测: 同目录 order_state.test.js (node --test)
// 抽取来源(2026-10-10 Wave1 防漂移): order-action L191 casStatus / order-timer L40 casStatus(两处重复实现)。
// 设计依据: docs/履约域业务逻辑与流程设计方案.md §3.1 设计原则 / §3.2 状态收编 / §3.3 目标状态迁移表。
// ⚠️ Wave1 契约 = 行为不变: 本模块的 CAS 与既有 casStatus 语义逐字一致(含数组 expect / stats.updated 判定 / 异常返回 false);
//    迁移白名单表此时仅作 SSOT + 单测目标 + 影子校验(不阻断), 强制拦截放后续波次。

// ──────────────────────────────────────────────────────────────────
// JSDoc 契约类型(纯类型标注, 供 IDE/重构静态检查; 运行时零影响)
// ──────────────────────────────────────────────────────────────────
/**
 * 订单主轴状态码(全量合法 14 态)。
 * @typedef {'S1'|'S0'|'S2'|'S2_5'|'S3'|'S3.5'|'S4'|'S5'|'S8'|'S10.5'|'S6'|'S7'|'S10'|'S9'} OrderStatus
 */
/**
 * 评价正交位。
 * @typedef {'pending'|'user_done'|'auto_done'} EvalState
 */
/**
 * 争议正交位。
 * @typedef {'none'|'open'|'resolved'} DisputeState
 */
/**
 * 争议类型。
 * @typedef {'complaint'|'no_show'|'refund'|''} DisputeType
 */
/**
 * 结算正交位。
 * @typedef {'pending'|'ready'|'done'} SettleState
 */
/**
 * 资金正交位(随订单持久化, 单位: 分)。
 * @typedef {Object} FundBit
 * @property {number} paid_fen       已付金额(分)
 * @property {number} refunded_fen   已退金额(分)
 * @property {SettleState} settle_state
 * @property {number} settled_at     结算完成时间戳(0=未结算)
 */
/**
 * 订单正交位集合(履约进度之外的维度, 不挤占 status)。
 * @typedef {Object} OrthoBits
 * @property {EvalState} eval_state
 * @property {DisputeState} dispute_state
 * @property {DisputeType} dispute_type
 * @property {boolean} frozen        争议/申诉期间冻结操作位
 * @property {FundBit} fund
 */
/**
 * 一条状态迁移规则(§3.3 目标迁移表)。
 * @typedef {Object} Transition
 * @property {number} no
 * @property {string} event
 * @property {'user'|'partner'|'both'|'platform'|'system'} role
 * @property {Array<OrderStatus|'*'>} from
 * @property {OrderStatus|null} to    null=目标由业务上下文决定
 * @property {string} guard
 * @property {string} money
 * @property {string} timeout
 */
/**
 * 读兼容归一化后的订单视图(mapStatus 输出)。
 * @typedef {Object} MappedOrder
 * @property {OrderStatus} status
 * @property {EvalState} eval_state
 * @property {DisputeState} dispute_state
 * @property {boolean} frozen
 */

// ── 状态常量(§3.2): 目标主轴 9 态 + 争议占位 + 终态 + 退役态 ──
const MAIN_AXIS = ['S1', 'S0', 'S2', 'S2_5', 'S3', 'S3.5', 'S4', 'S5', 'S8'];  // 目标主轴 9 态(S9 退役收编为 S8+eval_state=auto_done)
const SIDE_STATES = ['S10.5'];                                                  // 争议占位(目标态由 dispute_state 正交位表达)
const TERMINAL_STATES = ['S6', 'S7', 'S10'];                                    // 终态: 已取消/已退款/已关闭
const LEGACY_STATES = ['S9'];                                                   // 退役态: 仅存量与读兼容保留(mapStatus → S8 + auto_done)
const ALL_STATES = MAIN_AXIS.concat(SIDE_STATES, TERMINAL_STATES, LEGACY_STATES);  // 全量合法 S 码(14)
// 结算资格组: 原「S8/S9/S10 隐式算已结算」的注释口径(money_rules L85 注释), 在此收编为显式 SSOT(§3.2)
const SETTLE_ELIGIBLE = ['S8', 'S9', 'S10'];

// ── 正交位默认值(§3.2): 履约进度之外的维度不再挤占 status ──
// eval_state: pending(待评价) / user_done(用户已评) / auto_done(超时默认评)
// dispute_state: none / open / resolved  —— dispute_type: complaint / no_show / refund / ''
// fund: paid_fen(已付) / refunded_fen(已退) / settle_state(pending/ready/done) / settled_at
// frozen: 争议/申诉期间冻结操作位(替代 S10.5 靠占主状态实现的"天然冻结")
/**
 * 新建订单正交位的默认值集合(创建订单或补齐字段时用)。
 * @returns {OrthoBits}
 */
function orthoDefaults() {
  return {
    eval_state: 'pending',
    dispute_state: 'none',
    dispute_type: '',
    frozen: false,
    fund: { paid_fen: 0, refunded_fen: 0, settle_state: 'pending', settled_at: 0 }
  };
}

// ── 目标状态迁移表(§3.3, 22 条; from×event→to 白名单) ──
// to=null 表示目标由业务上下文决定(回原状态 / 平台裁决出口), 不做固定目标校验。
const TRANSITIONS = [
  { no: 1, event: 'confirm_done', role: 'both', from: ['S1'], to: 'S0', guard: '8 位确认全满', money: '', timeout: '15min→S6(释放 demand)' },
  { no: 2, event: 'pay', role: 'user', from: ['S0'], to: 'S2', guard: '支付流水成功', money: 'type=pay 流水', timeout: '30min→S6(释放 demand)' },
  { no: 3, event: 'cancel', role: 'both', from: ['S1', 'S0'], to: 'S6', guard: '', money: '已付则原路退', timeout: '' },
  { no: 4, event: 'cancel_request', role: 'both', from: ['S2'], to: null, guard: '挂起(不改主轴)', money: '按 PRD 取消梯度退款', timeout: '对方 2h 确认; 超时转裁决' },
  { no: 5, event: 'start_service', role: 'partner', from: ['S2'], to: 'S3', guard: '未冻结', money: '', timeout: 'start_time+Xh 未开始→提醒走申诉/取消' },
  { no: 6, event: 'modify', role: 'both', from: ['S2', 'S2_5'], to: null, guard: '未冻结', money: '', timeout: 'confirmHours→自动拒绝' },
  { no: 7, event: 'interrupt_report', role: 'both', from: ['S3'], to: 'S3.5', guard: '原因必填, 未冻结', money: '', timeout: '24h→S4' },
  { no: 8, event: 'resume', role: 'both', from: ['S3.5'], to: 'S3', guard: '', money: '', timeout: '' },
  { no: 9, event: 'partial_agree', role: 'both', from: ['S3.5'], to: 'S4', guard: '', money: '', timeout: '裁限期→按证据转裁决' },
  { no: 10, event: 'milestone', role: 'both', from: ['S3'], to: 'S3', guard: '', money: '', timeout: '确认窗(可配)自动确认' },
  { no: 11, event: 'extend_req', role: 'both', from: ['S3'], to: 'S3', guard: '未冻结', money: '', timeout: '对方 2h 未回应→自动拒绝' },
  { no: 12, event: 'extend_paid', role: 'user', from: ['S3'], to: 'S3', guard: '加时补付流水成功', money: 'type=pay(sub=extend)', timeout: '未付不加结算基数' },
  { no: 13, event: 'complete', role: 'partner', from: ['S3'], to: 'S5', guard: '里程碑 100% 或双方豁免', money: '', timeout: '' },
  { no: 14, event: 'ratio_agree', role: 'both', from: ['S4'], to: 'S5', guard: '双方各确认一次', money: '按 PRD 分段结算', timeout: '裁限期→平台介入' },
  { no: 15, event: 'evaluate', role: 'user', from: ['S5'], to: 'S8', guard: '无已有评价', money: '信用分±; settle ready', timeout: '48h→auto_done' },
  { no: 16, event: 'complaint_open', role: 'both', from: ['S2', 'S3', 'S3.5', 'S4', 'S5', 'S8'], to: null, guard: '售后/履约窗口内(目标态=原状态+frozen, 不改主轴)', money: '', timeout: '一审时限→升级二审/催办' },
  { no: 17, event: 'complaint_withdraw', role: 'both', from: ['*'], to: null, guard: '未受理(回 from_status)', money: '', timeout: '' },
  { no: 18, event: 'dispute_resolve_refund', role: 'platform', from: ['*'], to: null, guard: '金额≤可退上限; 全退→S7 / 部分退→回主轴', money: 'type=refund 流水+字段+通知', timeout: '' },
  { no: 19, event: 'dispute_resolve_complete', role: 'platform', from: ['*'], to: null, guard: '已有评价→S8(保留评价); 无评价→S5', money: '', timeout: '' },
  { no: 20, event: 'after_sale_expire', role: 'system', from: ['S8'], to: 'S10', guard: '售后窗口届满', money: 'settle ready 确认', timeout: '' },
  { no: 21, event: 'no_show_decide', role: 'platform', from: ['*'], to: null, guard: '受害方获退款通道', money: '赔付=订单额 10%(可配)', timeout: '' },
  { no: 22, event: 'settle', role: 'system', from: ['S8', 'S9', 'S10'], to: null, guard: 'settle ready', money: '余额=Σ基数−已提现', timeout: '' }
];

// 事件 → 规则(可能多条, 如 cancel 覆盖 S1/S0)
function transitionsOf(event) {
  return TRANSITIONS.filter((t) => t.event === event);
}

// 取匹配 `event` 且 from 命中(expect 可为字符串或数组)的规则; to 传入时须命中(或规则 to=null 视为由业务决定)。
// from 含 '*' 表示"任意已知状态"(冻结态下的撤回/裁决), 仍拒绝非法态。
function transitionFor(event, from, to) {
  const froms = Array.isArray(from) ? from : [from];
  const known = froms.filter((x) => ALL_STATES.indexOf(x) >= 0);
  return transitionsOf(event).find((t) => {
    const fromOk = t.from.indexOf('*') >= 0
      ? known.length > 0
      : t.from.some((f) => froms.indexOf(f) >= 0);
    if (!fromOk) return false;
    if (to === undefined || t.to === null) return true;
    return t.to === to;
  }) || null;
}
function canTransition(event, from, to) {
  return !!transitionFor(event, from, to);
}

// ── 读兼容(§5.1): 旧 S 码 → 目标表达; 未迁移的存量数据也能被新读方正确理解 ──
// 已有正交位字段时以其为准, 否则由旧状态推导。
/**
 * 把(可能含旧 S 码/缺正交位的)订单归一化为统一视图, 供读方消费。
 * @param {Object} order  原始订单(可缺字段)
 * @returns {MappedOrder}
 */
function mapStatus(order) {
  const o = order || {};
  const st = o.status;
  const out = {
    status: st,
    eval_state: o.eval_state || null,
    dispute_state: o.dispute_state || null,
    frozen: !!o.frozen
  };
  if (st === 'S9') { out.status = 'S8'; out.eval_state = out.eval_state || 'auto_done'; }
  else if (st === 'S8') { out.eval_state = out.eval_state || 'user_done'; }
  else if (st === 'S10.5') {
    out.status = o.complaint_from_status || o.dispute_from_status || st;
    out.dispute_state = out.dispute_state || 'open';
    out.frozen = true;
  }
  if (!out.eval_state) out.eval_state = 'pending';
  if (!out.dispute_state) out.dispute_state = 'none';
  return out;
}

// ── CAS 条件更新(与既有 casStatus 逐字同构, 仅增加可选影子校验) ──
// col/'_' 依赖注入(与 _shared/heal.js 同法), 便于纯逻辑单测。
// 仅当订单仍处于 expect(字符串或数组)时更新, 返回是否"抢到"; 异常一律返回 false(不抛)。
/**
 * CAS 条件更新: 仅当订单当前 status ∈ expect 时应用 patch, 实现并发安全的状态流转。
 * @param {Function} col       集合访问器(依赖注入, 如 (name)=>db.collection(name))
 * @param {Object} _           wx-server-sdk db command 构造器(_.in / _.eq ...)
 * @param {string} orderId     order_main._id
 * @param {OrderStatus|OrderStatus[]} expect  允许的当前状态(命中才更新)
 * @param {Object} patch       要写入的字段(含 status 与正交位)
 * @param {Object} [opts]      { event, onShadow, onError }
 * @returns {Promise<boolean>} 是否抢到更新(异常返回 false, 不抛)
 */
async function casTransition(col, _, orderId, expect, patch, opts) {
  const o = opts || {};
  try {
    const cond = Array.isArray(expect) ? _.in(expect) : expect;
    const r = await col('order_main').where({ _id: orderId, status: cond }).update({ data: patch });
    const won = !!(r.stats && r.stats.updated === 1);
    // 影子模式(Wave1 不阻断): 迁移不在 §3.3 白名单内时回调告警, 供观测后再决定是否开强制
    if (won && o.event && o.onShadow) {
      const to = patch && patch.status;
      if (to && !canTransition(o.event, expect, to)) o.onShadow(o.event, expect, to);
    }
    return won;
  } catch (e) {
    if (o.onError) o.onError(e);
    return false;
  }
}

module.exports = {
  MAIN_AXIS, SIDE_STATES, TERMINAL_STATES, LEGACY_STATES, ALL_STATES, SETTLE_ELIGIBLE,
  orthoDefaults,
  TRANSITIONS, transitionsOf, transitionFor, canTransition,
  mapStatus,
  casTransition
};
