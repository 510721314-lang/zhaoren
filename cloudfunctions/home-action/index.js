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

// 旧版 8 场景映射(兜底显示名, 不再作为首页分组依据)
const SCENE_NAMES_LEGACY = {
  W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴',
  W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴'
};
const CONTENT_TRUNC = 60;

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

// 活动配置过滤(首页 banner / 卡片), 与原 home_activity_list 口径一致
function pickActivities(raw, sceneCode) {
  const now = Date.now();
  const list = (raw || []).filter((a) => {
    if (a.status !== 'active') return false;
    if (a.start_at && now < a.start_at) return false;
    if (a.end_at && now > a.end_at) return false;
    if (sceneCode && a.scene_code && a.scene_code !== sceneCode) return false;
    return true;
  }).sort((a, b) => (b.priority || 0) - (a.priority || 0)).map((a) => ({
    id: a.id,
    title: a.title,
    subtitle: a.subtitle || '',
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
      const raw = (cfg && Array.isArray(cfg.scene_list) && cfg.scene_list.length > 0)
        ? cfg.scene_list
        : SCENE_FALLBACK;
      const scenes = raw.filter((s) => s && s.code).map((s) => ({
        code: s.code,
        name: s.name || SCENE_NAMES_LEGACY[s.code] || s.code,
        options: Array.isArray(s.options) ? s.options.slice(0, 3) : [],
        disclaimer_type: s.disclaimer_type || 'general_disclaimer',
        builtin: !!s.builtin,
        disclaimer_text: legal[s.code] || ''
      }));
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
      scene_options: Array.isArray(sceneDef.options) ? sceneDef.options.slice(0, 3) : [],
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

exports.main = async (event, context) => {
  try {
    await require('./openid').warmEnv(cloud); // 环境门控日志预热
    await ensureCollections();
    const action = event.action || 'overview';

    switch (action) {

      // ───────── 首页概览(一次返回四块) ─────────
      case 'overview': {
        // 观看者(耍伴)身份: 供耍伴推荐卡计算距离(与 square/nearby 同口径)
        const vOpenid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vPartner = await loadVisitorPartner(vOpenid);
        // 4 个独立查询并行执行(原串行 250-500ms → 并行 ~100ms)
        const [blogR, demandR, userR, partnerR] = await Promise.all([
          col('blog_post')
            .where({ status: 'normal', is_deleted: false })
            .orderBy('created_at', 'desc')
            .limit(3)
            .get()
            .catch(() => ({ data: [] })),
          col('demand')
            .where({ is_deleted: false, status: _.neq('cancelled') })
            .orderBy('created_at', 'desc')
            .limit(3)
            .get()
            .catch(() => ({ data: [] })),
          col('user_account')
            .where({
              is_deleted: _.neq(true),
              status: _.in(['normal', 'banned', 'frozen']),
              register_source: _.neq('phone_pending')
            })
            .orderBy('created_at', 'desc')
            .limit(5)
            .get()
            .catch(() => ({ data: [] })),
          col('partner_profile')
            .where({ status: 'approved', is_deleted: _.neq(true) })
            .orderBy('created_at', 'desc')
            .limit(20)
            .get()
            .catch(() => ({ data: [] }))
        ]);

        const partnerOpenids = (partnerR.data || []).map((p) => p.openid).filter(Boolean);
        const partnerUserMap = {};
        if (partnerOpenids.length) {
          const puR = await col('user_account')
            .where({ openid: _.in(partnerOpenids) })
            .limit(partnerOpenids.length)
            .get()
            .catch(() => ({ data: [] }));
          (puR.data || []).forEach((u) => { partnerUserMap[u.openid] = u; });
        }
        const partnerList = (partnerR.data || [])
          .map((p) => {
            const u = partnerUserMap[p.openid] || {};
            const item = {
              openid: p.openid,
              nickname: u.nickname || '耍伴',
              avatar: u.avatar || '',
              city: (p.city && p.city[0]) || '',
              accept_scenes: p.accept_scenes || [],
              partner_credit_score: u.partner_credit_score || 0,
              bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
              skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || []
            };
            // 距离: 观看者(耍伴)home_location ↔ 目标耍伴home_location
            if (vPartner && vPartner.home) {
              const hl = p.home_location || {};
              const lat = Number(hl.latitude), lng = Number(hl.longitude);
              if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
                item.distance_km = Math.round(haversineKm(vPartner.home.lat, vPartner.home.lng, lat, lng) * 10) / 10;
              }
            }
            return item;
          })
          .sort((a, b) => b.partner_credit_score - a.partner_credit_score)
          .slice(0, 5);

        return {
          ok: true,
          data: {
            blogs: (blogR.data || []).map((p) => ({
              _id: p._id,
              author_nickname: p.author_nickname || '微信用户',
              author_avatar: p.author_avatar || '',
              content: truncate(p.content, CONTENT_TRUNC),
              cover: (p.images && p.images[0]) || '',
              tags: p.tags || [],
              scene: p.scene || '',
              like_count: p.like_count || 0,
              created_at: p.created_at
            })),
            demands: (demandR.data || []).map((d) => ({
              _id: d._id,
              demand_no: d.demand_no,
              scene: d.scene,
              scene_name: SCENE_NAMES_LEGACY[d.scene] || d.scene || '',
              content_options: d.content_options || (d.content_option ? [d.content_option] : []),
              location_name: (d.location && d.location.name) || '',
              pricing_type: d.pricing_type || 'hourly',
              rate_fen: d.rate_fen || 0,
              start_time: d.start_time,
              created_at: d.created_at
            })),
            users: (userR.data || []).map((u) => ({
              openid: u.openid || '',
              nickname: u.nickname || '微信用户',
              avatar: u.avatar || '',
              created_at: u.created_at
            })),
            partners: partnerList
          }
        };
      }

      // ───────── 需求广场列表 + 耍伴推荐 ─────────
      case 'square': {
        const limit = Math.min(Number(event.limit) || 20, 50);
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 价格区间过滤(耍伴在接单配置设的区间; 非耍伴/游客/未设置 → 不过滤)
        // 过滤条件下推到 DB(而非 JS 侧过滤), 保证 limit 仍能取满
        const openid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(openid);
        const vRange = vp && vp.range;
        const priceWhere = priceRangeWhere(vRange);

        // 自己的需求恒可见: 发布者(无论当前前端身份)总能看见自己刚发布的需求,
        // 不受自身耍伴接单配置(价格区间/接单距离)过滤; 他人视角仍按接单配置过滤
        const ownWhere = openid ? Object.assign(hallWhere(), { creator_openid: openid }) : null;
        const hallWithPrice = priceWhere ? _.and([ hallWhere(), priceWhere ]) : hallWhere();
        const squareWhere = ownWhere ? _.or([hallWithPrice, ownWhere]) : hallWithPrice;

        // 轻量并行: demand + partner + active_user, 不查 scene_groups(5个额外查询导致冷启动超时,
        // 场景分组改由 scene_groups action 单独懒加载)
        // S1/S2 性能: banner 活动配置(admin_config 主键读, 60s 实例缓存)同时点火,
        // 与主查询并行; 冷 miss 时也不把这次 RTT 串行叠加到响应尾部
        const activitiesP = loadHomeActivitiesRaw().catch(() => []);
        const [demandR, partnerR, activeUserR] = await Promise.all([
          col('demand')
            .where(squareWhere)
            .orderBy('created_at', 'desc')
            .limit(limit)
            .get()
            .catch(() => ({ data: [] })),
          col('partner_profile')
            .where({ status: 'approved', is_deleted: _.neq(true) })
            .orderBy('created_at', 'desc')
            .limit(20)
            .get()
            .catch(() => ({ data: [] })),
          // 断链②修复(第三批爽约): 停用中用户不进入活跃用户栏(推荐栏为白名单 in 查询, suspended 天然不在内)
          col('user_account')
            .where({ is_deleted: _.neq(true), status: _.nin(['frozen', 'banned', 'closed', 'suspended']) })
            .orderBy('created_at', 'desc')
            .limit(20)
            .get()
            .catch(() => ({ data: [] }))
        ]);

        // 活跃用户横滑栏(图4): 头像+昵称, 不泄露手机号/openid 以外敏感信息
        const activeUsers = (activeUserR.data || []).map((u) => ({
          openid: u.openid || '',
          nickname: u.nickname || '微信用户',
          avatar: (u.avatar && /^https?:/.test(u.avatar)) ? u.avatar : '',
          created_at: u.created_at || 0
        })).filter((u) => !!u.openid).slice(0, 10);

        let list = (demandR.data || []).map((d) => mapDemand(d, now, pad));

        // S3 性能: 耍伴昵称查询提前发起(不 await), 与下方距离过滤/fillPublisherSurname 并行,
        // 消除 square 内一次串行 DB RTT
        const partnerOpenids = (partnerR.data || []).map((p) => p.openid).filter(Boolean);
        const puPromise = partnerOpenids.length
          ? col('user_account').where({ openid: _.in(partnerOpenids) }).limit(partnerOpenids.length).get().catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] });

        // 最大接单距离(接单配置设置): 参考耍伴日常位置计算并回填 distance_km;
        // 已设置且超出 min(设置, 平台上限) 的需求不在广场展示(与接单时服务端校验对齐)
        // 例外: 自己的需求(ownWhere 已并入)恒可见, 距离过滤时跳过, 但照常回填 distance_km 供展示
        if (vp && vp.home) {
          const effMaxKm = vp.maxKm ? Math.min(vp.maxKm, await loadTakeDistanceCap()) : null;
          const kept = [];
          (demandR.data || []).forEach((d, i) => {
            const site = d.location || {};
            const lat = Number(site.latitude), lng = Number(site.longitude);
            if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
              const km = Math.round(haversineKm(vp.home.lat, vp.home.lng, lat, lng) * 10) / 10;
              list[i].distance_km = km;
              if (effMaxKm !== null && km > effMaxKm && d.creator_openid !== openid) return;
            }
            kept.push(list[i]);
          });
          list = kept;
        }
        await fillPublisherSurname(list);

        // 耍伴推荐: partner_profile + user_account 昵称
        let partnerList = [];
        try {
          const partnerUserMap = {};
          const puR = await puPromise;
          (puR.data || []).forEach((u) => { partnerUserMap[u.openid] = u; });
          partnerList = (partnerR.data || [])
            .map((p) => {
              const u = partnerUserMap[p.openid] || {};
              const avatar = (u.avatar && /^https?:/.test(u.avatar)) ? u.avatar : '';
              const item = {
                openid: p.openid,
                nickname: u.nickname || '耍伴',
                avatar,
                city: (p.city && p.city[0]) || '',
                accept_scenes: p.accept_scenes || [],
                partner_credit_score: u.partner_credit_score || 0,
                certified_scenes: p.certified_scenes || [],
                // 耍伴资料: 只读审核通过快照(fail-closed); 卡片只取 bio, 详情页另有 detail 接口给全量
                bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
                skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || []
              };
              // 距离: 观看者(耍伴)home_location ↔ 目标耍伴home_location, 与 nearby/广场需求同口径
              if (vp && vp.home) {
                const hl = p.home_location || {};
                const lat = Number(hl.latitude), lng = Number(hl.longitude);
                if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
                  item.distance_km = Math.round(haversineKm(vp.home.lat, vp.home.lng, lat, lng) * 10) / 10;
                }
              }
              return item;
            })
            .filter((p) => !!p.openid)
            .sort((a, b) => b.partner_credit_score - a.partner_credit_score);
        } catch (e) {}

        // partners: Tab「⭐耍伴推荐」前5; active_partners: 首页「活跃耍伴」横滑栏前10(图4)
        const activePartners = partnerList.slice(0, 10);
        const partners = partnerList.slice(0, 5);

        // S1 性能: 首页 2RTT → 1RTT
        // · banners 为纯配置读取(60s 缓存), 始终内联, 首页恒定少 1 RTT
        // · scene_groups 含 9 个实时 demand 查询, 仅在「访客维度 60s 缓存命中」时内联;
        //   未命中(冷启动首次)仍返回空数组由前端懒调 scene_groups action(该 action 计算后回种缓存),
        //   避免 square 重蹈 9 查询叠加导致冷启动超时的旧问题; tab 切回/60s 内二次进首页即命中
        let inlineBanners = [];
        try {
          // 复用开头与主查询并行点火的 activitiesP(冷 miss 也已并行, 不再串行补 RTT)
          inlineBanners = pickActivities(await activitiesP, '').banners;
        } catch (e) { /* 配置读取失败静默, 前端兜底懒调 */ }
        let inlineGroups = [];
        try {
          const cachedGroups = memGet(sceneGroupsCacheKey(openid, vRange));
          if (Array.isArray(cachedGroups)) inlineGroups = cachedGroups;
        } catch (e) {}

        return { ok: true, data: { list, scene_groups: inlineGroups, banners: inlineBanners, partners, active_partners: activePartners, active_users: activeUsers } };
      }

      // ───────── 首页按场景分组(懒加载, 结果按访客维度缓存 60s 供 square 内联) ─────────
      case 'scene_groups': {
        const { scenes } = await loadSceneList();
        // 耍伴视角一致性: 与广场同口径应用接单价格区间过滤(非耍伴/游客/未设置 → 不过滤)
        const vOpenid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(vOpenid);
        const vRange = vp && vp.range;
        const cacheKey = sceneGroupsCacheKey(vOpenid, vRange);
        // 命中访客维度缓存直接返回(tab 切回/短时间重进免 9 次 demand 查询)
        const cached = memGet(cacheKey);
        const sceneGroups = Array.isArray(cached)
          ? cached
          : await buildSceneGroups(scenes, vRange);
        if (!Array.isArray(cached)) memSet(cacheKey, sceneGroups, TTL_SCENE_GROUPS);
        return { ok: true, data: { scene_groups: sceneGroups } };
      }

      // ───────── 单场景需求分页(更多列表, 每页 50) ─────────
      case 'scene_list': {
        const sceneCode = String(event.scene_code || '').trim();
        // 动态校验: 必须在 admin_config.scene_list 里(首页分组同源)
        const { scenes } = await loadSceneList();
        const sceneDef = scenes.find((s) => s.code === sceneCode);
        if (!sceneDef) {
          return { ok: false, code: 'home_bad_scene', msg: '场景不存在或已隐藏' };
        }
        const skip = Math.max(0, parseInt(event.skip, 10) || 0);
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 耍伴视角一致性: 与广场同口径应用接单价格区间过滤(非耍伴/游客/未设置 → 不过滤)
        const vOpenid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(vOpenid);
        const vRange = vp && vp.range;
        const priceWhere = priceRangeWhere(vRange);

        // 取 51 条判定是否还有下一页
        const demandR = await col('demand')
          .where(priceWhere ? _.and([ hallWhere({ scene: sceneCode }), priceWhere ]) : hallWhere({ scene: sceneCode }))
          .orderBy('created_at', 'desc')
          .skip(skip)
          .limit(SCENE_PAGE_SIZE + 1)
          .get()
          .catch(() => ({ data: [] }));

        const docs = demandR.data || [];
        const hasMore = docs.length > SCENE_PAGE_SIZE;
        const list = docs.slice(0, SCENE_PAGE_SIZE).map((d) => mapDemand(d, now, pad));
        await fillPublisherSurname(list);

        return {
          ok: true,
          data: {
            scene_code: sceneCode,
            scene_name: sceneDef.name,
            list,
            has_more: hasMore,
            next_skip: skip + list.length,
            page_size: SCENE_PAGE_SIZE
          }
        };
      }

      // ───────── 附近可接单池(耍伴端首页 + 附近列表页, 按发布时间倒序) ─────────
      // 过滤: 匹配中 + 场景白名单 + 非定向(match_mode!=='direct') + 未超 take_distance_max_km + 排除已删/自己的需求
      // 排序: created_at 降序(最新发布在前); 复用 square 的 mapDemand 卡片映射 + 距离过滤(仅剔除阈值外)
      // 分页: page 从 1 起, page_size 默认 10(首页用), 附近列表页可传 20(≤50)
      case 'nearby': {
        const page = Math.max(1, parseInt(event.page, 10) || 1);
        const pageSize = Math.min(Math.max(parseInt(event.page_size, 10) || 10, 1), 50);
        const skip = (page - 1) * pageSize;
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 附近可接单依赖耍伴日常位置(复用接单配置里的 home_location, 不新增定位授权)
        const openid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(openid);
        if (!vp || !vp.home) {
          return { ok: true, data: { list: [], need_home_location: true, page, page_size: pageSize, has_more: false } };
        }

        // 接单价格区间过滤(与广场同口径; 非耍伴/未设置 → 不过滤)
        const vRange = vp.range;
        const priceWhere = priceRangeWhere(vRange);

        // 场景白名单(与首页宫格同源 admin_config.scene_list)
        const { scenes } = await loadSceneList();
        const sceneCodes = scenes.map((s) => s.code).filter(Boolean);
        const whitelist = sceneCodes.length ? sceneCodes : SCENE_FALLBACK.map((s) => s.code);

        // 平台最大接单距离阈值(take_distance_max_km)
        const effMaxKm = await loadTakeDistanceCap();

        const baseWhere = {
          is_deleted: false,
          status: 'matching',
          match_mode: _.neq('direct'),        // 定向需求不进池
          creator_openid: _.neq(openid),      // 不展示自己的需求
          scene: _.in(whitelist)
        };
        const where = priceWhere ? _.and([ baseWhere, priceWhere ]) : baseWhere;

        // 按 created_at 降序分页(多取1条判定是否还有下一页)
        const demandR = await col('demand')
          .where(where)
          .orderBy('created_at', 'desc')
          .skip(skip)
          .limit(pageSize + 1)
          .get()
          .catch(() => ({ data: [] }));

        const rawDocs = demandR.data || [];
        const hasMore = rawDocs.length > pageSize;
        const docs = rawDocs.slice(0, pageSize);
        const items = docs.map((d) => mapDemand(d, now, pad));

        // 距离计算并过滤超出 take_distance_max_km 的需求(复用 square 口径; 仅作过滤, 不改动发布时间倒序)
        const kept = [];
        docs.forEach((d, i) => {
          const site = d.location || {};
          const lat = Number(site.latitude), lng = Number(site.longitude);
          if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
            const km = Math.round(haversineKm(vp.home.lat, vp.home.lng, lat, lng) * 10) / 10;
            items[i].distance_km = km;
            if (km > effMaxKm) return;
          }
          kept.push(items[i]);
        });

        await fillPublisherSurname(kept);
        return { ok: true, data: { list: kept, page, page_size: pageSize, has_more: hasMore } };
      }

      // ───────── 用户公开主页 ─────────
      case 'user_home': {
        const targetOpenid = event.openid || '';
        if (!targetOpenid || !/^[a-zA-Z0-9_-]{20,40}$/.test(targetOpenid)) {
          return { ok: false, code: 'home_bad_openid', msg: '参数错误' };
        }

        // 查 user_account + blog_post(用户发布的动态)
        const [userR, postR] = await Promise.all([
          col('user_account')
            .where({ openid: targetOpenid })
            .limit(1)
            .get()
            .catch(() => ({ data: [] })),
          col('blog_post')
            .where({ author_openid: targetOpenid, status: 'normal', is_deleted: false })
            .orderBy('created_at', 'desc')
            .limit(15)
            .get()
            .catch(() => ({ data: [] }))
        ]);

        const u = (userR.data || [])[0];
        if (!u) return { ok: false, code: 'home_user_gone', msg: '该用户不存在或已注销' };

        // 统计: 发帖数
        const postCountR = await col('blog_post')
          .where({ author_openid: targetOpenid, status: 'normal', is_deleted: false })
          .count()
          .catch(() => ({ total: 0 }));

        const isDeleted = u.is_deleted === true;
        if (isDeleted) return { ok: false, code: 'home_user_gone', msg: '该用户不存在或已注销' };

        return {
          ok: true,
          data: {
            profile: {
              openid: u.openid,
              nickname: u.nickname || '微信用户',
              avatar: u.avatar || '',
              city: (u.city_list && u.city_list[0]) || (u.city && u.city[0]) || '',
              created_at: u.created_at,
              is_partner: (u.roles || []).includes('partner'),
              partner_credit_score: u.partner_credit_score || 0
            },
            stats: {
              post_count: postCountR.total || 0
            },
            posts: (postR.data || []).map((p) => ({
              _id: p._id,
              content: truncate(p.content, CONTENT_TRUNC),
              cover: (p.images && p.images[0]) || '',
              images: ((p.images || []).filter((u) => typeof u === 'string' && u.indexOf('cloud://') === 0)).slice(0, 4),
              tags: p.tags || [],
              scene: p.scene || '',
              like_count: p.like_count || 0,
              comment_count: p.comment_count || 0,
              created_at: p.created_at
            }))
          }
        };
      }

      // ───────── 首页活动列表(小程序端: 时间过滤 + 状态过滤 + 优先级排序; 配置 60s 缓存) ─────────
      case 'home_activity_list': {
        try {
          const sceneCode = String(event.scene_code || '').trim();
          const raw = await loadHomeActivitiesRaw();
          const { banners, cards } = pickActivities(raw, sceneCode);
          return { ok: true, data: { banners, cards } };
        } catch (e) {
          log.d('home_activity_list err:', e.message);
          return { ok: true, data: { banners: [], cards: [] } };
        }
      }

      // ───────── 活动详情(按 id 取单条: 仅 active 且时间窗内, 含 content 详情) ─────────
      case 'activity_detail': {
        try {
          const cfgR = await col('admin_config').doc('global').get();
          const cfg = cfgR.data || {};
          const now = Date.now();
          const id = String(event.id || '');
          const a = (cfg.home_activities || []).find((x) =>
            x.id === id && x.status === 'active' &&
            (!x.start_at || now >= x.start_at) && (!x.end_at || now <= x.end_at)
          );
          if (!a) return { ok: false, code: 'act_not_found', msg: '活动不存在或已结束' };
          return { ok: true, data: a };
        } catch (e) {
          log.d('activity_detail err:', e.message);
          return { ok: false, code: 'home_server_error', msg: '服务繁忙,请稍后重试' };
        }
      }

      default:
        return { ok: false, code: 'home_unknown_action', msg: '未知动作' };
    }
  } catch (e) {
    log.d('home-action unhandled:', e && e.message);
    return { ok: false, code: 'home_server_error', msg: '服务繁忙,请稍后重试' };
  }
};
