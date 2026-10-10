// order-action · 查询分组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function detail(ctx) {
  const { getOrder, roleOf, getConfirmation, col, _, log, allConfirmed, CONFIRM_FIELDS, maskContact, getConfig, canManualUrge, buildOrderSummary, openid, order_id } = ctx;
  // ───────── 订单详情(全字段 + 四确认状态 + 评价, 仅参与方可读) ─────────
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

  // 并行:6 个独立查询(确认单 + 评价 + 双昵称 + sos + checkin)合并为 1 批, 冷启动压到 2s 内
  const [conf, evR, uR, pR, sosR, ckR] = await Promise.all([
    getConfirmation(order_id),
    col('evaluation').where({ order_id, is_deleted: false }).limit(1).get().catch(() => ({ data: [] })),
    col('user_account').where({ openid: order.user_openid }).limit(1).get().catch(() => ({ data: [] })),
    col('user_account').where({ openid: order.partner_openid }).limit(1).get().catch(() => ({ data: [] })),
    col('safety_report').where({ order_id, type: 'sos', status: 'active', is_deleted: false }).orderBy('created_at', 'desc').limit(1).get().catch(() => ({ data: [] })),
    col('safety_report').where({ order_id, type: 'checkin', is_deleted: false }).orderBy('created_at', 'desc').limit(3).get().catch(() => ({ data: [] }))
  ]);

  // 确认单
  let confirm = null;
  if (conf) {
    const fields = {};
    let confirmedCount = 0;
    for (const f of CONFIRM_FIELDS) {
      const it = conf.items[f] || {};
      if (it.user_ok) confirmedCount++;
      if (it.partner_ok) confirmedCount++;
      fields[f] = { value: it.value, user_ok: !!it.user_ok, partner_ok: !!it.partner_ok };
    }
    confirm = { items: fields, confirmed_count: confirmedCount, total_count: 8, all_confirmed: allConfirmed(conf.items), version: conf.version || 1 };
  }

  // 评价
  let evaluation = null;
  if (evR.data && evR.data[0]) {
    evaluation = { star: evR.data[0].star, content: evR.data[0].content || '' };
  }

  // 昵称
  let userNickname = '发单人', partnerNickname = '耍伴';
  if (uR.data && uR.data[0] && uR.data[0].nickname) userNickname = uR.data[0].nickname;
  if (pR.data && pR.data[0] && pR.data[0].nickname) partnerNickname = pR.data[0].nickname;

  // 联系信息(过渡版, 2026-10-09): 接单方且订单已支付后 → 展示对方脱敏号;
  // 代发单展示两条: 需求发布者 + 被代发人(关系); 普通单仅发布者。真实号一律不外传; 拨打为占位(二期接号码保护)。
  let contactDisplay = null;
  if (role === 'partner' && order.demand_id
    && ['S2', 'S3', 'S3.5', 'S4', 'S5', 'S8', 'S9'].indexOf(order.status) >= 0) {
    try {
      const dmR = await col('demand').doc(order.demand_id).get();
      const dm = dmR && dmR.data;
      if (dm) {
        const items = [];
        const ownerMasked = maskContact(dm.contact_phone);
        if (ownerMasked) items.push({ who: '需求发布者', masked: ownerMasked });
        const isProxy = dm.publish_type === 'proxy' && dm.service_target;
        if (isProxy) {
          const proxyMasked = maskContact(dm.service_target.phone || dm.service_target.phone_mask);
          if (proxyMasked) items.push({ who: `被代发人（${dm.service_target.relation || '亲友'}）`, masked: proxyMasked });
        }
        if (items.length) {
          contactDisplay = {
            items,
            note: '号码保护中，暂不支持直接拨打；可先通过「联系用户」聊天沟通'
          };
        }
      }
    } catch (e) { log.d(`contact display fail: ${e.message}`); }
  }

  // safety
  const safety = { help_flag: !!order.help_flag, active_sos: null, checkins: [] };
  const activeSos = sosR.data && sosR.data[0];
  if (activeSos) safety.active_sos = { reporter_role: activeSos.reporter_role || '', created_at: activeSos.created_at || null };
  safety.checkins = (ckR.data || []).map(r => ({
    reporter_role: r.reporter_role || '', created_at: r.created_at || null, location: r.location || null
  }));

  // Wave2 止血⑥: 催办信息（用户视角：入口可见性 + 次数；T+1h 自动标记 urge_t1_at 表示入口已由定时器点亮）
  const cfg = await getConfig();
  const urgeGate = canManualUrge(order, Date.now(), cfg);
  const urge = {
    count: Number(order.urge_count) || 0,
    max: urgeGate.max || (cfg && cfg.urge_max_count) || 2,
    can_urge: role === 'user' && urgeGate.ok,
    auto_reminded: !!order.urge_t1_at,
    logs: Array.isArray(order.urge_logs) ? order.urge_logs.slice(-3) : []
  };

  return {
    ok: true,
    data: {
      order_id,
      order_no: order.order_no,
      demand_no: order.demand_no || '',
      scene: order.scene,
      scene_name: SCENE_NAME[order.scene] || order.scene,
      content_options: order.content_options || [],
      location: order.location || null,
      start_time: order.start_time,
      duration_h: order.duration_h,
      total_fen: order.total_fen,
      fee_fen: order.fee_fen,
      partner_income_fen: order.partner_income_fen,
      tip_total_fen: order.tip_total_fen || 0,
      aa_tier: order.aa_tier || '',
      status: order.status,
      role,
      contact_display: contactDisplay,
      pay_expire_at: order.pay_expire_at || null,
      service_started_at: order.service_started_at || null,
      service_completed_at: order.service_completed_at || null,
      evaluated_at: order.evaluated_at || null,
      created_at: order.created_at || null,
      confirm,
      evaluation,
      safety,
      user_nickname: userNickname,
      partner_nickname: partnerNickname,
      milestone: order.milestone || null,
      modify_count: Number(order.modify_count) || 0,
      pending_modify: order.pending_modify || null,
      pending_extend: order.pending_extend || null,
      // 撤回投诉入口(仅发起人、且平台未受理=订单仍 S10.5 时可见); SOS 的 help_flag 与本流程无关, 不复用
      can_withdraw_complaint: order.status === 'S10.5' && order.complaint_by === openid,
      urge,
      order_summary: buildOrderSummary(order)
    }
  };
}

