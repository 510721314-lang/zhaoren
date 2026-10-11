// admin-action · 爽约申诉列表/详情 no_show_report_list（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function no_show_report_list(ctx) {
  const { event, isDocId, col, _, resolveTempUrls, pager, ok, fail } = ctx;
  const { status, report_id } = event;
  if (report_id) {
    if (!isDocId(report_id)) return fail('ns_bad_id', 'ID 格式不正确');
    let rpt = null;
    try { rpt = (await col('no_show_report').doc(report_id).get()).data; } catch (e) { rpt = null; }
    if (!rpt) return fail('ns_not_found', '申诉记录不存在');
    const urlMap = await resolveTempUrls([].concat(rpt.evidence_file_ids || [], rpt.defense_file_ids || []));
    const withUrls = (ids) => (ids || []).map((f) => ({ file_id: f, url: urlMap[f] || '' }));
    const oids = [rpt.reporter_openid, rpt.target_openid].filter(Boolean);
    const nameMap = {};
    try {
      const ur = await col('user_account').where({ openid: _.in(oids) }).limit(oids.length || 1).get();
      (ur.data || []).forEach((u) => { nameMap[u.openid] = u.nickname || ''; });
    } catch (e) {}
    return ok({
      report: Object.assign({}, rpt, {
        report_id: rpt._id,
        evidence: withUrls(rpt.evidence_file_ids),
        defense_evidence: withUrls(rpt.defense_file_ids),
        reporter_nickname: nameMap[rpt.reporter_openid] || '',
        target_nickname: nameMap[rpt.target_openid] || ''
      })
    });
  }
  const pg = pager(event);
  const base = { is_deleted: _.neq(true) };
  const cntP = (st) => col('no_show_report')
    .where(st ? Object.assign({}, base, { status: st }) : base)
    .count().catch(() => ({ total: 0 }));
  const filtered = (status && ['received', 'defense', 'decided', 'withdrawn'].indexOf(status) >= 0) ? status : '';
  const query = col('no_show_report').where(filtered ? Object.assign({}, base, { status: filtered }) : base);
  const [totalR, r, cReceived, cDefense, cDecided, cWithdrawn] = await Promise.all([
    cntP(filtered),
    query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] })),
    cntP('received'), cntP('defense'), cntP('decided'), cntP('withdrawn')
  ]);
  return ok({
    list: (r.data || []).map((x) => ({
      report_id: x._id, order_id: x.order_id, order_no: x.order_no || '',
      reporter_openid: x.reporter_openid, reporter_role: x.reporter_role || '',
      target_openid: x.target_openid, target_role: x.target_role || '',
      status: x.status || '', verdict: x.verdict || '',
      reason_type: x.reason_type || '',
      reason: x.reason || '', defense_reason: x.defense_reason || '',
      evidence_count: (x.evidence_file_ids || []).length,
      defense_count: (x.defense_file_ids || []).length,
      evidence_deadline: x.evidence_deadline || 0,
      defense_overdue: x.defense_overdue === true,
      created_at: x.created_at, decided_at: x.decided_at || 0,
      withdrawn_at: x.withdrawn_at || 0,
      decided_reason: x.decided_reason || '',
      penalty_applied: x.penalty_applied || null
    })),
    counts: { received: cReceived.total || 0, defense: cDefense.total || 0, decided: cDecided.total || 0, withdrawn: cWithdrawn.total || 0 },
    total: totalR.total || 0, page: pg.page, size: pg.size,
    has_more: pg.page * pg.size < (totalR.total || 0)
  });
}

module.exports = { no_show_report_list };
