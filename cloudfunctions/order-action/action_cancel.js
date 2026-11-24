// order-action · 订单取消分组(2026-11-24 W3, 方案 docs/schemes/cancel-fulfillment-v2.2.md §3.1/§4/§5)
// 协商型取消(S2/S2_6): 申请 → 对方确认(窗口可配) → 梯度退款+扣分 → S7; 拒绝/超时 → S10.5 裁决; 发起方可撤回。
// 共享符号经 ctx 注入, 禁止反向 require('./index'); 规则纯函数用本地副本(money_rules/credit_rules, sync 脚本同步)。
// 管理动作一律后台可配(§0.0): 开关/窗口/扣分梯度/退款档位/冷却时长全部读 admin_config, 此处零硬编码业务参数。
const { cancelRefundFen, refundCap } = require('./money_rules');
const { cancelCreditDelta } = require('./credit_rules');
const { getGlobalConfig } = require('./config_cache');

const CANCEL_REQUEST_STATUS = ['S2', 'S2_6'];   // 协商型申请白名单(状态机 no.4)
const REASON_MAX = 50;                          // D19: reason 选填, 最长 50 字

// admin_config 扁平键 → 取消配置对象(缺省/非法走规则函数兜底, 与方案 §0.1 默认一致)
function cancelCfgOf(c) {
  const o = c || {};
  const numPos = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);      // 窗口/档线须 > 0
  const numNonNeg = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);  // 冷却/扣分幅度 ≥ 0(0=免罚/免冷却合法)
  // 退款档位: 百分数存储 → 小数传入; pct 缺省时传 undefined 让 normalizeCancelRefundCfg 回退默认
  const pct = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) / 100 : undefined);
  return {
    enable: o.cancel_enable === true,
    windowMin: numPos(o.cancel_confirm_window_min, 120),
    withdrawCooldownMin: numNonNeg(o.cancel_cooldown_withdraw_min, 60),
    rejectedCooldownMin: numNonNeg(o.cancel_cooldown_rejected_min, 1440),
    refund: {
      far_hours: numPos(o.cancel_refund_far_hours, undefined),
      mid_hours: numPos(o.cancel_refund_mid_hours, undefined),
      far_rate: pct(o.cancel_refund_far_rate_pct),
      mid_rate: pct(o.cancel_refund_mid_rate_pct),
      near_rate: pct(o.cancel_refund_near_rate_pct)
    },
    penalty: {
      s2_far: numNonNeg(o.cancel_penalty_s2_far, undefined),
      s2_mid: numNonNeg(o.cancel_penalty_s2_mid, undefined),
      s2_near: numNonNeg(o.cancel_penalty_s2_near, undefined),
      s3: numNonNeg(o.cancel_penalty_s3, undefined),
      fulfill: numNonNeg(o.cancel_penalty_fulfill, undefined),
      far_hours: numPos(o.cancel_refund_far_hours, undefined),   // 档线与退款梯度同源(§5.1)
      mid_hours: numPos(o.cancel_refund_mid_hours, undefined)
    }
  };
}

