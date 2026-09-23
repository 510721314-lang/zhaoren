// 对应 PRD 章节：3.10.1 耍伴接单配置管理 / 5.1 B端后台RBAC / 3.2.2 进行中订单定义
// partner-action 耍伴配置与接单动作 · 身份取自 getWXContext().OPENID
// 7 个 action: apply / set_switch / update_config / my_profile / review / detail / route_plan
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

// 进行中订单状态集合
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];
// 场景白名单: 从 admin_config.scene_list 动态读取(SSOT), 兜底 5 场景
const SCENE_CODES_FALLBACK = ['W1', 'W2', 'W8', 'W10', 'W11'];
let _sceneCodesCache = null;
async function getSceneCodes() {
  if (_sceneCodesCache) return _sceneCodesCache;
  try {
    const r = await db.collection('admin_config').doc('global').get();
    const cfg = r.data;
    const list = (cfg && Array.isArray(cfg.scene_list) && cfg.scene_list.length > 0)
      ? cfg.scene_list.map((s) => s.code).filter(Boolean)
      : SCENE_CODES_FALLBACK;
    _sceneCodesCache = list;
    return list;
  } catch (e) {
    _sceneCodesCache = SCENE_CODES_FALLBACK;
    return SCENE_CODES_FALLBACK;
  }
}

// 腾讯地图 WebService Key（服务端路线规划调用；失败时降级直线估算）
const TENCENT_MAP_KEY = 'I2DBZ-2RJCC-7RC2K-ACPMG-35LBF-LUB3D';
const ROUTE_TIMEOUT_MS = 3500;

// 耍伴日常位置清洗(wx.chooseLocation gcj02 坐标; 中国范围粗校验防脏数据)
function sanitizeHomeLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (!isFinite(lat) || !isFinite(lng) || lat < 3 || lat > 54 || lng < 73 || lng > 136) return null;
  return {
    name: String(loc.name || '').slice(0, 40),
    address: String(loc.address || '').slice(0, 120),
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lng * 1e6) / 1e6,
    updated_at: Date.now()
  };
}

// 每周接单时段校验+规整: {mon:{enabled,start,end},...}; start/end 为 0-1440 分钟(本地时区), start>end 视为跨夜槽
const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SLOT_DEFAULT = { enabled: false, start: 540, end: 1080 };  // 09:00-18:00
function sanitizeWeeklySlots(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of WEEK_KEYS) {
    const s = raw[k];
    if (!s || typeof s !== 'object') { out[k] = Object.assign({}, SLOT_DEFAULT); continue; }
    const start = Number(s.start);
    const end = Number(s.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 1440 || end < 0 || end > 1440) return null;
    if (start === end) return null;    // 起止相同 → 无意义时段
    out[k] = { enabled: !!s.enabled, start, end };
  }
  return out;
}

// Haversine 直线距离(米)
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 直线距离降级耗时估算(分钟): 驾车30km/h 公交20km/h(含等车) 骑行15km/h
function estimateMinutes(mode, meters) {
  const speed = mode === 'drive' ? 30 : mode === 'transit' ? 20 : 15;
  return Math.max(1, Math.round(meters / 1000 / speed * 60));
}

// 原生 https GET JSON（云函数不受小程序 request 域名白名单限制）
function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = require('https').get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(ROUTE_TIMEOUT_MS, () => req.destroy(new Error('map_timeout')));
    req.on('error', reject);
  });
}

// 腾讯路线规划: mode=driving/transit/bicycling, 坐标 lat,lng(gcj02); 返回 {distance_m, minutes}
async function fetchTencentRoute(mode, from, to) {
  const url = 'https://apis.map.qq.com/ws/direction/v1/' + mode +
    '/?from=' + from.lat + ',' + from.lng +
    '&to=' + to.lat + ',' + to.lng +
    '&key=' + encodeURIComponent(TENCENT_MAP_KEY);
  const j = await httpsGetJson(url);
  const route = j && j.result && j.result.routes && j.result.routes[0];
  if (j.status !== 0 || !route) throw new Error('map_status_' + (j && j.status));
  const distanceM = Math.round(Number(route.distance));
  const minutes = Math.round(Number(route.duration));
  if (!isFinite(distanceM) || distanceM <= 0 || !isFinite(minutes) || minutes <= 0) {
    throw new Error('map_bad_route');
  }
  return { distance_m: distanceM, minutes };
}