async function my_orders(ctx) {
  const { event, openid, col, _, log, buildOrderSummary, haversineKm, estimateCommute } = ctx;
  const role = event.role === 'user' ? 'user' : 'partner';
  const queryField = role === 'partner' ? 'partner_openid' : 'user_openid';
  const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

  // tab 过滤(与前端 TAB_STATUS 同口径; 云端字面量一律点号 S3.5/S10.5/S2.5)
  const FILTER_STATUS = {
    pay: ['S0'],
    doing: ['S1', 'S2', 'S2.5', 'S3', 'S3.5'],
    eval: ['S5'],
    after: ['S6', 'S7', 'S9', 'S10', 'S10.5']
  };
  const filter = (['all', 'pay', 'doing', 'eval', 'after'].indexOf(event.filter) >= 0) ? event.filter : 'all';
  // 分页: 倒序(created_at desc), 每页最多 50
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(event.page_size) || 20));

  const where = { [queryField]: openid, is_deleted: false };
  if (filter !== 'all') where.status = _.in(FILTER_STATUS[filter]);

  let orders = [];
  try {
    const r = await col('order_main').where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize).limit(pageSize).get();
    orders = r.data || [];
  } catch (e) {
    log.d(`my_orders query fail: ${e.message}`);
    return { ok: false, code: 'oa_list_fail', msg: '订单查询失败' };
  }

  // 发单人视角: 订单在耍伴接单后才生成, 已发布但仍待接单(matching)的需求需一并展示
  let pendingDemands = [];
  if (role === 'user') {
    try {
      const dr = await col('demand').where({
        creator_openid: openid, status: 'matching', is_deleted: false
      }).orderBy('created_at', 'desc').limit(20).get();
      pendingDemands = (dr.data || []).map((d) => ({
        item_type: 'demand',
        order_id: d._id,
        demand_id: d._id,
        order_no: d.demand_no,
        scene: d.scene,
        scene_name: SCENE_NAME[d.scene] || d.scene,
        content_options: d.content_options || (d.content_option ? [d.content_option] : []),
        location_name: (d.location && d.location.name) || '',
        location_lat: (d.location && d.location.latitude) || null,
        location_lng: (d.location && d.location.longitude) || null,
        start_time: d.start_time,
        duration_h: d.duration_h,
        total_fen: d.total_fen,
        status: 'PENDING',   // 前端映射为"待接单"
        commute: null,
        order_summary: buildOrderSummary({
          order_no: d.demand_no, scene: d.scene, content_options: d.content_options || (d.content_option ? [d.content_option] : []),
          total_fen: d.total_fen, duration_h: d.duration_h, headcount: d.headcount,
          created_at: d.created_at, start_time: d.start_time, location: d.location || null, aa_tier: d.aa_tier
        })
      }));
    } catch (e) {
      log.d(`my_orders pending demands query fail: ${e.message}`);
    }
  }

  const ACTIVE_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

  const orderItems = orders.map((o, idx) => {
    const item = {
      item_type: 'order',
      order_id: o._id,
      order_no: o.order_no,
      scene: o.scene,
      scene_name: SCENE_NAME[o.scene] || o.scene,
      content_options: o.content_options || [],
      location_name: (o.location && o.location.name) || '',
      location_lat: (o.location && o.location.latitude) || null,
      location_lng: (o.location && o.location.longitude) || null,
      start_time: o.start_time,
      duration_h: o.duration_h,
      end_time: o.start_time + (o.duration_h || 1) * 3600 * 1000,
      total_fen: o.total_fen,
      status: o.status,
      // 改期待确认红点: 订单处于 S2.5 且改期发起人不是当前查看者
      need_confirm: o.status === 'S2.5' && !!(o.pending_modify && o.pending_modify.by_openid !== openid),
      commute: null,
      order_summary: buildOrderSummary(o)
    };

    // 计算到下一单的通勤(当前单结束 → 下一单开始)
    const next = orders[idx + 1];
    if (next && o.location && next.location &&
        o.location.latitude && next.location.latitude) {
      const km = haversineKm(
        o.location.latitude, o.location.longitude,
        next.location.latitude, next.location.longitude
      );
      const est = estimateCommute(km);
      const gapMin = Math.round((next.start_time - item.end_time) / 60000);
      // 预警:间隔时间小于最快通勤方式(驾车)所需时间
      const tight = gapMin < est.drive_min;
      item.commute = {
        to_location: (next.location && next.location.name) || '',
        gap_min: gapMin,
        distance_km: est.distance_km,
        walk_min: est.walk_min,
        bike_min: est.bike_min,
        bus_min: est.bus_min,
        drive_min: est.drive_min,
        tight
      };
    }
    return item;
  });

  // PENDING 待接单需求: 仅 user+all+第一页 置顶拼接(不参与分页计数)
  const list = (pendingDemands.length && filter === 'all' && page === 1)
    ? [...pendingDemands, ...orderItems]
    : orderItems;
  return { ok: true, data: { role, list, page, page_size: pageSize, has_more: orders.length === pageSize } };
}

