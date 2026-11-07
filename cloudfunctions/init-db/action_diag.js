// T-7.26(2026-11-07): 自 init-db/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── 运维查询模式 ──
async function lookup(ctx) {
  const { event, db, SEED_CONFIG } = ctx;
  const _ = db.command;
  const names = Array.isArray(event.nicknames) ? event.nicknames : [];
  const openids = Array.isArray(event.openids) ? event.openids : [];
  const results = {};
  if (names.length) {
    for (const nick of names) {
      const r = await db.collection('user_account').where({
        nickname: nick, is_deleted: _.neq(true)
      }).limit(1).get();
      const u = r.data && r.data[0];   // where().get() 返回数组, 必须取 [0]
      results[nick] = u ? {
        openid: u.openid,
        roles: u.roles || [],
        partner_profile_exists: false,
        exam_scores: null
      } : null;
      if (u) {
        const pR = await db.collection('partner_profile').where({ openid: u.openid, is_deleted: _.neq(true) }).limit(1).get();
        const p = pR.data && pR.data[0];
        results[nick].partner_profile_exists = !!p;
        if (p) {
          results[nick].accept_scenes = p.accept_scenes || [];
          results[nick].exam_scores = p.exam_scores || null;
        }
      }
    }
  }
  return { ok: true, mode: 'lookup', results };
}

// ── 临时查询: 查 demand 最近 5 条 + admin_config 关键项 ──
async function quick_check(ctx) {
  const { event, db, SEED_CONFIG } = ctx;
  const _ = db.command;
  let demands = [];
  try {
    const dr = await db.collection('demand').where({ is_deleted: _.neq(true) })
      .orderBy('created_at', 'desc').limit(5).get();
    demands = (dr.data || []).map(d => ({
      _id: d._id.slice(0, 12) + '...',
      status: d.status, broadcast: d.broadcast, scene: d.scene,
      creator: d.creator_openid ? d.creator_openid.slice(0, 8) + '...' : '',
      expire_at: d.expire_at ? new Date(d.expire_at).toISOString().slice(0, 16) : '',
      created_at: d.created_at ? new Date(d.created_at).toISOString().slice(0, 16) : ''
    }));
  } catch (e) { demands = [{ error: e.message }]; }
  let cfg = {};
  try {
    const cr = await db.collection('admin_config').doc('global').get();
    const c = cr.data || {};
    cfg = {
      env: c.env,
      enabled_cities: c.enabled_cities || c.city,
      scene_list: c.scene_list || [],
      scene_count: (c.scene_list || []).length,
      seed_expected_codes: SEED_CONFIG.scene_list.map(s => s.code)
    };
  } catch (e) { cfg = { error: e.message }; }
  // 上线冻结检查: prod 下 mock 资金开关开启须提审/上线前关闭(硬校验)
  let mockGate = { env: 'prod', mock_payment_enabled: false, status: 'OK', hint: '' };
  try {
    const cr = await db.collection('admin_config').doc('global').get();
    const c = cr.data || {};
    const mockPay = !!c.mock_payment_enabled;
    mockGate = {
      env: c.env || 'prod',
      mock_payment_enabled: mockPay,
      status: (c.env ? c.env === 'prod' : true) && mockPay ? 'BLOCK' : 'OK',
      hint: mockPay ? '正式上线前必须将 admin_config.mock_payment_enabled 置回 false' : ''
    };
  } catch (e) { /* 读不到配置按 OK, 上线类检查以 config_get 为准 */ }
  return { ok: true, mode: 'quick_check', demands, config: cfg, mock_gate: mockGate };
}

// ── 临时: 按 openid 查 partner_profile 全部文档 ──
async function check_pp(ctx) {
  const { event, db } = ctx;
  const _ = db.command;
  const oid = event.openid;
  if (!oid) return { ok: false, msg: 'need openid' };
  const r = await db.collection('partner_profile').where({ openid: oid }).limit(20).get();
  return { ok: true, count: r.data.length, profiles: r.data.map(p => ({
    _id: p._id.slice(0, 12) + '...',
    status: p.status, is_deleted: p.is_deleted, accept_switch: p.accept_switch,
    accept_scenes: p.accept_scenes || [],
    exam_scores: p.exam_scores || null,
    updated_at: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 16) : ''
  })) };
}

module.exports = { lookup, quick_check, check_pp };