async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) return r.data;   // doc().get() 返回单个对象(非数组)
  } catch (e) {}
  return {
    rate_min_fen: 3000, rate_max_fen: 10000,
    min_credit_take_order: 600, admin_openids: []
  };
}

// 容错读取耍伴资料: is_deleted 缺省(历史坏文档)视为有效并惰性治愈(见 ./heal)
const { getHealedPartnerProfile } = require('./heal');
const { getCachedEnv } = require('./openid');
async function getProfile(openid) {
  return getHealedPartnerProfile(col, _, openid);
}

// 默认考核分模板由 getSceneCodes() 动态构建(每个活跃场景默认 100 分), 见 apply case

// 检查是否有进行中订单
async function hasBusyOrder(openid) {
  const r = await col('order_main').where({
    partner_openid: openid, status: _.in(BUSY_STATUS), is_deleted: false
  }).limit(1).get();
  return r.data && r.data.length > 0;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'pa_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`partner-action action=${action} openid=${openid}`);

  switch (action) {

    // 0. 申请成为耍伴 (upsert partner_profile)
    //    审核红线: 仅 admin_config.auto_approve_partner === true 时自动开通;
    //    否则新申请/被拒记录一律 pending_review, 且不授予 partner role, 由管理员 review 放行
    case 'apply': {
      const config = await getConfig();
      const autoApprove = config.auto_approve_partner === true;
      const uaCol = col('user_account');
      const ua = await uaCol.where({ openid }).limit(1).get();
      if (!ua.data.length) return { ok: false, code: 'pa_no_user', msg: '请先登录' };

      // 加 partner role(仅审核通过后; pending_review 不授予)
      const curRoles = ua.data[0].roles || [];

      // upsert partner_profile
      // 注意: 早期版本 add 漏写 is_deleted 且重复提交可能产生多条文档,
      // 这里宽查(不带 is_deleted)并治愈该 openid 下全部文档, 避免严格守卫 limit(1) 漏读
      const ppCol = col('partner_profile');
      const now = Date.now();
      const existing = await ppCol.where({ openid }).limit(100).get();
      // 动态拿活跃场景列表(SSOT: admin_config.scene_list)
      const sceneCodes = await getSceneCodes();
      const scenes = Array.isArray(event.accept_scenes) && event.accept_scenes.length
        ? event.accept_scenes
        : (curRoles.includes('partner') && existing.data.length ? existing.data[0].accept_scenes || [] : [sceneCodes[0] || 'W1']);

      // 日常位置(注册时 chooseLocation 选点); 未传/非法则保留旧值, 不强制阻断老客户端
      const homeLocation = sanitizeHomeLocation(event.home_location);

      // 补全场景考核分: 非 W1 场景默认 100, W1(就医陪诊) 强制默认 0 防止架空国标考核
      // prod 环境 W1 必须由 partner-apply 入口显式提交 >= 80 分才能开通
      const defaultExam = sceneCodes.reduce((a, c) => { a[c] = c === 'W1' ? 0 : 100; return a; }, {});

      // 若显式传了 W1 分数, 同 partner-apply 对齐强制 >= 80
      if (event.exam_scores && Number(event.exam_scores.W1)) {
        if (Number(event.exam_scores.W1) < 80) {
          return { ok: false, code: 'pa_w1_exam_failed', msg: '就医陪诊场景需通过国标专项考核(>=80分)' };
        }
        defaultExam.W1 = Number(event.exam_scores.W1);
      }

      // 已是 approved 的历史档案重走申请时保留资格(只更新场景); 其余一律按自动开关决定
      const wasApproved = existing.data.some(p => p.status === 'approved');
      const finalApproved = wasApproved || autoApprove;
      const finalStatus = finalApproved ? 'approved' : 'pending_review';

      if (existing.data.length) {
        for (const p of existing.data) {
          // 重走申请=重新开通: 补全所有守卫依赖字段(status/is_deleted/accept_switch)
          const patch = {
            accept_scenes: scenes,
            status: p.status === 'approved' ? 'approved' : finalStatus,
            is_deleted: false,
            updated_at: now
          };
          if (p.accept_switch === undefined) patch.accept_switch = true;
          if (p.credit_score === undefined) patch.credit_score = 800;
          if (defaultExam && !p.exam_scores) patch.exam_scores = defaultExam;
          if (homeLocation) patch.home_location = homeLocation;
          await ppCol.doc(p._id).update({ data: patch });
        }
      } else {
        const doc = {
          openid,
          nick_name: ua.data[0].nick_name || '新耍伴',
          accept_scenes: scenes,
          status: finalStatus,
          accept_switch: true,
          credit_score: 800,
          order_count: 0,
          income_total_fen: 0,
          is_deleted: false,
          created_at: now,
          updated_at: now
        };
        if (defaultExam) doc.exam_scores = defaultExam;
        if (homeLocation) doc.home_location = homeLocation;
        await ppCol.add({ data: doc });
      }

      // 仅最终审核通过才授予 partner role; 待审核不污染身份分流
      let roles = curRoles;
      if (finalApproved && !curRoles.includes('partner')) {
        roles = [...curRoles, 'partner'];
        await uaCol.doc(ua.data[0]._id).update({ data: { roles, updated_at: now } });
      }

      log.d(`partner apply: ${openid} scenes=${scenes} docs=${existing.data.length} status=${finalStatus}`);
      return {
        ok: true,
        data: {
          roles: [...new Set(roles)],
          accept_scenes: scenes,
          status: finalStatus,
          pending_review: !finalApproved
        }
      };
    }

    // 1. 接单开关切换
    case 'set_switch': {
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      if (profile.status !== 'approved') {
        return { ok: false, code: 'pa_not_approved', msg: '耍伴资料未审核通过' };
      }

      // 关闭时检查进行中订单
      const newSwitch = event.accept_switch === false || event.accept_switch === 'false' ? false : true;
      if (!newSwitch) {
        const busy = await hasBusyOrder(openid);
        if (busy) return { ok: false, code: 'pa_busy_order', msg: '有进行中订单,不可关闭接单' };
      }

      await col('partner_profile').doc(profile._id).update({ data: {
        accept_switch: newSwitch, updated_at: Date.now()
      }});
      log.d(`partner switch -> ${newSwitch}: ${openid}`);
      return { ok: true, data: { accept_switch: newSwitch } };
    }

    // 2. 修改时薪与场景
    case 'update_config': {
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      if (profile.status !== 'approved') {
        return { ok: false, code: 'pa_not_approved', msg: '耍伴资料未审核通过' };
      }

      const config = await getConfig();
      const update = { updated_at: Date.now() };
      // 0 是合法下限(不能用 || 兜底, 否则 admin 配置 0 会被误当成缺省 3000)
      const _rmn = Number(config.rate_min_fen);
      const _rmx = Number(config.rate_max_fen);
      const rateMin = Number.isFinite(_rmn) ? _rmn : 3000;
      const rateMax = Number.isFinite(_rmx) ? _rmx : 10000;

      // 日常位置更新: 显式 null 清除, 传对象则校验后覆盖
      if (event.home_location !== undefined) {
        if (event.home_location === null) {
          update.home_location = _.remove();
        } else {
          const hl = sanitizeHomeLocation(event.home_location);
          if (!hl) return { ok: false, code: 'pa_bad_location', msg: '日常位置无效' };
          update.home_location = hl;
        }
      }

      // 最大接单距离(公里, 3-50): 广场展示过滤 + 接单校验取 min(本值, 平台上限 take_distance_max_km)
      if (event.max_distance_km !== undefined) {
        const md = parseInt(event.max_distance_km, 10);
        if (!Number.isInteger(md) || md < 3 || md > 50) {
          return { ok: false, code: 'pa_bad_max_distance', msg: '最大接单距离须为 3-50 公里的整数' };
        }
        update.max_distance_km = md;
      }

      // 场景校验
      let newScenes = profile.accept_scenes || [];
      if (Array.isArray(event.accept_scenes)) {
        if (event.accept_scenes.length === 0) {
          return { ok: false, code: 'pa_scenes_empty', msg: '请至少选择一个接单场景' };
        }
        const sceneCodes = await getSceneCodes();
        for (const s of event.accept_scenes) {
          if (sceneCodes.indexOf(s) < 0) {
            return { ok: false, code: 'pa_scene_invalid', msg: `场景 ${s} 不在白名单` };
          }
        }
        newScenes = event.accept_scenes;
        update.accept_scenes = newScenes;
      }

      // 各场景时薪(scene_rates: { W1: 5000, ... } 分单位)
      // 耍伴端逐场景输入(元/小时); 传入值非法时回落「原有效值 → 平台默认时薪」, 不硬拒(防脏数据/旧客户端)
      const sceneDefaultRate = config.scene_default_rate_fen || 5000;
      const oldRates = profile.scene_rates || {};
      if (event.scene_rates && typeof event.scene_rates === 'object') {
        const rateKeys = Object.keys(event.scene_rates);
        // 不允许多余 key
        for (const k of rateKeys) {
          if (newScenes.indexOf(k) < 0) {
            return { ok: false, code: 'pa_rate_extra', msg: `场景 ${k} 未勾选但设置了时薪` };
          }
        }
        // 为每个选中场景确定时薪: 传入值合法则用, 否则回退原值, 再否则平台默认
        const mergedRates = {};
        for (const s of newScenes) {
          let r = rateKeys.indexOf(s) >= 0 ? Number(event.scene_rates[s]) : NaN;
          if (!r || r < rateMin || r > rateMax) {
            const old = Number(oldRates[s]);
            r = (old && old >= rateMin && old <= rateMax) ? old : sceneDefaultRate;
          }
          mergedRates[s] = r;
        }
        update.scene_rates = mergedRates;
      } else if (update.accept_scenes) {
        // 只改场景未带时薪: 为新场景补默认时薪, 已有场景保留原值
        const mergedRates = {};
        for (const s of newScenes) {
          const old = Number(oldRates[s]);
          mergedRates[s] = (old && old >= rateMin && old <= rateMax) ? old : sceneDefaultRate;
        }
        update.scene_rates = mergedRates;
      }

      // 每周接单时段(结构化分钟数; 服务端 order-create 按"服务时间必须落在启用时段内"校验)
      if (event.weekly_slots !== undefined) {
        if (event.weekly_slots === null) {
          update.weekly_slots = _.remove();
        } else {
          const slots = sanitizeWeeklySlots(event.weekly_slots);
          if (!slots) {
            return { ok: false, code: 'pa_bad_slots', msg: '接单时段格式不正确(每天需 0-1440 的整数分钟, 起止不能相同)' };
          }
          update.weekly_slots = slots;
        }
      }

      // 接单价格区间(分/小时; null=清除=不限); 边界复用上方 rateMin/rateMax(0 合法)
      const priceLo = rateMin;
      const priceHi = rateMax;
      const hasMin = event.accept_rate_min_fen !== undefined;
      const hasMax = event.accept_rate_max_fen !== undefined;
      if (hasMin || hasMax) {
        const norm = (v) => (v === null ? null : Number(v));
        const curMin = profile.accept_rate_min_fen === undefined ? null : profile.accept_rate_min_fen;
        const curMax = profile.accept_rate_max_fen === undefined ? null : profile.accept_rate_max_fen;
        const nextMin = hasMin ? norm(event.accept_rate_min_fen) : curMin;
        const nextMax = hasMax ? norm(event.accept_rate_max_fen) : curMax;
        if (nextMin !== null && (!Number.isInteger(nextMin) || nextMin < priceLo || nextMin > priceHi)) {
          return { ok: false, code: 'pa_price_min_range', msg: `最低单价需在 ${priceLo / 100}-${priceHi / 100} 元/小时之间` };
        }
        if (nextMax !== null && (!Number.isInteger(nextMax) || nextMax < priceLo || nextMax > priceHi)) {
          return { ok: false, code: 'pa_price_max_range', msg: `最高单价需在 ${priceLo / 100}-${priceHi / 100} 元/小时之间` };
        }
        if (nextMin !== null && nextMax !== null && nextMin > nextMax) {
          return { ok: false, code: 'pa_price_cross', msg: '最低单价不能高于最高单价' };
        }
        if (hasMin) update.accept_rate_min_fen = nextMin === null ? _.remove() : nextMin;
        if (hasMax) update.accept_rate_max_fen = nextMax === null ? _.remove() : nextMax;
      }

      await col('partner_profile').doc(profile._id).update({ data: update });
      log.d(`partner config updated: ${openid}`);
      return { ok: true, data: { updated: Object.keys(update).filter(k => k !== 'updated_at') } };
    }

    // 3. 我的耍伴资料与接单统计
    case 'my_profile': {
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };

      // 统计:总单数、完成单数、好评率(占位)
      let totalOrders = 0, completedOrders = 0, goodRate = 0;
      try {
        const tr = await col('order_main').where({
          partner_openid: openid, is_deleted: false
        }).count();
        totalOrders = tr.total || 0;
        const cr = await col('order_main').where({
          partner_openid: openid, status: _.in(['S5', 'S8', 'S9', 'S10']), is_deleted: false
        }).count();
        completedOrders = cr.total || 0;
        // 好评率: evaluation 表 star>=4 占比
        const er = await col('evaluation').where({ partner_openid: openid, is_deleted: false }).count();
        const ec = await col('evaluation').where({ partner_openid: openid, star: _.gte(4), is_deleted: false }).count();
        if (er.total > 0) goodRate = Math.round((ec.total / er.total) * 100);
      } catch (e) {}

      return {
        ok: true,
        data: {
          profile: {
            _id: profile._id, openid: profile.openid,
            nickname: profile.nickname, avatar: profile.avatar,
            accept_scenes: profile.accept_scenes || [],
            scene_rates: profile.scene_rates || {},
            weekly_slots: profile.weekly_slots || null,
            accept_rate_min_fen: profile.accept_rate_min_fen === undefined ? null : profile.accept_rate_min_fen,
            accept_rate_max_fen: profile.accept_rate_max_fen === undefined ? null : profile.accept_rate_max_fen,
            max_distance_km: profile.max_distance_km === undefined ? null : profile.max_distance_km,
            exam_scores: profile.exam_scores || {},
            city: profile.city, accept_switch: profile.accept_switch,
            home_location: profile.home_location ? {
              name: profile.home_location.name || '',
              address: profile.home_location.address || ''
            } : null,
            status: profile.status, applied_at: profile.applied_at
          },
          stats: {
            total_orders: totalOrders,
            completed_orders: completedOrders,
            good_rate: goodRate
          }
        }
      };
    }

    // 4. 审核(管理员专用)
    case 'review': {
      const config = await getConfig();
      const adminList = config.admin_openids || [];
      if (adminList.indexOf(openid) < 0) {
        return { ok: false, code: 'pa_not_admin', msg: '无管理员权限' };
      }

      const { target_openid, pass } = event;
      if (!target_openid) return { ok: false, code: 'pa_no_target', msg: '缺少待审核用户' };

      const profile = await getProfile(target_openid);
      if (!profile) return { ok: false, code: 'pa_target_no_profile', msg: '目标用户不是耍伴' };
      if (profile.status !== 'pending_review') {
        return { ok: false, code: 'pa_already_reviewed', msg: '该耍伴已审核过' };
      }

      const newStatus = pass ? 'approved' : 'rejected';
      await col('partner_profile').doc(profile._id).update({ data: {
        status: newStatus, updated_at: Date.now()
      }});
      // 审核通过: 同步授予 user_account 的 partner role(申请时 pending_review 不授)
      if (pass) {
        try {
          const uaR = await col('user_account').where({ openid: target_openid }).limit(1).get();
          if (uaR.data && uaR.data.length) {
            const roles = uaR.data[0].roles || [];
            if (roles.indexOf('partner') < 0) {
              await col('user_account').doc(uaR.data[0]._id).update({
                data: { roles: [...roles, 'partner'], updated_at: Date.now() }
              });
            }
          }
        } catch (e) { log.d(`review grant role fail: ${e.message}`); }
      }
      log.d(`partner reviewed: ${target_openid} -> ${newStatus}`);
      return { ok: true, data: { target_openid, status: newStatus } };
    }

    // 5. 耍伴详情（C端公开）
    case 'detail': {
      const { partner_openid } = event;
      if (!partner_openid) return { ok: false, code: 'pa_no_target', msg: '缺少耍伴标识' };

      const r = await col('partner_profile').where({ openid: partner_openid, status: 'approved', is_deleted: false }).limit(1).get();
      if (!r.data || !r.data[0]) return { ok: false, code: 'pa_not_found', msg: '耍伴不存在或未认证' };
      const p = r.data[0];

      // 拉 user_account 拿昵称头像
      let nickname = p.nickname || '微信用户', avatar = '';
      try {
        const ua = await col('user_account').where({ openid: partner_openid }).limit(1).get();
        if (ua.data && ua.data[0]) {
          nickname = ua.data[0].nickname || nickname;
          avatar = ua.data[0].avatar || '';
        }
      } catch (e) {}

      // 订单统计
      let totalOrders = 0, completedOrders = 0;
      try {
        const tr = await col('order_main').where({ partner_openid, is_deleted: false }).count();
        totalOrders = tr.total || 0;
        const cr = await col('order_main').where({ partner_openid, status: _.in(['S5','S8','S9','S10']), is_deleted: false }).count();
        completedOrders = cr.total || 0;
      } catch (e) {}

      // 最近 3 条评价
      let evaluations = [];
      try {
        const er = await col('evaluation').where({ partner_openid, is_deleted: false }).orderBy('created_at', 'desc').limit(3).get();
        evaluations = (er.data || []).map(ev => ({
          stars: ev.stars || 5,
          tags: ev.tags || [],
          content: ev.content || '',
          at: formatTimeAgo(ev.created_at)
        }));
      } catch (e) {}

      return {
        ok: true,
        data: {
          partner: {
            _id: p._id, openid: p.openid,
            nickname, avatar,
            accept_scenes: p.accept_scenes || [],
            scene_rates: p.scene_rates || {},
            city: p.city,
            home_location: p.home_location ? {
              name: p.home_location.name || '',
              address: p.home_location.address || ''
            } : null,
            score: p.score || 0,
            level: p.level || 'L1',
            accept_switch: p.accept_switch !== false,
            real_name_verified: !!p.real_name_verified,
            face_verified: !!p.face_verified,
            intro: p.intro || '这个耍伴还没写自我介绍~',
            certified_scenes: p.accept_scenes || []
          },
          stats: { total_orders: totalOrders, completed_orders: completedOrders },
          evaluations
        }
      };
    }

    // 6. 路线规划（C端公开）: 耍伴日常位置 → 浏览者当前位置的距离与驾车/公交/骑行耗时
    //    腾讯 Direction API 并行查询, 任一方式失败独立降级为直线估算
    case 'route_plan': {
      const myLat = Number(event.latitude);
      const myLng = Number(event.longitude);
      if (!event.partner_openid) return { ok: false, code: 'pa_no_target', msg: '缺少耍伴标识' };
      if (!isFinite(myLat) || !isFinite(myLng) || myLat < 3 || myLat > 54 || myLng < 73 || myLng > 136) {
        return { ok: false, code: 'pa_bad_coord', msg: '当前坐标无效' };
      }

      const r = await col('partner_profile').where({
        openid: event.partner_openid, status: 'approved', is_deleted: false
      }).limit(1).get();
      const p = r.data && r.data[0];   // where().get() 返回数组, 必须取 [0]
      if (!p) return { ok: false, code: 'pa_not_found', msg: '耍伴不存在或未认证' };
      const h = sanitizeHomeLocation(p.home_location);
      if (!h) return { ok: false, code: 'pa_no_home', msg: '该耍伴未设置日常位置' };

      const from = { lat: h.latitude, lng: h.longitude }; // 从耍伴日常位置出发
      const to = { lat: myLat, lng: myLng };
      const straightM = Math.round(haversineMeters(h.latitude, h.longitude, myLat, myLng));

      const modeDefs = [['drive', 'driving'], ['transit', 'transit'], ['bike', 'bicycling']];
      const results = await Promise.all(modeDefs.map(async ([key, mode]) => {
        if (!TENCENT_MAP_KEY) {
          return { key, minutes: estimateMinutes(key, straightM), source: 'estimate', distance_m: null };
        }
        try {
          const rr = await fetchTencentRoute(mode, from, to);
          return { key, minutes: rr.minutes, source: 'tencent', distance_m: rr.distance_m };
        } catch (e) {
          log.d(`route_plan ${mode} fail: ${e.message}`);
          return { key, minutes: estimateMinutes(key, straightM), source: 'estimate', distance_m: null };
        }
      }));

      const modes = {};
      results.forEach((t) => {
        modes[t.key] = { minutes: t.minutes, source: t.source, distance_m: t.distance_m };
      });
      // 展示距离: 优先驾车路线里程, 无则直线距离
      const distanceM = (modes.drive && modes.drive.distance_m) || straightM;

      return {
        ok: true,
        data: {
          home: { name: h.name, address: h.address },
          straight_m: straightM,
          distance_m: distanceM,
          modes
        }
      };
    }

    default:
      return { ok: false, code: 'pa_unknown_action', msg: '未知动作' };
  }
};

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
  return new Date(ts).toLocaleDateString();
}
