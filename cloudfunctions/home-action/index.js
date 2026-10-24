// @VERIFIED 2026-10-13 已真机验证：场景/子场景显隐(visible/hidden_options)过滤统一在 scene_groups 出口+活动方形1:1卡片(标题trim非空才渲染)（依据：project_memory L78-82, L87-88, L207-208）
// home-action 首页概览 · 最新 BLOG / 最新需求 / 活跃注册用户 / 活跃耍伴
// 公开接口(不要求登录, 不返回隐私字段), 首页单次调用取全部四块数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

// 运营配置兜底: admin_config.scene_list 优先, 硬编码兜底(与 init-db 种子对齐)
const SCENE_FALLBACK = [
  { code: 'W1',  name: '就医陪诊' },
  { code: 'W2',  name: '学习陪伴' },
  { code: 'W8',  name: '生活协助' },
  { code: 'W10', name: '出行陪伴' },
  { code: 'W11', name: '线上陪伴' }
];

// 旧版 8 场景映射(兜底显示名, 不再作为首页分组依据; 规范源 _shared/scene_meta.js, 修改后跑 sync-scene-meta.ps1)
const { SCENE_NAMES: SCENE_NAMES_LEGACY } = require('./scene_meta');
const CONTENT_TRUNC = 60;

// 场景卡「服务项」展示上限(批3.2): admin_config.scene_option_display_max, 缺省 3, 收敛到 1..8。
// 展示层截断(与勾选上限 publish_content_options_max 不同语义)。
function sceneOptionDisplayMax(cfg) {
  const n = Number(cfg && cfg.scene_option_display_max);
  if (!Number.isFinite(n)) return 3;
  return Math.min(8, Math.max(1, Math.floor(n)));
}

// 集合自愈: 新环境首次调用自动建 blog 相关集合(demand/user_account/partner_profile 属已有核心集合, 不自动建)
let collectionsReady = null;
function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = (async () => {
      const names = ['blog_post', 'blog_comment', 'blog_like'];
      await Promise.all(names.map((n) =>
        db.createCollection(n).catch(() => {})
      ));
      return true;
    })();
  }
  return collectionsReady;
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// 每页条数常量(与场景配置无关)
const HOME_GROUP_SIZE = 8;     // 首页每场景展示条数
const SCENE_PAGE_SIZE = 50;    // 场景更多列表每页条数

// ─────────────────────────────────────────────────────────────
// 实例级短 TTL 内存缓存(云函数实例存活期有效; 多实例不共享, 命中即赚)
// 用途: admin_config 低频变更数据 + 访客维度场景分组, 把首页 2 RTT 降为 1 RTT
// ─────────────────────────────────────────────────────────────
const _mem = new Map();
const MEM_MAX = 200;
function memSet(key, val, ttlMs) {
  _mem.set(key, { val, until: Date.now() + ttlMs });
  if (_mem.size > MEM_MAX) {
    const oldest = _mem.keys().next().value;
    _mem.delete(oldest);
  }
}
function memGet(key) {
  const hit = _mem.get(key);
  if (hit && Date.now() < hit.until) return hit.val;
  if (hit) _mem.delete(key);
  return undefined;
}
// 异步 loader 记忆: 命中直接返回; 未命中执行 loader 并回种; loader 失败不污染缓存
async function memo(key, ttlMs, loader) {
  const cached = memGet(key);
  if (cached !== undefined) return cached;
  const val = await loader();
  memSet(key, val, ttlMs);
  return val;
}
const TTL_SCENE_LIST = 5 * 60 * 1000;   // 场景白名单 5min(与运营配置缓存惯例一致)
const TTL_ACT_RAW = 60 * 1000;          // 活动配置 60s
const TTL_SCENE_GROUPS = 60 * 1000;     // 访客维度场景分组 60s(tab 切回/二次进首页命中)

// 场景分组访客维度缓存 key(含身份与价格区间, 防耍伴间过滤结果串号)
function sceneGroupsCacheKey(openid, vRange) {
  return 'sg|' + (openid || 'guest') + '|' + (vRange ? vRange[0] + '-' + vRange[1] : 'all');
}

// 合法 jump_to 白名单 + 必填参数校验
// demand_publish → 可选 scene (jump_param.scene 无兜底也 ok, 前端有守卫)
// scene_list     → 可选 scene_code (无参数也能跳广场)
// activity_detail → 必填 id (jump_param.id 或顶层 id, 缺则前端 toast)
const VALID_JUMP_TO = {
  demand_publish: (a, p) => true,
  scene_list: (a, p) => true,
  activity_detail: (a, p) => !!(a.id || p.id)
};

