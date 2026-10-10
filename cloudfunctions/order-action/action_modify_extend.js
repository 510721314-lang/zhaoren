// order-action · 改期/加时/比例分组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

// 改期业务常量(与小程序 config/index.js MODIFY/TIME_REDLINE 对齐; admin_config.modify_config 可覆盖)
const MODIFY_DEFAULTS = { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 };
function redlineBounds(cfg) {
  const c = parseInt(cfg && cfg.time_redline_close_min, 10);
  const o = parseInt(cfg && cfg.time_redline_open_min, 10);
  const close = (c >= 0 && c <= 1440) ? c : 1440;
  const open = (o >= 0 && o < close) ? o : 360;
  return { open, close };
}
const CN_OFFSET_MS = 8 * 3600 * 1000;
function isModifyTimeAllowed(ts, cfg) {
  const { open, close } = redlineBounds(cfg);
  if (close === 0) return true;
  const d = new Date(ts + CN_OFFSET_MS);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= open && mins < close;
}

async function modify(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, getConfig, checkText, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit, reasonMaxLen } = ctx;
  const { new_start_time, reason } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const newTs = Number(new_start_time);
  if (!newTs || newTs <= Date.now()) {
    return { ok: false, code: 'oa_modify_time_invalid', msg: '新时间必须是未来时间' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S2') {
    return { ok: false, code: 'oa_modify_status', msg: `订单当前状态(${order.status})不可改期` };
  }
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可改期' };
  const config = await getConfig();
  const modifyConfig = Object.assign({}, MODIFY_DEFAULTS);
  try { Object.assign(modifyConfig, config.modify_config || {}); } catch (e) {}
  const currentModifyCount = Number(order.modify_count) || 0;
  if (currentModifyCount >= modifyConfig.maxTimes) {
    return { ok: false, code: 'oa_modify_exhausted', msg: `改期次数已用完(${modifyConfig.maxTimes}次)` };
  }
  if (newTs - Date.now() < modifyConfig.minLeadHours * 3600000) {
    return { ok: false, code: 'oa_modify_lead', msg: `须提前${modifyConfig.minLeadHours}小时申请改期` };
  }
  if (!isModifyTimeAllowed(newTs, config)) {
    return { ok: false, code: 'oa_modify_redline', msg: '服务时间须在运营时段内' };
  }
  const span = Math.abs(newTs - Number(order.start_time)) / 3600000;
  if (span > modifyConfig.maxSpanH) {
    return { ok: false, code: 'oa_modify_span', msg: `改期幅度超过上限(${modifyConfig.maxSpanH}小时)` };
  }

  const now = Date.now();
  const fromStatus = order.status;
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  if (reason) {
    const chk = await checkText(openid, reason);
    if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
  }
  const won = await casStatus(order_id, 'S2', {
    status: 'S2_5',
    pending_modify: {
      from_status: fromStatus,
      new_start_time: newTs,
      reason: String(reason || '').slice(0, reasonMaxLen(config)),
      by_openid: openid,
      by_role: role,
      created_at: now,
      expire_at: now + modifyConfig.confirmHours * 3600000
    },
    modify_at: now,
    updated_at: now
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S2_5' && latest.pending_modify && latest.pending_modify.by_openid === openid) {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_modify_apply', target_type: 'order', target_id: order_id, detail: { status: 'S2_5', idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S2_5', idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, fromStatus, 'S2_5', role === 'user' ? 'user_modify' : 'partner_modify', openid);
  log.d(`order modify: ${order.order_no} ${fromStatus}→S2_5 newStart=${newTs} expire=${modifyConfig.confirmHours}h`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'modify',
    title: `${role === 'user' ? '发单人' : '耍伴'}发起改期`, body: `请在 ${modifyConfig.confirmHours} 小时内确认或拒绝`,
    action_key: 'jump_accept_modify', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_modify_apply', target_type: 'order', target_id: order_id, detail: { status: 'S2_5', new_start_time: newTs }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S2_5', new_start_time: newTs } };
}

async function modify_confirm_or_reject(ctx) {
  const { action, event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, _, getConfig, getConfirmation, CONFIRM_FIELDS, col, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  if (order.status === 'S2' || order.status === 'S3') {
    if (!order.pending_modify) {
      await writeAudit(db, log, { openid, role, category: action === 'modify_confirm' ? 'consent' : 'business', action: action === 'modify_confirm' ? 'order_modify_confirm' : 'order_modify_reject', target_type: 'order', target_id: order_id, detail: { status: order.status, idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: order.status, idempotent: true } };
    }
  }
  if (order.status !== 'S2_5' || !order.pending_modify) {
    return { ok: false, code: 'oa_modify_status', msg: '订单当前没有待确认的改期申请' };
  }
  const pending = order.pending_modify;
  if (pending.by_openid === openid) {
    return { ok: false, code: 'oa_modify_self', msg: '只能由对方确认或拒绝改期' };
  }
  const toStatus = pending.from_status === 'S3' ? 'S3' : 'S2';
  const now = Date.now();

  if (action === 'modify_reject') {
    const won = await casStatus(order_id, 'S2_5', {
      status: toStatus,
      pending_modify: _.remove(),
      modify_rejected_at: now,
      modify_rejected_by: openid,
      updated_at: now
    });
    if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    await logStatus(order_id, 'S2_5', toStatus, role === 'user' ? 'user_modify_reject' : 'partner_modify_reject', openid);
    log.d(`modify rejected: ${order.order_no} S2_5→${toStatus} by=${role}`);
    await writeNotice({
      to_openid: pending.by_openid, order_id, type: 'modify_reject',
      title: '改期已被拒绝', body: `${role === 'user' ? '发单人' : '耍伴'}拒绝了你的改期申请`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_modify_reject', target_type: 'order', target_id: order_id, detail: { status: toStatus, modify_rejected: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: toStatus, modify_rejected: true } };
  }

  const config = await getConfig();
  const modifyConfig = Object.assign({}, MODIFY_DEFAULTS);
  try { Object.assign(modifyConfig, config.modify_config || {}); } catch (e) {}
  if (!pending.new_start_time || pending.new_start_time <= now) {
    return { ok: false, code: 'oa_modify_expired', msg: '改期时间已过期,请重新发起' };
  }
  if (!isModifyTimeAllowed(pending.new_start_time, config)) {
    return { ok: false, code: 'oa_modify_redline', msg: '服务时间不在运营时段内' };
  }
  const won = await casStatus(order_id, 'S2_5', {
    status: toStatus,
    start_time: pending.new_start_time,
    modify_count: (Number(order.modify_count) || 0) + 1,
    pending_modify: _.remove(),
    modify_confirmed_at: now,
    modify_confirmed_by: openid,
    updated_at: now
  });
  if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  try {
    const conf = await getConfirmation(order_id);
    if (conf && conf.items) {
      const resetPatch = { version: (Number(conf.version) || 1) + 1, updated_at: now };
      for (const f of CONFIRM_FIELDS) {
        resetPatch['items.' + f + '.user_ok'] = false;
        resetPatch['items.' + f + '.partner_ok'] = false;
      }
      await col('order_confirmations').doc(conf._id).update({ data: resetPatch });
      log.d(`modify confirmed: confirmations reset ok ${order.order_no}`);
    }
  } catch (e) { log.d(`modify_confirm reset confirmations fail: ${e.message}`); }
  await logStatus(order_id, 'S2_5', toStatus, role === 'user' ? 'user_modify_confirm' : 'partner_modify_confirm', openid);
  log.d(`modify confirmed: ${order.order_no} S2_5→${toStatus} newStart=${pending.new_start_time} by=${role}`);
  await writeNotice({
    to_openid: pending.by_openid, order_id, type: 'modify_confirm',
    title: '改期已确认', body: `新时间已生效, 订单状态回到${toStatus === 'S3' ? '履约中' : '待履约'}`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_modify_confirm', target_type: 'order', target_id: order_id, detail: { status: toStatus, start_time: pending.new_start_time }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: toStatus, start_time: pending.new_start_time, modify_confirmed: true } };
}

async function extend(ctx) {
  const { event, order_id, openid, getOrder, roleOf, getConfig, checkText, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit, reasonMaxLen } = ctx;
  const { add_hours, reason } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  const addHours = Number(add_hours);
  if (!Number.isInteger(addHours) || addHours <= 0 || addHours > 12) {
    return { ok: false, code: 'oa_extend_hours', msg: '加时时长须为 1-12 小时整数' };
  }
  if (order.status !== 'S3') {
    return { ok: false, code: 'oa_extend_status', msg: `订单当前状态(${order.status})不可申请加时` };
  }
  if (order.pending_extend) {
    return { ok: false, code: 'oa_extend_exist', msg: '已有待确认的加时申请,请等待对方处理' };
  }

  const isFixedExtend = order.pricing_type === 'fixed';
  const durationH = Number(order.duration_h) || 1;
  const totalFen = Number(order.total_fen) || 0;
  const addAmountFen = isFixedExtend ? 0 : Math.round(totalFen / durationH * addHours);
  if (addAmountFen <= 0 && !isFixedExtend) {
    return { ok: false, code: 'oa_extend_price', msg: '加时金额计算异常,请联系客服' };
  }

  const config = await getConfig();
  const now = Date.now();
  const confirmHours = (config.modify_config && config.modify_config.confirmHours) || 24;
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  if (reason) {
    const chk = await checkText(openid, reason);
    if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
  }

  const won = await casStatus(order_id, 'S3', {
    pending_extend: {
      add_hours: addHours,
      add_amount_fen: addAmountFen,
      reason: String(reason || '').slice(0, reasonMaxLen(config)),
      by_openid: openid,
      by_role: role,
      created_at: now,
      expire_at: now + confirmHours * 3600000
    },
    extend_count: (Number(order.extend_count) || 0) + 1,
    updated_at: now
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.pending_extend && latest.pending_extend.by_openid === openid) {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_extend_apply', target_type: 'order', target_id: order_id, detail: { idempotent: true, add_amount_fen: addAmountFen }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, add_amount_fen: addAmountFen, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3', 'S3', role === 'user' ? 'user_extend' : 'partner_extend', openid);
  log.d(`order extend: ${order.order_no} +${addHours}h addFen=${addAmountFen}`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'custom',
    title: `${role === 'user' ? '发单人' : '耍伴'}申请加时 ${addHours} 小时`,
    body: isFixedExtend
      ? `一口价订单不加价, 延长 ${addHours} 小时, 请在 ${confirmHours} 小时内确认或拒绝`
      : `加时金额 ¥${(addAmountFen / 100).toFixed(2)}, 请在 ${confirmHours} 小时内确认或拒绝`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_extend_apply', target_type: 'order', target_id: order_id, detail: { add_hours: addHours, add_amount_fen: addAmountFen }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, add_hours: addHours, add_amount_fen: addAmountFen } };
}

async function extend_confirm_or_reject(ctx) {
  const { action, event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, _, splitOrderAmount, getConfig, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  if (!order.pending_extend) {
    return { ok: false, code: 'oa_extend_no_pending', msg: '订单当前没有待确认的加时申请' };
  }
  const pending = order.pending_extend;
  if (pending.by_openid === openid) {
    return { ok: false, code: 'oa_extend_self', msg: '只能由对方确认或拒绝加时' };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  if (action === 'extend_reject') {
    const won = await casStatus(order_id, 'S3', {
      pending_extend: _.remove(),
      extend_rejected_at: Date.now(),
      extend_rejected_by: openid,
      updated_at: Date.now()
    });
    if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    await logStatus(order_id, 'S3', 'S3', role === 'user' ? 'user_extend_reject' : 'partner_extend_reject', openid);
    await writeNotice({
      to_openid: pending.by_openid, order_id, type: 'extend_reject',
      title: '加时申请已被拒绝',
      body: `${role === 'user' ? '发单人' : '耍伴'}拒绝了你的加时申请`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_extend_reject', target_type: 'order', target_id: order_id, detail: { extend_rejected: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, extend_rejected: true } };
  }

  const addFen = Number(pending.add_amount_fen) || 0;
  const addH = Number(pending.add_hours) || 0;
  const isFixedConfirm = order.pricing_type === 'fixed';
  const newTotalFen = (Number(order.total_fen) || 0) + addFen;
  const newDurationH = (Number(order.duration_h) || 0) + addH;
  const { feeFen: newFeeFen, partnerIncomeFen: newPartnerIncomeFen } = isFixedConfirm
    ? { feeFen: order.fee_fen, partnerIncomeFen: order.partner_income_fen }
    : splitOrderAmount(newTotalFen, (await getConfig()).platform_fee_rate_fen);

  const won = await casStatus(order_id, 'S3', {
    duration_h: newDurationH,
    total_fen: newTotalFen,
    fee_fen: newFeeFen,
    partner_income_fen: newPartnerIncomeFen,
    pending_extend: _.remove(),
    extend_confirmed_at: Date.now(),
    extend_confirmed_by: openid,
    updated_at: Date.now()
  });
  if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  await logStatus(order_id, 'S3', 'S3', role === 'user' ? 'user_extend_confirm' : 'partner_extend_confirm', openid);
  log.d(`order extend confirmed: ${order.order_no} +${addH}h addFen=${addFen} totalFen=${newTotalFen}`);
  await writeNotice({
    to_openid: pending.by_openid, order_id, type: 'extend_confirm',
    title: '加时申请已确认',
    body: isFixedConfirm
      ? `一口价不加价, 服务时长延长至 ${newDurationH} 小时`
      : `服务时长延长至 ${newDurationH} 小时, 加时金额 ¥${(addFen / 100).toFixed(2)} 已合并进结算`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_extend_confirm', target_type: 'order', target_id: order_id, detail: { duration_h: newDurationH, total_fen: newTotalFen, add_amount_fen: addFen }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, duration_h: newDurationH, total_fen: newTotalFen, add_amount_fen: addFen } };
}

async function partial_confirm(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S3.5') {
    return { ok: false, code: 'oa_partial_status', msg: `订单当前状态(${order.status})不可转部分完成` };
  }
  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S3.5', {
    status: 'S4', partial_confirmed_at: now, partial_confirmed_by: openid, updated_at: now
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S4') {
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_partial_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S4', idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S4', idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3.5', 'S4', role === 'user' ? 'user_partial_confirm' : 'partner_partial_confirm', openid);
  const other = role === 'user' ? order.partner_openid : order.user_openid;
  writeNotice({
    to_openid: other,
    order_id,
    type: 'partial_confirm',
    title: role === 'user' ? '耍伴已确认部分完成' : '发单人已确认部分完成',
    body: '请双方协商确认比例',
    action_key: 'jump_order',
    action_payload: { order_id }
  });
  log.d(`order partial confirm: ${order.order_no} S3.5→S4`);
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_partial_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S4' }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S4' } };
}

async function ratio_confirm(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  const { ratio } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S4') {
    return { ok: false, code: 'oa_ratio_status', msg: `订单当前状态(${order.status})不可确认比例` };
  }
  let ratioFen = 100;
  if (ratio !== undefined && ratio !== null && ratio !== '') {
    const r = Number(ratio);
    if (!Number.isInteger(r) || r < 0 || r > 100) {
      return { ok: false, code: 'oa_ratio_invalid', msg: '比例须为 0-100 的整数(百分比, 如 50 表示 50%)' };
    }
    ratioFen = r;
  }
  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S4', {
    status: 'S5',
    ratio_confirmed_at: now,
    ratio_confirmed_by: openid,
    ratio_fen: ratioFen,
    updated_at: now
  });
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S5') {
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_ratio_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S5', ratio_fen: latest.ratio_fen || ratioFen, idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S5', ratio_fen: latest.ratio_fen || ratioFen, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S4', 'S5', role === 'user' ? 'user_ratio_confirm' : 'partner_ratio_confirm', openid);
  const other2 = role === 'user' ? order.partner_openid : order.user_openid;
  writeNotice({
    to_openid: other2,
    order_id,
    type: 'ratio_confirm',
    title: role === 'user' ? '耍伴已确认结算比例' : '发单人已确认结算比例',
    body: `比例 ${ratioFen}% · 订单进入待评价`,
    action_key: 'jump_order',
    action_payload: { order_id }
  });
  log.d(`order ratio confirm: ${order.order_no} S4→S5 ratio=${ratioFen}%`);
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_ratio_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S5', ratio_fen: ratioFen }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S5', ratio_fen: ratioFen } };
}

module.exports = {
  modify,
  modify_confirm: modify_confirm_or_reject,
  modify_reject: modify_confirm_or_reject,
  extend,
  extend_confirm: extend_confirm_or_reject,
  extend_reject: extend_confirm_or_reject,
  partial_confirm,
  ratio_confirm
};
