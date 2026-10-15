// @VERIFIED 2026-10-13 已真机验证：order_state 表驱动+正交位 dual-write+三副本同步(SYNC_MAP)+action_timeline 时间线合并（依据：project_memory L182, L190, L206）
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
 * @typedef {'S1'|'S0'|'S2'|'S2_6'|'S2_5'|'S3'|'S3_6'|'S3.5'|'S4'|'S5'|'S8'|'S10.5'|'S6'|'S7'|'S10'|'S9'} OrderStatus
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

// ── 状态常量(§3.2): 目标主轴 11 态 + 争议占位 + 终态 + 退役态 ──
// 2026-10-14 履约双确认(规范《线下陪伴履约流程规范》)新增两中间态:
//   S2_6=开始履约申请中(耍伴发起申请待用户确认) / S3_6=履约完毕确认中(耍伴发起完毕待用户凭证确认)
const MAIN_AXIS = ['S1', 'S0', 'S2', 'S2_6', 'S2_5', 'S3', 'S3_6', 'S3.5', 'S4', 'S5', 'S8'];  // 目标主轴 11 态(S9 退役收编为 S8+eval_state=auto_done)
const SIDE_STATES = ['S10.5'];                                                  // 争议占位(目标态由 dispute_state 正交位表达)
const TERMINAL_STATES = ['S6', 'S7', 'S10'];                                    // 终态: 已取消/已退款/已关闭
const LEGACY_STATES = ['S9'];                                                   // 退役态: 仅存量与读兼容保留(mapStatus → S8 + auto_done)
const ALL_STATES = MAIN_AXIS.concat(SIDE_STATES, TERMINAL_STATES, LEGACY_STATES);  // 全量合法 S 码(16)

// ── 履约双确认存证结构(2026-10-14, 规范 §2.4) ──
// 定位快照与水印照片先落库再推消息(存证先行); 坐标全链路 GCJ-02; 时间一律服务端时间戳;
// threshold_used=发起瞬间快照的距离阈值(后台改配不影响存量订单)。挂 order_main, 不新建集合。
// 幂等: order_id + stage + 时间窗(同一阶段窗口内重复提交返回首次结果)。
const FULFILL_EVIDENCE_FIELDS = ['order_id', 'role', 'lat', 'lng', 'coord_system', 'accuracy', 'server_time', 'photo_urls', 'threshold_used'];
const FULFILL_COORD_SYSTEM = 'GCJ-02';
const FULFILL_STAGES = { START: 'start', FINISH: 'finish' };   // start=开始履约申请/同意后留痕; finish=履约完毕凭证
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
  // ⚠️ no.5(直连 S2→S3)与 no.13(直连 S3→S5)为旧 B1/完毕链路, 阶段 A 保留共存, 待阶段 C/F 切换 handler 到 start_apply/finish_apply 后收口移除(防中途状态机拒绝线上请求)。
  { no: 6, event: 'modify', role: 'both', from: ['S2', 'S2_5'], to: null, guard: '未冻结', money: '', timeout: 'confirmHours(后台可配)→自动拒绝' },
  { no: 7, event: 'interrupt_report', role: 'both', from: ['S3'], to: 'S3.5', guard: '原因必填, 未冻结', money: '', timeout: '24h→S4' },
  { no: 8, event: 'resume', role: 'both', from: ['S3.5'], to: 'S3', guard: '', money: '', timeout: '' },
  { no: 9, event: 'partial_agree', role: 'both', from: ['S3.5'], to: 'S4', guard: '', money: '', timeout: '裁限期→按证据转裁决' },
  { no: 10, event: 'milestone', role: 'both', from: ['S3'], to: 'S3', guard: '', money: '', timeout: '确认窗(可配)自动确认' },
  { no: 11, event: 'extend_req', role: 'both', from: ['S3'], to: 'S3', guard: '未冻结', money: '', timeout: 'extend_confirm_min(后台可配, 分钟, 默认 20; 0=跟随 confirmHours) 未回应→自动拒绝' },
  { no: 12, event: 'extend_paid', role: 'user', from: ['S3'], to: 'S3', guard: '加时补付流水成功', money: 'type=pay(sub=extend)', timeout: '未付不加结算基数' },
  { no: 13, event: 'complete', role: 'partner', from: ['S3'], to: 'S5', guard: '里程碑 100% 或双方豁免', money: '', timeout: '' },
  { no: 14, event: 'ratio_agree', role: 'both', from: ['S4'], to: 'S5', guard: '双方各确认一次', money: '按 PRD 分段结算', timeout: '裁限期→平台介入' },
  { no: 15, event: 'evaluate', role: 'user', from: ['S5'], to: 'S8', guard: '无已有评价', money: '信用分±; settle ready', timeout: '48h→auto_done' },
  { no: 16, event: 'complaint_open', role: 'both', from: ['S2', 'S3', 'S3.5', 'S4'], to: null, guard: '售后/履约窗口内(目标态=原状态+frozen, 不改主轴); 2026-10-15 需求变更: 用户确认履约完毕(S5)起关闭投诉入口 → 移除 S5/S8, 与 action_dispute.COMPLAINT_OPEN_STATUS 对齐', money: '', timeout: '一审时限→升级二审/催办' },
  { no: 17, event: 'complaint_withdraw', role: 'both', from: ['*'], to: null, guard: '未受理(回 from_status)', money: '', timeout: '' },
  { no: 18, event: 'dispute_resolve_refund', role: 'platform', from: ['*'], to: null, guard: '金额≤可退上限; 全退→S7 / 部分退→回主轴', money: 'type=refund 流水+字段+通知', timeout: '' },
  { no: 19, event: 'dispute_resolve_complete', role: 'platform', from: ['*'], to: null, guard: '已有评价→S8(保留评价); 无评价→S5', money: '', timeout: '' },
  { no: 20, event: 'after_sale_expire', role: 'system', from: ['S8'], to: 'S10', guard: '售后窗口届满', money: 'settle ready 确认', timeout: '' },
  { no: 21, event: 'no_show_decide', role: 'platform', from: ['*'], to: null, guard: '受害方获退款通道', money: '一期零赔付(10% 赔付本期不做, 仅扣信用分/停用; 已拍板)', timeout: '' },
  { no: 22, event: 'settle', role: 'system', from: ['S8', 'S9', 'S10'], to: null, guard: 'settle ready', money: '余额=Σ基数−已提现', timeout: '' },
  // ── 履约双确认链路(2026-10-14, 规范《线下陪伴履约流程规范》图1; 共 8 条 no.23-30) ──
  { no: 23, event: 'start_apply', role: 'partner', from: ['S2'], to: 'S2_6', guard: 'D≤N 且定位可信; 未冻结; 定位快照已落库(存证先行)', money: '', timeout: '15min 无响应→S10.5(提醒2次)' },
  { no: 24, event: 'start_confirm', role: 'user', from: ['S2_6'], to: 'S3', guard: '仅需求方; 同意(可带用户定位留痕)', money: '', timeout: '' },
  { no: 25, event: 'start_reject', role: 'user', from: ['S2_6'], to: 'S2', guard: '仅需求方; 冷却60s 可重发', money: '', timeout: '连续2次拒绝→S10.5' },
  { no: 26, event: 'start_apply_timeout', role: 'platform', from: ['S2_6'], to: 'S10.5', guard: '15min 超时未响应(或连续2次拒绝)', money: '资金冻结待裁定', timeout: '' },
  { no: 27, event: 'finish_apply', role: 'partner', from: ['S3'], to: 'S3_6', guard: 'D≤N 且定位可信; 完成照片+定位快照已先落库(凭证前置)', money: '', timeout: '30min 无响应→S10.5(提醒2次)' },
  { no: 28, event: 'finish_confirm', role: 'user', from: ['S3_6'], to: 'S5', guard: '仅需求方; 已查看凭证; 确认完毕→S5(已完成)', money: '完毕确认即触发结算(不等评价)', timeout: '连续2次不确认→S10.5' },
  { no: 29, event: 'finish_reject', role: 'user', from: ['S3_6'], to: 'S3', guard: '仅需求方; 冷却60s 可重发', money: '', timeout: '' },
  { no: 30, event: 'finish_confirm_timeout', role: 'platform', from: ['S3_6'], to: 'S10.5', guard: '30min 超时未响应(或连续2次不确认)', money: '资金冻结待裁定', timeout: '' }
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