// ── 发起取消申请(协商型) ──────────────────────────────────────────────
async function cancel_request(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, db, _, log, col, wxCtx, writeNotice, writeAudit } = ctx;
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  const cfg = cancelCfgOf(await getGlobalConfig(db));
  if (!cfg.enable) return { ok: false, code: 'oa_cancel_disabled', msg: '取消功能未开放' };
  if (CANCEL_REQUEST_STATUS.indexOf(order.status) < 0) {
    return { ok: false, code: 'oa_cancel_status', msg: `当前状态(${order.status})不可申请取消` };
  }
  if (isFrozen(order)) {
    return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可操作' };
  }
  const cr = order.cancel_request || {};
  const now = Date.now();
  if (cr.status === 'pending') {
    if (cr.by_openid === openid) return { ok: true, data: { pending: true, deadline: cr.deadline, idempotent: true } };
    return { ok: false, code: 'oa_cancel_pending', msg: '对方已发起取消申请,请在订单详情页处理' };
  }
  // 冷却期(B6/D14): 撤回/被拒后不可立即重发
  if (order.cancel_cooldown_until && order.cancel_cooldown_until > now) {
    const leftMin = Math.ceil((order.cancel_cooldown_until - now) / 60000);
    return { ok: false, code: 'oa_cancel_cooldown', msg: `冷却中,约 ${leftMin} 分钟后可再次申请取消` };
  }
  // D19: reason 选填, 截断 50 字
  const reason = String(event.reason || '').trim().slice(0, REASON_MAX);
  const deadline = now + cfg.windowMin * 60 * 1000;
  // CAS 抢占挂起: 状态白名单 + 未冻结 + 无 pending(三方条件防并发, 方案 §6)
  const won = await col('order_main').where({
    _id: order_id, status: _.in(CANCEL_REQUEST_STATUS),
    frozen: _.neq(true), 'cancel_request.status': _.neq('pending')
  }).update({ data: {
    cancel_request: { status: 'pending', by: role, by_openid: openid, at: now, deadline, reason },
    frozen: true, updated_at: now
  }});
  if (!won.stats || won.stats.updated !== 1) {
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  const peer = role === 'user' ? order.partner_openid : order.user_openid;
  await Promise.allSettled([
    writeNotice({ to_openid: peer, order_id, type: 'cancel_request', title: '对方申请取消订单', body: `请在 ${cfg.windowMin} 分钟内到订单详情确认,超时将转平台处理`, action_key: 'jump_order', action_payload: { order_id } }),
    writeNotice({ to_openid: openid, order_id, type: 'cancel_request_self', title: '取消申请已提交', body: `等待对方确认(${cfg.windowMin} 分钟内),确认后按梯度退款`, action_key: 'jump_order', action_payload: { order_id } })
  ]);
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  await writeAudit(db, log, { openid, role, category: 'business', action: 'cancel_request', target_type: 'order', target_id: order_id, detail: { from_status: order.status, window_min: cfg.windowMin, reason: reason.slice(0, 20) }, result: 'ok', client_ip: clientIp, device: String(event.device || '').slice(0, 200) });
  log.d(`cancel_request: ${order.order_no} by=${role} deadline=${deadline}`);
  return { ok: true, data: { order_id, pending: true, deadline } };
}

