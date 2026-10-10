// order-action · 四确认分组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function get_confirmation(ctx) {
  const { order_id, openid, getOrder, roleOf, getConfirmation, CONFIRM_FIELDS, allConfirmed } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  const conf = await getConfirmation(order_id);
  if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

  let confirmedCount = 0;
  const fields = {};
  for (const f of CONFIRM_FIELDS) {
    const it = conf.items[f] || {};
    if (it.user_ok) confirmedCount++;
    if (it.partner_ok) confirmedCount++;
    fields[f] = { value: it.value, user_ok: !!it.user_ok, partner_ok: !!it.partner_ok };
  }

  const pm = order.pending_modify;
  const pe = order.pending_extend;
  return {
    ok: true,
    data: {
      order_id,
      order_no: order.order_no,
      status: order.status,
      role,
      scene: order.scene || '',
      total_fen: order.total_fen || 0,
      start_time: order.start_time || 0,
      items: fields,
      confirmed_count: confirmedCount,
      total_count: 8,
      all_confirmed: allConfirmed(conf.items),
      version: conf.version || 1,
      pending_modify: pm ? {
        by_openid: pm.by_openid,
        by_role: pm.by_role,
        new_start_time: pm.new_start_time,
        reason: (pm.reason || '').slice(0, 60),
        can_respond: pm.by_openid !== openid
      } : null,
      pending_extend: pe ? {
        by_openid: pe.by_openid,
        by_role: pe.by_role,
        add_hours: pe.add_hours,
        add_amount_fen: pe.add_amount_fen,
        reason: (pe.reason || '').slice(0, 60),
        can_respond: pe.by_openid !== openid
      } : null
    }
  };
}

