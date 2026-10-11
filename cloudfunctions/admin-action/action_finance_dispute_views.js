// admin-action · 争议/财务列表视图（dispute_list / finance_list，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function dispute_list(ctx) {
  const { event, pager, col, _, ok } = ctx;
  const pg = pager(event);
  const scope = ['active', 'history', 'all'].indexOf(event.scope) >= 0 ? event.scope : 'active';
  const base = { is_deleted: _.neq(true) };
  let q = base;
  if (scope === 'active') {
    q = Object.assign({}, base, { status: _.in(['S10.5', 'S10']) });
  } else if (scope === 'history') {
    q = Object.assign({}, base, { dispute_handled_at: _.gt(0) });
  } else {
    q = _.and([base, _.or([
      { status: _.in(['S10.5', 'S10']) },
      { dispute_handled_at: _.gt(0) }
    ])]);
  }
  const query = col('order_main').where(q);
  const [totalR, r] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('updated_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  return ok({
    list: (r.data || []).map((o) => ({
      order_id: o._id, order_no: o.order_no, status: o.status, scene: o.scene,
      user_openid: o.user_openid, partner_openid: o.partner_openid,
      total_fen: o.total_fen, tip_total_fen: o.tip_total_fen || 0,
      complaint_reason: o.complaint_reason || o.dispute_reason || '',
      dispute_reason: o.dispute_reason || '',
      admin_note: o.admin_note || '',
      dispute_opened_at: o.dispute_opened_at || 0,
      dispute_handled_at: o.dispute_handled_at || 0,
      refund_fen: o.refund_fen || 0,
      updated_at: o.updated_at
    })),
    total: totalR.total || 0, page: pg.page, scope,
    has_more: pg.page * pg.size < (totalR.total || 0)
  });
}

async function finance_list(ctx) {
  const { event, pager, col, _, ok } = ctx;
  const { type, status } = event;
  const pg = pager(event);
  let q = { is_deleted: _.neq(true) };
  if (type) q.type = type;
  if (status) q.status = status;
  const query = col('pay_transaction').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const orderIds = (rows.data || []).map((t) => t.order_id).filter(Boolean);
  const noMap = {};
  if (orderIds.length) {
    const oR = await col('order_main').where({ _id: _.in(orderIds) }).limit(orderIds.length).get().catch(() => ({ data: [] }));
    for (const o of (oR.data || [])) noMap[o._id] = { user_openid: o.user_openid, partner_openid: o.partner_openid };
  }
  const list = (rows.data || []).map((t) => ({
    tx_id: t._id, pay_no: t.pay_no || t.refund_no || t.tip_no || '',
    type: t.type, status: t.status,
    amount_fen: t.amount_fen, fee_fen: t.fee_fen || 0,
    order_id: t.order_id, order_no: t.order_no,
    user_openid: noMap[t.order_id] && noMap[t.order_id].user_openid,
    partner_openid: noMap[t.order_id] && noMap[t.order_id].partner_openid,
    is_mock: !!t.is_mock, created_at: t.created_at || t.paid_at
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

module.exports = { dispute_list, finance_list };
