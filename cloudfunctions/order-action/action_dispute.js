// order-action · 争议/爽约申诉分组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function complaint(ctx) {
  const { event, order_id, openid, getOrder, roleOf, checkText, wxCtx, db, log, casStatus, logStatus, col, writeNotice, writeAudit } = ctx;
  const { reason } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (!['S5', 'S8', 'S9'].includes(order.status)) {
    return { ok: false, code: 'oa_complaint_status', msg: `订单当前状态(${order.status})不可发起争议` };
  }
  const now = Date.now();
  const fromStatus = order.status;
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  if (reason) {
    const chk = await checkText(openid, reason);
    if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
  }
  const won = await casStatus(order_id, ['S5', 'S8', 'S9'], {
    status: 'S10.5',
    help_flag: true,
    complaint_at: now,
    complaint_by: openid,
    complaint_reason: reason || '',
    complaint_from_status: fromStatus,
    complaint_withdrawn_at: 0,
    complaint_withdrawn_by: '',
    updated_at: now,
    dispute_state: 'open',
    dispute_type: 'complaint',
    frozen: true
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S10.5') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complaint_open', target_type: 'order', target_id: order_id, detail: { status: 'S10.5', idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S10.5', idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, fromStatus, 'S10.5', role === 'user' ? 'user_complaint' : 'partner_complaint', openid);

  try {
    await col('complaint').add({ data: {
      order_id, order_no: order.order_no,
      initiator_openid: openid, initiator_role: role,
      target_openid: role === 'user' ? order.partner_openid : order.user_openid,
      reason: reason || '',
      status: 'pending',
      created_at: now, updated_at: now, is_deleted: false
    }});
  } catch (e) {
    log.d(`complaint record fail: ${e.message}`);
  }

  log.d(`complaint filed: ${order.order_no} ${fromStatus}→S10.5 by=${role}`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'complaint',
    title: '对方发起投诉',
    body: `${role === 'user' ? '发单人' : '耍伴'}已发起投诉/争议,平台将介入处理`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complaint_open', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, status: 'S10.5', reason_type: String(reason || '').slice(0, 20) }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S10.5' } };
}

async function complaint_withdraw(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, col, _, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S10.5') {
    if (order.complaint_withdrawn_by === openid) return { ok: true, data: { status: order.status || '', idempotent: true } };
    return { ok: false, code: 'oa_complaint_not_open', msg: '当前订单不在争议处理中, 不可撤回' };
  }
  if (order.complaint_by !== openid) return { ok: false, code: 'oa_not_complaint_owner', msg: '仅投诉发起人可撤回' };
  let restore = order.complaint_from_status || '';
  if (!restore) {
    try {
      const lg = await col('order_status_log').where({ order_id, to_status: 'S10.5' })
        .orderBy('created_at', 'desc').limit(1).get();
      restore = (lg.data && lg.data[0] && lg.data[0].from_status) || '';
    } catch (e) { restore = ''; }
  }
  if (!['S5', 'S8', 'S9'].includes(restore)) {
    return { ok: false, code: 'oa_complaint_no_restore', msg: '该投诉不支持自助撤回, 请联系客服' };
  }
  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S10.5', {
    status: restore, complaint_withdrawn_at: now, complaint_withdrawn_by: openid, updated_at: now,
    dispute_state: 'resolved', dispute_type: '', frozen: false
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.complaint_withdrawn_by === openid) return { ok: true, data: { status: latest.status || '', idempotent: true } };
    return { ok: false, code: 'oa_complaint_handled', msg: '平台已受理该投诉, 不可撤回' };
  }
  await logStatus(order_id, 'S10.5', restore, 'complaint_withdraw', openid);
  try {
    const c = await col('complaint').where({ order_id, initiator_openid: openid, is_deleted: _.neq(true) })
      .orderBy('created_at', 'desc').limit(1).get();
    if (c.data && c.data[0]) {
      await col('complaint').doc(c.data[0]._id).update({ data: { status: 'withdrawn', withdrawn_at: now, updated_at: now } });
    }
  } catch (e) { log.d(`complaint withdraw mark fail: ${e.message}`); }
  log.d(`complaint withdrawn: ${order.order_no} S10.5→${restore} by=${role}`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'complaint',
    title: '对方已撤回投诉',
    body: '该投诉已撤回, 平台不再介入',
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complaint_withdraw', target_type: 'order', target_id: order_id, detail: { from_status: 'S10.5', to_status: restore }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { status: restore } };
}

