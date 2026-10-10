// order-action · 生命周期分组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function cancel(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, getOrder: _g, logStatus, col, writeNotice, writeAudit } = ctx;
  const { reason } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  if (order.status !== 'S1' && order.status !== 'S0') {
    return { ok: false, code: 'oa_cancel_status', msg: `订单当前状态(${order.status})不可取消` };
  }
  if (order.status === 'S0' && role !== 'user') {
    return { ok: false, code: 'oa_cancel_perm', msg: '待支付订单仅下单用户可取消' };
  }

  const now = Date.now();
  const fromStatus = order.status;
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, ['S1', 'S0'], {
    status: 'S6', cancel_at: now, updated_at: now
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S6') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_cancel', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, idempotent: true, demand_released: false }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S6', demand_released: false, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }

  await logStatus(order_id, fromStatus, 'S6', role === 'user' ? 'user_cancel' : 'partner_cancel', openid);

  let demandReleased = false;
  if (fromStatus === 'S1' && order.demand_id) {
    try {
      const dr = await col('demand').where({ _id: order.demand_id, status: 'matched' }).update({
        data: { status: 'matching', updated_at: now }
      });
      demandReleased = !!(dr.stats && dr.stats.updated === 1);
      log.d(`demand released: ${order.demand_id} → matching (released=${demandReleased})`);
    } catch (e) {}
  }

  log.d(`order cancelled: ${order.order_no} ${fromStatus}→S6 by=${role}`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'cancel',
    title: '订单已取消',
    body: `${role === 'user' ? '发单人' : '耍伴'}取消了订单, 请查看详情`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_cancel', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, status: 'S6', demand_released: demandReleased, cancel_reason_type: String(reason || '').slice(0, 30) }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S6', demand_released: demandReleased } };
}

async function start_service(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_start_perm', msg: '仅耍伴可开始履约' };
  if (order.status !== 'S2') return { ok: false, code: 'oa_start_status', msg: `订单当前状态(${order.status})不可开始履约` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可开始履约' };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S2', {
    status: 'S3', service_started_at: now, updated_at: now,
    milestone: { current: 0, confirmed: [false, false, false], evidence: [], submitted_at: null }
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S3') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_service', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S3', service_started_at: latest.service_started_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S2', 'S3', 'start_service', openid);
  log.d(`service started: ${order.order_no} S2→S3`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'start',
    title: '耍伴已开始履约', body: `${order.partner_nickname || '耍伴'} 已到达服务地点, 履约开始`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_service', target_type: 'order', target_id: order_id, detail: { status: 'S3' }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3', service_started_at: now } };
}

async function complete_service(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_complete_perm', msg: '仅耍伴可完成履约' };
  if (order.status !== 'S3') return { ok: false, code: 'oa_complete_status', msg: `订单当前状态(${order.status})不可完成履约` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可完成履约' };

  const ms = order.milestone || { current: 0 };
  if (ms.current < 3) {
    return { ok: false, code: 'oa_milestone_required', msg: `请先提交履约进度到100%(当前${ms.current}/3)再完成履约` };
  }

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S3', {
    status: 'S5', service_completed_at: now, updated_at: now
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S5') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complete_service', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S5', service_completed_at: latest.service_completed_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3', 'S5', 'complete_service', openid);
  log.d(`service completed: ${order.order_no} S3→S5`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'finish',
    title: '履约已完成', body: '耍伴已完成全部履约, 请对服务进行评价',
    action_key: 'jump_evaluate', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complete_service', target_type: 'order', target_id: order_id, detail: { status: 'S5', total_fen: Number(order.total_fen) || 0 }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S5', service_completed_at: now } };
}

