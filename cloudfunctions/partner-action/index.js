// 对应 PRD 章节：3.10.1 耍伴接单配置管理 / 5.1 B端后台RBAC / 3.2.2 进行中订单定义
// partner-action 耍伴配置与接单动作 · 身份取自 getWXContext().OPENID
// 7 个 action: apply / set_switch / update_config / my_profile / review / detail / route_plan
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');
const { writeAudit } = require('./audit');
const { buildAuditPatch } = require('./partner_audit');
// D2-3 防漂移抽取: 规范源 _shared/take_rules.js(修改后跑 sync-take-rules.ps1 同步各函数)
const { suspendLeftDays } = require('./take_rules');
// 物理拆分(2026-10-13): 各 action 组 handler 与 index 同级; 共享符号经 ctx 注入, handler 禁 require('./index')
const HANDLERS = Object.assign({},
  require('./action_config'),
  require('./action_exam'),
  // require('./action_profile'),
  // require('./action_public'),
);

// 耍伴审核通知推送(system_notice): 提交/通过/驳回都主动推给耍伴
// 去重合并: 同收件人+order_id('' 无订单)+type 未读则覆盖正文与时间, 避免刷屏
async function writeNotice(opt) {
  try {
    const exist = await col('system_notice').where({
      to_openid: opt.to_openid, order_id: opt.order_id || '', type: opt.type, read: false
    }).limit(1).get();
    const data = {
      title: opt.title, body: opt.body || '',
      action_key: opt.action_key || '',
      action_payload: opt.action_payload || {},
      updated_at: Date.now()
    };
    if (exist.data && exist.data[0]) {
      await col('system_notice').doc(exist.data[0]._id).update({ data });
    } else {
      await col('system_notice').add({ data: Object.assign({
        to_openid: opt.to_openid,
        order_id: opt.order_id || '',
        type: opt.type || 'custom',
        created_at: Date.now(),
        read: false
      }, data) });
    }
  } catch (e) {
    log.d('[notice] write failed:', opt.to_openid, opt.type, e && e.message);
  }
}

// 进行中订单状态集合
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];
// 耍伴信用等级映射(SSOT 与 miniprogram/config/enums.js CREDIT_LEVEL 一致)
// 2026-10-01 对齐 PRD R005: 百段制 L1[600,700) L2[700,800) L3[800,900) L4[900,1000]
const CREDIT_LEVELS = [
  { level: 'L1', min: 600, max: 699 },
  { level: 'L2', min: 700, max: 799 },
  { level: 'L3', min: 800, max: 899 },
  { level: 'L4', min: 900, max: 1000 }
];
function creditLevelOf(score) {
  if (!Number.isFinite(score)) return 'L1';
  const lv = CREDIT_LEVELS.find((l) => score >= l.min && score <= l.max);
  return lv ? lv.level : 'L1';
}
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

// 腾讯地图 WebService Key: 运行时从 admin_config.tencent_map_key 读取(安全基线: 密钥不硬编码)