// ── 强制迁移拦截(§3.3 收口) ──
// 注意: 仅凭 (from→to) 无法拦截——因 no.17/18/19/21 等规则 from=['*'](撤回/平台裁决),
//   任意 from→任意 to 均可命中, 白名单留有 '*' 时不具结构约束力。故强制校验须**事件驱动**。
// 放行规则: 无目标状态(非迁移) / 退役态 S9(存量写兼容) / 未提供 event(未迁移的兼容调用点)。
function transitionAllowed(event, expect, to) {
  if (!to) return true;
  if (LEGACY_STATES.indexOf(to) >= 0) return true;
  if (!event) return true;
  return canTransition(event, expect, to);
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
 * @param {Object} [opts]      { event, onShadow, onError, onReject, skipGuard }
 * @returns {Promise<boolean>} 是否抢到更新(白名单外迁移或异常返回 false, 不抛)
 */
async function casTransition(col, _, orderId, expect, patch, opts) {
  const o = opts || {};
  const to = patch && patch.status;
  // 强制拦截(§3.3 收口): patch.status 存在且不在迁移白名单内 → 直接拒绝(不写库)。
  // 退役态(S9)由 transitionAllowed 放行(存量写兼容); opts.skipGuard 可显式绕过(仅限明确场景)。
  if (to && !o.skipGuard && !transitionAllowed(o.event, expect, to)) {
    if (o.onReject) o.onReject(expect, to);
    return false;
  }
  try {
    const cond = Array.isArray(expect) ? _.in(expect) : expect;
    const r = await col('order_main').where({ _id: orderId, status: cond }).update({ data: patch });
    const won = !!(r.stats && r.stats.updated === 1);
    // 影子校验(保留): 白名单外迁移回调告警(供观测; 正常流程已由上方强制拦截)
    if (won && o.event && o.onShadow) {
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
  FULFILL_EVIDENCE_FIELDS, FULFILL_COORD_SYSTEM, FULFILL_STAGES,
  orthoDefaults,
  TRANSITIONS, transitionsOf, transitionFor, canTransition, transitionAllowed,
  mapStatus,
  casTransition
};