async function milestone_submit(ctx) {
  const { event, order_id, openid, getOrder, roleOf, checkText, col, wxCtx, db, log, writeNotice, writeAudit } = ctx;
  const MS_LABEL = { 1: '30%', 2: '60%', 3: '100%' };
  const { note, location } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_ms_perm', msg: '仅耍伴可提交履约进度' };
  if (order.status !== 'S3') return { ok: false, code: 'oa_ms_status', msg: `订单当前状态(${order.status})不可提交进度` };

  const ms = order.milestone || { current: 0, confirmed: [false, false, false], evidence: [] };
  if (ms.current >= 3) return { ok: false, code: 'oa_ms_done', msg: '履约进度已提交到100%,无需重复提交' };

  const next = ms.current + 1;
  if (note) {
    const chk = await checkText(openid, note);
    if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
  }
  const evidence = Array.isArray(ms.evidence) ? ms.evidence : [];
  evidence.push({
    milestone: next,
    label: MS_LABEL[next],
    note: note || '',
    location: location || null,
    submitted_by: openid,
    submitted_at: Date.now()
  });

  const casRes = await col('order_main').where({
    _id: order_id, status: 'S3', 'milestone.current': ms.current
  }).update({
    data: {
      'milestone.current': next,
      'milestone.evidence': evidence,
      'milestone.submitted_at': Date.now(),
      updated_at: Date.now()
    }
  });
  if (!casRes.stats || casRes.stats.updated !== 1) {
    return { ok: false, code: 'oa_ms_conflict', msg: '进度状态已变化,请刷新后重试' };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  log.d(`milestone ${next}/3 submitted: ${order.order_no}`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'milestone',
    title: `履约进度 ${MS_LABEL[next]}`, body: `耍伴提交了履约进度 ${MS_LABEL[next]}, 可在订单详情查看`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_milestone_submit', target_type: 'order', target_id: order_id, detail: { milestone: next, label: MS_LABEL[next] }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, milestone: next, label: MS_LABEL[next] } };
}

async function milestone_confirm(ctx) {
  const { event, order_id, openid, getOrder, roleOf, col, _, wxCtx, db, log, writeAudit } = ctx;
  const { milestone } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (![1, 2, 3].includes(milestone)) return { ok: false, code: 'oa_ms_invalid', msg: 'milestone 须为 1/2/3' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'user') return { ok: false, code: 'oa_ms_confirm_perm', msg: '仅需求者可确认履约进度' };

  const ms = order.milestone || { current: 0, confirmed: [false, false, false] };
  if (ms.current < milestone) return { ok: false, code: 'oa_ms_not_submitted', msg: '该进度尚未提交' };

  const idx = milestone - 1;
  const casCond = { _id: order_id };
  casCond[`milestone.confirmed.${idx}`] = _.neq(true);
  const casData = { updated_at: Date.now() };
  casData[`milestone.confirmed.${idx}`] = true;
  const casRes = await col('order_main').where(casCond).update({ data: casData });
  if (!casRes.stats || casRes.stats.updated !== 1) {
    return { ok: false, code: 'oa_ms_already_confirmed', msg: '该进度已确认,无需重复操作' };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  log.d(`milestone ${milestone} confirmed by user: ${order.order_no}`);
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_milestone_confirm', target_type: 'order', target_id: order_id, detail: { milestone, confirmed: true }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, milestone, confirmed: true } };
}

async function resume_service(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S3.5') {
    return { ok: false, code: 'oa_resume_status', msg: `订单当前状态(${order.status})不可恢复履约` };
  }
  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S3.5', {
    status: 'S3', resumed_at: now, resumed_by: openid, updated_at: now
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S3') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_resume_service', target_type: 'order', target_id: order_id, detail: { status: 'S3', idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S3', idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3.5', 'S3', role === 'user' ? 'user_resume' : 'partner_resume', openid);
  log.d(`order resume: ${order.order_no} S3.5→S3`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'resume',
    title: '履约已恢复', body: `${role === 'user' ? '发单人' : '耍伴'}恢复了履约, 可继续服务`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_resume_service', target_type: 'order', target_id: order_id, detail: { status: 'S3' }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3' } };
}

module.exports = { cancel, start_service, complete_service, milestone_submit, milestone_confirm, resume_service };
