// admin-action · 列表/流水只读组（从 index.js 物理抽出，行为逐字不变）
// 含从 main 内联搬入的 paginateList helper；共享符号通过 ctx 注入，禁止反向 require('./index')。

function mkPaginate(ctx) {
  const { col, ok } = ctx;
  return function paginateList(collName, where, pg, mapper) {
    const query = col(collName).where(where);
    return Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]).then(([totalR, rows]) => {
      const list = (rows.data || []).map(mapper);
      return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
    });
  };
}

async function report_list(ctx) {
  const { event, pager, col, _, ok } = ctx;
  const { status: rStatus } = event;
  const pg = pager(event);
  let q = { is_deleted: _.neq(true) };
  if (rStatus) q.status = rStatus;
  const query = col('safety_report').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const list = (rows.data || []).map((r) => ({
    report_id: r._id, order_id: r.order_id, order_no: r.order_no || '',
    reporter_openid: r.reporter_openid, reporter_role: r.reporter_role || '',
    type: r.type, status: r.status, note: r.note || '',
    resolve_note: r.resolve_note || '',
    location: r.location ? (r.location.name || '') : '',
    resolved_at: r.resolved_at, created_at: r.created_at
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

async function report_handle(ctx) {
  const { event, isDocId, col, now, openid, logEvent, ok, fail } = ctx;
  const { report_id, note } = event;
  if (!isDocId(report_id)) return fail('report_bad_id', '举报记录 ID 格式不正确');
  if (!note || !String(note).trim()) return fail('report_no_note', '请填写处理说明');
  let r;
  try { r = (await col('safety_report').doc(report_id).get()).data; } catch (e) { r = null; }
  if (!r) return fail('report_not_found', '举报记录不存在');
  await col('safety_report').doc(report_id).update({
    data: {
      status: 'resolved', resolve_note: String(note).trim(),
      resolved_by: openid, resolved_at: now, updated_at: now
    }
  });
  await logEvent('P2', 'report_resolved', openid, {
    report_id, order_no: r.order_no, type: r.type, note: String(note).trim()
  });
  return ok({ report_id, status: 'resolved' });
}

function safety_log_list(ctx) {
  const { event, pager, _, isOpenid } = ctx;
  const paginateList = mkPaginate(ctx);
  const { kind, status: slStatus, order_id: slOrderId, target_openid } = event;
  const pg = pager(event);
  const q = { type: _.in(['sos', 'checkin']), is_deleted: _.neq(true) };
  if (kind === 'sos' || kind === 'checkin') q.type = kind;
  if (slStatus) q.status = String(slStatus);
  if (slOrderId) q.order_id = String(slOrderId);
  if (isOpenid(target_openid)) q.reporter_openid = target_openid;
  return paginateList('safety_report', q, pg, (r) => ({
    report_id: r._id, order_id: r.order_id, order_no: r.order_no || '',
    type: r.type, sub_type: r.sub_type || '', status: r.status,
    reporter_openid: r.reporter_openid, reporter_role: r.reporter_role || '',
    note: r.note || '',
    location_name: r.location ? (r.location.name || '') : '',
    resolved_at: r.resolved_at || null, created_at: r.created_at
  }));
}

async function event_list(ctx) {
  const { event, pager, col, _, ok } = ctx;
  const { level, type: evType } = event;
  const pg = pager(event);
  let q = { is_deleted: _.neq(true) };
  if (level) q.level = level;
  if (evType) q.type = evType;
  const query = col('platform_event').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const list = (rows.data || []).map((e) => ({
    event_id: e._id, level: e.level, type: e.type, openid: e.openid,
    payload: e.payload || {}, created_at: e.created_at
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

function credit_log_list(ctx) {
  const { event, pager, _, isOpenid } = ctx;
  const paginateList = mkPaginate(ctx);
  const { target_openid, log_type } = event;
  const pg = pager(event);
  const q = { is_deleted: _.neq(true) };
  if (isOpenid(target_openid)) q.openid = target_openid;
  if (log_type) q.type = String(log_type);
  return paginateList('credit_score_log', q, pg, (l) => ({
    log_id: l._id, openid: l.openid, type: l.type, delta: l.delta, score: l.score,
    reason: l.reason || '', is_system: !!l.is_system, created_at: l.created_at
  }));
}

function withdraw_list(ctx) {
  const { event, pager, _, isOpenid } = ctx;
  const paginateList = mkPaginate(ctx);
  const { target_openid, status: wdStatus, wd_type } = event;
  const pg = pager(event);
  const q = { is_deleted: _.neq(true) };
  if (isOpenid(target_openid)) q.openid = target_openid;
  if (wdStatus) q.status = String(wdStatus);
  if (wd_type) q.type = String(wd_type);
  return paginateList('withdraw_record', q, pg, (w) => ({
    withdraw_id: w._id, withdraw_no: w.withdraw_no, openid: w.openid,
    type: w.type, amount_fen: w.amount_fen, status: w.status,
    expect_arrive_at: w.expect_arrive_at || null, arrived_at: w.arrived_at || null,
    is_mock: !!w.is_mock, created_at: w.created_at
  }));
}

function settlement_list(ctx) {
  const { event, pager, _, isOpenid } = ctx;
  const paginateList = mkPaginate(ctx);
  const { target_openid, order_id, status: stStatus } = event;
  const pg = pager(event);
  const q = { is_deleted: _.neq(true) };
  if (isOpenid(target_openid)) q.openid = target_openid;
  if (order_id) q.order_id = String(order_id);
  if (stStatus) q.status = String(stStatus);
  return paginateList('settlement', q, pg, (s) => ({
    settlement_id: s._id, order_id: s.order_id || '', openid: s.openid || '',
    type: s.type || '', amount_fen: s.amount_fen, fee_fen: s.fee_fen,
    income_fen: s.income_fen, status: s.status || '', batch_no: s.batch_no || '',
    created_at: s.created_at
  }));
}

function insurance_list(ctx) {
  const { event, pager, _, isOpenid } = ctx;
  const paginateList = mkPaginate(ctx);
  const { target_openid, order_id, policy_no } = event;
  const pg = pager(event);
  const q = { is_deleted: _.neq(true) };
  if (isOpenid(target_openid)) q.openid = target_openid;
  if (order_id) q.order_id = String(order_id);
  if (policy_no) q.policy_no = String(policy_no);
  return paginateList('insurance_record', q, pg, (i) => ({
    insurance_id: i._id, order_id: i.order_id, policy_no: i.policy_no,
    openid: i.openid, scene_code: i.scene_code || '', status: i.status,
    coverage_accident_fen: i.coverage_accident_fen, coverage_property_fen: i.coverage_property_fen,
    premium_fen: i.premium_fen, created_at: i.created_at
  }));
}

module.exports = {
  report_list, report_handle, safety_log_list, event_list,
  credit_log_list, withdraw_list, settlement_list, insurance_list
};
