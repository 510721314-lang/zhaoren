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
  W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴',
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

// 运营配置兜底: admin_config.scene_list 优先, 硬编码兜底(与 init-db 种子对齐)
// 返回: { scenes: [{code,name,disclaimer_type,builtin}], legal_scene_disclaimers: {code:text} }
async function loadSceneList() {
  try {
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
  } catch (e) {
    return {
      scenes: SCENE_FALLBACK.map((s) => ({ ...s, disclaimer_type: 'general_disclaimer', builtin: true, disclaimer_text: '' })),
      legal_scene_disclaimers: {}
    };
  }
}

// demand 文档 → 广场卡片视图模型(与原 square 内联映射保持一致)
function mapDemand(d, now, pad) {
  const remarkParts = String(d.remark || '').split('｜');
  const title = remarkParts[0] ? remarkParts[0].trim() : (d.content_options && d.content_options[0]) || '需求';
  const description = remarkParts[1] ? remarkParts[1].trim() : '';

  const dt = new Date(d.start_time);
  const service_date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const service_time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

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
    budget: Math.round((d.rate_fen || 0) / 100),
    aa_estimate: d.aa_tier || '0-50',
    status: d.status,
    match_mode: d.match_mode || 'broadcast',
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

// 广场(抢单入口)访问者过滤数据: 接单价格区间 + 最大接单距离 + 日常位置(非耍伴/游客=不限)
// ⚠️ 仅用于 square; 首页宫格(scene_groups/scene_list)不按这些字段过滤 —— 首页是通用入口(含需求者视角)
let _visitorCache = {};                // openid → { at, val } 进程内短缓存
const VISITOR_TTL = 60 * 1000;
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

// Haversine 球面距离(公里) · 两经纬度间直线距离
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

exports.main = async (event, context) => {
  try {
    await require('./openid').warmEnv(cloud); // 环境门控日志预热
    await ensureCollections();
    const action = event.action || 'overview';

    switch (action) {

      // ───────── 首页概览(一次返回四块) ─────────
      case 'overview': {
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
            return {
              openid: p.openid,
              nickname: u.nickname || '耍伴',
              avatar: u.avatar || '',
              city: (p.city && p.city[0]) || '',
              accept_scenes: p.accept_scenes || [],
              partner_credit_score: u.partner_credit_score || 0
            };
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
        const rateCond = vRange
          ? { rate_fen: _.gte(vRange[0] === null ? 0 : vRange[0]).and(_.lte(vRange[1] === null ? 99999999 : vRange[1])) }
          : null;

        // 轻量并行: demand + partner + active_user, 不查 scene_groups(5个额外查询导致冷启动超时,
        // 场景分组改由 scene_groups action 单独懒加载)
        const [demandR, partnerR, activeUserR] = await Promise.all([
          col('demand')
            .where(hallWhere(rateCond))
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
          col('user_account')
            .where({ is_deleted: _.neq(true), status: _.nin(['frozen', 'banned', 'closed']) })
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

        // 最大接单距离(接单配置设置): 参考耍伴日常位置计算并回填 distance_km;
        // 已设置且超出 min(设置, 平台上限) 的需求不在广场展示(与接单时服务端校验对齐)
        if (vp && vp.home) {
          const effMaxKm = vp.maxKm ? Math.min(vp.maxKm, await loadTakeDistanceCap()) : null;
          const kept = [];
          (demandR.data || []).forEach((d, i) => {
            const site = d.location || {};
            const lat = Number(site.latitude), lng = Number(site.longitude);
            if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
              const km = Math.round(haversineKm(vp.home.lat, vp.home.lng, lat, lng) * 10) / 10;
              list[i].distance_km = km;
              if (effMaxKm !== null && km > effMaxKm) return;
            }
            kept.push(list[i]);
          });
          list = kept;
        }
        await fillPublisherSurname(list);

        // 耍伴推荐: partner_profile + user_account 昵称
        let partnerList = [];
        try {
          const partnerOpenids = (partnerR.data || []).map((p) => p.openid).filter(Boolean);
          const partnerUserMap = {};
          if (partnerOpenids.length) {
            const puR = await col('user_account').where({ openid: _.in(partnerOpenids) }).limit(partnerOpenids.length).get();
            (puR.data || []).forEach((u) => { partnerUserMap[u.openid] = u; });
          }
          partnerList = (partnerR.data || [])
            .map((p) => {
              const u = partnerUserMap[p.openid] || {};
              const avatar = (u.avatar && /^https?:/.test(u.avatar)) ? u.avatar : '';
              return {
                openid: p.openid,
                nickname: u.nickname || '耍伴',
                avatar,
                city: (p.city && p.city[0]) || '',
                accept_scenes: p.accept_scenes || [],
                partner_credit_score: u.partner_credit_score || 0,
                certified_scenes: p.certified_scenes || []
              };
            })
            .filter((p) => !!p.openid)
            .sort((a, b) => b.partner_credit_score - a.partner_credit_score);
        } catch (e) {}

        // partners: Tab「⭐耍伴推荐」前5; active_partners: 首页「活跃耍伴」横滑栏前10(图4)
        const activePartners = partnerList.slice(0, 10);
        const partners = partnerList.slice(0, 5);

        // scene_groups 由 scene_groups action 单独懒加载, 避免首屏 5 个额外 DB 查询导致免费版 3s 超时
        return { ok: true, data: { list, scene_groups: [], partners, active_partners: activePartners, active_users: activeUsers } };
      }

      // ───────── 首页按场景分组(懒加载, 首屏 square 不查) ─────────
      case 'scene_groups': {
        const { scenes } = await loadSceneList();
        const sceneCodes = scenes.map((s) => s.code);
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;
        const sceneQueries = sceneCodes.map((code) =>
          col('demand')
            .where(hallWhere({ scene: code }))
            .orderBy('created_at', 'desc')
            .limit(HOME_GROUP_SIZE + 1)
            .get()
            .catch(() => ({ data: [] }))
        );
        const sceneRs = await Promise.all(sceneQueries);
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

        // 取 51 条判定是否还有下一页
        const demandR = await col('demand')
          .where(hallWhere({ scene: sceneCode }))
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

      // ───────── 首页活动列表(小程序端: 时间过滤 + 状态过滤 + 优先级排序) ─────────
      case 'home_activity_list': {
        try {
          const cfgR = await col('admin_config').doc('global').get();
          const cfg = cfgR.data || {};
          const now = Date.now();
          const sceneCode = String(event.scene_code || '').trim();
          const raw = cfg.home_activities || [];
          const list = raw.filter((a) => {
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
          const banners = list.filter((a) => a.type === 'banner' || a.type === 'both');
          const cards = list.filter((a) => a.type === 'card' || a.type === 'both');
          return { ok: true, data: { banners: banners.slice(0, 3), cards: cards.slice(0, 4) } };
        } catch (e) {
          log.d('home_activity_list err:', e.message);
          return { ok: true, data: { banners: [], cards: [] } };
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
