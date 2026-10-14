// 对应 PRD 章节：3.3 需求发布功能 / 8.4.1 需求超时与梯度退款 / 11 业务场景白名单
// demand-publish 需求发布 · 身份取自 getWXContext().OPENID
// 8 个 action: publish / cancel / my_demands / lazy_expire / detail
//             / save_draft(新增或更新草稿) / list_drafts(草稿列表,过滤过期) / delete_draft(软删)
// 草稿上限与有效期与小程序 config/index.js DRAFT 对齐: maxCount=20 / expireDays=30
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');
const { writeAudit } = require('./audit');
// 手机号加密(P0-3 整改): 账户已绑号现为密文, 取真号须解密(兼容存量明文)
const phoneCrypt = require('./phone_crypt');
// 场景中文名兜底映射(规范源 _shared/scene_meta.js, 修改后跑 sync-scene-meta.ps1)
const { SCENE_NAMES: SCENE_NAME } = require('./scene_meta');

// 场景白名单: 动态从 admin_config.scene_list 读取(SSOT), 兜底与 init-db 种子对齐
const SCENE_CODES_FALLBACK = ['W1', 'W2', 'W8', 'W10', 'W11'];
let _sceneCodesCache = null;
async function getSceneCodes() {
  if (_sceneCodesCache) return _sceneCodesCache;
  try {
    const r = await col('admin_config').doc('global').get();
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

// 接单模式白名单: direct=定向邀约(指定耍伴,不入大厅) · broadcast=抢单(先到先得) · select=选单(耍伴报名→需求者确认)
const MATCH_MODE_WHITELIST = ['direct', 'broadcast', 'select'];

// 场景→免责声明类型映射(code.html 第一道防线·双签)
const DISCLAIMER_TYPE_MAP = {
  W1: 'medical_disclaimer',     // 就医陪诊免责声明(国标第7条)
  W2: 'general_disclaimer',     // 学习陪伴
  W3: 'sports_disclaimer',      // 健身陪伴(运动伤害免责)
  W4: 'general_disclaimer',     // 游玩陪伴
  W7: 'emotion_disclaimer',     // 情绪陪伴(非心理咨询免责)
  W8: 'general_disclaimer',     // 生活协助
  W9: 'pet_disclaimer',         // 宠物陪伴(宠物授权+伤害免责)
  W10: 'general_disclaimer',    // 出行陪伴
  W11: 'online_disclaimer'      // 线上陪伴内容协议
};

// 场景子服务选项兜底(与 init-db 种子 admin_config.scene_list / 小程序 config/enums.js 一致)
const SCENE_OPTIONS_FALLBACK = {
  W1: ['挂号排队', '取药送药', '陪诊解压'],
  W2: ['自习陪伴', '口语陪练', '作业督促'],
  W3: ['健身指导', '跑步陪跑', '器械陪同'],
  W4: ['景区游览', '博物馆参观', '商圈逛街'],
  W7: ['陪伴散步', '倾听陪伴', '考前鼓励'],
  W8: ['排队代办', '搬家帮手', '采买陪同'],
  W9: ['遛狗陪伴', '喂猫照料', '宠物就医陪同'],
  W10: ['逛街同行', '夜跑陪跑', '活动搭子'],
  W11: ['树洞倾听', '游戏陪玩', '打卡监督']
};

// 备注安全检测降级词库(rules.md 六 · msgSecCheck 不可用时降级本地违禁词)
const BLOCK_WORDS_FALLBACK = ['加微信', '加V', '转账', '私聊我', '威信', 'VX', 'vx', '加我vx', '扣扣', 'QQ号', '支付宝', '口令红包', '站外交易', '线下转账'];

// ─────────────── P1 节点留证(勾选同意型) ───────────────
// 发布/修改需求时用户勾选《场景免责声明》等文档; 服务端记录所同意文档全文 + SHA-256 落 disclaimer_signature 集合。
// 与实名手写签名留证(kind=realname_agreement)同集合不同 kind; 全文入库保证事后可举证"当时同意的是什么"
// o.doc 可显式指定文档(如 W9《宠物照料授权书》); 缺省取场景免责声明(admin_config.legal_scene_disclaimers)
const DEFAULT_PET_AUTHORIZATION = [
  '找人帮忙 宠物照料授权书（电子确认）',
  '一、本人系所照料宠物的主人，或已获得宠物主人的明确授权；',
  '二、本人知悉并确认：服务内容仅限遛狗、宠物医院陪同等陪同类事项；禁止代为饲养，禁止上门喂猫、寄养等入户照料；',
  '三、服务过程中如发生宠物伤人、应激等情形，双方应及时沟通处理，并保留相关记录；',
  '四、本人同意：本电子确认记录将作为平台内「明确授权」凭证留存，用于履约与纠纷举证。'
].join('\n');
function sceneDocText(config, scene) {
  const m = config && config.legal_scene_disclaimers;
  const t = (m && typeof m === 'object') ? m[scene] : '';
  return typeof t === 'string' ? t.trim() : '';
}
function buildCheckboxEvidence(o) {
  const doc = o.doc
    ? { key: o.doc.key, title: o.doc.title, text: String(o.doc.text || '').trim() }
    : { key: 'scene_disclaimer', title: `场景免责声明(${o.scene})`, text: sceneDocText(o.config, o.scene) };
  const docs = doc.text ? [{
    key: doc.key,
    title: doc.title,
    hash: crypto.createHash('sha256').update(doc.text, 'utf8').digest('hex'),
    text: doc.text
  }] : [];
  const data = {
    openid: o.openid,
    role: o.role,
    scene: o.scene,
    kind: o.kind || 'scene_disclaimer',
    disclaimer_type: o.disclaimerType,
    agree_type: 'checkbox',   // 勾选同意(无手写签名; 手写签名见 kind=realname_agreement)
    docs,
    // 兼容旧字段: 原为占位 sig_xxx, 现为所同意文档的 SHA-256(文档缺失时保留占位以标记异常)
    signature_hash: docs.length ? docs[0].hash : `sig_missing_${o.openid}_${o.scene}_${o.signedAt}`,
    signed_at: o.signedAt,
    created_at: o.signedAt,
    updated_at: o.signedAt,
    is_deleted: false
  };
  if (o.demandId) data.demand_id = o.demandId;
  if (o.orderId) data.order_id = o.orderId;
  // 手写签字型(覆盖 signature_hash/agree_type): 用于 W9 授权书本人手写签字留证
  if (o.signature) {
    data.signature_file_id = o.signature.fileId;
    data.signature_hash = o.signature.hash;
    data.signature_size = o.signature.size;
    data.verify_method = 'handwritten';
    data.agree_type = 'handwritten';
  }
  return data;
}

// 电话格式校验: 11 位手机号 或 带区号座机(区号 0 开头 3-4 位 + 连字符 + 7-8 位号码, 如 028-88888888)
function isPhoneOrLandline(s) {
  const t = String(s || '').trim();
  return /^1[3-9]\d{9}$/.test(t) || /^0\d{2,3}-\d{7,8}$/.test(t);
}
// 电话脱敏(phone_mask 语义): 手机保留前 3 后 4; 座机保留区号 + 后 4; 其他长度保留首尾各 2 位
function maskContact(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  const ll = t.match(/^(0\d{2,3})-(\d{7,8})$/);
  if (ll) return ll[1] + '-****' + ll[2].slice(-4);
  if (/^1[3-9]\d{9}$/.test(t)) return t.slice(0, 3) + '****' + t.slice(7);
  if (t.length <= 4) return t;
  return t.slice(0, 2) + '****' + t.slice(-2);
}

// W9 手写签字图取证: 服务端下载 → PNG 魔数 + 体积校验 → SHA-256(证明入库时刻文件内容, 与实名留证同口径)
async function verifySignatureFile(fileId) {
  if (!fileId || !/^cloud:\/\//.test(String(fileId))) return { ok: false, code: 'missing' };
  try {
    const dl = await cloud.downloadFile({ fileID: String(fileId) });
    const buf = dl && dl.fileContent;
    const size = buf ? buf.length : 0;
    if (!buf || !size || size > 2 * 1024 * 1024) return { ok: false, code: 'bad_size' };
    if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)) return { ok: false, code: 'not_png' };
    return { ok: true, fileId: String(fileId), hash: crypto.createHash('sha256').update(buf).digest('hex'), size };
  } catch (e) {
    log.d(`pet signature verify fail: ${(e && e.message) || e}`);
    return { ok: false, code: 'download_fail' };
  }
}
const REMARK_MAX_LEN = 200;

// 备注内容安全:msgSecCheck v2;87014 明确违规;其他异常(未开通/网络)降级本地违禁词
async function checkText(openid, text, blockWords) {
  try {
    await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 2,   // 2=评论/留言场景
      openid
    });
    return { pass: true };
  } catch (e) {
    if (e && (e.errCode === 87014 || e.errCode === '87014')) {
      return { pass: false, reason: '备注包含违规信息,请修改后重试' };
    }
    log.w('msgSecCheck fail(降级本地词库):', (e && (e.errCode || e.errMsg || e.message)) || '');
    // 降级:本地违禁词库
    const words = (blockWords && blockWords.length) ? blockWords : BLOCK_WORDS_FALLBACK;
    const lower = String(text).toLowerCase();
    for (const w of words) {
      if (w && lower.indexOf(String(w).toLowerCase()) >= 0) {
        return { pass: false, reason: '备注包含平台禁止的内容(如联系方式/转账),请修改后重试' };
      }
    }
    // fail-closed(评审整改 P1): msgSecCheck 不可用时不再放行, 避免违规内容绕过(与 blog/evaluation 同口径)
    return { pass: false, reason: '内容安全校验暂不可用,请稍后重试', degraded: true };
  }
}

