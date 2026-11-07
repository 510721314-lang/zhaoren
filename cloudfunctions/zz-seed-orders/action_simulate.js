// T-7.26(2026-11-07): 自 zz-seed-orders/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── simulate: 创建虚拟账号 + 每子场景 5 条真人感需求 ──

async function run_simulate(ctx) {
  const { event, db, _, openid, sceneList, simOpenids, USERS, CONTENT, PLACES, DAY_OFFSETS, HOURS, RATE_MIN, RATE_MAX, genDemandNo, pick } = ctx;

  const now = Date.now();

  // 0) 收集子场景候选 (scene, subIdx, sub, i)
  const subjects = [];
  for (const s of sceneList) {
    if (!Array.isArray(s.options)) continue;
    for (const sub of s.options) {
      if (!CONTENT[sub]) continue; // 无文案库的子场景跳过(数量制不对齐时安全降级)
      for (let i = 0; i < 5; i++) subjects.push({ s, sub, i });
    }
  }

  // 1) 幂等: 一次 in 查询已有 crid
  const allCrids = subjects.map((c, idx) => `sim-${c.sub}-${idx}`);
  let existingSet = new Set();
  try {
    const existRes = await db.collection('demand').where({ client_request_id: _.in(allCrids) }).field({ client_request_id: true }).get();
    existingSet = new Set((existRes.data || []).map((d) => d.client_request_id));
  } catch (e) { /* in 查询失败则逐条写入, 跳过不阻塞 */ }

  // 2) 虚拟账号幂等建(缺的补)
  let userAdded = 0;
  {
    const existU = await db.collection('user_account').where({ openid: _.in(simOpenids) }).field({ openid: true }).get().catch(() => ({ data: [] }));
    const have = new Set((existU.data || []).map((u) => u.openid));
    const missing = USERS.filter((u) => !have.has(u.openid));
    if (missing.length) {
      const createdDays = missing.map(() => Math.floor(Math.random() * 20) + 1);
      await Promise.all(missing.map((u, idx) => db.collection('user_account').add({ data: {
        openid: u.openid,
        nickname: u.nickname,
        surname: u.surname,
        status: 'normal',
        is_deleted: false,
        created_at: now - createdDays[idx] * 86400000,
        updated_at: now - createdDays[idx] * 86400000
      }}).catch(() => {})));
      userAdded = missing.length;
    }
  }

  // 3) 构造需求 docs 并并发写入
  const docs = [];
  subjects.forEach((c, idx) => {
    const crid = allCrids[idx];
    if (existingSet.has(crid)) return;
    const tpls = CONTENT[c.sub];
    const tpl = tpls[c.i % tpls.length];
    const [title, desc] = tpl;
    const duration_h = tpl[2] || 2;
    const user = USERS[idx % USERS.length];
    const dayOffset = DAY_OFFSETS[idx % DAY_OFFSETS.length];
    const hour = HOURS[idx % HOURS.length];
    const st = new Date(now + dayOffset * 86400000);
    st.setHours(hour, 15, 0, 0);
    const start_time = st.getTime();
    const rate_fen = RATE_MIN + Math.floor(Math.random() * (RATE_MAX - RATE_MIN));
    const lat = +(30.58 + Math.random() * 0.16).toFixed(6);
    const lng = +(104.03 + Math.random() * 0.12).toFixed(6);
    const place = pick(PLACES);
    const createdAt = now - Math.floor(Math.random() * 12 * 3600000) - 60000; // 1min-12h 前发布
    const viewCount = Math.floor(Math.random() * 90) + 3;
    docs.push({
      demand_no: genDemandNo(),
      client_request_id: crid,
      creator_openid: user.openid,
      scene: c.s.code,
      project_attr: 'commercial',
      start_time,
      duration_h,
      location: { name: place, latitude: lat, longitude: lng, city: '成都' },
      publish_location: { name: place, latitude: lat, longitude: lng, city: '成都' },
      content_option: c.sub,
      content_options: [c.sub],
      remark: `${title}｜${desc}`,
      rate_fen,
      total_fen: rate_fen * duration_h,
      aa_tier: '0-50',
      aa_promise_signed: true,
      disclaimer_type: 'general_disclaimer',
      disclaimer_signed: true,
      disclaimer_signed_at: now,
      pet_auth_signed: false,
      pet_auth_signed_at: 0,
      match_mode: 'broadcast',
      applicants: [],
      matched_openid: null,
      status: 'matching',
      match_candidates: [],
      invited: [],
      broadcast: true,
      view_count: viewCount,
      expire_at: now + 24 * 3600 * 1000,
      created_at: createdAt,
      updated_at: createdAt,
      is_deleted: false
    });
  });

  const created = [];
  const BATCH = 20;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map((doc) =>
      db.collection('demand').add({ data: doc })
        .then(() => doc.client_request_id)
        .catch((e) => {
          db.collection('platform_event').add({ data: {
            level: 'P3', type: 'seed_fail', openid,
            payload: { crid: doc.client_request_id, message: String((e && e.message) || e) },
            created_at: Date.now(), updated_at: Date.now(), is_deleted: false
          }}).catch(() => {});
          return null;
        })
    ));
    for (const r of results) if (r) created.push(r);
  }

  return { ok: true, data: { created: created.length, skipped: subjects.length - created.length, user_added: userAdded, subjects: subjects.length, users: USERS.length } };
}

module.exports = { simulate: run_simulate };