async function no_show_report_submit(ctx) {
  const { event, order_id, openid, getOrder, getConfig, noShowCfg, roleOf, canSubmitReport, checkText, col, _, wxCtx, db, log, REPORT_STATUS, defenseDeadlineOf, writeNotice, writeAudit } = ctx;
  const { reason, reason_type, evidence_file_ids } = event;
  const order = await getOrder(order_id);
  const config = await getConfig();
  const cfg = noShowCfg(config);
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  const gate = canSubmitReport(order, Date.now(), cfg);
  if (!gate.ok) return { ok: false, code: gate.code, msg: gate.msg };
  const reasonText = String(reason || '').trim();
  if (!reasonText) return { ok: false, code: 'no_show_no_reason', msg: '请填写申诉说明' };
  if (reasonText.length < cfg.reasonMinLen) {
    return { ok: false, code: 'no_show_reason_short', msg: `申诉说明至少 ${cfg.reasonMinLen} 字` };
  }
  const chk = await checkText(openid, reasonText, config.block_words);
  if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
  const files = Array.isArray(evidence_file_ids)
    ? evidence_file_ids.filter((f) => typeof f === 'string' && f).slice(0, cfg.evidenceMax)
    : [];
  const mine = await col('no_show_report').where({
    order_id, reporter_openid: openid, is_deleted: _.neq(true)
  }).count().catch(() => ({ total: 0 }));
  if ((mine.total || 0) >= cfg.maxPerOrder) {
    return { ok: false, code: 'no_show_report_limit', msg: `同一订单最多提交 ${cfg.maxPerOrder} 条申诉` };
  }
  const target = role === 'user' ? order.partner_openid : order.user_openid;
  if (!target) return { ok: false, code: 'no_show_no_target', msg: '订单缺少对方账号信息' };
  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const doc = {
    order_id, order_no: order.order_no || '',
    reporter_openid: openid, reporter_role: role,
    target_openid: target, target_role: role === 'user' ? 'partner' : 'user',
    reason_type: String(reason_type || '').trim().slice(0, 20),
    reason: reasonText, evidence_file_ids: files,
    status: REPORT_STATUS.RECEIVED,
    evidence_deadline: defenseDeadlineOf(now, cfg),
    created_at: now, updated_at: now, is_deleted: false
  };
  let reportId = '';
  try {
    const addRes = await col('no_show_report').add({ data: doc });
    reportId = (addRes && addRes._id) || '';
  } catch (e) {
    log.d(`no_show_report add fail: ${e.message}`);
    return { ok: false, code: 'no_show_submit_fail', msg: '提交失败,请稍后重试' };
  }
  try {
    await col('order_main').where({ _id: order_id }).update({ data: { frozen: true, updated_at: now } });
  } catch (e) { log.d(`no_show freeze fail: ${e.message}`); }
  await writeNotice({
    to_openid: target, order_id, type: 'no_show_report',
    title: '对方提交了爽约申诉',
    body: `请在 ${cfg.defenseWindowH} 小时内提交举证`,
    action_key: 'jump_order', action_payload: { order_id, report_id: reportId }
  });
  await writeAudit(db, log, {
    openid, role, category: 'business', action: 'no_show_report_submit',
    target_type: 'no_show_report', target_id: reportId,
    detail: { order_no: order.order_no || '', target_role: doc.target_role, files: files.length },
    result: 'ok', client_ip: clientIp, device
  });
  return { ok: true, data: { report_id: reportId, status: REPORT_STATUS.RECEIVED, evidence_deadline: doc.evidence_deadline } };
}