// 生成需求编号 DR + yyyymmdd + 8字节密码学随机
function genDemandNo() {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const r = require('crypto').randomBytes(8).toString('hex');
  return `DR${ymd}${r}`;
}

// D2-3 防漂移抽取: 规范源 _shared/take_rules.js(修改后跑 sync-take-rules.ps1 同步四个函数)
const { isServiceTimeAllowed, suspendLeftDays, haversineKm } = require('./take_rules');
// D4-5 防漂移抽取: 测试数据打标规范源 _shared/test_data.js(修改后跑 sync-test-data.ps1 同步)
const { isTestOpenid } = require('./test_data');

function validLngLat(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number'
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
}

// 取运营参数(失败用兜底)
async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) return r.data;   // doc().get() 返回单个对象(非数组)
  } catch (e) {}
  return {
    rate_min_fen: 3000, rate_max_fen: 10000,
    youth_limit_fen: 20000,
    min_credit_place_order: 600,
    city_enabled: ['成都'],
    publish_distance_max_km: 50,
    take_distance_max_km: 50
  };
}

// 子服务内容最多项数(后台 publish_content_options_max 可配, 缺省 3)
function contentOptionsMax(config) {
  const v = Number(config && config.publish_content_options_max);
  return Number.isFinite(v) && v >= 1 ? v : 3;
}

