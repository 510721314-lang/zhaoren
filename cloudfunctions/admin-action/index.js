// @VERIFIED 2026-10-13 已真机验证：admin-action 181例等价零差异/101 action 分发(2026-11-08 复核: 33 个 action_*.js, 102 导出键 − readImageDims)/鉴权门+图片1:1强制校验(up_not_square)+JPEG填充字节跳过（依据：project_memory L69, L104, L111, L95, L107）
// 管理后台 RBAC + 九大模块(看板/用户/耍伴/需求/订单/财务/风控/配置/管理员)
// 所有动作第一步鉴权: getWXContext().OPENID 必须在 admin_config.admin_openids 白名单内,
// 否则拒绝并写 platform_event(P1, admin_probe)。
// 例外: claim_admin —— 白名单为空时首个调用者自助初始化管理员(仅可成功一次)。
const cloud = require('wx-server-sdk');
// 2026-11-05 N-3: 改期/S2 规则默认值唯一规范源（副本经 sync-config-defaults.ps1 同步）
const { MODIFY_DEFAULTS, S2_CHANGE_DEFAULTS } = require('./config_defaults');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;   // 聚合管道命令(sum/avg 等只在此命名空间下)
const col = (n) => db.collection(n);
const log = require('./logger');
const { buildAuditPatch, FIELD_PENDING, isFieldEmpty } = require('./partner_audit');
// 第三批 3B: 爽约申诉/举证/裁定纯规则(规范源 _shared/no_show_rules.js, 修改后跑 sync-no-show-rules.ps1)
const { noShowCfg, verdictOutcome, VERDICTS, REPORT_STATUS, DAY_MS } = require('./no_show_rules');

// ───────── RBAC 角色体系(S1, PRD §5.1 最小版: R1超管/R2审核/R3运营) ─────────
// 2026-11-06 P3-25: ROLE_GRANTS / 角色标签 / 判定函数已迁至 ./authz.js（零行为变更），此处仅引用
const { ADMIN_ROLE_LABEL, ADMIN_ROLES, ROLE_GRANTS, canAccess, forbiddenMsg } = require('./authz');
// 后台账号密码 hash(SHA256(salt+pwd+salt), 与 user-login hashPassword 同构)
function hashAdminPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password + salt).digest('hex');
}
// admin_accounts/admin_web_sessions 集合幂等创建(add/set 不自动建集合, 缺集合报 -502005; 云函数管理权限可 createCollection)
async function ensureAdminColls() {
  try { await db.createCollection('admin_accounts'); } catch (e) { /* 已存在则忽略 */ }
  try { await db.createCollection('admin_web_sessions'); } catch (e) { /* 已存在则忽略 */ }
  try { await db.createCollection('exam_bank'); } catch (e) { /* 已存在则忽略 */ }
  try { await db.createCollection('config_history'); } catch (e) { /* 已存在则忽略 */ }
}

// ───────── admin-web HTTP 代理身份(2026-10-13 收敛) ─────────
// 原实现内联在 admin-action/openid.js(规范源超集副本); 现 openid.js 与 _shared 规范源逐字节一致(SHA 门禁),
// 差异逻辑上移到本包装层: 校验网关共享密钥 admin_web_key, 防客户端直连 callFunction 冒充管理员。
let _cachedProxyKey = null;
let _proxyKeyCacheUntil = 0;
const PROXY_KEY_TTL_MS = 5 * 60 * 1000;      // 命中缓存 5 分钟
const PROXY_KEY_FAIL_TTL_MS = 10 * 1000;     // 读配置失败只短缓存, 便于恢复
async function _readProxyKey() {
  const now = Date.now();
  if (_cachedProxyKey !== null && now < _proxyKeyCacheUntil) return _cachedProxyKey;
  try {
    const r = await db.collection('admin_config').doc('global').get();
    _cachedProxyKey = (r.data && r.data.admin_web_key) || '';
    _proxyKeyCacheUntil = now + PROXY_KEY_TTL_MS;
  } catch (e) {
    // fail-closed: 读不到配置时空字符串, 代理旁路不生效
    _cachedProxyKey = '';
    _proxyKeyCacheUntil = now + PROXY_KEY_FAIL_TTL_MS;
  }
  return _cachedProxyKey;
}
// 身份解析(含网关代理链路): 代理密钥匹配 → 采用网关声明的 openid; 不匹配/为空 → 回落规范源 resolveOpenid(fail-closed)
async function resolveOpenidWithProxy(event) {
  if (event && event.__admin_web_proxy && event._admin_web_proxy_openid) {
    const proxyKey = event._admin_web_proxy_key || '';
    const storedKey = await _readProxyKey();
    if (storedKey && proxyKey && proxyKey === storedKey) return event._admin_web_proxy_openid;
  }
  const { resolveOpenid } = require('./openid');
  return resolveOpenid(cloud, event);
}

