// T-7.26(2026-11-07): 自 zz-seed-orders/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── night_orders: 生成「服务时间在 00:00-06:00 夜间红线内」的需求与订单 ──
// 用途: 测试夜间红线链路 —— 广场可见凌晨服务需求; 抢单被 order_time_redline 拦截;
//       附带 2 条 S2 已支付订单展示凌晨服务时间的列表/详情。真实发布会被 publish_redline 拦截, 仅种子直写。
// 幂等: client_request_id(nto-*/nto-ord-*), 重复调用只补缺失

async function run_night_orders(ctx) {
  const { event, db, _, sceneList, CONTENT, USERS, PLACES, pick } = ctx;

  const now = Date.now();
  // 东八区折算: 明天北京 00:00 的 UTC 时间戳(云函数运行时 UTC, 前端显示 +8)
  // floor((now+8h)/day)*day 是「UTC 日历日起点」, 需再 -8h 才是北京 00:00(UTC 表示)
  const bjTodayStart = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  const tomorrowBJStart = bjTodayStart + 86400000;   // 明天北京 00:00
  const NIGHT_HOURS = [1, 2, 3, 4, 5];
  const count = Math.min(10, Math.max(1, Number(event.count) || 6));
  const withOrders = event.with_orders !== false;

  const sceneSubs = {};
  for (const s of sceneList) sceneSubs[s.code] = (s.options || []).filter((sub) => CONTENT[sub]);
  const scenesAvail = Object.keys(sceneSubs).filter((c) => sceneSubs[c].length > 0);
  if (!scenesAvail.length) return { ok: false, code: 'no_scene_content', msg: '场景文案库为空' };

  // 幂等: 一次性查已有 crid
  const dCrids = []; const oCrids = [];
  for (let i = 0; i < count; i++) dCrids.push(`nto-${i}`);
  for (let i = 0; i < (withOrders ? 2 : 0); i++) oCrids.push(`nto-ord-${i}`);

  // cleanup: 软删全部 nto-* 需求 + nto-ord-* 订单及配套(重跑修复时区等用)
  if (event.cleanup === true) {
    let cleanedD = 0, cleanedO = 0;
    try {
      const dr = await db.collection('demand').where({ client_request_id: db.RegExp({ regexp: '^nto-' }), is_deleted: false })
        .update({ data: { is_deleted: true, updated_at: now } });
      cleanedD = (dr.stats && dr.stats.updated) || 0;
    } catch (e) { /* ignore */ }
    let orderIds = [];
    try {
      const or = await db.collection('order_main').where({ client_request_id: _.in(oCrids), is_deleted: false }).field({ _id: true }).limit(100).get();
      orderIds = (or.data || []).map((x) => x._id);
    } catch (e) { /* ignore */ }
    if (orderIds.length) {
      try {
        const oUpd = await db.collection('order_main').where({ _id: _.in(orderIds) })
          .update({ data: { is_deleted: true, updated_at: now } });
        cleanedO = (oUpd.stats && oUpd.stats.updated) || 0;
      } catch (e) { /* ignore */ }
      await Promise.all(['order_confirmations', 'order_status_log'].map((c) =>
        db.collection(c).where({ order_id: _.in(orderIds) }).update({ data: { is_deleted: true, updated_at: now } }).catch(() => {})
      ));
    }
    return { ok: true, data: { cleaned_demands: cleanedD, cleaned_orders: cleanedO, hint: 'nto-* 夜间种子已软删' } };
  }

  let existingD = new Set(); let existingO = new Set();
  try {
    const [dr, or] = await Promise.all([
      db.collection('demand').where({ client_request_id: _.in(dCrids), is_deleted: _.neq(true) }).field({ client_request_id: true }).get(),
      db.collection('order_main').where({ client_request_id: _.in(oCrids), is_deleted: _.neq(true) }).field({ client_request_id: true }).get()
    ]);
    existingD = new Set((dr.data || []).map((x) => x.client_request_id));
    existingO = new Set((or.data || []).map((x) => x.client_request_id));
  } catch (e) { /* 查询失败则逐条幂等重试 */ }

  const p2 = (n) => String(n).padStart(2, '0');
  const genNo = (prefix) => {
    const d = new Date();
    return `${prefix}${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  };
  const genStart = () => {
    const hour = NIGHT_HOURS[Math.floor(Math.random() * NIGHT_HOURS.length)];
    const min = Math.floor(Math.random() * 56);
    return tomorrowBJStart + hour * 3600000 + min * 60000;
  };
  const genDoc = (i) => {
    const scene = scenesAvail[Math.floor(Math.random() * scenesAvail.length)];
    const sub = sceneSubs[scene][Math.floor(Math.random() * sceneSubs[scene].length)];
    const tpl = CONTENT[sub][0];
    const user = USERS[i % USERS.length];
    const place = pick(PLACES);
    return {
      scene, sub, tpl, duration_h: tpl[2] || 2, user, place,
      lat: +(30.58 + Math.random() * 0.16).toFixed(6),
      lng: +(104.03 + Math.random() * 0.12).toFixed(6),
      rate_fen: 4000 + Math.floor(Math.random() * 4000),
      start_time: genStart(),
      createdAt: now - Math.floor(Math.random() * 12 * 3600000) - 60000
    };
  };

  // ── 需求批次(matching, 广场可见, 抢单会被红线拦) ──
  const demands = [];
  for (let i = 0; i < count; i++) {
    if (existingD.has(`nto-${i}`)) continue;
    demands.push({ crid: `nto-${i}`, demand_no: genNo('DR'), ...genDoc(i) });
  }
  const BATCH = 10;
  let dCreated = 0;
  for (let b = 0; b < demands.length; b += BATCH) {
    const chunk = demands.slice(b, b + BATCH);
    const rs = await Promise.all(chunk.map((t) => db.collection('demand').add({
      data: {
        demand_no: t.demand_no, client_request_id: t.crid,
        creator_openid: t.user.openid, scene: t.scene, project_attr: 'commercial',
        start_time: t.start_time, duration_h: t.duration_h,
        location: { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' },
        publish_location: { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' },
        content_option: t.sub, content_options: [t.sub],
        remark: `${t.tpl[0]}｜${t.tpl[1]}`,
        rate_fen: t.rate_fen, total_fen: t.rate_fen * t.duration_h,
        aa_tier: '0-50', aa_promise_signed: true,
        disclaimer_type: 'general_disclaimer', disclaimer_signed: true, disclaimer_signed_at: t.createdAt,
        pet_auth_signed: false, pet_auth_signed_at: 0,
        match_mode: 'broadcast', applicants: [], matched_openid: null,
        status: 'matching', match_candidates: [], invited: [], broadcast: true,
        view_count: Math.floor(Math.random() * 60) + 5,
        expire_at: t.start_time + 2 * 3600000,   // 服务开始 2h 后失效
        created_at: t.createdAt, updated_at: t.createdAt, is_deleted: false
      }
    }).then(() => { dCreated++; }).catch((e) => { console.error('[night_orders] demand fail', e && e.message); })));
    await Promise.all(rs);
  }

  // ── 订单批次(2 条 S2 已支付, 服务时间凌晨, 测列表/详情展示) ──
  let oCreated = 0;
  if (withOrders) {
    // 取一个 approved 耍伴作 partner(考试过优先), 兜底固定测试号
    let partnerOpenid = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
    try {
      const pr = await db.collection('partner_profile').where({ status: 'approved', is_deleted: _.neq(true) }).limit(20).get();
      const p = (pr.data || []).find((x) => Number((x.exam_scores && x.exam_scores.base) || 0) >= 100) || (pr.data || [])[0];
      if (p && p.openid) partnerOpenid = p.openid;
    } catch (e) { /* 兜底测试号 */ }
    for (let i = 0; i < 2; i++) {
      if (existingO.has(`nto-ord-${i}`)) continue;
      const t = genDoc(100 + i);
      const orderNo = genNo('ORD');
      const demandNo = genNo('DR');
      const totalFen = t.rate_fen * t.duration_h;
      const feeFen = Math.round(totalFen * 1000 / 10000);
      const loc = { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' };
      const demandRes = await db.collection('demand').add({ data: {
        demand_no: demandNo, client_request_id: `nto-ord-${i}-d`,
        creator_openid: t.user.openid, scene: t.scene, project_attr: 'commercial',
        start_time: t.start_time, duration_h: t.duration_h,
        location: loc, publish_location: loc,
        content_option: t.sub, content_options: [t.sub],
        remark: `${t.tpl[0]}｜${t.tpl[1]}`,
        rate_fen: t.rate_fen, total_fen: totalFen,
        aa_tier: '0-50', aa_promise_signed: true,
        disclaimer_type: 'general_disclaimer', disclaimer_signed: true, disclaimer_signed_at: t.createdAt,
        pet_auth_signed: false, pet_auth_signed_at: 0,
        match_mode: 'broadcast', applicants: [], matched_openid: partnerOpenid,
        status: 'matched', matched_at: t.createdAt - 3600000,
        match_candidates: [], invited: [], broadcast: false,
        view_count: Math.floor(Math.random() * 30) + 5,
        expire_at: t.start_time + 2 * 3600000,
        created_at: t.createdAt, updated_at: t.createdAt, is_deleted: false
      }}).catch(() => {});
      if (!demandRes || !demandRes._id) continue;
      const orderRes = await db.collection('order_main').add({ data: {
        order_no: orderNo, demand_id: demandRes._id, demand_no: demandNo,
        user_openid: t.user.openid, partner_openid: partnerOpenid, scene: t.scene,
        start_time: t.start_time, duration_h: t.duration_h,
        location: loc, publish_location: loc,
        content_options: [t.sub],
        rate_fen: t.rate_fen, total_fen: totalFen, fee_fen: feeFen, partner_income_fen: totalFen - feeFen,
        headcount: 1, aa_tier: '0-50', aa_promise_signed: true,
        status: 'S2', pay_expire_at: t.start_time - 3600000, help_flag: false,
        take_distance_km: +(0.5 + Math.random() * 7).toFixed(1),
        client_request_id: `nto-ord-${i}`,
        created_at: t.createdAt, updated_at: t.createdAt, is_deleted: false
      }}).catch(() => {});
      if (!orderRes || !orderRes._id) continue;
      await Promise.all([
        db.collection('order_confirmations').add({ data: {
          order_id: orderRes._id,
          items: {
            time: { value: t.start_time, user_ok: true, partner_ok: true },
            location: { value: loc, user_ok: true, partner_ok: true },
            content: { value: [t.sub], user_ok: true, partner_ok: true },
            fee: { value: totalFen, user_ok: true, partner_ok: true }
          },
          version: 1, created_at: t.createdAt, updated_at: t.createdAt, is_deleted: false
        }}).catch(() => {}),
        db.collection('order_status_log').add({ data: {
          order_id: orderRes._id, from_status: null, to_status: 'S1',
          action: 'create_from_take', operator: partnerOpenid,
          created_at: t.createdAt, updated_at: t.createdAt, is_deleted: false
        }}).catch(() => {}),
        db.collection('order_status_log').add({ data: {
          order_id: orderRes._id, from_status: 'S1', to_status: 'S0',
          action: 'confirm_all', operator: t.user.openid,
          created_at: t.createdAt + 300000, updated_at: t.createdAt + 300000, is_deleted: false
        }}).catch(() => {}),
        db.collection('order_status_log').add({ data: {
          order_id: orderRes._id, from_status: 'S0', to_status: 'S2',
          action: 'mock_pay', operator: t.user.openid,
          created_at: t.createdAt + 600000, updated_at: t.createdAt + 600000, is_deleted: false
        }}).catch(() => {})
      ]);
      oCreated++;
    }
  }

  return { ok: true, data: { created_demands: dCreated, created_orders: oCreated, night_window: '00:00-06:00', hint: '服务时间在凌晨的夜间需求/订单已生成; 抢单会被 order_time_redline 拦截' } };
}

module.exports = { night_orders: run_night_orders };
