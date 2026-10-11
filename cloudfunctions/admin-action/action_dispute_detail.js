// admin-action · 纠纷详情时间线 dispute_detail（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function dispute_detail(ctx) {
  const { event, isDocId, fail, col, _, STATUS_LABEL, TX_LABEL, maskDoc, SCENE_NAME, ok } = ctx;
  const { order_id } = event;
  if (!isDocId(order_id)) return fail('dispute_bad_id', '订单 ID 格式不正确');
  let o;
  try { o = (await col('order_main').doc(order_id).get()).data; } catch (e) { o = null; }
  if (!o) return fail('dispute_not_found', '订单不存在');
  const [logsR, cR, nsR, txR] = await Promise.all([
    col('order_status_log').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(100).get().catch(() => ({ data: [] })),
    col('complaint').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(20).get().catch(() => ({ data: [] })),
    col('no_show_report').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(20).get().catch(() => ({ data: [] })),
    col('pay_transaction').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(50).get().catch(() => ({ data: [] }))
  ]);
  const logs = logsR.data || [];
  const complaints = cR.data || [];
  const reports = nsR.data || [];
  const txs = txR.data || [];
  const oidSet = new Set();
  logs.forEach((l) => { if (l.actor_openid) oidSet.add(l.actor_openid); if (l.operator) oidSet.add(l.operator); });
  complaints.forEach((c) => { if (c.initiator_openid) oidSet.add(c.initiator_openid); });
  reports.forEach((r) => { if (r.reporter_openid) oidSet.add(r.reporter_openid); if (r.target_openid) oidSet.add(r.target_openid); if (r.decided_by) oidSet.add(r.decided_by); });
  txs.forEach((t) => { if (t.operator_openid) oidSet.add(t.operator_openid); });
  [o.user_openid, o.partner_openid].forEach((x) => { if (x) oidSet.add(x); });
  const openids = Array.from(oidSet).slice(0, 30);
  const nm = {};
  if (openids.length) {
    try {
      const ur = await col('user_account').where({ openid: _.in(openids) }).limit(30).get();
      (ur.data || []).forEach((u) => { nm[u.openid] = u.nickname || ''; });
    } catch (e) {}
  }
  const roleOf = (oid) => {
    if (!oid) return '系统';
    if (oid === o.user_openid) return '发单人';
    if (oid === o.partner_openid) return '耍伴';
    return '客服/系统';
  };
  const actorText = (oid, fallback) => {
    if (!oid) return fallback || '系统';
    const who = nm[oid] ? `${nm[oid]}(${roleOf(oid)})` : roleOf(oid);
    return fallback ? `${who} · ${fallback}` : who;
  };
  const sl = (s) => s ? `${s} ${STATUS_LABEL[s] || ''}`.trim() : '';
  const tl = [];
  logs.forEach((l) => tl.push({
    ts: l.created_at || l.updated_at || 0, tag: 'status',
    title: `${sl(l.from_status) || '—'} → ${sl(l.to_status) || '—'}`,
    desc: l.note || l.action || '',
    actor_text: actorText(l.actor_openid || l.operator, l.action || '')
  }));
  complaints.forEach((c) => tl.push({
    ts: c.created_at || 0, tag: 'complaint',
    title: c.status === 'withdrawn' ? '投诉已撤回' : '发起投诉',
    desc: c.reason || '',
    actor_text: actorText(c.initiator_openid, c.initiator_role === 'partner' ? '耍伴' : '发单人')
  }));
  reports.forEach((rp) => {
    tl.push({
      ts: rp.created_at || 0, tag: 'nosh',
      title: `爽约申诉(${rp.reason_type || '提交'})`,
      desc: rp.reason || '',
      actor_text: actorText(rp.reporter_openid, rp.reporter_role === 'partner' ? '耍伴' : '发单人')
    });
    if (rp.defense_at) tl.push({
      ts: rp.defense_at, tag: 'nosh', title: '申诉举证',
      desc: rp.defense_reason || '', actor_text: actorText(rp.target_openid, '被诉方')
    });
    if (rp.decided_at) tl.push({
      ts: rp.decided_at, tag: 'nosh',
      title: `申诉裁定：${rp.verdict === 'upheld' ? '成立' : '不成立'}`,
      desc: rp.decided_reason || '', actor_text: actorText(rp.decided_by, '管理员')
    });
    if (rp.withdrawn_at) tl.push({
      ts: rp.withdrawn_at, tag: 'nosh', title: '申诉已撤回',
      desc: '', actor_text: actorText(rp.reporter_openid, '申诉人')
    });
  });
  txs.forEach((t) => tl.push({
    ts: t.created_at || t.paid_at || 0, tag: 'money',
    title: `${TX_LABEL[t.type] || t.type} ¥${((t.amount_fen || 0) / 100).toFixed(2)}`,
    desc: t.pay_no || '', actor_text: actorText(t.operator_openid, t.status || '')
  }));
  tl.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return ok({
    order: maskDoc({
      order_id: o._id, order_no: o.order_no, status: o.status, scene: o.scene,
      scene_name: SCENE_NAME[o.scene] || o.scene,
      user_openid: o.user_openid, partner_openid: o.partner_openid,
      user_nick: nm[o.user_openid] || '', partner_nick: nm[o.partner_openid] || '',
      total_fen: o.total_fen, tip_total_fen: o.tip_total_fen || 0,
      fee_fen: o.fee_fen, partner_income_fen: o.partner_income_fen,
      refund_fen: o.refund_fen || 0, refund_no: o.refund_no || '',
      complaint_reason: o.complaint_reason || o.dispute_reason || '',
      complaint_at: o.complaint_at || 0, complaint_by: o.complaint_by || '',
      complaint_withdrawn_at: o.complaint_withdrawn_at || 0,
      dispute_opened_at: o.dispute_opened_at || 0,
      dispute_handled_by: o.dispute_handled_by || '', dispute_handled_at: o.dispute_handled_at || 0,
      refunded_at: o.refunded_at || 0, admin_note: o.admin_note || '',
      created_at: o.created_at
    }),
    timeline: tl,
    complaint: complaints.length ? complaints[complaints.length - 1] : null,
    no_show_reports: reports.map((rp) => ({
      report_id: rp._id, status: rp.status, verdict: rp.verdict || '',
      reason_type: rp.reason_type || '', reason: rp.reason || '',
      defense_reason: rp.defense_reason || '', decided_reason: rp.decided_reason || '',
      penalty_applied: rp.penalty_applied || null,
      created_at: rp.created_at, decided_at: rp.decided_at || 0, withdrawn_at: rp.withdrawn_at || 0
    })),
    transactions: txs.map((t) => ({
      pay_no: t.pay_no || '', type: t.type, amount_fen: t.amount_fen || 0,
      status: t.status, source: t.source || '', created_at: t.created_at || t.paid_at || 0
    }))
  });
}

module.exports = { dispute_detail };