// 云存储 fileID → 临时访问 URL(批量, 每次最多 50; 失败降级为原 fileID 前端兜底不显示)
async function resolveTempUrls(fileIDs) {
  const ids = Array.isArray(fileIDs) ? fileIDs.filter((f) => f && typeof f === 'string') : [];
  if (ids.length === 0) return {};
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const r = await cloud.getTempFileURL({ fileList: batch });
      const list = (r && r.fileList) || [];
      for (const it of list) {
        if (it && it.fileID) map[it.fileID] = it.tempFileURL || '';
      }
    } catch (e) {
      log.d('getTempFileURL batch fail:', e && e.message);
    }
  }
  return map;
}

// 进行中订单(数据看板口径)
const ACTIVE_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];
const PAGE_SIZE = 15;
// 场景中文名兜底映射(规范源 _shared/scene_meta.js, 修改后跑 sync-scene-meta.ps1; 后台新增动态场景未列出的回退显示 code)
const { SCENE_NAMES: SCENE_NAME } = require('./scene_meta');
// 本地违禁词兜底(与 im-send/order-action/demand-publish 同款; msgSecCheck 不可用时降级)
const BLOCK_WORDS_FALLBACK = ['加微信', '加V', '转账', '私聊我', '威信', 'VX', 'vx', '加我vx', '扣扣', 'QQ号', '支付宝', '口令红包', '站外交易', '线下转账'];

// ───────── 参数元数据(单一真相 SSOT) ─────────
// 2026-11-07 T-7.12: CONFIG_SCHEMA 数据块已物理拆分至 ./config_schema.js(L95-L244 原样搬移, 零行为变更), 此处仅引用
const { CONFIG_SCHEMA } = require('./config_schema');

// 按 schema 组装 operations 块(缺失走 def), 供 config_get 与前端表单使用
function resolveOperations(config) {
  const ops = { city_enabled: config.city_enabled || [] };
  CONFIG_SCHEMA.forEach((s) => {
    const raw = config[s.f];
    if (s.t === 'bool') ops[s.f] = raw === undefined ? s.def : !!raw;
    else if (s.t === 'enum') ops[s.f] = raw === undefined ? s.def : String(raw);
    else ops[s.f] = raw === undefined ? s.def : Number(raw);
  });
  return ops;
}

async function getConfig() {
  try {
    const r = await db.collection('admin_config').doc('global').get();
    if (r.data) return r.data;
  } catch (e) {}
  return { admin_openids: [], platform_fee_rate_fen: 1000, auto_approve_partner: false, block_words: [], payment_visible: true, test_openids: [] };
}

