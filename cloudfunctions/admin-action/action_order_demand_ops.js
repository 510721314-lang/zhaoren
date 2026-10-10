// admin-action · 需求/订单人工处置（demand_offline / order_force_cancel，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function demand_offline(ctx) {
  const { event, now, openid, isDocId, col, logEvent, ok, fail } = ctx;
  const { demand_id, note } = event;
  if (!isDocId(demand_id)) return fail('demand_bad_id', '需求 ID 格式不正确');
  if (!note || !String(note).trim()) return fail('demand_no_note', '请填写下架原因');
  let d;
  try { d = (await col('demand').doc(demand_id).get()).data; } catch (e) { d = null; }
  if (!d) return fail('demand_not_found', '需求不存在');
  if (d.status !== 'matching') return fail('demand_bad_status', `当前状态(${d.status})不可下架,仅匹配中需求可下架`);
  await col('demand').doc(demand_id).update({
    data: {
      status: 'cancelled', admin_note: String(note).trim(),
      offline_by: openid, offline_at: now, updated_at: now
    }
  });
  await logEvent('P2', 'demand_offline', openid, {
    demand_id, demand_no: d.demand_no, reason: String(note).trim()
  });
  return ok({ demand_id, status: 'cancelled' });
}

async function order_force_cancel(ctx) {
  const { event, now, openid, isDocId, col, _, logEvent, ok, fail } = ctx;
  const { order_id, note } = event;
  if (!isDocId(order_id)) return fail('order_bad_id', '订单 ID 格式不正确');
  if (!note || !String(note).trim()) return fail('cancel_no_note', '请填写取消原因');
  let o;
  try { o = (await col('order_main').doc(order_id).get()).data; } catch (e) { o = null; }
  if (!o) return fail('order_not_found', '订单不存在');
  if (o.status !== 'S1' && o.status !== 'S0') {
    return fail('cancel_bad_status', `当前状态(${o.status})不可强制取消,仅待确认/待支付订单可取消`);
  }
  const before = o.status;
  const cr = await col('order_main').where({ _id: order_id, status: _.in(['S1', 'S0']) }).update({
    data: { status: 'S6', admin_note: String(note).trim(), cancel_by: openid, cancel_at: now, updated_at: now }
  });
  if (!cr.stats || cr.stats.updated !== 1) {
    return fail('cancel_conflict', '订单状态已变化,请刷新后重试');
  }
  if (o.demand_id && before === 'S1') {
    await col('demand').where({ _id: o.demand_id, status: 'matched' }).update({ data: { status: 'matching', updated_at: now } }).catch(() => {});
  }
  try {
    await col('order_status_log').add({ data: {
      order_id, order_no: o.order_no, from_status: before, to_status: 'S6',
      actor: 'admin', actor_openid: openid, action: 'admin_force_cancel',
      note: String(note).trim(), created_at: now, updated_at: now, is_deleted: false
    }});
  } catch (e) {}
  await logEvent('P2', 'order_force_cancel', openid, {
    order_id, order_no: o.order_no, before, after: 'S6', note: String(note).trim()
  });
  return ok({ order_id, before, after: 'S6' });
}

module.exports = { demand_offline, order_force_cancel };