async function no_show_report_defense(ctx) {
  const { event, openid, isValidDocId, col, _, REPORT_STATUS, getConfig, noShowCfg, checkText, wxCtx, db, log, writeNotice, writeAudit } = ctx;
  const { report_id, defense_reason, defense_file_ids } = event;
  if (!report_id || !isValidDocId(report_id)) return { ok: false, code: 'no_show_bad_report', msg: '申诉记录 ID 格式不正确' };
  let report = null;
  try { report = (await col('no_show_report').doc(report_id).get()).data; } catch (e) { report = null; }
  if (!report || report.is_deleted) return { ok: false, code: 'no_show_report_missing', msg: '申诉记录不存在' };
  if (report.target_openid !== openid) return { ok: false, code: 'no_show_not_target', msg: '仅被诉方可提交举证' };
  if (report.status === REPORT_STATUS.DECIDED) {
    return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可再补充举证' };
  }
  const config = await getConfig();
  const cfg = noShowCfg(config);
  const text = String(defense_reason || '').trim();
  if (!text) return { ok: false, code: 'no_show_no_defense', msg: '请填写举证说明' };
  const chk = await checkText(openid, text, config.block_words);
  if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
  const files = Array.isArray(defense_file_ids)
    ? defense_file_ids.filter((f) => typeof f === 'string' && f).slice(0, cfg.evidenceMax)
    : [];
  const now = Date.now();
  const overdue = now > (Number(report.evidence_deadline) || 0);
  const up = await col('no_show_report').where({
    _id: report_id, status: _.in([REPORT_STATUS.RECEIVED, REPORT_STATUS.DEFENSE])
  }).update({ data: {
    defense_reason: text, defense_file_ids: files,
    status: REPORT_STATUS.DEFENSE, defense_at: now, defense_overdue: overdue, updated_at: now
  }});
  if (!up.stats || up.stats.updated < 1) {
    const latest = await col('no_show_report').doc(report_id).get().catch(() => ({ data: null }));
    if (latest && latest.data && latest.data.status === REPORT_STATUS.DECIDED) {
      return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可再补充举证' };
    }
    return { ok: false, code: 'no_show_defense_conflict', msg: '状态已变化,请刷新后重试' };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  await writeNotice({
    to_openid: report.reporter_openid, order_id: report.order_id, type: 'no_show_defense',
    title: '对方已提交举证', body: '等待平台裁定',
    action_key: 'jump_order', action_payload: { order_id: report.order_id, report_id }
  });
  await writeAudit(db, log, {
    openid, role: 'partner', category: 'business', action: 'no_show_report_defense',
    target_type: 'no_show_report', target_id: report_id,
    detail: { order_no: report.order_no || '', overdue, files: files.length },
    result: 'ok', client_ip: clientIp, device
  });
  return { ok: true, data: { status: REPORT_STATUS.DEFENSE, overdue } };
}

async function no_show_report_withdraw(ctx) {
  const { event, openid, isValidDocId, col, _, REPORT_STATUS, canWithdrawReport, wxCtx, db, log, writeNotice, writeAudit } = ctx;
  const { report_id } = event;
  if (!report_id || !isValidDocId(report_id)) return { ok: false, code: 'no_show_bad_report', msg: '申诉记录 ID 格式不正确' };
  let report = null;
  try { report = (await col('no_show_report').doc(report_id).get()).data; } catch (e) { report = null; }
  if (!report || report.is_deleted) return { ok: false, code: 'no_show_report_missing', msg: '申诉记录不存在' };
  if (report.reporter_openid !== openid) return { ok: false, code: 'no_show_not_reporter', msg: '仅申诉人可撤回申诉' };
  if (report.status === REPORT_STATUS.WITHDRAWN) {
    return { ok: true, data: { status: REPORT_STATUS.WITHDRAWN, withdrawn_at: report.withdrawn_at || 0, idempotent: true } };
  }
  if (report.status === REPORT_STATUS.DECIDED) {
    return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可撤回申诉' };
  }
  if (!canWithdrawReport(report.status, true)) {
    return { ok: false, code: 'no_show_withdraw_not_allowed', msg: '当前状态不可撤回申诉' };
  }
  const now = Date.now();
  const up = await col('no_show_report').where({
    _id: report_id, status: _.in([REPORT_STATUS.RECEIVED, REPORT_STATUS.DEFENSE])
  }).update({ data: {
    status: REPORT_STATUS.WITHDRAWN, withdrawn_at: now, withdrawn_by: openid, updated_at: now
  }});
  if (!up.stats || up.stats.updated < 1) {
    const latest = await col('no_show_report').doc(report_id).get().catch(() => ({ data: null }));
    const st = latest && latest.data && latest.data.status;
    if (st === REPORT_STATUS.WITHDRAWN) {
      return { ok: true, data: { status: REPORT_STATUS.WITHDRAWN, withdrawn_at: (latest.data.withdrawn_at || 0), idempotent: true } };
    }
    if (st === REPORT_STATUS.DECIDED) {
      return { ok: false, code: 'no_show_already_decided', msg: '平台已裁定,不可撤回申诉' };
    }
    return { ok: false, code: 'no_show_withdraw_conflict', msg: '状态已变化,请刷新后重试' };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  try {
    await col('order_main').where({ _id: report.order_id }).update({ data: { frozen: false, updated_at: now } });
  } catch (e) { log.d(`no_show unfreeze fail: ${e.message}`); }
  await writeNotice({
    to_openid: report.target_openid, order_id: report.order_id, type: 'no_show_report',
    title: '对方已撤回爽约申诉',
    body: '该申诉已撤回, 无需再提交举证',
    action_key: 'jump_order', action_payload: { order_id: report.order_id, report_id }
  });
  await writeAudit(db, log, {
    openid, role: report.reporter_role || '', category: 'business', action: 'no_show_report_withdraw',
    target_type: 'no_show_report', target_id: report_id,
    detail: { order_no: report.order_no || '', prev_status: report.status || '' },
    result: 'ok', client_ip: clientIp, device
  });
  return { ok: true, data: { status: REPORT_STATUS.WITHDRAWN, withdrawn_at: now } };
}

async function no_show_report_detail(ctx) {
  const { order_id, openid, getOrder, roleOf, col, _, REPORT_STATUS, canWithdrawReport } = ctx;
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  const r = await col('no_show_report')
    .where({ order_id, is_deleted: _.neq(true) })
    .orderBy('created_at', 'desc').limit(10).get().catch(() => ({ data: [] }));
  const list = (r.data || []).map((x) => {
    const iAmReporter = x.reporter_openid === openid;
    return {
      report_id: x._id,
      my_role: iAmReporter ? 'reporter' : 'target',
      reporter_role: x.reporter_role || '',
      status: x.status || '',
      verdict: x.verdict || '',
      reason_type: x.reason_type || '',
      reason: x.reason || '',
      evidence_file_ids: x.evidence_file_ids || [],
      defense_reason: x.defense_reason || '',
      defense_file_ids: x.defense_file_ids || [],
      evidence_deadline: x.evidence_deadline || 0,
      defense_overdue: x.defense_overdue === true,
      decided_at: x.decided_at || 0,
      withdrawn_at: x.withdrawn_at || 0,
      created_at: x.created_at || 0,
      can_defense: !iAmReporter && x.status !== REPORT_STATUS.DECIDED && x.status !== REPORT_STATUS.WITHDRAWN,
      can_withdraw: canWithdrawReport(x.status, iAmReporter)
    };
  });
  return { ok: true, data: { list } };
}

module.exports = {
  complaint, complaint_withdraw,
  no_show_report_submit, no_show_report_defense, no_show_report_withdraw, no_show_report_detail
};