// 平台事件(P0 紧急 / P1 安全/越权 / P2 运营 / P3 业务异常)
// Phase2-A5 管理端操作镜像: P2(运营写操作) 除 platform_event 外同步写 audit_log(role=admin), 供审计证据链留痕
async function logEvent(level, type, openid, payload) {
  const now = Date.now();
  try {
    await col('platform_event').add({ data: {
      level, type, openid: openid || 'unknown', payload: payload || {},
      created_at: now, updated_at: now, is_deleted: false
    }});
  } catch (e) {
    log.d(`platform_event write fail: ${e.message}`);
  }
  if (level === 'P2') {
    try {
      const { writeAudit } = require('./audit');
      const pl = payload || {};
      // 镜像审计: 管理写操作留痕(不含敏感明文; 展示用 detail 为 payload 摘要)
      const detail = {};
      Object.keys(pl).forEach((k) => {
        const v = pl[k];
        if (v === undefined || v === null) return;
        detail[k] = (typeof v === 'object') ? JSON.stringify(v) : v;
      });
      await writeAudit(db, log, {
        openid: openid || '', role: 'admin', category: 'business',
        action: 'admin_' + type,
        target_type: 'platform_event', target_id: '',
        detail, result: 'ok', client_ip: '', device: 'admin-web', at: now
      });
    } catch (e) {
      log.d(`audit mirror fail: ${(e && e.message) || e}`);
    }
  }
}

// ── 敏感信息脱敏 ──
function maskPhone(p) {
  if (!p || typeof p !== 'string') return p || '';
  return p.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}
// IP 脱敏: 1.2.3.4 → 1.2.*.*(审计列表展示用; 原始 IP 仍存于记录, 举证时不脱敏)
function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return ip || '';
  return ip.replace(/^(\d+)\.(\d+)\.\d+\.\d+$/, '$1.$2.*.*');
}
function maskIdCard(id) {
  if (!id || typeof id !== 'string') return id || '';
  return id.replace(/^(.{4}).+(.{4})$/, '$1**********$2');
}
function maskDoc(o) {
  if (!o) return o;
  const out = Object.assign({}, o);
  Object.keys(out).forEach((k) => {
    if (/phone/i.test(k) && typeof out[k] === 'string') out[k] = maskPhone(out[k]);
    if (/idcard|id_card/i.test(k) && typeof out[k] === 'string') out[k] = maskIdCard(out[k]);
  });
  return out;
}