// 活动配置过滤(首页 banner / 卡片), 与原 home_activity_list 口径一致
function pickActivities(raw, sceneCode) {
  const now = Date.now();
  const list = (raw || []).filter((a) => {
    if (a.status !== 'active') return false;
    if (a.start_at && now < a.start_at) return false;
    if (a.end_at && now > a.end_at) return false;
    if (sceneCode && a.scene_code && a.scene_code !== sceneCode) return false;
    // jump_to 白名单 + 必填参数校验(服务端过滤坏配置, 前端 banners/cards 空则整块不渲染)
    const jt = a.jump_to;
    if (!jt || !VALID_JUMP_TO[jt]) return false;
    const p = a.jump_param || {};
    if (!VALID_JUMP_TO[jt](a, p)) return false;
    return true;
  }).sort((a, b) => (b.priority || 0) - (a.priority || 0)).map((a) => ({
    id: a.id,
    // 统一 trim: 历史配置里出现「只填空格」的标题会让前端卡片渲染出空白正文区(2026-10-12 修)
    title: String(a.title || '').trim(),
    subtitle: String(a.subtitle || '').trim(),
    banner_image: a.banner_image || '',
    cover_image: a.cover_image || '',
    type: a.type,
    jump_to: a.jump_to,
    jump_param: a.jump_param || {}
  }));
  const banners = list.filter((a) => a.type === 'banner' || a.type === 'both').slice(0, 3);
  const cards = list.filter((a) => a.type === 'card' || a.type === 'both').slice(0, 4);
  return { banners, cards };
}

// home_activities 原始配置(60s 缓存)
async function loadHomeActivitiesRaw() {
  return memo('home_activities_raw', TTL_ACT_RAW, async () => {
    const cfgR = await col('admin_config').doc('global').get();
    return (cfgR.data && cfgR.data.home_activities) || [];
  });
}

// 运营配置: admin_config.scene_list 优先; 读取失败由外层兜底(且兜底值不进缓存)
// 返回: { scenes: [{code,name,disclaimer_type,builtin}], legal_scene_disclaimers: {code:text} }
async function loadSceneList() {
  // memo 只缓存「成功读取」的结果; loader 抛错时 memo 不回种,
  // 避免一次 admin_config 抖动把 5 场景兜底值缓存 5 分钟(场景收窄/自定义免责文案丢失)
  try {
    return await memo('scene_list', TTL_SCENE_LIST, async () => {
      const r = await col('admin_config').doc('global').get();
      const cfg = r.data;
      const legal = (cfg && cfg.legal_scene_disclaimers) || {};
      const optMax = sceneOptionDisplayMax(cfg);
      const raw = (cfg && Array.isArray(cfg.scene_list) && cfg.scene_list.length > 0)
        ? cfg.scene_list
        : SCENE_FALLBACK;
      // 注意: 这里只「透传」显隐字段, 不做过滤 —— scene_list 单场景分页与 nearby 白名单
      // 复用本函数返回值, 过滤会让隐藏场景的存量需求从附近/翻页里消失(与「仅前端隐藏入口」不符)。
      // 展示层过滤在 scene_groups / buildSceneGroups 出口做。
      const scenes = raw.filter((s) => s && s.code).map((s) => {
        const hidden = Array.isArray(s.hidden_options) ? s.hidden_options.slice() : [];
        // 前端只暴露前 N 个服务项(N = scene_option_display_max, 缺省 3) → 「先取前 N 再剔除隐藏项」; options 即「前端可见服务项」
        const options = (Array.isArray(s.options) ? s.options.slice(0, optMax) : []).filter((o) => hidden.indexOf(o) < 0);
        return {
          code: s.code,
          name: s.name || SCENE_NAMES_LEGACY[s.code] || s.code,
          options,
          disclaimer_type: s.disclaimer_type || 'general_disclaimer',
          builtin: !!s.builtin,
          visible: s.visible !== false,   // 缺省即可见
          hidden_options: hidden,
          disclaimer_text: legal[s.code] || ''
        };
      });
      return { scenes, legal_scene_disclaimers: legal };
    });
  } catch (e) {
    // 仅当次请求降级到 5 场景兜底, 不写缓存; 下次调用重新尝试读 admin_config
    return {
      scenes: SCENE_FALLBACK.map((s) => ({ ...s, disclaimer_type: 'general_disclaimer', builtin: true, disclaimer_text: '' })),
      legal_scene_disclaimers: {}
    };
  }
}