// ── 耍伴接单考试题库(云端判分, 防作弊) ──
// subject: base=基础科目(耍伴考试, 全员接单前置) / W1=提升科目(陪诊考试, 就医陪诊专项)
// 每题单选 4 选项; answer_idx 仅云端持有, 下发题库时剥离
// 2026-10-03 后台化: 题库/通过线/前置规则迁至 exam_bank 集合(admin-action 管理), 此处仅读库失败兜底(FALLBACK)
// SSOT: EXAM_BANK_FALLBACK 与 admin-action EXAM_BANK_FALLBACK 同源, 改题库须双处同步或先 seed 到云端
const EXAM_BANK_FALLBACK = {
  base: {
    title: '耍伴基础考试', desc: '全体耍伴接单前置，满分 100 分通过', pass_line: 100, requires: [],
    questions: [
      { question: '接单前需要确认什么？', options: ['需求内容与时间地点', '直接按导航出发', '先收钱再谈', '到地方再问'], answer_idx: 0 },
      { question: '遇到服务价格争议时应该？', options: ['现场理论自行解决', '联系平台客服介入', '直接结束服务', '要求对方加钱'], answer_idx: 1 },
      { question: '订单时间临时变更时应该？', options: ['自行改时间', '先与需求方沟通确认', '拒绝服务', '不理会'], answer_idx: 1 },
      { question: '关于平台信用分，正确的是？', options: ['完成优质服务可提升', '与服务质量无关', '花钱可买', '接单越多分越高不看出勤'], answer_idx: 0 },
      { question: '履约前需要做好的准备是？', options: ['熟悉需求内容并准点到达', '先索要好评', '只做自己方便的部分', '让需求方多等一会'], answer_idx: 0 },
      { question: '夜间服务(23:00-7:00)的正确做法是？', options: ['照常接单不理会', '平台有夜间红线,按规则暂停', '只接远距离单', '私下加价接单'], answer_idx: 1 },
      { question: '服务过程中发现问题(如信息不符)应该？', options: ['拍照留证并联系平台', '默默做完', '直接走人', '与对方争吵'], answer_idx: 0 },
      { question: '关于客户隐私信息，正确的是？', options: ['不外传对方联系方式与照片', '可以发朋友圈', '告诉亲友无妨', '保存备用'], answer_idx: 0 },
      { question: '被差评或投诉后正确的做法是？', options: ['申诉并提供证据', '恶意报复', '注销账号', '拉黑对方'], answer_idx: 0 },
      { question: '平台禁止的行为是？', options: ['线下绕开平台交易', '按时履约', '提前沟通', '如实描述服务'], answer_idx: 0 }
    ]
  },
  W1: {
    title: '陪诊提升考试', desc: '就医陪诊场景专项，满分 100 分通过；需先通过基础考试', pass_line: 100, requires: ['base'],
    questions: [
      { question: '陪诊服务的首要原则是？', options: ['以患者需求与医嘱为中心', '节省时间即可', '听家属意见就行', '按自己经验处理'], answer_idx: 0 },
      { question: '发现患者突发不适时应该？', options: ['立即通知医护人员并协助', '自行离开', '喂药处理', '等待家属'], answer_idx: 0 },
      { question: '陪诊时能否代患者做医疗决策？', options: ['不能,医疗决策须由医生/患者', '可以,图方便', '家属要求就可以', '看情况'], answer_idx: 0 },
      { question: '陪诊中涉及患者隐私(病历/报告)应？', options: ['妥善保管不外传', '拍照发给亲友', '发朋友圈', '保存备用'], answer_idx: 0 },
      { question: '取药送药服务需注意？', options: ['核对医嘱与用量,当面交付', '放前台即可', '让患者自取', '交家属就算完成'], answer_idx: 0 },
      { question: '陪诊中遇到挂号排队久等，正确做法是？', options: ['耐心陪同并安抚患者情绪', '催促插队', '中途离开', '让患者自己等'], answer_idx: 0 },
      { question: '患者提出与医嘱相悖的要求时应该？', options: ['耐心解释并咨询医护人员', '照做', '批评患者', '忽视'], answer_idx: 0 },
      { question: '陪诊结束后应？', options: ['如实反馈就诊要点与医嘱', '直接结束', '索要好评', '不说明'], answer_idx: 0 },
      { question: '陪诊中对收费或流程有疑问时？', options: ['咨询医院收费处/导诊', '让患者自己问', '替患者做主缴费', '忽略'], answer_idx: 0 },
      { question: '以下哪种情况应立即求助医护人员？', options: ['患者面色异常或突然不适', '患者稍显疲惫', '排队时间长', '找不到科室'], answer_idx: 0 }
    ]
  }
};

