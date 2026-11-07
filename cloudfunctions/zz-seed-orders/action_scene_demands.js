// T-7.26(2026-11-07): 自 zz-seed-orders/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── scene_demands: 生成 N 条匹配中需求(默认排除 W9 宠物陪伴), 供场景测试 ──
// 用途: 广场/首页/附近按场景浏览与抢单链路测试; 服务时间在未来 1-5 天白天时段(避开夜间红线)
// 参数: per=每场景(或 per_sub=true 时每子场景)单数; owner_openid=指定发布人(缺省用虚拟账号轮流)
// 幂等: client_request_id = sdm-{scene}-{sub}-{i}(传 force_date 时追加 -{日期} 后缀); cleanup=true 软删全部 sdm-* 需求

async function run_scene_demands(ctx) {
  const { event, db, _, sceneList, CONTENT, USERS, PLACES, DAY_OFFSETS, RATE_MIN, RATE_MAX, genDemandNo, pick, softDeleteAll } = ctx;

  const now = Date.now();
  const per = Math.min(100, Math.max(1, Number(event.per) || 3));   // 2026-10-17: 上限 10→100(造数用; 默认调用不受影响)
  const perSub = event.per_sub === true;   // true: 每个子场景 per 单; false: 每场景 per 单(子场景轮流)
  const owner = event.owner_openid ? String(event.owner_openid) : '';  // 指定则以该用户名义发布需求
  // 2026-10-17: 可选参数 —— radius_m 半径(米)/force_date 固定履约日(YYYY-MM-DD)/hours 履约时段/limit 总条数上限; 均不传则走原逻辑
  const radiusM = Math.max(0, Number(event.radius_m) || 0);
  const forceRaw = event.force_date ? String(event.force_date).trim() : '';
  const forceDate = /^\d{4}-\d{2}-\d{2}$/.test(forceRaw) ? forceRaw : '';
  const LIMIT = Math.max(0, Number(event.limit) || 0);
  let exSet = new Set(['W9']);
  if (event.exclude_scenes) {
    const arr = Array.isArray(event.exclude_scenes) ? event.exclude_scenes : String(event.exclude_scenes).split(',');
    exSet = new Set(arr.map((s) => String(s).trim()).filter(Boolean));
  }
  const targets = sceneList.filter((s) => !exSet.has(s.code) && (s.options || []).some((sub) => CONTENT[sub]));

  if (event.cleanup === true) {
    let cleaned = 0, pass = 0;
    const cre = db.RegExp({ regexp: '^sdm-' });
    // 集合收缩时 skip 分页会漏删, 循环软删直至 0(与 cleanup_sim 历史教训一致)
    while (pass < 10) {
      const n = await softDeleteAll('demand', { client_request_id: cre, is_deleted: false }, 'is_deleted');
      cleaned += n;
      if (n === 0) break;
      pass++;
    }
    return { ok: true, data: { cleaned_demands: cleaned, hint: 'sdm-* 场景种子已软删' } };
  }

  // 幂等: 一次 in 查询已有 crid(需求维度)
  const allCrids = [];
  const slotOf = {};
  const dateTag = forceDate ? `-${forceDate}` : '';   // 2026-10-17: 指定履约日时 crid 带日期后缀, 便于定向清理且不与既有种子撞号
  for (const s of targets) {
    const subs = (s.options || []).filter((sub) => CONTENT[sub]);
    if (perSub) {
      for (const sub of subs) {
        for (let i = 0; i < per; i++) {
          const crid = `sdm-${s.code}-${sub}-${i}${dateTag}`;
          allCrids.push(crid);
          slotOf[crid] = { s, sub, i };
        }
      }
    } else {
      for (let i = 0; i < per; i++) {
        const crid = `sdm-${s.code}-${i}${dateTag}`;
        allCrids.push(crid);
        slotOf[crid] = { s, sub: subs[i % subs.length], i };
      }
    }
  }
  if (LIMIT && allCrids.length > LIMIT) allCrids.length = LIMIT;   // 2026-10-17: 总条数上限
  let existingSet = new Set();
  try {
    const er = await db.collection('demand').where({ client_request_id: _.in(allCrids), is_deleted: _.neq(true) }).field({ client_request_id: true }).get();
    existingSet = new Set((er.data || []).map((d) => d.client_request_id));
  } catch (e) { /* in 查询失败则逐条写入, 幂等靠 crid 修订 */ }

  // 虚拟账号幂等补齐(缺失才建)
  try {
    const existU = await db.collection('user_account').where({ openid: _.in(USERS.map((u) => u.openid)) }).field({ openid: true }).get().catch(() => ({ data: [] }));
    const have = new Set((existU.data || []).map((u) => u.openid));
    const missing = USERS.filter((u) => !have.has(u.openid));
    if (missing.length) {
      await Promise.all(missing.map((u) => db.collection('user_account').add({ data: {
        openid: u.openid, nickname: u.nickname, surname: u.surname,
        status: 'normal', is_deleted: false,
        created_at: now, updated_at: now
      }}).catch(() => {})));
    }
  } catch (e) { /* 创建失败不阻断 */ }

  // ── owner 位置中心: 显式 owner_location 优先; 否则取该用户最近一次发布的真实需求位置(近似"当前位置") ──
  let center = null;
  if (owner) {
    const ol = event.owner_location || null;
    if (ol && isFinite(Number(ol.lat)) && isFinite(Number(ol.lng))) {
      center = { lat: Number(ol.lat), lng: Number(ol.lng), name: ol.name || '我的位置', city: ol.city || '成都' };
    } else {
      try {
        // 取最近发布的真实需求位置(排除本工具生成的 sdm-* 种子, 否则中心退化为随机坐标)
        const lr = await db.collection('demand').where({ creator_openid: owner, is_deleted: _.neq(true) })
          .orderBy('created_at', 'desc').limit(5).get();
        const ld = ((lr.data || []).find((x) => !(x.client_request_id && String(x.client_request_id).startsWith('sdm-')))) || null;
        if (ld && ld.location && isFinite(Number(ld.location.latitude)) && Number(ld.location.latitude) !== 0) {
          center = {
            lat: Number(ld.location.latitude), lng: Number(ld.location.longitude),
            name: (ld.location && ld.location.name) || '我的位置',
            city: (ld.location && ld.location.city) || '成都'
          };
        }
      } catch (e) { /* 取不到则回退成都随机 */ }
    }
  }
  // 城市与坐标可能不符(历史数据 city 存错): 显式 owner_city 优先修正
  if (center && event.owner_city) center.city = String(event.owner_city).trim();

  // 构造需求 docs
  const docs = [];
  // 北京时段: 白天 9-18 点(避 00:00-06:00 夜间红线); bjDayStart = 北京今天 00:00 的 UTC 时间戳
  const bjDayStart = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  const BJ_HOURS = (Array.isArray(event.hours) && event.hours.length) ? event.hours : [9, 11, 14, 16, 18];
  // 2026-10-17: force_date 存在时履约日固定为该日(北京时区), 不再用「今天+dayOffset」
  let forceDayStart = null;
  if (forceDate) { const [fy, fm, fd] = forceDate.split('-').map(Number); forceDayStart = Date.UTC(fy, fm - 1, fd) - 8 * 3600000; }
  allCrids.forEach((crid) => {
    if (existingSet.has(crid)) return;
    const { s, sub, i } = slotOf[crid];
    const tpl = CONTENT[sub][i % CONTENT[sub].length];
    const duration_h = tpl[2] || 2;
    const user = USERS[i % USERS.length];
    const dayOffset = DAY_OFFSETS[i % DAY_OFFSETS.length];   // 未来 1-5 天
    const hourBJ = BJ_HOURS[i % BJ_HOURS.length];             // 北京白天时段 9-18 点
    const start_time = (forceDayStart !== null)
      ? forceDayStart + BJ_HOURS[i % BJ_HOURS.length] * 3600000 + 15 * 60000
      : bjDayStart + dayOffset * 86400000 + hourBJ * 3600000 + 15 * 60000;
    const rate_fen = RATE_MIN + Math.floor(Math.random() * (RATE_MAX - RATE_MIN));
    // owner 位置中心小偏移模拟周边; 2026-10-17: 传 radius_m 时改为「半径米内圆域随机(极坐标采样)」, 不传维持原 ±0.01°(≈1km); 无 center 回退成都随机
    let lat; let lng;
    if (center) {
      if (radiusM) {
        const rr = Math.sqrt(Math.random()) * radiusM;   // 半径 rr 圆域均匀采样 → 距圆心必 ≤ radius_m
        const th = Math.random() * Math.PI * 2;
        lat = +(center.lat + (rr * Math.cos(th)) / 111320).toFixed(6);
        lng = +(center.lng + (rr * Math.sin(th)) / (111320 * Math.cos(center.lat * Math.PI / 180))).toFixed(6);
      } else {
        lat = +(center.lat + (Math.random() - 0.5) * 0.02).toFixed(6);
        lng = +(center.lng + (Math.random() - 0.5) * 0.02).toFixed(6);
      }
    } else {
      lat = +(30.58 + Math.random() * 0.16).toFixed(6);
      lng = +(104.03 + Math.random() * 0.12).toFixed(6);
    }
    const place = center ? center.name : pick(PLACES);
    const city = center ? center.city : '成都';
    const createdAt = now - Math.floor(Math.random() * 6 * 3600000) - 60000;
    docs.push({
      demand_no: genDemandNo(),
      client_request_id: crid,
      creator_openid: owner || user.openid,
      scene: s.code,
      project_attr: 'commercial',
      start_time,
      duration_h,
      location: { name: place, latitude: lat, longitude: lng, city },
      publish_location: { name: place, latitude: lat, longitude: lng, city },
      content_option: sub,
      content_options: [sub],
      remark: `${tpl[0]}｜${tpl[1]}`,
      rate_fen,
      total_fen: rate_fen * duration_h,
      aa_tier: '0-50',
      aa_promise_signed: true,
      disclaimer_type: 'general_disclaimer',
      disclaimer_signed: true,
      disclaimer_signed_at: createdAt,
      pet_auth_signed: false,
      pet_auth_signed_at: 0,
      match_mode: 'broadcast',
      applicants: [],
      matched_openid: null,
      status: 'matching',
      match_candidates: [],
      invited: [],
      broadcast: true,
      view_count: Math.floor(Math.random() * 90) + 3,
      expire_at: start_time + duration_h * 3600000,   // 服务结束时间(覆盖完整服务时段)
      created_at: createdAt,
      updated_at: createdAt,
      is_deleted: false
    });
  });

  const created = [];
  const BATCH = 20;
  for (let i2 = 0; i2 < docs.length; i2 += BATCH) {
    const chunk = docs.slice(i2, i2 + BATCH);
    const results = await Promise.all(chunk.map((doc) =>
      db.collection('demand').add({ data: doc })
        .then(() => doc.client_request_id)
        .catch((e) => { console.error('[scene_demands] add fail', e && e.message); return null; })
    ));
    for (const r of results) if (r) created.push(r);
  }

  const byScene = {};
  for (const c of created) { const sc = c.split('-')[1]; byScene[sc] = (byScene[sc] || 0) + 1; }
  return { ok: true, data: { created: created.length, skipped: allCrids.length - created.length, per_scene: per, targets: targets.map((t) => t.code), by_scene: byScene, center: center || null, hint: '每场景 matching 需求已生成(除排除场景), 广场/首页/附近刷新可见' } };
}

module.exports = { scene_demands: run_scene_demands };
