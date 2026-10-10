// admin-action · IM 监管 + 客服工作台 + 提现审批（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function im_degraded_list(ctx) {
  const { event, pager, col, _, log, ok } = ctx;
  const pg = pager(event);
  const q = { sec_degraded: true, is_deleted: _.neq(true) };
  const query = col('im_message').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const orderIds = Array.from(new Set((rows.data || []).map((m) => m.order_id).filter(Boolean)));
  const orderMap = {};
  if (orderIds.length) {
    try {
      const orders = await col('order_main').where({ _id: _.in(orderIds) }).limit(100).get();
      (orders.data || []).forEach((o) => { orderMap[o._id] = o; });
    } catch (e) { log.d('im_degraded order join fail:', e.message); }
  }
  const list = (rows.data || []).map((m) => ({
    msg_id: m._id, order_id: m.order_id, order_no: (orderMap[m.order_id] && orderMap[m.order_id].order_no) || '',
    from_openid: m.from_openid, from_role: m.from_role || '', text: m.text || '',
    sec_degraded: true, sec_degraded_at: m.sec_degraded_at || m.created_at, created_at: m.created_at
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

async function im_message_admin_list(ctx) {
  const { event, pager, col, _, log, isDocId, ok, fail } = ctx;
  const { conv_id, order_id, order_no } = event;
  const pg = pager(event);
  let conv = null;
  if (isDocId(conv_id)) {
    const c = await col('im_conversation').doc(conv_id).get().catch(() => null);
    conv = c && c.data ? c.data : null;
  } else {
    const q = { is_deleted: _.neq(true) };
    if (isDocId(order_id)) q.order_id = order_id;
    else if (order_no) {
      const om = await col('order_main').where({ order_no: String(order_no) }).limit(1).get().catch(() => ({ data: [] }));
      if (om.data && om.data[0]) q.order_id = om.data[0]._id;
      else return fail('im_conv_not_found', '会话不存在');
    }
    else return fail('im_no_target', '请提供 conv_id 或 order_id 或 order_no');
    const c = await col('im_conversation').where(q).limit(1).get();
    conv = (c.data && c.data[0]) || null;
  }
  if (!conv) return fail('im_conv_not_found', '会话不存在');
  const msgQ = { conv_id: conv._id, is_deleted: _.neq(true) };
  const query = col('im_message').where(msgQ);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('created_at', 'asc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const openids = Array.from(new Set((rows.data || []).map((m) => m.from_openid).filter(Boolean)));
  const userMap = {};
  if (openids.length) {
    try {
      const users = await col('user_account').where({ openid: _.in(openids) }).limit(20).get();
      (users.data || []).forEach((u) => { userMap[u.openid] = { nickname: u.nickname || '微信用户', role: (Array.isArray(u.roles) && u.roles.indexOf('partner') >= 0) ? 'partner' : 'user' }; });
    } catch (e) { log.d('im msg user join fail:', e.message); }
  }
  const list = (rows.data || []).map((m) => ({
    msg_id: m._id, from_role: m.from_role || (userMap[m.from_openid] ? userMap[m.from_openid].role : ''),
    from_nickname: (userMap[m.from_openid] && userMap[m.from_openid].nickname) || '',
    type: m.type || 'text', text: m.text || '', template_id: m.template_id || '',
    sec_degraded: !!m.sec_degraded, quote: m.quote || null, created_at: m.created_at
  }));
  return ok({
    list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0),
    conv: { conv_id: conv._id, order_id: conv.order_id, order_no: conv.order_no || '', scene_name: conv.scene_name || '' }
  });
}

async function kefu_conv_list(ctx) {
  const { event, pager, col, _, log, isDocId, ok } = ctx;
  const pg = pager(event);
  const q = { is_deleted: _.neq(true) };
  if (event.kefu_status) q.kefu_status = event.kefu_status;
  if (isDocId(event.order_id)) q.order_id = event.order_id;
  const query = col('im_conversation').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('last_msg_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const openids = Array.from(new Set((rows.data || []).flatMap((c) => [c.user_openid, c.partner_openid]).filter(Boolean)));
  const userMap = {};
  if (openids.length) {
    try {
      const users = await col('user_account').where({ openid: _.in(openids) }).limit(50).get();
      (users.data || []).forEach((u) => { userMap[u.openid] = { nickname: u.nickname || '微信用户', role: (Array.isArray(u.roles) && u.roles.indexOf('partner') >= 0) ? 'partner' : 'user' }; });
    } catch (e) { log.d('kefu conv user join fail:', e.message); }
  }
  const list = (rows.data || []).map((c) => ({
    conv_id: c._id, order_id: c.order_id, order_no: c.order_no || '',
    conv_type: c.kefu_openid ? 'kefu' : 'order',
    scene_name: c.scene_name || '',
    user_nickname: (userMap[c.user_openid] && userMap[c.user_openid].nickname) || '用户',
    partner_nickname: (userMap[c.partner_openid] && userMap[c.partner_openid].nickname) || '耍伴',
    last_msg_text: c.last_msg_text || '', last_msg_at: c.last_msg_at || 0, last_msg_from: c.last_msg_from || '',
    user_unread: c.user_unread || 0, partner_unread: c.partner_unread || 0,
    kefu_status: c.kefu_status || 'unhandled', handled_at: c.handled_at || 0
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

async function kefu_conv_reply(ctx) {
  const { event, openid, isDocId, col, cloud, config, BLOCK_WORDS_FALLBACK, log, logEvent, ok, fail } = ctx;
  const { conv_id, text } = event;
  if (!isDocId(conv_id)) return fail('kefu_bad_conv', '会话 ID 不合法');
  const msg = String(text || '').trim();
  if (!msg) return fail('kefu_empty', '回复内容不能为空');
  if (msg.length > 500) return fail('kefu_too_long', '回复内容不超过500字');
  const conv = await col('im_conversation').doc(conv_id).get().catch(() => null);
  if (!conv || !conv.data || conv.data.is_deleted) return fail('kefu_conv_not_found', '会话不存在');
  const c = conv.data;
  let quote = null;
  const quoteMsgId = event.quote && String(event.quote.msg_id || '').trim();
  if (quoteMsgId) {
    if (!isDocId(quoteMsgId)) return fail('kefu_bad_quote', '引用消息 ID 不合法');
    const qmR = await col('im_message').doc(quoteMsgId).get().catch(() => null);
    const qm = qmR && qmR.data;
    if (!qm || qm.conv_id !== conv_id || qm.is_deleted) return fail('kefu_quote_not_found', '引用的消息不存在或已删除');
    quote = { msg_id: qm._id, text: qm.text || '', from_role: qm.from_role || '', created_at: qm.created_at || 0 };
  }
  let secDegraded = false;
  try {
    const check = await cloud.openapi.security.msgSecCheck({ content: msg, version: 2, scene: 2 }).catch((e) => {
      log.w('kefu msgSecCheck error:', e && e.message, e && e.errCode);
      return null;
    });
    if (check && check.errCode === 87014) return fail('kefu_blocked', '内容涉及违规,禁止发送');
    if (!check) {
      const words = (config.block_words && config.block_words.length) ? config.block_words : BLOCK_WORDS_FALLBACK;
      const lower = msg.toLowerCase();
      for (const w of words) {
        if (w && lower.indexOf(String(w).toLowerCase()) >= 0) {
          return fail('kefu_blocked', '消息包含平台禁止的内容(如联系方式/转账),请修改后重试');
        }
      }
    }
  } catch (e) { log.w('kefu msgSecCheck throw:', e && e.message); }
  const now = Date.now();
  const msgRes = await col('im_message').add({ data: {
    conv_id, order_id: c.order_id, from_openid: openid, from_role: 'kefu',
    type: 'text', text: msg, template_id: '', sec_degraded: secDegraded,
    quote, created_at: now, updated_at: now, is_deleted: false
  }}).catch((e) => { log.d('kefu msg add fail:', e.message); return null; });
  if (!msgRes) return fail('kefu_write_fail', '回复发送失败,请重试');
  await col('im_conversation').doc(conv_id).update({ data: {
    last_msg_text: msg, last_msg_at: now, last_msg_from: 'kefu',
    kefu_status: 'handled', handled_at: now, updated_at: now
  }}).catch(() => {});
  const targets = [c.user_openid, c.partner_openid].filter(Boolean);
  for (const to of targets) {
    try {
      const exist = await col('system_notice').where({ to_openid: to, order_id: c.order_id || '', type: 'kefu_reply', read: false }).limit(1).get();
      const data = { title: '客服回复', body: msg, action_key: 'jump_chat', action_payload: { order_id: c.order_id }, updated_at: now };
      if (exist.data && exist.data[0]) {
        await col('system_notice').doc(exist.data[0]._id).update({ data });
      } else {
        await col('system_notice').add({ data: Object.assign({ to_openid: to, order_id: c.order_id || '', type: 'kefu_reply', created_at: now, read: false }, data) });
      }
    } catch (e) { log.d('kefu notice fail:', to, e && e.message); }
  }
  await logEvent('P2', 'kefu_reply', openid, { conv_id, order_id: c.order_id, sec_degraded: secDegraded });
  return ok({ msg_id: msgRes._id, conv_id, kefu_status: 'handled' });
}

async function kefu_mislabel_clear(ctx) {
  const { openid, col, logEvent, ok } = ctx;
  const r = await col('im_message')
    .where({ from_role: 'kefu', sec_degraded: true }).update({
      data: { sec_degraded: false, sec_degraded_at: null, sec_degraded_fixed_at: Date.now() }
    }).catch(() => null);
  const updated = (r && r.stats && r.stats.updated) || 0;
  await logEvent('P2', 'kefu_mislabel_clear', openid, { updated });
  return ok({ updated });
}

async function withdraw_review(ctx) {
  const { event, openid, operatorAccount, isDocId, col, _, logEvent, ok, fail } = ctx;
  const { withdraw_id, decision, reason } = event;
  if (!['approve', 'reject'].includes(decision)) return fail('wr_bad_decision', 'decision 只能是 approve/reject');
  if (decision === 'reject' && !String(reason || '').trim()) return fail('wr_need_reason', '驳回必须填原因');
  if (!isDocId(withdraw_id)) return fail('wr_bad_id', 'withdraw_id 格式不正确');
  const wR = await col('withdraw_record').doc(withdraw_id).get().catch(() => null);
  const w = wR && wR.data;
  if (!w || w.is_deleted) return fail('wr_not_found', '提现记录不存在');
  if (w.status !== 'processing') return fail('wr_status', `当前状态(${w.status})不可审核`);
  const now2 = Date.now();
  const accCntR = await col('admin_accounts').where({ status: 'active', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 }));
  const rbacEnabled = (accCntR.total || 0) > 0;
  if (rbacEnabled && !w.review1_by) {
    await col('withdraw_record').doc(withdraw_id).update({ data: { review1_by: operatorAccount, review1_at: now2, updated_at: now2 } });
    await logEvent('P2', 'withdraw_review1', openid, { withdraw_id, by: operatorAccount });
    return ok({ withdraw_id, step: 1, msg: '已提交审核, 待第二人(不同账号)复核确认' });
  }
  if (rbacEnabled && w.review1_by === operatorAccount) {
    return fail('wr_self', '复核人不能与第一审核人相同(职责分离)');
  }
  const patch = { review2_by: operatorAccount, review2_at: now2, updated_at: now2 };
  if (decision === 'approve') {
    patch.status = 'success';
    patch.arrived_at = now2;
  } else {
    patch.status = 'rejected';
    patch.reject_reason = String(reason).trim();
  }
  await col('withdraw_record').doc(withdraw_id).update({ data: patch });
  await logEvent('P2', decision === 'approve' ? 'withdraw_approve' : 'withdraw_reject', openid, {
    withdraw_id, amount_fen: w.amount_fen, by: operatorAccount, reason: reason || ''
  });
  return ok({ withdraw_id, step: rbacEnabled ? 2 : 1, status: patch.status });
}

module.exports = {
  im_degraded_list, im_message_admin_list,
  kefu_conv_list, kefu_conv_reply, kefu_mislabel_clear,
  withdraw_review
};
