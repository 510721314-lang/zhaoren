// order-action · 订单事件时间线 timeline（只读，从 index.js 物理抽出）
// 需求(2026-10-12 拍板 E1=全事件族): 投诉 / 爽约上报 / 改期 / 加时 / 里程碑 / 支付退款 / 催办
//   等所有订单相关事件, 在订单详情**双方向**可回看详情。
// 数据源合并: order_status_log(状态轴, 含改期/加时/取消/里程碑外的流转) + complaint + no_show_report
//   + pay_transaction + order_main(milestone.evidence / urge_logs) → 统一事件数组
//   [{ at, type, label, actor_role, detail }], 按时间**倒序**, 限流最近 50 条。
// 权限: 仅订单参与方; 只返回角色可读化文案(actor_role), 不外显 openid / 内部 note / 风控字段。
//   投诉/撤回的 status_log 与 complaint 记录重复, 故在此**跳过**投诉类 status_log, 由 complaint 源承载。
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

const STATUS_LABEL = {
  S0: '待支付', S1: '待确认', S2: '已支付待履约', 'S2.5': '改期处理中', S3: '履约中',
  'S3.5': '履约中断', S4: '部分完成', S5: '已完成', S6: '已取消', S7: '已退款',
  S8: '已评价', S9: '评价超时', S10: '已关闭', 'S10.5': '争议处理中'
};
const TX_LABEL = { pay: '支付', refund: '退款', tip: '打赏', settle: '结算' };
// 状态流转 action → 角色可读动作; 未收录则回退「A → B」状态文案
const ACTION_LABEL = {
  four_confirm_done: '四确认完成',
  user_cancel: '取消订单', partner_cancel: '取消订单',
  start_service: '开始履约',
  complete_service: '履约完成',
  user_modify: '发起改期', partner_modify: '发起改期',
  user_modify_confirm: '确认改期', partner_modify_confirm: '确认改期',
  user_modify_reject: '拒绝改期', partner_modify_reject: '拒绝改期',
  user_extend: '加时申请', partner_extend: '加时申请',
  user_extend_confirm: '同意加时', partner_extend_confirm: '同意加时',
  user_extend_reject: '拒绝加时', partner_extend_reject: '拒绝加时',
  user_resume: '恢复履约', partner_resume: '恢复履约',
  user_partial_confirm: '确认部分完成', partner_partial_confirm: '确认部分完成',
  user_ratio_confirm: '确认比例', partner_ratio_confirm: '确认比例',
  timeout_s1_cancel: '超时未确认自动取消',
  timeout_s0_close: '超时未支付自动取消',
  timeout_interrupt_partial: '超时自动转部分完成',
  timeout_modify_auto_reject: '改期超时自动拒绝',
  timeout_extend_auto_reject: '加时超时自动拒绝',
  after_sale_expire: '售后窗口到期关闭'
};
// 投诉/撤回类 status_log 跳过(由 complaint 集合承载, 避免同一动作重复两遍)
const SKIP_STATUS_ACTIONS = ['user_complaint', 'partner_complaint', 'complaint_withdraw'];

const TIMELINE_LIMIT = 50;

async function timeline(ctx) {
  const { order_id, openid, getOrder, roleOf, col, _ } = ctx;
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  const [logsR, cR, nsR, txR] = await Promise.all([
    col('order_status_log').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(100).get().catch(() => ({ data: [] })),
    col('complaint').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(20).get().catch(() => ({ data: [] })),
    col('no_show_report').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(20).get().catch(() => ({ data: [] })),
    col('pay_transaction').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(50).get().catch(() => ({ data: [] }))
  ]);
  const logs = logsR.data || [];
  const complaints = cR.data || [];
  const reports = nsR.data || [];
  const txs = txR.data || [];

  // openid → 角色(仅内部换算, 不外显)
  const actorOf = (oid) => {
    if (!oid || oid === 'system') return 'system';
    if (oid === order.user_openid) return 'user';
    if (oid === order.partner_openid) return 'partner';
    return 'admin';
  };
  const sl = (s) => STATUS_LABEL[s] || s || '';
  const events = [];

  logs.forEach((l) => {
    if (SKIP_STATUS_ACTIONS.indexOf(l.action) >= 0) return;
    const from = l.from_status, to = l.to_status;
    events.push({
      at: l.created_at || l.updated_at || 0,
      type: 'status',
      label: ACTION_LABEL[l.action] || (from === to ? sl(to) : `${sl(from)} → ${sl(to)}`),
      actor_role: actorOf(l.operator || l.actor_openid),
      detail: from === to ? '' : `${sl(from)} → ${sl(to)}`
    });
  });

  complaints.forEach((c) => {
    const withdrawn = c.status === 'withdrawn';
    events.push({
      at: (withdrawn && c.withdrawn_at) ? c.withdrawn_at : (c.created_at || 0),
      type: 'complaint',
      label: withdrawn ? '投诉已撤回' : '发起投诉',
      actor_role: actorOf(c.initiator_openid),
      detail: withdrawn ? '' : String(c.reason || '').slice(0, 100)
    });
  });

  reports.forEach((rp) => {
    events.push({
      at: rp.created_at || 0,
      type: 'no_show',
      label: `爽约申诉${rp.reason_type ? '(' + rp.reason_type + ')' : ''}`,
      actor_role: actorOf(rp.reporter_openid),
      detail: String(rp.reason || '').slice(0, 100)
    });
    if (rp.defense_at) events.push({
      at: rp.defense_at, type: 'no_show', label: '提交举证',
      actor_role: actorOf(rp.target_openid), detail: String(rp.defense_reason || '').slice(0, 100)
    });
    if (rp.decided_at) events.push({
      at: rp.decided_at, type: 'no_show',
      label: `申诉裁定：${rp.verdict === 'upheld' ? '成立' : '不成立'}`,
      actor_role: actorOf(rp.decided_by), detail: String(rp.decided_reason || '').slice(0, 100)
    });
    if (rp.withdrawn_at) events.push({
      at: rp.withdrawn_at, type: 'no_show', label: '申诉已撤回',
      actor_role: actorOf(rp.reporter_openid), detail: ''
    });
  });

  txs.forEach((t) => {
    events.push({
      at: t.created_at || t.paid_at || 0,
      type: 'money',
      label: `${TX_LABEL[t.type] || t.type} ¥${((t.amount_fen || 0) / 100).toFixed(2)}`,
      actor_role: actorOf(t.operator_openid),
      detail: t.note ? String(t.note).slice(0, 50) : ''
    });
  });

  // 里程碑(order_main.milestone.evidence) + 催办(order_main.urge_logs) —— 状态轴不落这两类
  const ms = order.milestone || {};
  (Array.isArray(ms.evidence) ? ms.evidence : []).forEach((ev) => {
    events.push({
      at: ev.submitted_at || 0, type: 'milestone',
      label: `提交履约进度 ${ev.label || ''}`.trim(),
      actor_role: actorOf(ev.submitted_by),
      detail: String(ev.note || '').slice(0, 100)
    });
  });
  (Array.isArray(order.urge_logs) ? order.urge_logs : []).forEach((u, i) => {
    events.push({
      at: u.at || 0, type: 'urge', label: '催办履约',
      actor_role: actorOf(u.by), detail: `第 ${i + 1} 次`
    });
  });

  events.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { ok: true, data: { events: events.slice(0, TIMELINE_LIMIT), total: events.length } };
}

module.exports = { timeline };