// 首页场景分组计算(9 场景 demand 并行查询 + 批量补姓氏), 结果按访客维度缓存 60s
async function buildSceneGroups(scenes, vRange) {
  const priceWhere = priceRangeWhere(vRange);
  const now = Date.now();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const sceneRs = await Promise.all(scenes.map((sceneDef) =>
    col('demand')
      .where(priceWhere ? _.and([ hallWhere({ scene: sceneDef.code }), priceWhere ]) : hallWhere({ scene: sceneDef.code }))
      .orderBy('created_at', 'desc')
      .limit(HOME_GROUP_SIZE + 1)
      .get()
      .catch(() => ({ data: [] }))
  ));
  const sceneGroups = [];
  sceneRs.forEach((r, i) => {
    const sceneDef = scenes[i];
    if (!sceneDef) return;
    const docs = r.data || [];
    const items = docs.slice(0, HOME_GROUP_SIZE).map((d) => mapDemand(d, now, pad));
    sceneGroups.push({
      scene_code: sceneDef.code,
      scene_name: sceneDef.name || SCENE_NAMES_LEGACY[sceneDef.code] || '',
      // 上游 loadSceneList 已完成「slice(0,3) → 剔除隐藏项」, 这里直接用(即前端可见服务项)
      scene_options: Array.isArray(sceneDef.options) ? sceneDef.options : [],
      scene_disclaimer_type: sceneDef.disclaimer_type || 'general_disclaimer',
      scene_disclaimer_text: sceneDef.disclaimer_text || '',
      scene_builtin: sceneDef.builtin === true,
      list: items,
      has_more: docs.length > HOME_GROUP_SIZE
    });
  });
  await fillPublisherSurname(sceneGroups.reduce((acc, g) => acc.concat(g.list), []));
  return sceneGroups;
}

