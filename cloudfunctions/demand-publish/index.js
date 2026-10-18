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

// 电话格式校验: 仅 11 位手机号(需求变更 2026-10-16 取消座机; 与前端 publish-validate 同口径)
function isMobilePhone(s) {
  const t = String(s || '').trim();
  return /^1[3-9]\d{9}$/.test(t);
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

// 需求标题/详细描述字数上限(后台 publish_title_max_len / publish_desc_max_len 可配; 缺省 20 / 200)
// 与后台 config_set 的下限(5 / 50)同口径, 越界即回落兜底, 防静默退化
const TITLE_MAX_DEFAULT = 20;
const DESC_MAX_DEFAULT = 200;
function titleMaxLen(config) {
  const v = Number(config && config.publish_title_max_len);
  return Number.isFinite(v) && v >= 5 ? v : TITLE_MAX_DEFAULT;
}
function descMaxLen(config) {
  const v = Number(config && config.publish_desc_max_len);
  return Number.isFinite(v) && v >= 50 ? v : DESC_MAX_DEFAULT;
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
  require('./action_draft'),
  require('./action_update')
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
      isMobilePhone, maskContact, verifySignatureFile, titleMaxLen, descMaxLen, checkText, genDemandNo,
      isServiceTimeAllowed, suspendLeftDays, haversineKm, isTestOpenid, validLngLat, getConfig, contentOptionsMax,
      creditLevelOf, timeAgoText, buildRecommendPartners, getUser, hasEmergencyContact, isValidDocId, addWithColl, lazyExpire
    };
    return await HANDLERS[action](ctx);
  }

  switch (action) {

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