// ── 对方确认取消(梯度退款 + 发起方扣分, 同事务) ────────────────────────
async function cancel_confirm(ctx) {
  const { event, order_id, openid, getOrder, roleOf, db, log, col, _, wxCtx, writeNotice, writeAudit } = ctx;
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  const cfg = cancelCfgOf(await getGlobalConfig(db));
  // 2026-11-24 修复: 在途申请的确认不受全局开关 gate(与 cancel_reject/withdraw 对齐),
  // 否则 cancel_enable=false 时 pending 申请死锁无法闭环; 开关仅控制 cancel_request 新发起
  const cr = order.cancel_request || {};
  if (cr.status !== 'pending') return { ok: false, code: 'oa_cancel_no_pending', msg: '无进行中的取消申请' };
  if (cr.by_openid === openid) return { ok: false, code: 'oa_cancel_self_confirm', msg: '不能确认自己发起的取消申请' };
  if (CANCEL_REQUEST_STATUS.indexOf(order.status) < 0) {
    return { ok: false, code: 'oa_cancel_status', msg: `当前状态(${order.status})不可确认取消` };
  }
  const now = Date.now();
  const fromStatus = order.status;
  const paidFen = (order.fund && Number(order.fund.paid_fen)) || 0;
  const alreadyRefunded = (order.fund && Number(order.fund.refunded_fen)) || 0;
  const tipTotalFen = Number(order.tip_total_fen) || 0;
  // leadMs = 履约开始时间 - 同意时刻(不按申请时刻, 评审 N10); 基准一律 fund.paid_fen
  const leadMs = Math.max(0, (Number(order.start_time) || 0) - now);
  const refundFen = Math.min(cancelRefundFen(paidFen, leadMs, cfg.refund), refundCap(paidFen, alreadyRefunded));
  // D18: tip 同比例退(B4), 单条 refund 流水合并记录(note 记明细)
  const tipRefundFen = paidFen > 0 ? Math.round(tipTotalFen * refundFen / paidFen) : 0;
  const totalRefund = refundFen + tipRefundFen;
  const delta = cancelCreditDelta(fromStatus, leadMs, cfg.penalty);   // 发起方扣分(梯度可配)
  const initiatorRole = cr.by === 'partner' ? 'partner' : 'user';
  const creditField = initiatorRole === 'partner' ? 'partner_credit_score' : 'user_credit_score';

  // 1) CAS 串行门: 主轴 S2/S2_6→S7(状态机 no.32) + fund 点路径 _.inc + cancel_request 落定(方案 §4.2)
  const won = await col('order_main').where({
    _id: order_id, status: _.in(CANCEL_REQUEST_STATUS), 'cancel_request.status': 'pending'
  }).update({ data: {
    status: 'S7', refunded_at: now,
    'fund.refunded_fen': _.inc(totalRefund),
    'cancel_request.status': 'agreed',
    'cancel_request.refund_fen': refundFen,
    'cancel_request.tip_refund_fen': tipRefundFen,
    'cancel_request.confirmed_at': now,
    'cancel_request.confirmed_by': openid,
    frozen: false, updated_at: now
  }});
  if (!won.stats || won.stats.updated !== 1) {
    return { ok: false, code: 'oa_status_conflict', msg: '取消申请已处理或订单状态已变化,请刷新' };
  }

  // 2) 同事务: refund 流水 + 发起方信用分读-钳制[0,1000]-写 + credit_score_log + order_status_log(方案 §4.3)
  const refundNo = 'RF' + now.toString(36).toUpperCase() + String(Math.floor(Math.random() * 1e6));
  try {
    await db.runTransaction(async (t) => {
      await t.collection('pay_transaction').add({ data: {
        pay_no: refundNo, order_id, order_no: order.order_no,
        type: 'refund', amount_fen: totalRefund,
        refund_fen: refundFen, tip_refund_fen: tipRefundFen,
        lead_hours: Math.round(leadMs / 3600e3 * 10) / 10,
        channel: 'mock', is_mock: true, status: 'success',
        reason: 'cancel_confirm', paid_at: now,
        created_at: now, updated_at: now, is_deleted: false
      }});
      if (delta !== 0) {
        const u = (await t.collection('user_account').where({ openid: cr.by_openid }).limit(1).get()).data[0];
        if (u) {
          const before = Number(u[creditField]) || 800;
          const after = Math.max(0, Math.min(1000, before + delta));
          await t.collection('user_account').doc(u._id).update({ data: { [creditField]: after, updated_at: now } });
          await t.collection('credit_score_log').add({ data: {
            openid: cr.by_openid, type: 'cancel', score_type: initiatorRole,
            delta, score: after,
            reason: `取消订单(协商一致) #${order.order_no}`,
            order_id, is_system: false, admin_openid: '',
            created_at: now, updated_at: now, is_deleted: false
          }});
        }
      }
      await t.collection('order_status_log').add({ data: {
        order_id, from_status: fromStatus, to_status: 'S7',
        action: 'cancel_confirm', operator: openid,
        created_at: now, updated_at: now, is_deleted: false
      }});
    });
  } catch (e) {
    // 3) 补偿: 回退主轴/fund(增量回退, 防 prior refunded>0 被清零)/挂起恢复 pending; 二次失败 P0 留痕
    log.d(`cancel_confirm txn fail: ${e.message}; compensating ${order_id} → ${fromStatus}`);
    const back = await col('order_main').where({ _id: order_id, status: 'S7' }).update({ data: {
      status: fromStatus, refunded_at: 0,
      'fund.refunded_fen': _.inc(-totalRefund),
      'cancel_request.status': 'pending',
      frozen: true, updated_at: Date.now()
    }}).catch((e2) => {
      log.e(`cancel_confirm compensate FAIL order=${order_id}: ${(e2 && e2.message) || e2}`);
      return col('platform_event').add({ data: {
        level: 'P0', type: 'cancel_compensate_fail', order_id, order_no: order.order_no,
        detail: { totalRefund, fromStatus, err: String((e2 && e2.message) || e2) },
        created_at: Date.now(), is_deleted: false
      }}).catch(() => null);
    });
    return { ok: false, code: 'cancel_db_fail', msg: '取消确认失败,请稍后重试' + (back ? '' : '(已留痕待人工核对)') };
  }

  // 4) 通知双方(退款到账 + 扣分提示) + 审计
  const initiatorNotice = delta !== 0 ? `订单已取消,退款 ${totalRefund / 100} 元将原路返回;信用分 ${delta}` : `订单已取消,退款 ${totalRefund / 100} 元将原路返回`;
  await Promise.allSettled([
    writeNotice({ to_openid: cr.by_openid, order_id, type: 'cancel_agreed', title: '取消申请已确认', body: initiatorNotice, action_key: 'jump_order', action_payload: { order_id } }),
    writeNotice({ to_openid: openid, order_id, type: 'cancel_agreed_peer', title: '已确认取消订单', body: `订单已取消,退款 ${totalRefund / 100} 元将原路返回给付款方`, action_key: 'jump_order', action_payload: { order_id } })
  ]);
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  await writeAudit(db, log, { openid, role, category: 'funds', action: 'cancel_confirm', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, refund_fen: refundFen, tip_refund_fen: tipRefundFen, credit_delta: delta, initiator: initiatorRole, pay_no: refundNo }, result: 'ok', client_ip: clientIp, device: String(event.device || '').slice(0, 200) });
  log.d(`cancel_confirm: ${order.order_no} ${fromStatus}→S7 refund=${totalRefund} delta=${delta}`);
  return { ok: true, data: { order_id, status: 'S7', refund_fen: refundFen, tip_refund_fen: tipRefundFen, total_refund_fen: totalRefund, credit_delta: delta } };
}