// demand 文档 → 广场卡片视图模型(与原 square 内联映射保持一致)
function mapDemand(d, now, pad) {
  const remarkParts = String(d.remark || '').split('｜');
  const title = remarkParts[0] ? remarkParts[0].trim() : (d.content_options && d.content_options[0]) || '需求';
  const description = remarkParts[1] ? remarkParts[1].trim() : '';

  const dt = new Date(Number(d.start_time) + 8 * 3600 * 1000);
  const service_date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  const service_time = `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;

  const minutes_ago = Math.max(1, Math.floor((now - (d.created_at || now)) / 60000));

  return {
    _id: d._id,
    demand_no: d.demand_no,
    scene_code: d.scene,
    project_attr: d.project_attr || 'commercial',
    title,
    description,
    service_date,
    service_time,
    duration_hours: d.duration_h,
    location: d.location || { name: '' },
    district: (d.location && d.location.city) || '',
    distance_km: null,
    headcount: 1,
    pricing_type: d.pricing_type || 'hourly',
    budget: (d.pricing_type === 'fixed')
      ? Math.round((d.total_fen || 0) / 100)
      : Math.round((d.rate_fen || 0) / 100),
    aa_estimate: d.aa_tier || '0-50',
    status: d.status,
    match_mode: d.match_mode || 'broadcast',
    view_count: typeof d.view_count === 'number' ? d.view_count : 0,
    publisher: {
      surname: '匿',
      real_name_verified: true,
      minutes_ago,
      openid: d.creator_openid
    },
    created_at: d.created_at
  };
}

// 批量补发布者姓氏(就地修改)
async function fillPublisherSurname(list) {
  const openids = list.map((d) => d.publisher.openid).filter(Boolean);
  if (!openids.length) return;
  try {
    const uR = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get();
    const map = {};
    (uR.data || []).forEach((u) => { map[u.openid] = u; });
    list.forEach((d) => {
      const u = map[d.publisher.openid] || {};
      const name = u.surname || u.real_name || u.nickname || '';
      d.publisher.surname = name ? String(name).charAt(0) : '匿';
    });
  } catch (e) {}
}

// 公共大厅可接单需求过滤条件
function hallWhere(extra) {
  return Object.assign({
    is_deleted: false,
    status: 'matching',
    expire_at: _.gt(Date.now()),
    broadcast: true
  }, extra || {});
}

// 价格区间过滤下推: 时薪命中区间 OR 一口价单(fixed 的 rate_fen=null 会被时薪区间漏掉);
// 公益单归入 fixed 同样放行(豁免价格区间筛选); 未传 vRange → null(不过滤)
function priceRangeWhere(vRange) {
  if (!vRange) return null;
  return _.or([
    { rate_fen: _.gte(vRange[0] === null ? 0 : vRange[0]).and(_.lte(vRange[1] === null ? 99999999 : vRange[1])) },
    { pricing_type: 'fixed' }
  ]);
}

// 广场(抢单入口)访问者过滤数据: 接单价格区间 + 最大接单距离 + 日常位置(非耍伴/游客=不限)
// ⚠️ 仅用于 square; 首页宫格(scene_groups/scene_list)不按这些字段过滤 —— 首页是通用入口(含需求者视角)
let _visitorCache = {};                // openid → { at, val } 进程内短缓存
const VISITOR_TTL = 15 * 1000;   // 短缓存: 接单配置改完后尽快在广场生效
async function loadVisitorPartner(openid) {
  if (!openid) return null;            // 游客/匿名(如后台探针) → 不过滤, 且不产生查询
  const hit = _visitorCache[openid];
  if (hit && Date.now() - hit.at < VISITOR_TTL) return hit.val;
  let val = null;
  try {
    const r = await col('partner_profile').where({ openid, is_deleted: _.neq(true) }).limit(1).get();
    const p = (r.data && r.data[0]) || null;
    if (p && p.status === 'approved') {
      let range = null;
      const lo = (p.accept_rate_min_fen === undefined || p.accept_rate_min_fen === null) ? null : Number(p.accept_rate_min_fen);
      const hi = (p.accept_rate_max_fen === undefined || p.accept_rate_max_fen === null) ? null : Number(p.accept_rate_max_fen);
      if (lo !== null || hi !== null) range = [lo, hi];
      const md = Number(p.max_distance_km);
      const maxKm = (isFinite(md) && md > 0) ? md : null;
      const hl = p.home_location || {};
      const hLat = Number(hl.latitude), hLng = Number(hl.longitude);
      const home = (isFinite(hLat) && isFinite(hLng) && hLat !== 0 && hLng !== 0) ? { lat: hLat, lng: hLng } : null;
      val = { range, maxKm, home };
    }
  } catch (e) {}
  _visitorCache[openid] = { at: Date.now(), val };
  return val;
}

// 平台接单距离上限(admin_config.take_distance_max_km, 缺省 50km), 进程内 60s 缓存
let _capCache = { at: 0, km: 50 };
async function loadTakeDistanceCap() {
  if (Date.now() - _capCache.at < VISITOR_TTL) return _capCache.km;
  try {
    const r = await col('admin_config').doc('global').get();
    const km = Number(r.data && r.data.take_distance_max_km);
    _capCache = { at: Date.now(), km: (isFinite(km) && km > 0) ? km : 50 };
  } catch (e) { _capCache = { at: Date.now(), km: 50 }; }
  return _capCache.km;
}

// D2-3 防漂移抽取: 规范源 _shared/take_rules.js(修改后跑 sync-take-rules.ps1 同步四个函数)
// (原本地 asin 变体与规范 atan2 形式数学等价, 已统一)
const { haversineKm } = require('./take_rules');

// 物理拆分(2026-10-14): 各 action 组 handler 与 index 同级; 共享符号经 ctx 注入, handler 禁 require('./index')
const HANDLERS = Object.assign({},
  require('./action_feed'),
  require('./action_scene'),
  require('./action_nearby'),
  require('./action_misc'),
);

exports.main = async (event, context) => {
  try {
    await require('./openid').warmEnv(cloud); // 环境门控日志预热
    await ensureCollections();
    const action = event.action || 'overview';

    // 物理拆分分发: 命中 HANDLERS 的 action 走同级 handler(等价于原内联 case, 行为逐字不变)
    if (HANDLERS[action]) {
      const ctx = {
        event, action, cloud, db, _, col, log,
        SCENE_FALLBACK, SCENE_NAMES_LEGACY, CONTENT_TRUNC, HOME_GROUP_SIZE, SCENE_PAGE_SIZE,
        TTL_SCENE_GROUPS,
        sceneOptionDisplayMax, ensureCollections, truncate,
        memSet, memGet, memo, sceneGroupsCacheKey, pickActivities,
        loadHomeActivitiesRaw, loadSceneList, buildSceneGroups, mapDemand, fillPublisherSurname,
        hallWhere, priceRangeWhere, loadVisitorPartner, loadTakeDistanceCap, haversineKm
      };
      return await HANDLERS[action](ctx);
    }

    switch (action) {

      default:
        return { ok: false, code: 'home_unknown_action', msg: '未知动作' };
    }
  } catch (e) {
    log.d('home-action unhandled:', e && e.message);
    return { ok: false, code: 'home_server_error', msg: '服务繁忙,请稍后重试' };
  }
};