async function update_item(ctx) {
  const { event, order_id, openid, CONFIRM_FIELDS, getOrder, roleOf, getConfig, splitOrderAmount, col, _, getConfirmation, log, casStatus, writeNotice, FIELD_CN } = ctx;
  const { item, value } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (CONFIRM_FIELDS.indexOf(item) < 0) {
    return { ok: false, code: 'oa_bad_item', msg: '确认项只能是 时间/地点/内容/费用' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
  if (order.status !== 'S1') {
    return { ok: false, code: 'oa_not_editable', msg: '订单当前状态不可修改确认项' };
  }

  const config = await getConfig();
  const now = Date.now();

  let updateOrder = null;
  if (item === 'time') {
    const ts = Number(value);
    if (!ts || ts <= now) return { ok: false, code: 'oa_time_future', msg: '服务时间必须是未来时间' };
  } else if (item === 'location') {
    if (!value || !value.name || !value.latitude || !value.longitude) {
      return { ok: false, code: 'oa_location_invalid', msg: '地点信息不完整' };
    }
  } else if (item === 'content') {
    if (!Array.isArray(value)) return { ok: false, code: 'oa_content_invalid', msg: '服务内容格式有误' };
  } else if (item === 'fee') {
    const fee = Number(value);
    if (!Number.isInteger(fee)) {
      return { ok: false, code: 'oa_fee_invalid', msg: '费用必须是整数(分)' };
    }
    const rateMin = config.rate_min_fen || 3000;
    const rateMax = config.rate_max_fen || 10000;
    const clampedFee = Math.max(rateMin, Math.min(rateMax, fee));
    if (clampedFee !== fee) {
      return { ok: false, code: 'oa_fee_out_of_range',
        msg: `费用超出耍伴时薪区间(${Math.round(rateMin/100)}元-${Math.round(rateMax/100)}元/小时),已自动调整为 ${Math.round(clampedFee/100)}元/小时`,
        original_fen: fee, adjusted_fen: clampedFee };
    }
    const { feeFen } = splitOrderAmount(clampedFee, config.platform_fee_rate_fen);

    const youthLimit = config.youth_limit_fen || 20000;
    const [u, p] = await Promise.all([
      col('user_account').where({ openid: order.user_openid }).limit(1).get(),
      col('user_account').where({ openid: order.partner_openid }).limit(1).get()
    ]);
    const isYouth = (doc) => doc && doc.age !== null && doc.age !== undefined && doc.age >= 18 && doc.age <= 22;
    const uYouth = u.data && u.data[0] && isYouth(u.data[0]);
    const pYouth = p.data && p.data[0] && isYouth(p.data[0]);
    if ((uYouth || pYouth) && clampedFee > youthLimit) {
      return { ok: false, code: 'oa_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
    }
    updateOrder = { total_fen: clampedFee, fee_fen: feeFen, partner_income_fen: clampedFee - feeFen };
  }

  const conf = await getConfirmation(order_id);
  if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

  const newItems = {};
  for (const f of CONFIRM_FIELDS) {
    newItems[f] = {
      value: f === item ? value : conf.items[f].value,
      user_ok: false,
      partner_ok: false
    };
  }

  const v = conf.version || 1;
  let occRes;
  try {
    occRes = await col('order_confirmations').where({ _id: conf._id, version: v }).update({ data: {
      items: newItems,
      version: v + 1,
      updated_at: now
    }});
  } catch (e) {
    log.d(`update_item occ fail: ${e.message}`);
    return { ok: false, code: 'oa_update_fail', msg: '修改失败,请稍后重试' };
  }
  if (!occRes.stats || occRes.stats.updated !== 1) {
    return { ok: false, code: 'oa_conflict', msg: '确认信息刚被对方更新,请刷新后重试' };
  }

  const orderPatch = { updated_at: now };
  if (item === 'fee') Object.assign(orderPatch, updateOrder);
  if (item === 'time') orderPatch.start_time = Number(value);
  if (item === 'location') orderPatch.location = value;
  if (item === 'content') orderPatch.content_options = value;
  const orderWon = await casStatus(order_id, 'S1', orderPatch);
  if (!orderWon) {
    return { ok: false, code: 'oa_conflict', msg: '订单状态已变化,请刷新后重试' };
  }

  log.d(`confirm item updated: order=${order.order_no} item=${item} by=${role}, all reset`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'modify',
    title: '订单沟通',
    body: `对方修改了「${FIELD_CN[item] || item}」,需重新确认`,
    action_key: 'jump_chat', action_payload: { order_id }
  });
  return {
    ok: true,
    data: { item, reset: true, version: v + 1, confirmed_count: 0, total_count: 8 }
  };
}

async function confirm_item(ctx) {
  const { event, order_id, openid, CONFIRM_FIELDS, getOrder, roleOf, getConfirmation, wxCtx, db, log, writeAudit, col, _, allConfirmed, getConfig, casStatus, logStatus, writeNotice, FIELD_CN } = ctx;
  const { item } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (CONFIRM_FIELDS.indexOf(item) < 0) {
    return { ok: false, code: 'oa_bad_item', msg: '确认项只能是 时间/地点/内容/费用' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
  if (order.status !== 'S1') {
    return { ok: false, code: 'oa_not_confirmable', msg: '订单当前状态不可确认' };
  }

  const conf = await getConfirmation(order_id);
  if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

  const okKey = role + '_ok';
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  if (conf.items[item][okKey]) {
    let cnt = 0;
    for (const f of CONFIRM_FIELDS) {
      if (conf.items[f].user_ok) cnt++;
      if (conf.items[f].partner_ok) cnt++;
    }
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_confirm_item', target_type: 'order', target_id: order_id, detail: { item, role, idempotent: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { item, idempotent: true, confirmed_count: cnt, total_count: 8, all_confirmed: allConfirmed(conf.items), status: order.status } };
  }

  const now = Date.now();
  try {
    await col('order_confirmations').doc(conf._id).update({ data: {
      ['items.' + item + '.' + okKey]: true,
      version: _.inc(1),
      updated_at: now
    }});
  } catch (e) {
    log.d(`confirm_item fail: ${e.message}`);
    return { ok: false, code: 'oa_confirm_fail', msg: '确认失败,请稍后重试' };
  }

  const fresh = await getConfirmation(order_id);
  const freshItems = (fresh && fresh.items) || conf.items;
  let cnt = 0;
  for (const f of CONFIRM_FIELDS) {
    if (freshItems[f].user_ok) cnt++;
    if (freshItems[f].partner_ok) cnt++;
  }
  const done = allConfirmed(freshItems);

  let newStatus = order.status;
  if (done) {
    const config = await getConfig();
    const payExpire = now + (config.s0_timeout_min || 30) * 60 * 1000;
    const won = await casStatus(order_id, 'S1', {
      status: 'S0', pay_expire_at: payExpire, updated_at: now
    });
    if (won) {
      await logStatus(order_id, 'S1', 'S0', 'four_confirm_done', openid);
      newStatus = 'S0';
      writeNotice({
        to_openid: order.user_openid, order_id, type: 'confirm_done',
        title: '四确认全部完成',
        body: '订单已进入待支付,请在30分钟内完成支付',
        action_key: 'jump_pay', action_payload: { order_id }
      });
      writeNotice({
        to_openid: order.partner_openid, order_id, type: 'confirm_done',
        title: '四确认全部完成',
        body: '订单已进入待支付,等待发单人付款',
        action_key: 'jump_order', action_payload: { order_id }
      });
      log.d(`four confirm done: order=${order.order_no} → S0, pay_expire=${payExpire}`);
    } else {
      const latest = await getOrder(order_id);
      newStatus = latest ? latest.status : 'S1';
      if (newStatus !== 'S0') {
        return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      }
    }
  }

  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_confirm_item', target_type: 'order', target_id: order_id, detail: { item, role, confirmed_count: cnt, status: newStatus }, result: 'ok', client_ip: clientIp, device });
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: `confirm:${item}`,
    title: '订单沟通',
    body: `对方已确认「${FIELD_CN[item] || item}」`,
    action_key: 'jump_chat', action_payload: { order_id }
  });
  return {
    ok: true,
    data: {
      item, role, confirmed_count: cnt, total_count: 8,
      all_confirmed: done, status: newStatus
    }
  };
}

async function confirm_all(ctx) {
  const { event, order_id, openid, CONFIRM_FIELDS, getOrder, roleOf, getConfirmation, wxCtx, db, log, writeAudit, col, _, allConfirmed, getConfig, casStatus, logStatus, writeNotice } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
  if (order.status !== 'S1') {
    return { ok: false, code: 'oa_not_confirmable', msg: '订单当前状态不可确认' };
  }
  const conf = await getConfirmation(order_id);
  if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

  const okKey = role + '_ok';
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  const now = Date.now();
  const bitPatch = { version: _.inc(1), updated_at: now };
  for (const f of CONFIRM_FIELDS) { bitPatch['items.' + f + '.' + okKey] = true; }
  try {
    await col('order_confirmations').doc(conf._id).update({ data: bitPatch });
  } catch (e) {
    log.d(`confirm_all fail: ${e.message}`);
    return { ok: false, code: 'oa_confirm_fail', msg: '确认失败' };
  }

  const fresh = await getConfirmation(order_id);
  const freshItems = (fresh && fresh.items) || conf.items;
  let cnt = 0;
  for (const f of CONFIRM_FIELDS) {
    if (freshItems[f].user_ok) cnt++;
    if (freshItems[f].partner_ok) cnt++;
  }
  const done = allConfirmed(freshItems);
  let newStatus = order.status;
  if (done) {
    const config = await getConfig();
    const payExpire = now + (config.s0_timeout_min || 30) * 60 * 1000;
    const won = await casStatus(order_id, 'S1', { status: 'S0', pay_expire_at: payExpire, updated_at: now });
    if (won) {
      await logStatus(order_id, 'S1', 'S0', 'four_confirm_done', openid);
      newStatus = 'S0';
      writeNotice({
        to_openid: order.user_openid, order_id, type: 'confirm_done',
        title: '四确认全部完成',
        body: '订单已进入待支付,请在30分钟内完成支付',
        action_key: 'jump_pay', action_payload: { order_id }
      });
      writeNotice({
        to_openid: order.partner_openid, order_id, type: 'confirm_done',
        title: '四确认全部完成',
        body: '订单已进入待支付,等待发单人付款',
        action_key: 'jump_order', action_payload: { order_id }
      });
    } else {
      const latest = await getOrder(order_id);
      newStatus = latest ? latest.status : 'S1';
      if (newStatus !== 'S0') {
        return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      }
    }
  }
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_confirm_all', target_type: 'order', target_id: order_id, detail: { role, confirmed_count: cnt, status: newStatus }, result: 'ok', client_ip: clientIp, device });
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'confirm_all',
    title: '订单沟通',
    body: '对方已一键确认全部四项',
    action_key: 'jump_chat', action_payload: { order_id }
  });
  return { ok: true, data: { role, confirmed_count: cnt, total_count: 8, all_confirmed: done, status: newStatus } };
}

module.exports = { get_confirmation, update_item, confirm_item, confirm_all };
