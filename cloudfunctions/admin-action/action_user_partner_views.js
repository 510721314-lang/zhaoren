// admin-action · 用户/耍伴列表与详情视图（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function user_list(ctx) {
  const { event, pager, col, _, db, isOpenid, maskPhone, ok } = ctx;
  const { keyword, status, is_partner, sort } = event;
  const pg = pager(event);
  let q = { is_deleted: _.neq(true) };
  const conds = [];
  if (status) q.status = status;
  if (is_partner === true || is_partner === 'true') q.roles = 'partner';
  if (keyword) {
    const kw = String(keyword).trim();
    if (isOpenid(kw)) conds.push({ openid: kw });
    else conds.push({ nickname: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) });
  }
  if (conds.length) q = _.and([q, _.or(conds)]);
  const query = col('user_account').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy(sort === 'credit' ? 'user_credit_score' : 'created_at', 'desc')
      .skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const list = (rows.data || []).map((u) => ({
    openid: u.openid,
    nickname: u.nickname || '微信用户',
    avatar: u.avatar || '',
    roles: u.roles || [],
    status: u.status || 'normal',
    user_credit_score: u.user_credit_score || 800,
    partner_credit_score: u.partner_credit_score || 800,
    is_realname_done: !!u.is_realname_done,
    phone: maskPhone(u.phone),
    created_at: u.created_at
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

async function user_detail(ctx) {
  const { event, col, _, isOpenid, maskDoc, ok, fail } = ctx;
  const { target_openid } = event;
  if (!isOpenid(target_openid)) return fail('detail_bad_openid', 'openid 格式不正确');
  const [uR, ecR, dCnt, oUser, oPartner, logsR] = await Promise.all([
    col('user_account').where({ openid: target_openid }).limit(1).get().catch(() => ({ data: [] })),
    col('emergency_contact').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] })),
    col('demand').where({ creator_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('order_main').where({ user_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('order_main').where({ partner_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('credit_score_log').where({ openid: target_openid, is_deleted: _.neq(true) })
      .orderBy('created_at', 'desc').limit(10).get().catch(() => ({ data: [] }))
  ]);
  const u = uR.data && uR.data[0];
  if (!u) return fail('user_not_found', '用户不存在');
  const profileR = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const p = profileR.data && profileR.data[0];
  return ok({
    user: maskDoc({
      openid: u.openid, nickname: u.nickname, avatar: u.avatar, roles: u.roles || [],
      status: u.status || 'normal', age: u.age || null,
      user_credit_score: u.user_credit_score || 800, partner_credit_score: u.partner_credit_score || 800,
      is_realname_done: !!u.is_realname_done, phone: u.phone, id_card: u.id_card,
      banned_reason: u.banned_reason || '', created_at: u.created_at
    }),
    partner: p ? {
      status: p.status, accept_scenes: p.accept_scenes || [], accept_switch: !!p.accept_switch,
      scene_rates: p.scene_rates || {}, applied_at: p.applied_at
    } : null,
    emergency_contact: ecR.data && ecR.data[0] ? maskDoc({
      name: ecR.data[0].name || ecR.data[0].contact_name || '',
      phone: ecR.data[0].phone || ecR.data[0].contact_phone || '',
      relation: ecR.data[0].relation || ''
    }) : null,
    stats: { demand_count: dCnt.total || 0, order_as_user: oUser.total || 0, order_as_partner: oPartner.total || 0 },
    credit_logs: (logsR.data || []).map((l) => ({
      type: l.type, delta: l.delta, score: l.score, reason: l.reason || '',
      is_system: !!l.is_system, created_at: l.created_at
    }))
  });
}

async function user_ec_update(ctx) {
  const { event, openid, operatorAccount, col, _, isOpenid, logEvent, ok, fail } = ctx;
  const { target_openid, contacts } = event;
  if (!isOpenid(target_openid)) return fail('ec_bad_openid', 'openid 格式不正确');
  if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > 2) {
    return fail('ec_count', '紧急联系人需 1-2 名');
  }
  for (const c of contacts) {
    if (!c.name || !/^1\d{10}$/.test(c.phone || '')) return fail('ec_field', '姓名/手机号格式有误');
  }
  const nowEc = Date.now();
  const existR = await col('emergency_contact')
    .where({ openid: target_openid, is_deleted: false }).orderBy('created_at', 'asc').limit(2).get();
  const existDocs = existR.data || [];
  await Promise.all(contacts.map((c, i) => {
    if (existDocs[i]) {
      return col('emergency_contact').doc(existDocs[i]._id).update({
        data: { name: c.name, phone: c.phone, relation: c.relation || '', updated_at: nowEc }
      });
    }
    return col('emergency_contact').add({
      data: { openid: target_openid, name: c.name, phone: c.phone, relation: c.relation || '', created_at: nowEc, updated_at: nowEc, is_deleted: false }
    });
  }));
  for (let i = contacts.length; i < existDocs.length; i++) {
    await col('emergency_contact').doc(existDocs[i]._id).update({ data: { is_deleted: true, updated_at: nowEc } });
  }
  await col('user_account').where({ openid: target_openid }).update({ data: { emergency_changed_at: nowEc, updated_at: nowEc } });
  await logEvent('P2', 'user_ec_update', openid, { target_openid, by: operatorAccount, count: contacts.length });
  return ok({ target_openid, contacts: contacts.map((c) => ({ name: c.name, phone: c.phone.slice(0, 3) + '****' + c.phone.slice(-4), relation: c.relation || '' })) });
}

async function partner_list(ctx) {
  const { event, pager, col, _, maskPhone, ok } = ctx;
  const { status } = event;
  const pg = pager(event);
  let q = { is_deleted: _.neq(true) };
  if (status) q.status = status;
  const query = col('partner_profile').where(q);
  const [totalR, rows] = await Promise.all([
    query.count().catch(() => ({ total: 0 })),
    query.orderBy('applied_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
  ]);
  const openids = (rows.data || []).map((p) => p.openid);
  const userMap = {};
  if (openids.length) {
    const ur = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get().catch(() => ({ data: [] }));
    for (const u of (ur.data || [])) {
      userMap[u.openid] = {
        nickname: u.nickname || '', phone: maskPhone(u.phone),
        user_credit_score: u.user_credit_score || 800, partner_credit_score: u.partner_credit_score || 800,
        age: u.age || '', status: u.status || 'normal'
      };
    }
  }
  const list = (rows.data || []).map((p) => ({
    openid: p.openid,
    nickname: p.nickname || (userMap[p.openid] && userMap[p.openid].nickname) || '耍伴',
    avatar: p.avatar || '',
    status: p.status,
    accept_scenes: p.accept_scenes || [],
    scene_rates: p.scene_rates || {},
    accept_switch: !!p.accept_switch,
    applied_at: p.applied_at,
    review_note: p.review_note || '',
    max_distance_km: p.max_distance_km === undefined ? null : p.max_distance_km,
    accept_rate_min_fen: p.accept_rate_min_fen === undefined ? null : p.accept_rate_min_fen,
    accept_rate_max_fen: p.accept_rate_max_fen === undefined ? null : p.accept_rate_max_fen,
    home_lat: (p.home_location && Number(p.home_location.latitude)) || null,
    home_lng: (p.home_location && Number(p.home_location.longitude)) || null,
    user: userMap[p.openid] || null
  }));
  return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
}

async function partner_detail(ctx) {
  const { event, col, _, isOpenid, maskDoc, ok, fail } = ctx;
  const { target_openid } = event;
  if (!isOpenid(target_openid)) return fail('detail_bad_openid', 'openid 格式不正确');
  const [pR, uR, oCnt, doneCnt, evR] = await Promise.all([
    col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] })),
    col('user_account').where({ openid: target_openid }).limit(1).get().catch(() => ({ data: [] })),
    col('order_main').where({ partner_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('order_main').where({ partner_openid: target_openid, status: _.in(['S5', 'S8', 'S9']), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
    col('evaluation').where({ to_openid: target_openid, is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }))
  ]);
  const p = pR.data && pR.data[0];
  if (!p) return fail('partner_not_found', '耍伴不存在');
  const u = uR.data && uR.data[0];
  const evs = evR.data || [];
  const avgStar = evs.length ? Math.round(evs.reduce((s, e) => s + (e.star || 0), 0) / evs.length * 10) / 10 : 0;
  return ok({
    profile: {
      openid: p.openid, nickname: p.nickname, avatar: p.avatar, status: p.status,
      accept_scenes: p.accept_scenes || [], scene_rates: p.scene_rates || {},
      accept_switch: !!p.accept_switch, city: p.city || [],
      applied_at: p.applied_at, reviewed_at: p.reviewed_at, review_note: p.review_note || ''
    },
    user: u ? maskDoc({
      nickname: u.nickname, phone: u.phone, status: u.status || 'normal',
      user_credit_score: u.user_credit_score || 800, partner_credit_score: u.partner_credit_score || 800,
      is_realname_done: !!u.is_realname_done
    }) : null,
    stats: {
      order_count: oCnt.total || 0,
      done_count: doneCnt.total || 0,
      eval_count: evs.length,
      avg_star: avgStar
    }
  });
}

module.exports = {
  user_list, user_detail, user_ec_update, partner_list, partner_detail
};
