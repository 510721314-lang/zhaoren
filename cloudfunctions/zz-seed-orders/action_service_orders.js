// T-7.26(2026-11-07): 自 zz-seed-orders/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── service_orders: 生成「正在服务时段」的履约中(S3)订单 ──
// 用途: 耍伴工作台/订单列表「进行中」测试——订单已开服(start_time 在过去), 未到结束时间
// partner 默认自动识别: status=approved 且基础科目考试已通过(exam_scores.base>=100)的耍伴, 每人 count 单
// 可传 partner_openid 指定单个耍伴; 幂等(client_request_id), 重复调用只补缺失

async function run_service_orders(ctx) {
  const { event, db, _, sceneList, CONTENT, USERS, PLACES, pick } = ctx;

  const now = Date.now();
  let partners = [];
  if (event.partner_openid) {
    partners = [String(event.partner_openid)];
  } else {
    const pr = await db.collection('partner_profile').where({ status: 'approved', is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
    partners = (pr.data || [])
      .filter((p) => Number((p.exam_scores && p.exam_scores.base) || 0) >= 100)
      .map((p) => p.openid);
  }
  if (!partners.length) return { ok: false, code: 'no_exam_partner', msg: '未找到考试基础科目已通过的耍伴, 可传 partner_openid 指定' };
  const count = Math.min(10, Math.max(1, Number(event.count) || 5));
  partners = partners.slice(0, 5);

  // scene → 子场景文案候选(复用 CONTENT 库 + admin_config.scene_list)
  const sceneSubs = {};
  for (const s of sceneList) sceneSubs[s.code] = (s.options || []).filter((sub) => CONTENT[sub]);
  const scenesAvail = Object.keys(sceneSubs).filter((c) => sceneSubs[c].length > 0);
  if (!scenesAvail.length) return { ok: false, code: 'no_scene_content', msg: '场景文案库为空' };

  // 幂等: 一次 in 查询已有 crid(订单维度), 避免重试重复建单
  const allCrids = [];
  const taskOf = {};
  for (const p of partners) {
    const tail = p.slice(-6);
    for (let i = 0; i < count; i++) {
      const crid = `svo-${tail}-${i}`;
      allCrids.push(crid);
      taskOf[crid] = { partner: p, i };
    }
  }
  let existingSet = new Set();
  try {
    const er = await db.collection('order_main').where({ client_request_id: _.in(allCrids) }).field({ client_request_id: true }).get();
    existingSet = new Set((er.data || []).map((d) => d.client_request_id));
  } catch (e) { /* in 查询失败则逐条重试, 靠 crid 幂等修订 */ }

  // 预构建任务
  const tasks = [];
  allCrids.forEach((crid) => {
    if (existingSet.has(crid)) return;
    const { partner, i } = taskOf[crid];
    const scene = scenesAvail[Math.floor(Math.random() * scenesAvail.length)];
    const sub = sceneSubs[scene][Math.floor(Math.random() * sceneSubs[scene].length)];
    const tpl = CONTENT[sub][0];
    const duration_h = tpl[2] || 2;
    const user = USERS[(i + Math.floor(Math.random() * 8)) % USERS.length];
    const place = pick(PLACES);
    const lat = +(30.58 + Math.random() * 0.16).toFixed(6);
    const lng = +(104.03 + Math.random() * 0.12).toFixed(6);
    const rate_fen = 4000 + Math.floor(Math.random() * 4000);
    const total_fen = rate_fen * duration_h;
    const fee_fen = Math.round(total_fen * 1000 / 10000);   // 平台费率默认 10%
    const partner_income_fen = total_fen - fee_fen;
    const svcStart = now - (20 + Math.floor(Math.random() * 30)) * 60000;   // 已开服 20-50 分钟(服务时段进行中)
    const createdAt = now - 3 * 3600000;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const demandNo = `DR${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    // 订单号与线上一致: 纯数字 yyyymmdd + 12 位随机数字 = 20 位(2026-10-21 起)
    const orderNo = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
    tasks.push({ crid, partner, i, scene, sub, tpl, duration_h, user, place, lat, lng, rate_fen, total_fen, fee_fen, partner_income_fen, svcStart, createdAt, demandNo, orderNo });
  });
  const skipped = allCrids.length - tasks.length;

  // 阶段A: 并发写需求(已匹配), 拿 demandId
  const BATCH = 10;
  for (let b = 0; b < tasks.length; b += BATCH) {
    const chunk = tasks.slice(b, b + BATCH);
    const rs = await Promise.all(chunk.map((t) => db.collection('demand').add({
      data: {
        demand_no: t.demandNo, client_request_id: t.crid + '-d',
        creator_openid: t.user.openid, scene: t.scene, project_attr: 'commercial',
        start_time: t.svcStart, duration_h: t.duration_h,
        location: { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' },
        publish_location: { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' },
        content_option: t.sub, content_options: [t.sub],
        remark: `${t.tpl[0]}｜${t.tpl[1]}`,
        rate_fen: t.rate_fen, total_fen: t.total_fen,
        aa_tier: '0-50', aa_promise_signed: true,
        disclaimer_type: 'general_disclaimer', disclaimer_signed: true, disclaimer_signed_at: t.createdAt,
        pet_auth_signed: false, pet_auth_signed_at: 0,
        match_mode: 'broadcast', applicants: [], matched_openid: t.partner,
        status: 'matched', matched_at: t.createdAt,
        match_candidates: [], invited: [], broadcast: false,
        view_count: Math.floor(Math.random() * 60) + 5,
        expire_at: t.svcStart + 6 * 3600000,
        created_at: t.createdAt, updated_at: now - 30 * 60000, is_deleted: false
      }
    }).then((r) => ({ t, demandId: r._id }))
      .catch((e) => { console.error('[service_orders] demand add fail', e && e.message); return { t, demandId: '' }; })));
    // 阶段B: 并发写订单(S3 履约中)
    await Promise.all(rs.filter((x) => x.demandId).map(({ t, demandId }) => {
      const orderData = {
        order_no: t.orderNo, demand_id: demandId, demand_no: t.demandNo,
        user_openid: t.user.openid, partner_openid: t.partner, scene: t.scene,
        start_time: t.svcStart, service_started_at: t.svcStart, duration_h: t.duration_h,
        location: { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' },
        publish_location: { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' },
        content_options: [t.sub],
        rate_fen: t.rate_fen, total_fen: t.total_fen, fee_fen: t.fee_fen, partner_income_fen: t.partner_income_fen,
        headcount: 1, aa_tier: '0-50', aa_promise_signed: true,
        status: 'S3', pay_expire_at: null, help_flag: false,
        take_distance_km: +(0.5 + Math.random() * 7).toFixed(1),
        client_request_id: t.crid,
        created_at: t.createdAt, updated_at: now - 30 * 60000, is_deleted: false
      };
      if (t.scene === 'W1') orderData.insurance = { policy_no: 'INS' + now + t.i, type: 'W1_caregiver', amount_fen: 5000000, is_mock: true, created_at: t.createdAt };
      return db.collection('order_main').add({ data: orderData })
        .then((or) => ({ t, orderId: or._id }))
        .catch((e) => { console.error('[service_orders] order add fail', e && e.message); return { t, orderId: '' }; });
    })).then((orRes) =>
      // 阶段C: 四确认(已全部确认)+状态流水(建单→待支付→已支付→履约中), 失败不阻断
      Promise.all(orRes.filter((x) => x.orderId).map(({ t, orderId }) => {
        const itemLoc = { name: t.place, latitude: t.lat, longitude: t.lng, city: '成都' };
        const writes = [
          db.collection('order_confirmations').add({ data: {
            order_id: orderId,
            items: {
              time: { value: t.svcStart, user_ok: true, partner_ok: true },
              location: { value: itemLoc, user_ok: true, partner_ok: true },
              content: { value: [t.sub], user_ok: true, partner_ok: true },
              fee: { value: t.total_fen, user_ok: true, partner_ok: true }
            },
            version: 1, created_at: t.createdAt, updated_at: t.createdAt, is_deleted: false
          }}).catch(() => {})
        ];
        const logs = [
          { from: null, to: 'S1', act: 'create_from_take', operator: t.partner, ts: t.createdAt },
          { from: 'S1', to: 'S0', act: 'confirm_all', operator: t.user.openid, ts: t.createdAt + 600000 },
          { from: 'S0', to: 'S2', act: 'mock_pay', operator: t.user.openid, ts: t.createdAt + 1200000 },
          { from: 'S2', to: 'S3', act: 'start_service', operator: t.partner, ts: t.svcStart }
        ];
        logs.forEach((lg) => writes.push(db.collection('order_status_log').add({ data: {
          order_id: orderId, from_status: lg.from, to_status: lg.to,
          action: lg.act, operator: lg.operator,
          created_at: lg.ts, updated_at: lg.ts, is_deleted: false
        }}).catch(() => {})));
        return Promise.all(writes).then(() => 1);
      })).then(() => rs)
    );
  }

  const created = tasks.length;   // 批次内全部写入(阶段A追加成功)
  return { ok: true, data: { created, skipped, partners, count, hint: 'S3 履约中订单已生成, 耍伴工作台/订单列表「进行中」刷新可见' } };
}

module.exports = { service_orders: run_service_orders };