// 考试题库动态读取: 优先 exam_bank 集合(admin-action 管理), 读不到走 FALLBACK(fail-closed)
// 缓存 5 分钟(后台改题后 ≤5min 生效); 读失败不缓存空值
let _examBankCache = null;
let _examBankCacheUntil = 0;
async function getExamBank() {
  const now = Date.now();
  if (_examBankCache !== null && now < _examBankCacheUntil) return _examBankCache;
  try {
    const r = await col('exam_bank').where({ is_deleted: _.neq(true), enabled: true }).limit(100).get();
    const docs = (r.data || []).filter((d) => Array.isArray(d.questions) && d.questions.length > 0);
    if (docs.length > 0) {
      const bank = {};
      for (const d of docs) {
        bank[d.code] = {
          title: d.title || d.code,
          desc: d.desc || '',
          pass_line: Number(d.pass_line) || 100,
          requires: Array.isArray(d.requires) ? d.requires : [],
          questions: d.questions,
          bank_ver: d.updated_at || 0
        };
      }
      _examBankCache = bank;
      _examBankCacheUntil = now + 5 * 60 * 1000;
      return bank;
    }
  } catch (e) { /* 读失败走 FALLBACK, 不缓存 */ }
  _examBankCache = null; // 集合无数据/读失败: 用 FALLBACK, 下次调用重试
  return EXAM_BANK_FALLBACK;
}

// 题库前置门禁(通用): 逐 requires 查 exam_scores, 未通过返回 { locked, code, msg }
function examRequiresGate(profile, subject, bank) {
  const reqs = subject.requires || [];
  for (const r of reqs) {
    const score = Number((profile.exam_scores && profile.exam_scores[r]) || 0);
    const reqSubject = (bank && bank[r]) || EXAM_BANK_FALLBACK[r];
    const passLine = reqSubject ? Number(reqSubject.pass_line) || 100 : 100;
    if (score < passLine) {
      return { locked: true, code: 'pa_exam_prereq_not_passed', msg: `需先通过「${reqSubject ? reqSubject.title : r}」考试（${passLine} 分）` };
    }
  }
  return { locked: false };
}
// 读取失败/未配置时返回空串, 路线规划降级直线估算(fail-closed); 模块级缓存 5 分钟
const ROUTE_TIMEOUT_MS = 3500;
let _cachedMapKey = null;
let _mapKeyCacheUntil = 0;
async function getTencentMapKey() {
  const now = Date.now();
  if (_cachedMapKey !== null && now < _mapKeyCacheUntil) return _cachedMapKey;
  try {
    const r = await col('admin_config').doc('global').get();
    _cachedMapKey = (r.data && r.data.tencent_map_key) || '';
  } catch (e) {
    _cachedMapKey = ''; // fail-closed: 读不到按未配置处理, 走估算降级
  }
  _mapKeyCacheUntil = now + 5 * 60 * 1000;
  return _cachedMapKey;
}