// ── 对方拒绝取消 → S10.5 平台裁决(D6: 拒绝不私了) ─────────────────────
async function cancel_reject(ctx) {
  const { event, order_id, openid, getOrder, roleOf, db, _, log, col, wxCtx, writeNotice, writeAudit, casStatus, logStatus } = ctx;
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  const cr = order.cancel_request || {};
  if (cr.status !== 'pending') return { ok: false, code: 'oa_cancel_no_pending', msg: '无进行中的取消申请' };
  if (cr.by_openid === openid) return { ok: false, code: 'oa_cancel_self_reject', msg: '无需拒绝自己发起的申请,可直接撤回' };
  if (CANCEL_REQUEST_STATUS.indexOf(order.status) < 0) {
    return { ok: false, code: 'oa_cancel_status', msg: `当前状态(${order.status})不可处理取消申请` };
  }
  const cfg = cancelCfgOf(await getGlobalConfig(db));
  const now = Date.now();
  const fromStatus = order.status;
  // 2026-11-24 波2: 拒绝理由(选填 ≤50 字) 落 cancel_request.reject_reason, 供对端与时间线展示
  const rejectReason = String((event && event.reason) || '').slice(0, 50);
  // 拒绝 → S10.5(no.33) + 记 pre_dispute_status(裁决不支持时回退) + 被拒冷却(D14); frozen 保持(争议中)
  const won = await casStatus(order_id, CANCEL_REQUEST_STATUS, {
    status: 'S10.5',
    pre_dispute_status: fromStatus,
    'cancel_request.status': 'rejected',
    'cancel_request.rejected_at': now,
    'cancel_request.reject_reason': rejectReason,
    cancel_cooldown_until: now + cfg.rejectedCooldownMin * 60 * 1000,
    dispute_state: 'open', dispute_type: 'cancel',
    frozen: true, updated_at: now
  }, 'cancel_reject');
  if (!won) return { ok: false, code: 'oa_status_conflict', msg: '取消申请已处理或订单状态已变化,请刷新' };
  await logStatus(order_id, fromStatus, 'S10.5', role === 'user' ? 'user_cancel_reject' : 'partner_cancel_reject', openid);
  await Promise.allSettled([
    writeNotice({ to_openid: cr.by_openid, order_id, type: 'cancel_rejected', title: '取消申请被拒绝', body: `对方拒绝取消,订单转入平台处理;${Math.round(cfg.rejectedCooldownMin / 60)} 小时内不可再次申请`, action_key: 'jump_order', action_payload: { order_id } }),
    writeNotice({ to_openid: openid, order_id, type: 'cancel_rejected_peer', title: '已拒绝取消申请', body: '订单转入平台处理,请等待平台裁决', action_key: 'jump_order', action_payload: { order_id } })
  ]);
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  await writeAudit(db, log, { openid, role, category: 'business', action: 'cancel_reject', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, cooldown_min: cfg.rejectedCooldownMin }, result: 'ok', client_ip: clientIp, device: String(event.device || '').slice(0, 200) });
  log.d(`cancel_reject: ${order.order_no} ${fromStatus}→S10.5 by=${role}`);
  return { ok: true, data: { order_id, status: 'S10.5' } };
}

