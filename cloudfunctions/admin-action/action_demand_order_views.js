// admin-action · 需求/订单列表与详情视图（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function demand_list(ctx) {
  const { event, pager, col, _, db, isDocId, ok } = ctx;
  const { keyword, scene, status } = event;
  const pg = pager(event);
  let q = { is_deleted: _.neq(true) };
  if (scene) q.scene = scene;
  if (status) q.status = status;
  const conds = [];
  if (keyword) {
    const kw = String(keyword).trim();
    if (isDocId(kw)) conds.push({ _id: kw }, { creator_openid: kw });
    else conds.push({ demand_no: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) });
  }
  if (conds.length) q = _.and([q, _.or(conds)]);
  const query = col('demand').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const openids = (rows.data || []).map((d) => d.creator_openid);
  const nameMap = {};
  if (openids.length) {
    const ur = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get().catch(() => ({ data: [] }));
    for (const u of (ur.data || [])) nameMap[u.openid] = u.nickname || '微信用户';
  }
  const list = (rows.data || []).map((d) => ({
    demand_id: d._id, demand_no: d.demand_no,
    creator_openid: d.creator_openid, creator_name: nameMap[d.creator_openid] || '微信用户',
    scene: d.scene, status: d.status,
    content_options: d.content_options || (d.content_option ? [d.content_option] : []),
    remark: d.remark || '',
    start_time: d.start_time, duration_h: d.duration_h,
    location_name: d.location && d.location.name, city: d.location && d.location.city,
    loc_lat: (d.location && Number(d.location.latitude)) || null,
    loc_lng: (d.location && Number(d.location.longitude)) || null,
    rate_fen: d.rate_fen, total_fen: d.total_fen,
    broadcast: !!d.broadcast, match_mode: d.match_mode || 'invite',
    admin_note: d.admin_note || '', created_at: d.created_at
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

async function order_list_query(ctx) {
  const { event, action, pager, col, _, db, isDocId, maskDoc, SCENE_NAME, logEvent, openid, ok } = ctx;
  const { keyword, status, export_mode } = event;
  const pg = pager(event);
  let q = { is_deleted: _.neq(true) };
  const conds = [];
  if (status) q.status = status;
  if (keyword) {
    const kw = String(keyword).trim();
    if (isDocId(kw)) {
      conds.push({ _id: kw }, { user_openid: kw }, { partner_openid: kw }, { demand_id: kw });
    } else {
      conds.push({ order_no: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) });
    }
  }
  if (conds.length) q = _.and([q, _.or(conds)]);
  const query = col('order_main').where(q);
  if (export_mode === 'csv') {
    const rows = await query.orderBy('created_at', 'desc').limit(10000).get().catch(() => ({ data: [] }));
    const list = (rows.data || []).map((o) => ({
      order_no: o.order_no, status: o.status, scene: o.scene,
      user_openid: (o.user_openid || '').slice(0, 12), partner_openid: (o.partner_openid || '').slice(0, 12),
      total_yuan: (o.total_fen || 0) / 100, tip_yuan: (o.tip_total_fen || 0) / 100,
      start_time: o.start_time || '', created_at: o.created_at
    }));
    await logEvent('P2', 'order_export_csv', openid, { count: list.length });
    return ok({ list, csv_mode: true });
  }
  const usePage = action === 'order_list';
  const [totalR, rowsR] = await Promise.all([
    usePage ? query.count().catch(() => ({ total: 0 })) : Promise.resolve({ total: 0 }),
    usePage
      ? query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
      : query.orderBy('created_at', 'desc').limit(30).get().catch(() => ({ data: [] }))
  ]);
  const list = (rowsR.data || []).map((o) => maskDoc({
    order_id: o._id, order_no: o.order_no,
    status: o.status, scene: o.scene,
    scene_name: SCENE_NAME[o.scene] || o.scene,
    content_options: o.content_options || (o.content_option ? [o.content_option] : []),
    user_openid: o.user_openid, partner_openid: o.partner_openid,
    total_fen: o.total_fen, tip_total_fen: o.tip_total_fen || 0,
    start_time: o.start_time, created_at: o.created_at,
    help_flag: !!o.help_flag, admin_note: o.admin_note || ''
  }));
  return ok(usePage
    ? { list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) }
    : { list });
}

async function order_detail(ctx) {
  const { event, col, _, isDocId, maskDoc, ok, fail } = ctx;
  const { order_id } = event;
  if (!isDocId(order_id)) return fail('order_bad_id', '订单 ID 格式不正确');
  let o;
  try { o = (await col('order_main').doc(order_id).get()).data; } catch (e) { o = null; }
  if (!o) return fail('order_not_found', '订单不存在');
  const [logsR, txR, evR, cfR] = await Promise.all([
    col('order_status_log').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(50).get().catch(() => ({ data: [] })),
    col('pay_transaction').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(20).get().catch(() => ({ data: [] })),
    col('evaluation').where({ order_id, is_deleted: _.neq(true) }).limit(10).get().catch(() => ({ data: [] })),
    col('order_confirmations').where({ order_id, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }))
  ]);
  return ok({
    order: maskDoc({
      order_id: o._id, order_no: o.order_no, demand_no: o.demand_no,
      user_openid: o.user_openid, partner_openid: o.partner_openid,
      status: o.status, scene: o.scene,
      content_options: o.content_options || [],
      start_time: o.start_time, duration_h: o.duration_h,
      location: o.location, total_fen: o.total_fen, fee_fen: o.fee_fen,
      partner_income_fen: o.partner_income_fen, tip_total_fen: o.tip_total_fen || 0,
      aa_tier: o.aa_tier, pay_expire_at: o.pay_expire_at,
      help_flag: !!o.help_flag, dispute_reason: o.dispute_reason || '',
      admin_note: o.admin_note || '', created_at: o.created_at
    }),
    status_logs: (logsR.data || []).map((l) => ({
      from: l.from_status, to: l.to_status,
      action: l.action || l.note || '', actor: l.operator || l.actor_openid || l.actor || '',
      created_at: l.created_at
    })),
    transactions: (txR.data || []).map((t) => ({
      pay_no: t.pay_no || t.refund_no || t.tip_no || '',
      type: t.type, amount_fen: t.amount_fen, fee_fen: t.fee_fen || 0,
      status: t.status, created_at: t.created_at || t.paid_at
    })),
    evaluations: (evR.data || []).map((e) => ({
      from_openid: e.from_openid, to_openid: e.to_openid,
      star: e.star, content: e.content, is_system: !!e.is_system, created_at: e.created_at
    })),
    confirmations: cfR.data && cfR.data[0] ? {
      version: cfR.data[0].version,
      items: Object.keys(cfR.data[0].items || {}).map((k) => ({
        key: k,
        user_ok: !!cfR.data[0].items[k].user_ok,
        partner_ok: !!cfR.data[0].items[k].partner_ok
      }))
    } : null
  });
}

module.exports = {
  demand_list,
  order_list: order_list_query,
  order_query: order_list_query,
  order_detail
};