// 信用分等级(与 partner-action 同源: L1[600,699] L2[700,799] L3[800,899] L4[900,1000])
function creditLevelOf(score) {
  if (!Number.isFinite(score)) return 'L1';
  if (score >= 900) return 'L4';
  if (score >= 800) return 'L3';
  if (score >= 700) return 'L2';
  return 'L1';
}

// 相对时间文案(推荐卡片最新动态用)
function timeAgoText(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
  return new Date(ts).toLocaleDateString();
}

// 推荐耍伴明细(Top5): 同场景可接单 + 审核通过 + 信用达标, 按信用分降序
// 失败/无候选一律返回 [], 绝不阻断 detail 主流程
async function buildRecommendPartners(d) {
  try {
    const scene = (d && d.scene) || '';
    if (!scene) return [];
    let cfg = {};
    try { cfg = await getConfig(); } catch (e) { cfg = {}; }
    const minCredit = Number(cfg.min_credit_take_order) || 600;
    const base = { status: 'approved', is_deleted: _.neq(true), accept_switch: _.neq(false), accept_scenes: scene };
    const pick = async (extra) => {
      const r = await col('partner_profile').where(Object.assign({}, base, extra))
        .orderBy('credit_score', 'desc').limit(20).get();
      return r.data || [];
    };
    let rows = [];
    try { rows = await pick({ credit_score: _.gte(minCredit) }); } catch (e) { rows = []; }
    if (!rows.length) { try { rows = await pick({}); } catch (e) { rows = []; } }  // 去掉信用门槛重试
    if (!rows.length) return [];

    const openids = rows.map((p) => p.openid).filter(Boolean);
    if (!openids.length) return [];

    // 富化(并行): user_account + blog_post 各一次批量查询(降低冷启动时延, 避免 detail 3s 超时)
    const [uMap, dynMap] = await Promise.all([
      (async () => {
        const m = {};
        try {
          const ur = await col('user_account').where({ openid: _.in(openids) }).get();
          (ur.data || []).forEach((u) => { m[u.openid] = u; });
        } catch (e) {}
        return m;
      })(),
      (async () => {
        const m = {};
        try {
          const br = await col('blog_post')
            .where({ author_openid: _.in(openids), status: 'normal', is_deleted: false })
            .orderBy('created_at', 'desc').limit(openids.length * 3).get();
          (br.data || []).forEach((bp) => {
            if (m[bp.author_openid]) return;   // 每人仅取最新一条
            m[bp.author_openid] = {
              cover: (bp.images && bp.images[0]) || '',
              title: String(bp.content || '').slice(0, 40),
              at: timeAgoText(bp.created_at)
            };
          });
        } catch (e) {}
        return m;
      })()
    ]);

    const demandLoc = (d && d.location) || {};
    const hasDemandLoc = validLngLat(Number(demandLoc.latitude), Number(demandLoc.longitude));

    const list = [];
    for (const p of rows) {
      const u = uMap[p.openid] || {};
      const cs = Number(u.partner_credit_score);
      const credit = (Number.isFinite(cs) && cs > 0) ? cs : (Number(p.credit_score) || 0);

      // 价格: 优先该场景报价, 否则全部场景 min/max(分→元)
      const rates = p.scene_rates || {};
      let priceMin = null, priceMax = null;
      const scoped = Number(rates[scene]);
      if (Number.isFinite(scoped) && scoped > 0) {
        priceMin = Math.round(scoped / 100); priceMax = priceMin;
      } else {
        const vals = Object.keys(rates).map((k) => Number(rates[k])).filter((v) => Number.isFinite(v) && v > 0);
        if (vals.length) { priceMin = Math.round(Math.min.apply(null, vals) / 100); priceMax = Math.round(Math.max.apply(null, vals) / 100); }
      }

      // 距离(需求履约地 ↔ 耍伴日常位置; 语义为"距履约地", 无坐标则 null)
      let distanceKm = null;
      const hl = p.home_location || {};
      if (hasDemandLoc && validLngLat(Number(hl.latitude), Number(hl.longitude))) {
        distanceKm = Math.round(haversineKm(
          Number(demandLoc.latitude), Number(demandLoc.longitude), Number(hl.latitude), Number(hl.longitude)
        ) * 10) / 10;
      }

      list.push({
        _id: p._id, openid: p.openid,
        nickname: u.nickname || p.nickname || '微信用户',
        avatar: u.avatar || '',
        real_name_verified: !!p.real_name_verified,
        face_verified: !!p.face_verified,
        partner_credit_score: credit,
        partner_level: creditLevelOf(credit),
        accept_scenes: p.accept_scenes || [],
        certified_scenes: p.accept_scenes || [],
        city: p.city || '',
        bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
        order_count: null,    // 不做逐人计数查询(省冷启动时延); 卡片因缺 on_time_rate/praise_rate 恒显示「数据积累中」
        on_time_rate: null,   // 项目暂无该数据源(卡片据此显示「数据积累中」)
        praise_rate: null,
        price_min: priceMin,
        price_max: priceMax,
        distance_km: distanceKm,
        latest_dynamic: dynMap[p.openid] || null
      });
    }
    list.sort((a, b) => (b.partner_credit_score - a.partner_credit_score)
      || ((a.distance_km == null ? 9999 : a.distance_km) - (b.distance_km == null ? 9999 : b.distance_km)));
    return list.slice(0, 5);
  } catch (e) {
    log.d(`buildRecommendPartners fail: ${e.message}`);
    return [];
  }
}

