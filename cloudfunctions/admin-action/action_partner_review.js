// admin-action · 耍伴审核/上下线组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function partner_offline_online(ctx) {
  const { event, action, now, openid, isOpenid, col, _, logEvent, ok, fail } = ctx;
  const { target_openid, reason } = event;
  if (!isOpenid(target_openid)) return fail('partner_bad_openid', 'openid 格式不正确');
  const pr = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get();
  if (!pr.data || !pr.data[0]) return fail('partner_not_found', '耍伴不存在');
  const online = action === 'partner_online';
  if (pr.data[0].status !== 'approved' && online) return fail('partner_not_approved', '仅审核通过的耍伴可恢复接单');
  await col('partner_profile').doc(pr.data[0]._id).update({
    data: { accept_switch: online, updated_at: now }
  });
  await logEvent('P2', online ? 'partner_online' : 'partner_offline', openid, {
    target_openid, reason: reason || '', before: pr.data[0].accept_switch, after: online
  });
  return ok({ openid: target_openid, accept_switch: online });
}

async function partner_profile_pending_list(ctx) {
  const { event, pager, col, _, FIELD_PENDING, isFieldEmpty, log, resolveTempUrls, ok } = ctx;
  const pg = pager(event);
  const query = col('partner_profile').where({ profile_audit_status: 'pending', is_deleted: _.neq(true) });
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('profile_submit_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const healedNow = Date.now();
  const rowsAll = rows.data || [];
  const stillPending = [];
  for (const p of rowsAll) {
    const allEmpty = Object.keys(FIELD_PENDING).every((f) => isFieldEmpty(f, p[FIELD_PENDING[f]]));
    if (allEmpty) {
      col('partner_profile').doc(p._id).update({ data: { profile_audit_status: 'approved', profile_reject_reason: '', updated_at: healedNow } }).catch(() => {});
      log.d('heal deadlock audit lock:', p.openid);
    } else {
      stillPending.push(p);
    }
  }
  rows.data = stillPending;
  if (stillPending.length !== rowsAll.length) {
    totalR.total = Math.max(0, (totalR.total || 0) - (rowsAll.length - stillPending.length));
  }
  const openids = (rows.data || []).map((p) => p.openid);
  const userMap = {};
  if (openids.length) {
    const ur = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get().catch(() => ({ data: [] }));
    for (const u of (ur.data || [])) userMap[u.openid] = { nickname: u.nickname || '', avatar: u.avatar || '' };
  }
  const fileIDSet = new Set();
  for (const p of (rows.data || [])) {
    const cols = [
      p.qualifications_pending && p.qualifications_pending.photos,
      p.honors_pending && p.honors_pending.photos,
      p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications && p.profile_audited_snapshot.qualifications.photos,
      p.profile_audited_snapshot && p.profile_audited_snapshot.honors && p.profile_audited_snapshot.honors.photos
    ];
    for (const arr of cols) if (Array.isArray(arr)) for (const f of arr) if (f && typeof f === 'string') fileIDSet.add(f);
  }
  const urlMap = await resolveTempUrls([...fileIDSet]);
  const toPhotos = (photos) => (Array.isArray(photos) ? photos.map((f) => ({ fileid: f, url: urlMap[f] || '' })) : []);
  const list = (rows.data || []).map((p) => ({
    openid: p.openid,
    nickname: p.nickname || (userMap[p.openid] && userMap[p.openid].nickname) || '耍伴',
    avatar: p.avatar || (userMap[p.openid] && userMap[p.openid].avatar) || '',
    pending: { bio: p.bio_pending || '', skills: p.skills_pending || [], highlights: p.highlights_pending || [],
      qualifications: { titles: (p.qualifications_pending && p.qualifications_pending.titles) || [], photos: toPhotos(p.qualifications_pending && p.qualifications_pending.photos) },
      honors: { titles: (p.honors_pending && p.honors_pending.titles) || [], photos: toPhotos(p.honors_pending && p.honors_pending.photos) } },
    current: {
      bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
      skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || [],
      highlights: (p.profile_audited_snapshot && p.profile_audited_snapshot.highlights) || [],
      qualifications: { titles: (p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications && p.profile_audited_snapshot.qualifications.titles) || [], photos: toPhotos(p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications && p.profile_audited_snapshot.qualifications.photos) },
      honors: { titles: (p.profile_audited_snapshot && p.profile_audited_snapshot.honors && p.profile_audited_snapshot.honors.titles) || [], photos: toPhotos(p.profile_audited_snapshot && p.profile_audited_snapshot.honors && p.profile_audited_snapshot.honors.photos) }
    },
    reject_reason: p.profile_reject_reason || '',
    submitted_at: p.profile_submit_at,
    audit_history: (p.profile_audit_history || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0))
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

async function partner_profile_review(ctx) {
  const { event, openid, isOpenid, col, _, buildAuditPatch, logEvent, ok, fail } = ctx;
  const { target_openid, items } = event;
  if (!isOpenid(target_openid)) return fail('pp_bad_openid', 'openid 格式不正确');
  const pr = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get();
  const p = pr.data && pr.data[0];
  if (!p) return fail('pp_not_found', '耍伴不存在');
  if (p.profile_audit_status !== 'pending') return fail('pp_no_pending', '该耍伴资料不在审核队列');
  if (!Array.isArray(items) || items.length === 0) return fail('pp_no_items', '缺少审核项');
  const _n = Date.now();
  const { patch, hist, hasRemainingPending, anyPatched } = buildAuditPatch(p, items, _n, openid);
  if (!anyPatched || Object.keys(patch).length === 0) return fail('pp_no_pending_scope', '所选审核项均无待审内容');
  patch.profile_audit_history = _.push(...hist);
  await col('partner_profile').doc(p._id).update({ data: patch });
  try {
    await col('system_notice').add({ data: {
      to_openid: target_openid, order_id: '', type: hasRemainingPending ? 'partner_profile_rejected' : 'partner_profile_approved',
      title: hasRemainingPending ? '部分资料未通过' : '资料审核通过',
      body: hasRemainingPending ? '你的部分耍伴资料未通过审核，请修改未通过的栏目后重新提交；已通过的栏目已展示。'
        : '你的耍伴资料已通过审核，已在耍伴卡片与详情页展示。',
      action_key: 'partner_profile_edit', action_payload: {}, created_at: _n, updated_at: _n, read: false
    }});
  } catch (e) {}
  await logEvent('P2', hasRemainingPending ? 'pp_profile_partial' : 'pp_profile_approved', openid, { target_openid, fields: items.map((i) => i.field).join(',') });
  return ok({ target_openid, profile_audit_status: hasRemainingPending ? 'pending' : 'approved' });
}

async function review(ctx) {
  const { event, now, openid, isOpenid, col, _, logEvent, ok, fail } = ctx;
  const { target_openid, decision, note } = event;
  if (!isOpenid(target_openid)) return fail('review_no_openid', '缺少耍伴 openid');
  if (decision !== 'approve' && decision !== 'reject') {
    return fail('review_bad_decision', 'decision 必须为 approve/reject');
  }
  const pr = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get();
  if (!pr.data || !pr.data[0]) return fail('review_not_found', '耍伴申请不存在');
  const profile = pr.data[0];
  const newStatus = decision === 'approve' ? 'approved' : 'rejected';
  await col('partner_profile').doc(profile._id).update({
    data: {
      status: newStatus, review_note: note || '', reviewed_by: openid, reviewed_at: now,
      accept_switch: decision === 'approve' ? true : profile.accept_switch, updated_at: now
    }
  });
  if (decision === 'approve') {
    await col('user_account').where({ openid: target_openid }).update({
      data: { roles: _.addToSet('partner'), updated_at: now }
    }).catch(() => {});
  }
  await logEvent('P2', 'partner_review_' + decision, openid, {
    target_openid, before: profile.status, after: newStatus, note: note || ''
  });
  return ok({ openid: target_openid, status: newStatus });
}

module.exports = {
  partner_offline: partner_offline_online,
  partner_online: partner_offline_online,
  partner_profile_pending_list,
  partner_profile_review,
  review
};