async function my_counts(ctx) {
  const { event, openid, col, _ } = ctx;
  const role = event.role === 'partner' ? 'partner' : 'user';
  const openidField = role === 'partner' ? 'partner_openid' : 'user_openid';
  const COL = col('order_main');
  // 6 次独立 count 合并为 1 批, 冷启动压到 1s 内
  const [pay, doing, eval, afterSale] = await Promise.all([
    // 待支付 S0 只属于 user 视角(partner 看不到)
    COL.where({ user_openid: openid, status: 'S0', is_deleted: false }).count().catch(() => ({ total: 0 })),
    // 进行中
    COL.where({ [openidField]: openid, status: _.in(['S1','S2','S2_5','S3','S3.5']), is_deleted: false }).count().catch(() => ({ total: 0 })),
    // 待评价
    COL.where({ [openidField]: openid, status: 'S5', is_deleted: false }).count().catch(() => ({ total: 0 })),
    // 售后(双方都能看)
    COL.where({
      $or: [{ user_openid: openid }, { partner_openid: openid }],
      status: _.in(['S6','S7','S9','S10','S10.5']),
      is_deleted: false
    }).count().catch(() => ({ total: 0 }))
  ]);
  return { ok: true, data: {
    role,
    pending_pay: pay.total || 0,
    in_progress: doing.total || 0,
    pending_eval: eval.total || 0,
    after_sales: afterSale.total || 0
  }};
}

async function notice_list(ctx) {
  const { event, openid, col, _, log, buildOrderSummary } = ctx;
  const limit = Math.min(Number(event.limit) || 50, 100);
  const skip = Number(event.skip) || 0;
  const list = await col('system_notice')
    .where({ to_openid: openid })
    .orderBy('created_at', 'desc')
    .skip(skip)
    .limit(limit)
    .get();
  // 未读数
  const unread = await col('system_notice').where({ to_openid: openid, read: false }).count();
  // 订单概要(所有订单类通知前置统一概要): 批量关联 order_main
  const orderIds = Array.from(new Set((list.data || []).map((n) => n.order_id).filter(Boolean)));
  const orderMap = {};
  if (orderIds.length) {
    try {
      const orders = await col('order_main').where({ _id: _.in(orderIds) }).limit(100).get();
      (orders.data || []).forEach((o) => { orderMap[o._id] = o; });
    } catch (e) { log.d('notice order join fail:', e.message); }
  }
  const decorated = (list.data || []).map((n) => Object.assign({}, n, {
    order_summary: n.order_id ? buildOrderSummary(orderMap[n.order_id]) : ''
  }));
  return { ok: true, data: { list: decorated, unread: unread.total } };
}

async function notice_poll(ctx) {
  const { event, openid, col } = ctx;
  if (!/^[a-f0-9]{32}$/i.test(String(event.order_id || ''))) {
    return { ok: false, code: 'oa_bad_order', msg: '缺少有效订单 ID' };
  }
  const r = await col('system_notice').where({ to_openid: openid, order_id: event.order_id, read: false })
    .orderBy('created_at', 'desc').limit(20).get().catch(() => ({ data: [] }));
  const list = (r.data || []).map((n) => ({ id: n._id, type: n.type || '', title: n.title || '', body: n.body || '', created_at: n.created_at || 0 }));
  return { ok: true, data: { has_new: list.length > 0, list } };
}

async function notice_read(ctx) {
  const { event, openid, col } = ctx;
  if (event.notice_id) {
    const r = await col('system_notice').where({ _id: event.notice_id, to_openid: openid, read: false })
      .update({ data: { read: true, read_at: Date.now() } });
    return { ok: true, data: { updated: (r.stats && r.stats.updated) || 0 } };
  }
  await col('system_notice').where({ to_openid: openid, read: false })
    .update({ data: { read: true, read_at: Date.now() } });
  return { ok: true };
}

module.exports = { detail, my_orders, my_counts, notice_list, notice_poll, notice_read };
