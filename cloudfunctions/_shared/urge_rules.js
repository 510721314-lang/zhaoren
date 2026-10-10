// urge_rules.js - S2 履约催办三段式纯规则（Wave2 止血⑥）
// 纯函数，无 wx-server-sdk 依赖，可独立单测。消费者：order-timer（自动链路）。
// 设计依据：docs/履约域业务逻辑与流程设计方案.md §3.7.6
//   自动链路三段式：T-0 到点提醒耍伴 → T+remindAfterH 用户通知+催办入口 → T+escalateAfterH 引导申诉
//   幂等：每段用订单标记位（urge_t0_at/urge_t1_at/urge_t2_at）防重复轰炸
//   互斥：cancel_request.pending（协商取消挂起）或 frozen（申诉/投诉冻结）时不催办（§3.7.5）

function urgeCfg(config) {
  const c = config || {};
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
  return {
    remindAfterH: num(c.remind_after_h, 1),      // T+1h：用户通知 + 催办入口亮起
    escalateAfterH: num(c.escalate_after_h, 4),  // T+4h：引导爽约申诉
    urgeMaxCount: num(c.urge_max_count, 2)        // 手动催办每单上限（order-action 消费）
  };
}

// 判定订单本次应触发的催办阶段。返回 [{ stage, markField, to, title, body }]（按 t0→t1→t2）；无则 []
function dueStages(order, now, cfg) {
  if (!order) return [];
  if (order.status !== 'S2') return [];
  const st = Number(order.start_time) || 0;
  if (!st || st >= now) return [];                 // 未到开始时间，不催办
  if (order.cancel_request && order.cancel_request.status === 'pending') return []; // 取消挂起互斥
  if (order.frozen === true) return [];            // 申诉/投诉冻结互斥

  const c = urgeCfg(cfg);
  const H = 3600 * 1000;
  const stages = [];

  if (!order.urge_t0_at) {
    stages.push({
      stage: 't0', markField: 'urge_t0_at', to: 'partner',
      title: '⏰ 履约时间已到',
      body: '约定的服务开始时间已到，请尽快开始履约'
    });
  }
  if (!order.urge_t1_at && now >= st + c.remindAfterH * H) {
    stages.push({
      stage: 't1', markField: 'urge_t1_at', to: 'user',
      title: '⚠️ 对方尚未开始履约',
      body: '已超过约定开始时间，可在订单详情催办或发起爽约申诉'
    });
  }
  if (!order.urge_t2_at && now >= st + c.escalateAfterH * H) {
    stages.push({
      stage: 't2', markField: 'urge_t2_at', to: 'user',
      title: '🚨 履约严重超时',
      body: '对方长时间未开始履约，建议发起爽约申诉维护权益'
    });
  }
  return stages;
}

// 手动催办准入判定（order-action 消费）：返回 {ok, code?, remaining?, max?}
function canManualUrge(order, now, cfg) {
  if (!order || order.status !== 'S2') return { ok: false, code: 'oa_urge_status' };
  const st = Number(order.start_time) || 0;
  if (!st || st >= now) return { ok: false, code: 'oa_urge_not_started' };
  if (order.cancel_request && order.cancel_request.status === 'pending') return { ok: false, code: 'oa_urge_cancel_pending' };
  if (order.frozen === true) return { ok: false, code: 'oa_urge_frozen' };
  const c = urgeCfg(cfg);
  const used = Number(order.urge_count) || 0;
  if (used >= c.urgeMaxCount) return { ok: false, code: 'oa_urge_limit', remaining: 0, max: c.urgeMaxCount };
  return { ok: true, remaining: c.urgeMaxCount - used, max: c.urgeMaxCount };
}

module.exports = { urgeCfg, dueStages, canManualUrge };