// 耍伴资料维护页数量/字数限制: 从 admin_config 动态读取(SSOT, 后台可配), 后端强约束与前端校验同源
// 读取失败返回默认值(fail-closed 不放大); 模块级缓存 5 分钟(后台改后 ≤5min 生效)
const PARTNER_LIMITS_FALLBACK = {
  skills_max: 10, skills_len: 12,
  highlights_max: 3, highlight_len: 30,
  media_title_max: 20, media_len: 20,
  media_photo_max: 6, bio_len: 200
};
let _partnerLimitsCache = null;
let _partnerLimitsCacheUntil = 0;
async function getPartnerLimits() {
  const now = Date.now();
  if (_partnerLimitsCache !== null && now < _partnerLimitsCacheUntil) return _partnerLimitsCache;
  const L = { ...PARTNER_LIMITS_FALLBACK };
  try {
    const r = await col('admin_config').doc('global').get();
    const cfg = r.data || {};
    const num = (v, d) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : d; };
    L.skills_max = num(cfg.p_skills_max, 10);
    L.skills_len = num(cfg.p_skills_len, 12);
    L.highlights_max = num(cfg.p_highlights_max, 3);
    L.highlight_len = num(cfg.p_highlight_len, 30);
    L.media_title_max = num(cfg.p_media_title_max, 20);
    L.media_len = num(cfg.p_media_len, 20);
    L.media_photo_max = num(cfg.p_media_photo_max, 6);
    L.bio_len = num(cfg.p_bio_len, 200);
  } catch (e) { /* 读不到走默认 */ }
  _partnerLimitsCache = L;
  _partnerLimitsCacheUntil = now + 5 * 60 * 1000;
  return L;
}

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
async function fetchTencentRoute(mode, from, to, mapKey) {
  const url = 'https://apis.map.qq.com/ws/direction/v1/' + mode +
    '/?from=' + from.lat + ',' + from.lng +
    '&to=' + to.lat + ',' + to.lng +
    '&key=' + encodeURIComponent(mapKey);
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

  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  const { action } = event;
  log.d(`partner-action action=${action} openid=${openid}`);

  // 物理拆分分发: 命中已抽出的 handler 组直接执行(行为与拆分前 inline case 逐字一致)
  if (HANDLERS[action]) {
    const ctx = {
      event, openid, clientIp, device, action,
      cloud, db, _, col, log, writeAudit, buildAuditPatch, suspendLeftDays,
      writeNotice, creditLevelOf, getSceneCodes, getExamBank, examRequiresGate,
      getTencentMapKey, getPartnerLimits, sanitizeHomeLocation, sanitizeWeeklySlots,
      haversineMeters, estimateMinutes, httpsGetJson, fetchTencentRoute,
      getConfig, getProfile, hasBusyOrder, formatTimeAgo,
      BUSY_STATUS, CREDIT_LEVELS, SCENE_CODES_FALLBACK, EXAM_BANK_FALLBACK,
      ROUTE_TIMEOUT_MS, PARTNER_LIMITS_FALLBACK, WEEK_KEYS, SLOT_DEFAULT
    };
    return await HANDLERS[action](ctx);
  }

  switch (action) {    // 5. 耍伴接单考试    // 6. 审核(管理员专用)
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
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_review',
        target_type: 'partner_profile', target_id: profile._id,
        detail: { target_openid, status: newStatus, pass: !!pass },
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { target_openid, status: newStatus } };
    }

    // 4.5 耍伴资料维护(bio/skills/highlights; 内容安全+审核快照, fail-closed)
    //     硬拦截 URL/联系方式 → msgSecCheck → 本地词库; 写入待审区, profile_audit_status=pending
    //     展示端只读 profile_audited_snapshot, 未过审不上线
    case 'update_partner_profile': {
      const me = await getProfile(openid);
      // 入驻审核未通过(非 rejected/pending_review)之外, 允许维护资料:
      // 已入驻(approved)/入驻审核中(pending_review)可提前备资料; 资料展示仍只读 status==='approved' 的快照(fail-closed)
      if (!me || me.status === 'rejected') {
        return { ok: false, code: 'pa_not_partner', msg: '仅认证耍伴可维护资料' };
      }
      // 并发幂等: 审核中禁止重复提交(防双击/连点产多条 audit)
      if (me.profile_audit_status === 'pending') {
        return { ok: false, code: 'pa_audit_pending', msg: '资料正在审核中,请耐心等待' };
      }
      // 限频: 距上次提交 30 分钟内拒绝
      if (me.profile_submit_at && Date.now() - me.profile_submit_at < 30 * 60 * 1000) {
        return { ok: false, code: 'pa_submit_frequent', msg: '提交太频繁,请30分钟后再试' };
      }

      // 入参清洗与上限(数量/字数限制从 admin_config 动态读取, 后台可配; 读不到走默认不放大)
      const pLimits = await getPartnerLimits();
      const bio = String(event.bio || '').trim().slice(0, pLimits.bio_len);
      const skills = (Array.isArray(event.skills) ? event.skills : [])
        .map((s) => String(s || '').trim()).filter(Boolean).slice(0, pLimits.skills_max)
        .map((s) => s.slice(0, pLimits.skills_len));
      const highlights = (Array.isArray(event.service_highlights) ? event.service_highlights : [])
        .map((s) => String(s || '').trim()).filter(Boolean).slice(0, pLimits.highlights_max)
        .map((s) => s.slice(0, pLimits.highlight_len));
      // 资质证书 / 荣誉 其他: 每条仅标题(条数/字数后台可配), 图片为栏目级多图(张数后台可配, 存云存储 fileID)
      const sanitizeMedia = (titles, photos) => ({
        titles: (Array.isArray(titles) ? titles : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, pLimits.media_title_max).map((s) => s.slice(0, pLimits.media_len)),
        photos: (Array.isArray(photos) ? photos : []).map((f) => String(f || '')).filter(Boolean).slice(0, pLimits.media_photo_max)
      });
      const qualifications = sanitizeMedia(event.qual_titles, event.qual_photos);
      const honors = sanitizeMedia(event.hon_titles, event.hon_photos);
      const hasMedia = (m) => m.titles.length > 0 || m.photos.length > 0;
      if (!bio && !skills.length && !highlights.length && !hasMedia(qualifications) && !hasMedia(honors)) {
        return { ok: false, code: 'pa_profile_empty', msg: '请至少填写一项资料内容' };
      }

      // 硬拦截(零延迟, 先于 msgSecCheck): URL/微信号/联系方式/转账引流
      const CONTACT_RE = /(https?:\/\/|www\.|wxid|微信号|加微信|加V|转账|支付宝|QQ号|手机号1[3-9]\d{9})/i;
      const allText = [bio, ...skills, ...highlights, ...qualifications.titles, ...honors.titles].join(' ');
      if (CONTACT_RE.test(allText)) {
        return { ok: false, code: 'pa_profile_contact', msg: '资料不能包含联系方式/链接,请修改后重试' };
      }

      // 内容安全(复用项目模式: msgSecCheck + 本地词库降级)
      try {
        const r = await cloud.openapi.security.msgSecCheck({ content: allText });
        if (r.errCode !== 0) {
          return { ok: false, code: 'pa_profile_unsafe', msg: '资料包含违规内容,请修改后重试' };
        }
      } catch (e) {
        log.w('msgSecCheck fail(降级本地词库):', (e && (e.errCode || e.errMsg || e.message)) || '');
        const cfg = await getConfig();
        const hit = (cfg.block_words || []).find((w) => allText.indexOf(w) >= 0);
        if (hit) {
          return { ok: false, code: 'pa_profile_unsafe', msg: '资料包含敏感词,请修改后重试' };
        }
      }

      // 写入待审区(不动快照, 展示端仍读旧快照)
      await col('partner_profile').doc(me._id).update({ data: {
        bio_pending: bio, skills_pending: skills, highlights_pending: highlights,
        qualifications_pending: qualifications, honors_pending: honors,
        profile_audit_status: 'pending', profile_submit_at: Date.now(), updated_at: Date.now()
      }});
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_profile_update',
        target_type: 'partner_profile', target_id: me._id,
        detail: { bio_len: bio.length, skills_count: skills.length, highlights_count: highlights.length,
          qual_titles: qualifications.titles.length, qual_photos: qualifications.photos.length,
          hon_titles: honors.titles.length, hon_photos: honors.photos.length },
        result: 'ok', client_ip: clientIp, device
      });
      // 推送审核中提醒给耍伴
      await writeNotice({
        to_openid: openid,
        type: 'partner_profile_submitted',
        title: '资料审核中',
        body: '你的耍伴资料已提交审核，审核通过后将自动展示。',
        action_key: 'partner_profile_edit'
      });
      return { ok: true, data: { msg: '资料已提交,审核通过后自动展示', profile_audit_status: 'pending' } };
    }

    // 4.6 耍伴资料审核(管理员专用; 支持按栏目独立通过/驳回: items=[{field,pass,reason}])
    //     通过某栏目 → 该栏目 pending 并入快照(覆盖), 清其 pending
    //     驳回某栏目 → 清该栏目 pending(可重提), 留 reason
    //     全部栏目处理完后若仍有 pending 未清 → 保持 pending 锁; 否则解除锁
    //
    // ⚠️ DEPRECATED(兼容入口): 耍伴资料审核统一走 admin-action.partner_profile_review(admin-web 后台)。
    //    本分支仅保留供云端「云端测试」面板人工触发; 逻辑与 admin-action 保持一致(items 白名单/判空/锁判定)。
    case 'audit_partner_profile': {
      const config = await getConfig();
      const adminList = config.admin_openids || [];
      if (adminList.indexOf(openid) < 0) {
        return { ok: false, code: 'pa_not_admin', msg: '无管理员权限' };
      }
      const { target_openid, items } = event;
      if (!target_openid) return { ok: false, code: 'pa_no_target', msg: '缺少待审核耍伴' };
      const profile = await getProfile(target_openid);
      if (!profile) return { ok: false, code: 'pa_target_no_profile', msg: '目标用户不是耍伴' };
      if (profile.profile_audit_status !== 'pending') {
        return { ok: false, code: 'pa_no_pending', msg: '该耍伴资料不在审核队列' };
      }
      if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, code: 'pa_no_items', msg: '缺少审核项' };
      }

      const now = Date.now();
      // 收敛: 审核增量由 _shared/partner_audit 唯一实现(与 admin-action 同源, 防漂移)
      const { patch, hist, hasRemainingPending, anyPatched } = buildAuditPatch(profile, items, now, openid);
      if (!anyPatched || Object.keys(patch).length === 0) {
        return { ok: false, code: 'pa_no_pending', msg: '所选审核项均无待审内容' };
      }
      patch.profile_audit_history = _.push(...hist);
      await col('partner_profile').doc(profile._id).update({ data: patch });

      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_profile_audit',
        target_type: 'partner_profile', target_id: profile._id,
        detail: { target_openid, items: items.map((i) => ({ field: i.field, pass: !!i.pass })) },
        result: 'ok', client_ip: clientIp, device
      });
      // 推送审核结果给耍伴
      await writeNotice({
        to_openid: profile.openid || target_openid,
        type: hasRemainingPending ? 'partner_profile_rejected' : 'partner_profile_approved',
        title: hasRemainingPending ? '部分资料未通过' : '资料审核通过',
        body: hasRemainingPending
          ? '你的部分耍伴资料未通过审核，请修改未通过的栏目后重新提交；已通过的栏目已展示。'
          : '你的耍伴资料已通过审核，已在耍伴卡片与详情页展示。',
        action_key: 'partner_profile_edit'
      });
      return { ok: true, data: { target_openid, profile_audit_status: hasRemainingPending ? 'pending' : 'approved' } };
    }

    // 5. 耍伴详情（C端公开）
    case 'detail': {
      const { partner_openid } = event;
      if (!partner_openid) return { ok: false, code: 'pa_no_target', msg: '缺少耍伴标识' };

      const r = await col('partner_profile').where({ openid: partner_openid, status: 'approved', is_deleted: false }).limit(1).get();
      if (!r.data || !r.data[0]) return { ok: false, code: 'pa_not_found', msg: '耍伴不存在或未认证' };
      const p = r.data[0];

      // 拉 user_account 拿昵称头像 + 动态信用分(partner_credit_score 为真值源)
      let nickname = p.nickname || '微信用户', avatar = '', creditScore = 800;
      try {
        const ua = await col('user_account').where({ openid: partner_openid }).limit(1).get();
        if (ua.data && ua.data[0]) {
          nickname = ua.data[0].nickname || nickname;
          avatar = ua.data[0].avatar || '';
          const cs = Number(ua.data[0].partner_credit_score);
          if (Number.isFinite(cs) && cs > 0) creditScore = cs;
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
            score: creditScore,
            level: creditLevelOf(creditScore),
            accept_switch: p.accept_switch !== false,
            real_name_verified: !!p.real_name_verified,
            face_verified: !!p.face_verified,
            intro: p.intro || '这个耍伴还没写自我介绍~',
            certified_scenes: p.accept_scenes || [],
            // 耍伴资料: 展示端只读审核通过快照(未过审/审核中一律不上线, fail-closed)
            bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
            skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || [],
            service_highlights: (p.profile_audited_snapshot && p.profile_audited_snapshot.highlights) || [],
            // 资质证书 / 荣誉 其他(展示端只读审核通过快照)
            qualifications: (p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications) || { titles: [], photos: [] },
            honors: (p.profile_audited_snapshot && p.profile_audited_snapshot.honors) || { titles: [], photos: [] }
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

      const mapKey = await getTencentMapKey();
      const modeDefs = [['drive', 'driving'], ['transit', 'transit'], ['bike', 'bicycling']];
      const results = await Promise.all(modeDefs.map(async ([key, mode]) => {
        if (!mapKey) {
          return { key, minutes: estimateMinutes(key, straightM), source: 'estimate', distance_m: null };
        }
        try {
          const rr = await fetchTencentRoute(mode, from, to, mapKey);
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