// 敏感字段脱敏规则(顶层常量, 供递归 maskDocDeep 使用)
// 2026-09-23 备份查证补全: idcard(历史明文证件号)/sms_target(原样手机号)/sms_code(验证码)/
//   *_aes_key/*_web_key(密钥, 此前 export_collection 会原样导出) 均在 L3 导出中泄露过
const SENSITIVE_MASK = {
  phone: (v) => typeof v === 'string' && v.length >= 7 ? v.slice(0, 3) + '****' + v.slice(-4) : v,
  idcard_no: (v) => typeof v === 'string' && v.length >= 8 ? v.slice(0, 4) + '********' + v.slice(-4) : v,
  idcard: (v) => typeof v === 'string' && v.length >= 8 ? v.slice(0, 4) + '********' + v.slice(-4) : v,
  sms_target: (v) => typeof v === 'string' && v.length >= 7 ? v.slice(0, 3) + '****' + v.slice(-4) : v,
  sms_code: () => '***REDACTED***',
  real_name: (v) => typeof v === 'string' && v.length >= 2 ? v[0] + '*' + (v.length > 2 ? v.slice(-1) : '') : v,
  address: (v) => typeof v === 'string' && v.length > 6 ? v.slice(0, 6) + '***' : v,
  openid: (v) => typeof v === 'string' && v.length > 8 ? v.slice(0, 4) + '****' + v.slice(-6) : v,
  wx_nickname: (v) => typeof v === 'string' ? v.slice(0, 1) + '***' : v,
  admin_openids: (v) => Array.isArray(v)
    ? v.map((o) => typeof o === 'string' && o.length > 8 ? o.slice(0, 4) + '****' + o.slice(-6) : o)
    : v
};
// 递归脱敏(嵌套对象/数组逐层应用, 深度 ≤4 防循环引用)
// 顶层定义: 避免在 exports.main 内 function 声明提升造成对 SENSITIVE_MASK 的 TDZ 引用崩溃
function maskDocDeep(doc, depth = 0) {
  if (!doc || typeof doc !== 'object') return doc;
  if (depth > 4) return doc;
  if (Array.isArray(doc)) return doc.map((x) => maskDocDeep(x, depth + 1));
  const out = {};
  for (const k of Object.keys(doc)) {
    const v = doc[k];
    if (SENSITIVE_MASK[k]) out[k] = SENSITIVE_MASK[k](v);
    else if (k.includes('password') || k.includes('secret') || k.includes('token')
      || k.includes('aes_key') || k.includes('web_key')) out[k] = '***REDACTED***';
    else if (v && typeof v === 'object') out[k] = maskDocDeep(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

// 2026-11-09 P2: 运行时 TZ=UTC，日界按北京时间(+8)计算，避免 00:00-07:59 数据归前一日
const CN_OFF = 8 * 3600 * 1000;
function todayStart() {
  const d = new Date(Date.now() + CN_OFF);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - CN_OFF;
}

// ── 分页参数 ──
function pager(event) {
  const page = Math.max(1, parseInt(event.page, 10) || 1);
  // 支持调用方指定 size(默认 PAGE_SIZE), 钳到 1-100 防滥用
  const size = Math.min(100, Math.max(1, parseInt(event.size, 10) || PAGE_SIZE));
  return { page, size, skip: (page - 1) * size };
}
function isOpenid(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_-]{10,40}$/.test(s);
}
function isDocId(s) {
  return typeof s === 'string' && /^[a-f0-9]{32}$/i.test(s);
}
// 支付/退款流水号生成(与 payment-mock genPayNo 同构: prefix + YYYYMMDD + 16hex 随机, 防并发碰撞)
function genPayNo(prefix) {
  // 2026-11-09 P3-26: 运行时 TZ=UTC，单号日期前缀按北京时间(+8)
  const d = new Date(Date.now() + CN_OFF);
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const r = crypto.randomBytes(8).toString('hex');
  return `${prefix}${ymd}${r}`;
}
// 订单状态中文名(云函数侧无 enums 模块, 与 miniprogram/config/enums.js 对齐)
// Wave1 标签对齐(2026-10-10, Q2=A 以前端 enums.js ORDER_STATUS 为准), 修正 5 处错位:
//   S2 履约中→已支付待履约 / S3 已确认→履约中 / S3.5 履约完成→履约中断 / S8 已结算→已评价 / S9 已评价→评价超时
const STATUS_LABEL = {
  // 评审F3: 补 S2_5/S2_6/S3_6 三中间态, 与 order_state MAIN_AXIS / 前端 enums.js 对齐(缺失时后台显示裸状态码)
  S0: '待支付', S1: '待确认', S2: '已支付待履约', S2_5: '改期处理中', S2_6: '开始履约申请中',
  S3: '履约中', S3_6: '履约完毕确认中', 'S3.5': '履约中断',
  S4: '部分完成', S5: '已完成', S6: '已取消', S7: '已退款', S8: '已评价',
  S9: '评价超时', S10: '已关闭', 'S10.5': '争议处理中'
};
// 支付流水类型中文名
const TX_LABEL = { pay: '支付', refund: '退款', tip: '打赏', tip_refund: '打赏退款', withdraw: '提现', settle: '结算' };
function dayKey(ts) {
  const d = new Date(Number(ts) + CN_OFF);
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function last7Days() {
  const arr = [];
  const base = todayStart();
  for (let i = 6; i >= 0; i--) arr.push(dayKey(base - i * 86400000));
  return arr;
}
// 按天分桶计数
function bucketCount(days, arr, tsField) {
  const m = {};
  days.forEach((d) => { m[d] = 0; });
  (arr || []).forEach((x) => {
    const k = dayKey(x[tsField] || x.created_at);
    if (m[k] !== undefined) m[k]++;
  });
  return days.map((d) => m[d]);
}
function bucketFen(days, arr) {
  const m = {};
  days.forEach((d) => { m[d] = 0; });
  (arr || []).forEach((x) => {
    const k = dayKey(x.paid_at || x.created_at);
    if (m[k] !== undefined) m[k] += (x.amount_fen || 0);
  });
  return days.map((d) => m[d]);
}
async function sumTx(type, sinceMs) {
  try {
    const q = { type, status: 'success', is_deleted: _.neq(true) };
    if (sinceMs) q.created_at = _.gte(sinceMs);
    const r = await col('pay_transaction').aggregate()
      .match(q)
      .group({ _id: null, total: $.sum('$amount_fen'), fee: $.sum('$fee_fen') })
      .end();
    return r.list && r.list[0] ? r.list[0] : { total: 0, fee: 0 };
  } catch (e) { return { total: 0, fee: 0 }; }
}

// ── action 分发表：已物理抽到同级 action_*.js 的 handler 在此注册，ctx 注入共享符号 ──
// 鉴权后分组(RBAC 门之后): handler 签名 (ctx)=>result，禁止反向 require('./index')。
const HANDLERS = Object.assign(
  {},
  require('./action_adminlist'),
  require('./action_blog'),
  require('./action_home_activity'),
  require('./action_config_read'),
  require('./action_misc'),
  require('./action_lists'),
  require('./action_admin_account'),
  require('./action_user_moderation'),
  require('./action_user_ops'),
  require('./action_partner_review'),
  require('./action_order_demand_ops'),
  require('./action_im_kefu'),
  require('./action_user_partner_views'),
  require('./action_demand_order_views'),
  require('./action_finance_dispute_views'),
  require('./action_notice'),
  require('./action_noshow_list'),
  require('./action_export'),
  require('./action_import'),
  require('./action_dashboard'),
  require('./action_finance'),
  require('./action_dispute_detail'),
  require('./action_noshow_decide'),
  require('./action_exam'),
  // S4: questions 写入口 + 学习内容只读预览（旧 exam_subject_* 写动作见 action_exam 退役注释）
  require('./action_question'),
  require('./action_study'),
  require('./action_dispute_handle'),
  require('./action_audit'),
  require('./action_config_set'),
  require('./action_audit_verify'),
  require('./action_legal_doc')
);
// 免鉴权前置分组(统一鉴权门之前): claim_admin / config_public / admin_login / admin_logout
const HANDLERS_PRE = Object.assign(
  {},
  require('./action_config_public'),
  require('./action_auth_pre')
);

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = await resolveOpenidWithProxy(event);
  const action = event.action;
  log.d(`admin-action action=${action} openid=${openid || 'none'}`);

  const config = await getConfig();
  const adminOpenids = config.admin_openids || [];

  // 已抽离到 action_*.js 的免鉴权前置动作优先走分发表（统一鉴权门之前）
  if (HANDLERS_PRE[action]) {
    const preCtx = {
      event, openid, action, wxCtx, config, adminOpenids,
      col, db, _, log, cloud, crypto,
      getConfig, logEvent, ensureAdminColls, hashAdminPassword
    };
    return await HANDLERS_PRE[action](preCtx);
  }

  // （config_public 已抽离到 ./action_config_public.js，由上方 HANDLERS_PRE 分发表处理）

  // ───────── 统一鉴权 ─────────
  if (!openid) {
    await logEvent('P1', 'admin_probe', '', { action, reason: 'no_openid' });
    return { ok: false, code: 'admin_no_openid', msg: '未获取到登录身份' };
  }
  // mock 测试环境:仅 dev 且 resolveOpenid 已确认 dev 时, mock_openid 视为测试管理员; prod/读不到配置一律关闭
  const { getCachedEnv } = require('./openid');
  const isMockAdmin = !!event.mock_openid && getCachedEnv() === 'dev';
  if (adminOpenids.indexOf(openid) < 0 && !isMockAdmin) {
    await logEvent('P1', 'admin_probe', openid, { action, reason: 'not_in_whitelist' });
    if (adminOpenids.length === 0) {
      return { ok: false, code: 'admin_empty', msg: '后台尚未初始化管理员' };
    }
    return { ok: false, code: 'admin_forbidden', msg: '无权限,该操作已被记录' };
  }

  const now = Date.now();
  const ok = (data) => ({ ok: true, data: data || {} });
  const fail = (code, msg) => ({ ok: false, code, msg });

  // ───────── RBAC 操作者角色解析(S1) ─────────
  // 优先级: 账号会话 token(admin_accounts 登录) > 网关 admin_web_key 代理/白名单 openid(视为 R1)
  // admin_login/admin_logout 已在统一鉴权前处理, 此处面向其余 action
  let operatorRole = 'R1';
  let operatorAccount = '';
  const adminToken = String(event.__admin_token || '');
  if (adminToken) {
    const sessR = await col('admin_web_sessions').doc(adminToken).get().catch(() => null);
    const sess = sessR && sessR.data;
    if (!sess || sess.is_deleted || (sess.expires_at || 0) < Date.now()) {
      return { ok: false, code: 'bad_token', msg: '登录已过期, 请重新登录' };
    }
    const accR = await col('admin_accounts').where({ account: sess.account || '', is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
    const acc = (accR.data && accR.data[0]) || null;
    if (!acc || acc.status !== 'active') {
      return { ok: false, code: 'bad_token', msg: '账号已被禁用, 请联系超管' };
    }
    operatorAccount = acc.account;
    operatorRole = acc.role || 'R1'; // 会话角色以账号当前角色为准
  }
  // 角色门控: 已声明的 action 检查放行角色; 未声明(敏感: export_*/config_set/账号管理/force 类)默认仅 R1; R1 超管拥有全部权限
  // 判定与文案已迁至 ./authz.js（canAccess / forbiddenMsg），此处只保留「拒绝时留痕」的编排
  if (!canAccess(action, operatorRole)) {
    await logEvent('P1', 'role_forbidden', openid, { action, role: operatorRole, account: operatorAccount });
    return { ok: false, code: 'role_forbidden', msg: forbiddenMsg(action) };
  }

  // 已抽离到 action_*.js 的鉴权后动作优先走分发表（ctx 注入共享符号，行为与原内联逐字一致）
  if (HANDLERS[action]) {
    // ── handler 依赖注入上下文(ctx)类型契约 ──
    // handler 仅通过 ctx 获取共享符号, 禁止反向 require('./index')。本 typedef 供 IDE/静态检查
    // 校验「handler 解构的符号是否都注入了」; 新增符号时须同步本 typedef 与下方 ctx 字面量。
    /**
     * @typedef {Object} AdminHandlerCtx
     * @property {Object} event
     * @property {string} openid
     * @property {string} action
     * @property {Object} wxCtx
     * @property {Object} config
     * @property {Array} adminOpenids
     * @property {Function} col
     * @property {Object} db
     * @property {Object} _
     * @property {Object} $
     * @property {Object} log
     * @property {Object} cloud
     * @property {Object} crypto
     * @property {number} now
     * @property {Function} ok
     * @property {Function} fail
     * @property {Function} getConfig
     * @property {Function} logEvent
     * @property {Function} ensureAdminColls
     * @property {Function} resolveTempUrls
     * @property {Function} maskDocDeep
     * @property {Function} pager
     * @property {Function} isOpenid
     * @property {Function} isDocId
     * @property {Function} genPayNo
     * @property {Function} sumTx
     * @property {Object} ADMIN_ROLE_LABEL
     * @property {Object} ADMIN_ROLES
     * @property {Object} ROLE_GRANTS
     * @property {string} operatorRole
     * @property {string} operatorAccount
     * @property {Function} noShowCfg
     * @property {Function} verdictOutcome
     * @property {Array} VERDICTS
     * @property {Object} REPORT_STATUS
     * @property {number} DAY_MS
     * @property {Function} buildAuditPatch
     * @property {Object} FIELD_PENDING
     * @property {Function} isFieldEmpty
     * @property {Array} ACTIVE_STATUS
     * @property {number} PAGE_SIZE
     * @property {Object} SCENE_NAME
     * @property {Array} BLOCK_WORDS_FALLBACK
     * @property {Object} STATUS_LABEL
     * @property {Object} TX_LABEL
     * @property {Array} CONFIG_SCHEMA
     * @property {Function} hashAdminPassword
     * @property {Function} maskPhone
     * @property {Function} maskIp
     * @property {Function} maskIdCard
     * @property {Function} maskDoc
     * @property {Object} SENSITIVE_MASK
     * @property {Function} resolveOperations
     * @property {Function} todayStart
     * @property {Function} dayKey
     * @property {Function} last7Days
     * @property {Function} bucketCount
     * @property {Function} bucketFen
     */
    /** @type {AdminHandlerCtx} */
    const ctx = {
      event, openid, action, wxCtx, config, adminOpenids,
      col, db, _, $, log, cloud, crypto,
      now, ok, fail,
      getConfig, logEvent, ensureAdminColls, resolveTempUrls, maskDocDeep,
      pager, isOpenid, isDocId, genPayNo, sumTx,
      ADMIN_ROLE_LABEL, ADMIN_ROLES, ROLE_GRANTS,
      operatorRole, operatorAccount,
      noShowCfg, verdictOutcome, VERDICTS, REPORT_STATUS, DAY_MS,
      buildAuditPatch, FIELD_PENDING, isFieldEmpty,
      ACTIVE_STATUS, PAGE_SIZE, SCENE_NAME, BLOCK_WORDS_FALLBACK,
      STATUS_LABEL, TX_LABEL, CONFIG_SCHEMA,
      hashAdminPassword, maskPhone, maskIp, maskIdCard, maskDoc, SENSITIVE_MASK,
      resolveOperations, todayStart, dayKey, last7Days, bucketCount, bucketFen
    };
    return await HANDLERS[action](ctx);
  }

  // 强制下架/恢复耍伴接单(不影响其发单人身份)
  // ───────── 争议处置(S10→S10.5→裁决 S7/S5) ─────────
  // 2026-10-10: scope 视图(active 处理中 / history 已处置 / all 全部, 默认 active 保持向后兼容)
  // 纠纷全流程留痕(订单 + 状态流水 + 投诉 + 爽约申诉 + 支付/退款流水 → 统一时间线)
  // ───────── 7. 风控: 举报 / 平台事件 ─────────
  // 安全报备/SOS 流水(只读, 事故回溯用)
  // 集合现状: safety_report 仅有 sos(含 sub_type=silent) 与 checkin 两类;
  // 举报类记录未来独立走 report_list, 此处显式限定两类, 口径不混。
  // ───────── IM 内容安全降级消息补审 ─────────
  // （home_activity_* 已抽离到 ./action_home_activity.js，由上方 HANDLERS 分发表处理）

  // ───────── 8.8 爽约申诉: 列表/详情 + 裁定(第三批 3B) ─────────
  // 设计稿 §2.2-2.7: 平台不自动处罚, 管理员裁定; 成立 → 扣分(credit_score_log type='no_show')
  // + 滚动窗口计次 + 达阈值停用(数值全部读 no_show_* 实配); 幂等键 order_id+target_openid。
  // 2026-10-10: 新增 withdrawn(申诉人自行撤回, 由 order-action no_show_report_withdraw 写入)→ 列表筛选/徽标纳入;
  //   已撤回记录不可裁定(decide 的 CAS 三值不含 withdrawn, 天然排除)。
  // （admin_list/admin_add/admin_remove 已抽离到 ./action_adminlist.js，由上方 HANDLERS 分发表处理）

  // （blog_* 已抽离到 ./action_blog.js，由上方 HANDLERS 分发表处理）

  return fail('admin_unknown_action', '未知动作');
};