// 服务端时间红线(R1)已收敛到 _shared/take_rules.js 统一实现(见上方 require)

// 获取用户文档
async function getUser(openid) {
  const r = await col('user_account').where({ openid }).limit(1).get();
  // 修复: get() 返回 { data: [doc] }, 必须取 [0]; 之前返回数组导致 user.is_realname_done 恒为 undefined → 误报需实名
  return (r.data && r.data[0]) || null;
}

// 检查紧急联系人是否已填
async function hasEmergencyContact(openid) {
  const r = await col('emergency_contact').where({ openid, is_deleted: false }).limit(1).get();
  return r.data && r.data.length > 0;
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制(拦截需求编号/占位符)
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// 写入自愈:集合不存在(-502005)时建集合并重试一次(demand_draft 首次落库兜底)
async function addWithColl(name, doc) {
  try {
    return await col(name).add({ data: doc });
  } catch (e) {
    const sig = `${e && e.errCode || ''} ${e && e.message || ''}`;
    if (!/502005|not exist|不存在/i.test(sig)) throw e;
    await db.createCollection(name);
    return await col(name).add({ data: doc });
  }
}

// 已拆分 action 的 HANDLERS 分发表(物理拆分, 行为逐字不变; 约束见 .trae/skills/cloud-function-split)
const HANDLERS = Object.assign({},
  require('./action_lifecycle'),
  require('./action_publish'),
  require('./action_query'),
  require('./action_draft')
);

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'publish_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`demand-publish action=${action} openid=${openid}`);

  // 审计留痕公共字段
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  // 已拆分 action 走 HANDLERS 分发; 其余 action 仍走下方 switch
  if (HANDLERS[action]) {
    const ctx = {
      event, openid, clientIp, device, action, wxCtx, db, _, col, log, writeAudit, crypto, cloud,
      phoneCrypt, SCENE_NAME, SCENE_CODES_FALLBACK, getSceneCodes, MATCH_MODE_WHITELIST, DISCLAIMER_TYPE_MAP,
      SCENE_OPTIONS_FALLBACK, BLOCK_WORDS_FALLBACK, DEFAULT_PET_AUTHORIZATION, sceneDocText, buildCheckboxEvidence,
      isPhoneOrLandline, maskContact, verifySignatureFile, REMARK_MAX_LEN, checkText, genDemandNo,
      isServiceTimeAllowed, suspendLeftDays, haversineKm, isTestOpenid, validLngLat, getConfig, contentOptionsMax,
      creditLevelOf, timeAgoText, buildRecommendPartners, getUser, hasEmergencyContact, isValidDocId, addWithColl, lazyExpire
    };
    return await HANDLERS[action](ctx);
  }

  switch (action) {

    // 9. 更新需求(仅创建者,仅 matching 状态; 白名单字段更新; 跳过发布地址重定位)
    case 'update': {
      const { demand_id, scene, start_time, duration_h, location, content_option, content_options,
        remark, rate_fen, aa_tier, aa_promise_checked, disclaimer_signed,
        match_mode, target_openid, gender_pref, headcount, pet_auth_checked, pet_auth_signature_file_id,
        pricing_type, fixed_price_fen, project_attr } = event;
      // 计价模式归一化(与 publish 同口径; 缺省 hourly/commercial 兼容存量)
      const pricingTypeU = pricing_type === 'fixed' ? 'fixed' : 'hourly';
      const projectAttrU = project_attr === 'public_welfare' ? 'public_welfare' : 'commercial';
      const isWelfareU = projectAttrU === 'public_welfare';

      if (!demand_id) return { ok: false, code: 'update_no_id', msg: '缺少需求 ID' };
      if (!isValidDocId(demand_id)) return { ok: false, code: 'update_bad_id', msg: '需求 ID 格式不正确' };

      // d 需在整个 update case 可见(后续 mode 兜底 + 成功日志均引用);
      // 此前 const 声明在 try 块内, 块外引用抛 ReferenceError: d is not defined, 被误判为 DB 失败
      let d;
      try {
        const r = await col('demand').doc(demand_id).get();
        d = r.data;
        if (!d || d.is_deleted) return { ok: false, code: 'update_not_found', msg: '需求不存在' };
        if (d.creator_openid !== openid) return { ok: false, code: 'update_not_owner', msg: '无权编辑此需求' };
        if (d.status !== 'matching') return { ok: false, code: 'update_bad_status', msg: `当前状态(${d.status})不可编辑` };
      } catch (e) {
        return { ok: false, code: 'update_get_fail', msg: '查询需求失败' };
      }

      // ── 并行拉配置 + 用户 ──
      const [config, user] = await Promise.all([getConfig(), getUser(openid)]);
      if (!user) return { ok: false, code: 'update_no_user', msg: '用户不存在,请先登录' };
      if (user.status === 'frozen') return { ok: false, code: 'update_frozen', msg: '账号已冻结' };
      if (user.status === 'banned') return { ok: false, code: 'update_banned', msg: '账号已封禁' };
      if (user.status === 'closed') return { ok: false, code: 'update_closed', msg: '账号已注销' };
      // 断链②修复(第三批爽约): 停用中拦截「发布更新」; 到期/缺 suspend_until 视为已恢复按 normal 放行
      const suspendDaysU = suspendLeftDays(user);
      if (suspendDaysU > 0) {
        return { ok: false, code: 'update_suspended', msg: `账号停用中,${suspendDaysU}天后自动恢复` };
      }

      // ── 场景白名单(动态从 admin_config.scene_list 读取) ──
      const sceneCodes2 = await getSceneCodes();
      if (!scene || sceneCodes2.indexOf(scene) < 0) {
        return { ok: false, code: 'update_scene_invalid', msg: '场景不在白名单' };
      }
      const mode = MATCH_MODE_WHITELIST.indexOf(match_mode) >= 0 ? match_mode : d.match_mode;

      // ── 开始时间: 必须是未来时间戳, 距现在不超 30 天 ──
      if (!start_time || typeof start_time !== 'number' || start_time <= Date.now()) {
        return { ok: false, code: 'update_start_time', msg: '开始时间必须是未来时间' };
      }
      const MAX_ADVANCE_MS = 30 * 24 * 3600 * 1000;
      if (start_time > Date.now() + MAX_ADVANCE_MS) {
        return { ok: false, code: 'update_time_too_far', msg: '服务时间距现在不能超过 30 天' };
      }

      // ── 时长 1-12 ──
      if (!duration_h || duration_h < 1 || duration_h > 12) {
        return { ok: false, code: 'update_duration', msg: '时长需 1-12 小时' };
      }

      // ── 计价分支(与 publish 同口径: hourly / fixed / 公益特例; 收敛到 total_fen) ──
      let docPricingTypeU, docRateFenU, docFixedPriceFenU, docProjectAttrU, total_fen;
      docProjectAttrU = projectAttrU;
      if (isWelfareU) {
        const wFen = Number(config.welfare_fixed_price_fen);
        if (!Number.isFinite(wFen)) {
          return { ok: false, code: 'update_welfare_not_open', msg: '公益单暂未开放,请稍后再试' };
        }
        docPricingTypeU = 'fixed'; docFixedPriceFenU = wFen; docRateFenU = null; total_fen = wFen;
      } else if (pricingTypeU === 'fixed') {
        if (!fixed_price_fen || typeof fixed_price_fen !== 'number' || fixed_price_fen <= 0) {
          return { ok: false, code: 'update_fixed_price', msg: '一口价金额格式有误' };
        }
        const _uFLo = Number(config.fixed_price_min_fen);
        const _uFHi = Number(config.fixed_price_max_fen);
        if (Number.isFinite(_uFLo) && fixed_price_fen < _uFLo) {
          return { ok: false, code: 'update_fixed_range', msg: `一口价需不低于 ${_uFLo / 100} 元` };
        }
        if (Number.isFinite(_uFHi) && fixed_price_fen > _uFHi) {
          return { ok: false, code: 'update_fixed_range', msg: `一口价需不高于 ${_uFHi / 100} 元` };
        }
        docPricingTypeU = 'fixed'; docFixedPriceFenU = fixed_price_fen; docRateFenU = null; total_fen = fixed_price_fen;
      } else {
        if (!rate_fen || typeof rate_fen !== 'number' || rate_fen < 100) {
          return { ok: false, code: 'update_rate', msg: '时薪金额格式有误' };
        }
        // 0 是合法下限(不用 || 兜底); 区间与提示文案均按后台实配生成
        const _uLo = Number(config.rate_min_fen);
        const _uHi = Number(config.rate_max_fen);
        const uLo = Number.isFinite(_uLo) ? _uLo : 3000;
        const uHi = Number.isFinite(_uHi) ? _uHi : 10000;
        if (rate_fen < uLo || rate_fen > uHi) {
          return { ok: false, code: 'update_rate_range', msg: `时薪需在 ${uLo / 100}-${uHi / 100} 元/小时之间` };
        }
        docPricingTypeU = 'hourly'; docFixedPriceFenU = null; docRateFenU = rate_fen; total_fen = rate_fen * duration_h;
      }

      // ── 履约地点 ──
      if (!location || !location.name) {
        return { ok: false, code: 'update_location', msg: '请填写履约地点名称' };
      }

      // ── AA + 免责声明 ──
      if (!aa_tier) return { ok: false, code: 'update_aa_tier', msg: '请选择 AA 档位' };
      if (!aa_promise_checked) return { ok: false, code: 'update_aa_promise', msg: '请先勾选《线下费用自理承诺书》' };
      if (!disclaimer_signed) return { ok: false, code: 'update_disclaimer', msg: '请先勾选《场景免责声明》' };
      // W9 宠物照料授权(与 publish 同口径: 无凭证视为未授权)
      if (scene === 'W9' && !pet_auth_checked) {
        return { ok: false, code: 'update_pet_auth_required', msg: 'W9 宠物陪伴需先确认《宠物照料授权书》' };
      }
      // 首次补留证(该需求此前无凭证)时才要求手写签字图; 已签过的需求沿用原留证不重复签
      let petSignature = null;
      if (scene === 'W9' && pet_auth_checked && d.pet_auth_signed !== true) {
        petSignature = await verifySignatureFile(pet_auth_signature_file_id);
        if (!petSignature.ok) {
          return { ok: false, code: 'update_pet_auth_sign_required', msg: '请完成《宠物照料授权书》手写签字后重试' };
        }
      }

      // ── 定向邀约改 direct 时需校验 target_openid ──
      if (mode === 'direct') {
        if (!target_openid) return { ok: false, code: 'update_target_required', msg: '定向邀约缺少指定耍伴' };
        if (target_openid === openid) return { ok: false, code: 'update_target_self', msg: '不能定向邀约自己' };
        const tpR = await col('partner_profile')
          .where({ openid: target_openid, status: 'approved', is_deleted: _.neq(true) })
          .limit(1).get().catch(() => ({ data: [] }));
        if (!(tpR.data && tpR.data[0])) {
          return { ok: false, code: 'update_target_invalid', msg: '指定耍伴不存在或未通过审核' };
        }
      }

      // ── 城市校验 ──
      const normCity = (c) => String(c || '').replace(/市$/, '').trim();
      const city = normCity(location.city) || '成都';
      let enabledCities = (Array.isArray(config.city_enabled) ? config.city_enabled : [])
        .map(normCity).filter(Boolean);
      if (enabledCities.length === 0) enabledCities = ['成都'];
      const locName = String((location && location.name) || '');
      const cityOk = enabledCities.indexOf(city) >= 0
        || enabledCities.some((c) => city.indexOf(c) >= 0 || locName.indexOf(c) >= 0);
      if (!cityOk) {
        return { ok: false, code: 'update_city_disabled', msg: `当前城市未开通服务(${city})` };
      }

      // ── 子服务内容校验 ──
      let opts = Array.isArray(content_options)
        ? content_options
        : (typeof content_option === 'string' ? [content_option] : []);
      opts = Array.from(new Set(opts.map((s) => String(s || '').trim()).filter(Boolean)));
      if (opts.length === 0) return { ok: false, code: 'update_content_option', msg: '请选择服务内容' };
      if (opts.length > contentOptionsMax(config)) return { ok: false, code: 'update_content_too_many', msg: `服务内容最多 ${contentOptionsMax(config)} 项` };
      const sceneCfg = (config.scene_list || []).find((s) => s.code === scene);
      const allowedOptions = (sceneCfg && sceneCfg.options) || SCENE_OPTIONS_FALLBACK[scene] || [];
      for (const o of opts) {
        if (allowedOptions.indexOf(o) < 0) {
          return { ok: false, code: 'update_content_invalid', msg: `服务内容「${o}」不在该场景可选项内` };
        }
      }

      // ── 备注安全 ──
      const remarkStr = remark ? String(remark).trim() : '';
      if (remarkStr) {
        if (remarkStr.length > REMARK_MAX_LEN) {
          return { ok: false, code: 'update_remark_long', msg: `备注最长 ${REMARK_MAX_LEN} 字` };
        }
        const chk = await checkText(openid, remarkStr, config.block_words);
        if (!chk.pass) {
          return { ok: false, code: 'update_remark_blocked', msg: chk.reason };
        }
      }

      // ── 时间冲突校验:排除当前需求本身 ──
      const newStart = start_time;
      const newEnd = start_time + duration_h * 3600 * 1000;
      const existDemands = await col('demand').where({
        creator_openid: openid, scene, is_deleted: false,
        status: _.neq('cancelled'),
        _id: _.neq(demand_id)  // 排除自己, 避免编辑前和编辑后冲突
      }).get();
      for (const e of existDemands.data) {
        const oldStart = e.start_time;
        const oldEnd = e.start_time + (e.duration_h || 1) * 3600 * 1000;
        if (!(newStart < oldEnd && oldStart < newEnd)) continue;
        const oldOpts = (e.content_options && e.content_options.length)
          ? e.content_options
          : (e.content_option ? [e.content_option] : []);
        if (opts.some((o) => oldOpts.indexOf(o) >= 0)) {
          return { ok: false, code: 'update_time_conflict', msg: '该时段已有同类服务需求,请调整时间' };
        }
      }

      // ── 青少年保护(total_fen 已在计价分支算出) ──
      if (user.age !== null && user.age !== undefined && user.age >= 18 && user.age <= 22) {
        if (total_fen > (config.youth_limit_fen || 20000)) {
          return { ok: false, code: 'update_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
        }
      }

      // ── 白名单字段组装(publish_location/broadcast/invited 等系统字段禁止改) ──
      const now = Date.now();
      const patch = {
        scene,
        content_option: opts[0],
        content_options: opts,
        start_time,
        duration_h,
        location: {
          name: location.name,
          address: location.name,
          latitude: location.latitude || 0,
          longitude: location.longitude || 0,
          city
        },
        remark: remarkStr,
        pricing_type: docPricingTypeU,
        project_attr: docProjectAttrU,
        rate_fen: docRateFenU,
        fixed_price_fen: docFixedPriceFenU,
        total_fen,
        aa_tier,
        aa_promise_signed: !!aa_promise_checked,
        disclaimer_signed: !!disclaimer_signed,
        disclaimer_signed_at: now,
        match_mode: mode,
        headcount: headcount || 1,
        gender_pref: gender_pref || '不限',
        updated_at: now
      };
      // match_mode 改了 → 同步更新 broadcast/invited(不改 publish_location!)
      patch.broadcast = mode === 'broadcast';
      patch.invited = mode === 'direct' ? [target_openid] : [];
      // 场景变更时同步刷新免责声明类型(SSOT: admin_config.scene_list; 此前 update 漏刷新, 场景与类型可能不一致)
      patch.disclaimer_type = (sceneCfg && sceneCfg.disclaimer_type) || DISCLAIMER_TYPE_MAP[scene] || 'general_disclaimer';
      // W9 宠物照料授权(电子确认)状态同步; 非 W9 场景恒 false
      patch.pet_auth_signed = scene === 'W9' && !!pet_auth_checked;
      if (patch.pet_auth_signed) patch.pet_auth_signed_at = now;
      if (mode === 'direct' && target_openid) {
        patch.target_openid = target_openid;
      }

      // ── CAS 更新: 仅 matching 状态可改, 防止并发冲突 ──
      try {
        const cr = await col('demand').where({ _id: demand_id, status: 'matching' }).update({ data: patch });
        if (!cr.stats || cr.stats.updated !== 1) {
          return { ok: false, code: 'update_gone', msg: '需求状态已变化,请刷新后重试' };
        }
        log.d(`demand updated: ${d.demand_no}`);
        // ── P1 留证: 场景变更(=换签新场景免责声明)才补新留证; 场景未变沿用原留证(不重复签) ──
        let upEvidenceId = '';
        let upEvidenceHash = '';
        let upPetEvidenceId = '';
        if (d.scene !== scene) {
          try {
            const upData = buildCheckboxEvidence({
              openid, role: 'user', scene, disclaimerType: patch.disclaimer_type, config,
              demandId: demand_id, signedAt: now
            });
            const upRes = await col('disclaimer_signature').add({ data: upData });
            upEvidenceId = (upRes && upRes._id) || '';
            upEvidenceHash = upData.signature_hash || '';
            log.d(`scene evidence(user) written(update): ${d.demand_no}`);
          } catch (ee) {
            log.d(`scene evidence(update) fail: ${(ee && ee.message) || ee}`);
            col('platform_event').add({ data: {
              level: 'P3', type: 'evidence_write_fail', openid,
              payload: { node: 'update', scene, demand_id, message: String((ee && ee.message) || ee) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }}).catch(() => {});
          }
        }
        // ── W9 留证: 首次确认宠物照料授权书(该需求此前无凭证)时补留证 ──
        if (scene === 'W9' && pet_auth_checked && d.pet_auth_signed !== true) {
          try {
            const upPetData = buildCheckboxEvidence({
              openid, role: 'user', scene, disclaimerType: 'pet_authorization',
              config, demandId: demand_id, signedAt: now,
              kind: 'pet_authorization',
              signature: petSignature,
              doc: {
                key: 'pet_authorization', title: '宠物照料授权书',
                text: String(config.legal_pet_authorization || DEFAULT_PET_AUTHORIZATION)
              }
            });
            const upPetRes = await col('disclaimer_signature').add({ data: upPetData });
            upPetEvidenceId = (upPetRes && upPetRes._id) || '';
            log.d(`pet auth evidence written(update): ${d.demand_no}`);
          } catch (ee) {
            log.d(`pet auth evidence(update) fail: ${(ee && ee.message) || ee}`);
            col('platform_event').add({ data: {
              level: 'P3', type: 'evidence_write_fail', openid,
              payload: { node: 'update_pet', scene, demand_id, message: String((ee && ee.message) || ee) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }}).catch(() => {});
          }
        }
        await writeAudit(db, log, {
          openid, role: 'user', category: 'business', action: 'demand_update',
          target_type: 'demand', target_id: demand_id,
          detail: {
            demand_no: d.demand_no, scene, prev_scene: d.scene, match_mode: mode,
            scene_changed: d.scene !== scene,
            pet_auth: scene === 'W9' && !!pet_auth_checked,
            evidence_ids: [upEvidenceId, upPetEvidenceId].filter(Boolean)
          },
          evidence_id: upEvidenceId, doc_hash: upEvidenceHash,
          result: 'ok', client_ip: clientIp, device
        });
        return { ok: true, data: { _id: demand_id, updated_at: now } };
      } catch (e) {
        // 记录数据库原始错误(此前被吞, 无法定位; 查询通道: admin-action export_collection platform_event)
        try {
          await col('platform_event').add({ data: {
            level: 'P3', type: 'demand_update_fail', openid,
            payload: { demand_id, message: String((e && e.message) || e), errCode: (e && e.errCode) || '' },
            created_at: Date.now(), updated_at: Date.now(), is_deleted: false
          }});
        } catch (_) {}
        log.d(`update db fail: ${(e && e.message) || e}`);
        return { ok: false, code: 'update_db_fail', msg: '需求更新失败' };
      }
    }

    default:
      return { ok: false, code: 'publish_unknown_action', msg: '未知动作' };
  }
};

// ─────────────── 内部函数 ───────────────
// 懒过期:把 expire_at 已过期的 matching 需求置为 expired
async function lazyExpire() {
  try {
    const r = await col('demand').where({
      status: 'matching', expire_at: _.lt(Date.now()), is_deleted: false
    }).limit(100).get();
    if (!r.data || r.data.length === 0) return 0;
    let n = 0;
    for (const d of r.data) {
      // CAS: 仅 matching→expired, 不覆盖刚被接单(matched)/取消的需求
      try {
        const cr = await col('demand').where({ _id: d._id, status: 'matching' }).update({ data: {
          status: 'expired', expired_at: Date.now(), updated_at: Date.now()
        }});
        if (cr.stats && cr.stats.updated === 1) {
          n++;
          log.d(`demand expired: ${d.demand_no}`);
        }
      } catch (e) {}
    }
    return n;
  } catch (e) {
    log.d(`lazy_expire error: ${e.message}`);
    return 0;
  }
}