// ── 发起方撤回(不扣分, 冷却 withdraw_min, B6/D13) ──────────────────────
async function cancel_withdraw(ctx) {
  const { event, order_id, openid, getOrder, roleOf, db, _, log, col, wxCtx, writeNotice, writeAudit } = ctx;
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  const cr = order.cancel_request || {};
  if (cr.status !== 'pending') return { ok: false, code: 'oa_cancel_no_pending', msg: '无进行中的取消申请' };
  if (cr.by_openid !== openid) return { ok: false, code: 'oa_cancel_not_initiator', msg: '仅发起方可撤回取消申请' };
  const now = Date.now();
  if (cr.deadline && now > cr.deadline) {
    return { ok: false, code: 'oa_cancel_expired', msg: '申请已超时,等待平台处理' };
  }
  const cfg = cancelCfgOf(await getGlobalConfig(db));
  // 撤回原因(选填 ≤50 字)落独立字段 withdraw_reason, 不复用 reason(发起原因) / reject_reason(拒绝原因), 避免覆盖(经验 100034919)
  const withdrawReason = String((event && event.reason) || '').trim().slice(0, REASON_MAX);
  // CAS 撤回: 主轴不变(no.35 to=null), 清 frozen, 写冷却; 条件含发起方防对方并发操作竞态
  const won = await col('order_main').where({
    _id: order_id, status: _.in(CANCEL_REQUEST_STATUS),
    'cancel_request.status': 'pending', 'cancel_request.by_openid': openid
  }).update({ data: {
    'cancel_request.status': 'withdrawn',
    'cancel_request.withdrawn_at': now,
    'cancel_request.withdraw_reason': withdrawReason,
    cancel_cooldown_until: now + cfg.withdrawCooldownMin * 60 * 1000,
    frozen: false, updated_at: now
  }});
  if (!won.stats || won.stats.updated !== 1) {
    return { ok: false, code: 'oa_status_conflict', msg: '申请已处理或订单状态已变化,请刷新' };
  }
  const peer = role === 'user' ? order.partner_openid : order.user_openid;
  await Promise.allSettled([
    writeNotice({ to_openid: peer, order_id, type: 'cancel_withdrawn', title: '对方撤回了取消申请', body: '订单继续正常流程', action_key: 'jump_order', action_payload: { order_id } }),
    writeNotice({ to_openid: openid, order_id, type: 'cancel_withdrawn_self', title: '取消申请已撤回', body: `订单继续正常流程;${cfg.withdrawCooldownMin} 分钟内不可再次申请`, action_key: 'jump_order', action_payload: { order_id } })
  ]);
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  await writeAudit(db, log, { openid, role, category: 'business', action: 'cancel_withdraw', target_type: 'order', target_id: order_id, detail: { from_status: order.status, cooldown_min: cfg.withdrawCooldownMin }, result: 'ok', client_ip: clientIp, device: String(event.device || '').slice(0, 200) });
  log.d(`cancel_withdraw: ${order.order_no} by=${role}`);
  return { ok: true, data: { order_id, status: order.status, withdrawn: true } };
}

module.exports = { cancel_request, cancel_confirm, cancel_reject, cancel_withdraw, cancelCfgOf };
