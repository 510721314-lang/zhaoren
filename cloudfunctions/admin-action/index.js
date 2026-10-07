// 管理后台 RBAC + 九大模块(看板/用户/耍伴/需求/订单/财务/风控/配置/管理员)
// 所有动作第一步鉴权: getWXContext().OPENID 必须在 admin_config.admin_openids 白名单内,
// 否则拒绝并写 platform_event(P1, admin_probe)。
// 例外: claim_admin —— 白名单为空时首个调用者自助初始化管理员(仅可成功一次)。
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;   // 聚合管道命令(sum/avg 等只在此命名空间下)
const col = (n) => db.collection(n);
const log = require('./logger');
const { buildAuditPatch, FIELD_PENDING, isFieldEmpty } = require('./partner_audit');

// ───────── RBAC 角色体系(S1, PRD §5.1 最小版: R1超管/R2审核/R3运营) ─────────
const ADMIN_ROLE_LABEL = { R1: '超管', R2: '审核', R3: '运营' };
const ADMIN_ROLES = ['R1', 'R2', 'R3'];
// 非 R1 角色的 action 放行表; 未列出的 action 仅 R1 可执行(敏感: export_*/config_set/force 类)
// R2=审核专员: 审核/证据/举报/IM监管/内容下架; R3=运营: 配置/活动/通知/订单/财务只读/用户查询
const ROLE_GRANTS = {
  // ── R2 审核 ──
  'audit_init': ['R2'], 'audit_query': ['R2'], 'audit_verify': ['R2'],
  'evidence_query': ['R2'],
  'partner_profile_pending_list': ['R2'], 'partner_profile_review': ['R2'], 'review': ['R2'],
  'im_degraded_list': ['R2'], 'im_message_admin_list': ['R2'],
  'report_list': ['R2', 'R3'], 'report_handle': ['R2'],
  'safety_log_list': ['R2'], 'insurance_list': ['R2'],
  'blog_list': ['R2', 'R3'], 'blog_offline': ['R2'], 'blog_restore': ['R2'], 'blog_delete': ['R2'],
  'blog_comment_list': ['R2'], 'blog_comment_delete': ['R2'],
  'demand_list': ['R2', 'R3'], 'demand_offline': ['R2', 'R3'],
  'order_list': ['R2', 'R3'], 'order_query': ['R2', 'R3'], 'order_detail': ['R2', 'R3'],
  'dispute_list': ['R2', 'R3'], 'dispute_handle': ['R2'],
  // ── R3 运营 ──
  'dashboard': ['R3'],
  'config_get': ['R3'], 'config_log_list': ['R3'],
  'home_activity_list': ['R3'], 'home_activity_create': ['R3'], 'home_activity_update': ['R3'], 'home_activity_delete': ['R3'], 'upload_image': ['R3'],
  'notice_send': ['R3'],
  'kefu_conv_list': ['R3'], 'kefu_conv_reply': ['R3'],
  'user_list': ['R3'], 'user_detail': ['R3'],
  'partner_list': ['R3'], 'partner_detail': ['R3'],
  'finance_list': ['R3'], 'finance_stats': ['R3'],
  'withdraw_list': ['R3'], 'settlement_list': ['R3'],
  'credit_log_list': ['R3'], 'penalty': ['R2', 'R3'],
  // ── 认证考试管理(题库/通过规则, 配置化) ──
  'exam_subject_list': ['R3'], 'exam_subject_detail': ['R3'],
  'exam_subject_create': ['R3'], 'exam_subject_update': ['R3'], 'exam_subject_delete': ['R3'],
  'exam_bank_seed': ['R1', 'R3']
};
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
// 场景中文名(与 order-action 等 SCENE_NAME 同源, 全仓同步维护; 后台新增动态场景未列出的回退显示 code)
const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };
// 本地违禁词兜底(与 im-send/order-action/demand-publish 同款; msgSecCheck 不可用时降级)
const BLOCK_WORDS_FALLBACK = ['加微信', '加V', '转账', '私聊我', '威信', 'VX', 'vx', '加我vx', '扣扣', 'QQ号', '支付宝', '口令红包', '站外交易', '线下转账'];

// ───────── 参数元数据(单一真相 SSOT) ─────────
// config_set 区间校验 + config_get 输出 schema + admin-web Operations.vue 动态渲染,
// 新增参数只需在此加一行, 三端自动生效。字段:
//   f=admin_config 键名  t=int|bool  g=卡片分组  label=中文标签
//   unit=单位(渲染)  min/max=区间  def=默认值
const CONFIG_SCHEMA = [
  // ── 距离与限额 ──
  { f: 'publish_distance_max_km', t: 'int', g: '距离与限额', label: '发布距离上限', unit: 'km', min: 1, max: 500, def: 50 },
  { f: 'take_distance_max_km', t: 'int', g: '距离与限额', label: '接单距离上限', unit: 'km', min: 1, max: 500, def: 50 },
  { f: 'youth_limit_fen', t: 'int', g: '距离与限额', label: '青年最低预算', unit: '分', min: 1000, max: 100000, def: 20000 },
  { f: 'partner_daily_take_limit', t: 'int', g: '距离与限额', label: '耍伴每日接单上限', unit: '单', min: 1, max: 50, def: 5 },
  // ── 订单超时 ──
  { f: 's0_timeout_min', t: 'int', g: '订单超时', label: 'S0 待支付', unit: '分钟', min: 1, max: 1440, def: 30 },
  { f: 's1_timeout_min', t: 'int', g: '订单超时', label: 'S1 待确认', unit: '分钟', min: 1, max: 1440, def: 15 },
  { f: 'interrupt_timeout_h', t: 'int', g: '订单超时', label: '中断超时', unit: '小时', min: 1, max: 168, def: 24 },
  { f: 'eval_window_h', t: 'int', g: '订单超时', label: '评价窗口', unit: '小时', min: 1, max: 720, def: 48 },
  { f: 'milestone_confirm_min', t: 'int', g: '订单超时', label: '里程碑确认', unit: '分钟', min: 1, max: 1440, def: 15 },
  { f: 'default_star', t: 'int', g: '订单超时', label: '默认星级', unit: '星', min: 1, max: 5, def: 4 },
  // ── 时间红线 ──
  { f: 'time_redline_close_min', t: 'int', g: '时间红线', label: '接单截止(0=00:00)', unit: '分钟', min: 0, max: 1440, def: 1440 },
  { f: 'time_redline_open_min', t: 'int', g: '时间红线', label: '接单开放(0=00:00)', unit: '分钟', min: 0, max: 1440, def: 360 },
  // ── 信用阈值 ──
  { f: 'min_credit_take_order', t: 'int', g: '信用阈值', label: '最低接单刷分', unit: '分', min: 0, max: 1000, def: 600 },
  { f: 'min_credit_place_order', t: 'int', g: '信用阈值', label: '最低发单刷分', unit: '分', min: 0, max: 1000, def: 600 },
  { f: 'credit_freeze_line', t: 'int', g: '信用阈值', label: '冻结线', unit: '分', min: 0, max: 1000, def: 400 },
  // ── 费率 ──
  { f: 'rate_min_fen', t: 'int', g: '费率', label: '最低时薪', unit: '分', min: 0, max: 100000, def: 3000 },
  { f: 'rate_max_fen', t: 'int', g: '费率', label: '最高时薪', unit: '分', min: 0, max: 100000, def: 10000 },
  { f: 'scene_default_rate_fen', t: 'int', g: '费率', label: '场景默认时薪', unit: '分', min: 0, max: 100000, def: 5000 },
  // ── 保险与提现 ──
  { f: 'insurance_coverage_accident_fen', t: 'int', g: '保险与提现', label: '意外险保额', unit: '分', min: 0, max: 1000000000, def: 50000000 },
  { f: 'insurance_coverage_property_fen', t: 'int', g: '保险与提现', label: '财产险保额', unit: '分', min: 0, max: 1000000000, def: 5000000 },
  { f: 'fast_withdraw_per_order_max_fen', t: 'int', g: '保险与提现', label: '极速提现单笔上限', unit: '分', min: 0, max: 1000000, def: 20000 },
  { f: 'fast_withdraw_per_day_max_fen', t: 'int', g: '保险与提现', label: '极速提现日上限', unit: '分', min: 0, max: 10000000, def: 200000 },
  // ── AA 记账防滥用(线下台账仅记账不代收, 上限防刷) ──
  { f: 'aa_record_max_fen', t: 'int', g: 'AA记账', label: 'AA单笔记账上限', unit: '分', min: 100, max: 10000000, def: 100000 },
  { f: 'aa_ledger_max_fen', t: 'int', g: 'AA记账', label: 'AA单订单累计上限', unit: '分', min: 100, max: 100000000, def: 300000 },
  { f: 'aa_ledger_max_records', t: 'int', g: 'AA记账', label: 'AA单订单条数上限', unit: '条', min: 1, max: 1000, def: 50 },
  // ── 通用开关 ──
  { f: 'auto_approve_partner', t: 'bool', g: '通用开关', label: '自动通过耍伴申请', def: false },
  { f: 'payment_visible', t: 'bool', g: '通用开关', label: '显示支付入口', def: true },
  { f: 'platform_fee_rate_fen', t: 'int', g: '通用开关', label: '平台抽成', unit: '万分比', min: 0, max: 10000, def: 1000 },
  // 模拟支付开关(测试期): 仅影响资金 mock 入口(mock_pay/refund/ins/withdraw/fast_withdraw), prod 开放供真机/提审演示闭环;
  // 打赏(mock_tip)恒随 env 关闭(硬约束), 正式上线前必须置回 false(fail-closed 默认关)
  { f: 'mock_payment_enabled', t: 'bool', g: '通用开关', label: '模拟支付开关(测试期)', def: false },
  // audit_log 留存清理(2026-10-07 P2 采纳): dry-run 只统计不删; 置 false 后每日 UTC 19 点真删 90 天前 audit_log(order-timer auditPrune)
  { f: 'audit_prune_dry_run', t: 'bool', g: '通用开关', label: '审计日志清理(仅统计不删除)', def: true },
  // ── 平台总开关(关停=维护态, 各云函数服务端拦截 + C 端维护提示) ──
  { f: 'switch_access', t: 'bool', g: '平台总开关', label: '核心交易(下单/接单)', def: true },
  { f: 'switch_blog', t: 'bool', g: '平台总开关', label: '动态社区', def: true },
  { f: 'switch_im', t: 'bool', g: '平台总开关', label: '私信沟通', def: true },
  // ── 私信频控(滑动窗口; im-send 服务端计数拦截) ──
  { f: 'im_rate_window_min', t: 'int', g: '私信频控', label: '频控统计窗口', unit: '分钟', min: 1, max: 60, def: 5 },
  { f: 'im_rate_max_count', t: 'int', g: '私信频控', label: '窗口内最多消息', unit: '条', min: 1, max: 200, def: 30 },
  // ── 实名与签署(测试期 mock; 类目资质审批后切 wx 走微信官方人脸核验) ──
  { f: 'realname_face_mode', t: 'enum', opts: ['mock', 'wx'], g: '实名与签署', label: '人脸核验模式', def: 'mock' },
  // ── 耍伴资料(数量/字数限制后台可配; 前端校验+后端强约束+后台表单同源) ──
  { f: 'p_skills_max', t: 'int', g: '耍伴资料', label: '技能标签条数上限', unit: '条', min: 1, max: 50, def: 10 },
  { f: 'p_skills_len', t: 'int', g: '耍伴资料', label: '技能标签单条字数', unit: '字', min: 1, max: 50, def: 12 },
  { f: 'p_highlights_max', t: 'int', g: '耍伴资料', label: '服务亮点条数上限', unit: '条', min: 1, max: 20, def: 3 },
  { f: 'p_highlight_len', t: 'int', g: '耍伴资料', label: '服务亮点单条字数', unit: '字', min: 1, max: 100, def: 30 },
  { f: 'p_media_title_max', t: 'int', g: '耍伴资料', label: '资质/荣誉标题条数上限', unit: '条', min: 1, max: 50, def: 20 },
  { f: 'p_media_len', t: 'int', g: '耍伴资料', label: '资质/荣誉单条标题字数', unit: '字', min: 1, max: 50, def: 20 },
  { f: 'p_media_photo_max', t: 'int', g: '耍伴资料', label: '资质/荣誉照片张数上限', unit: '张', min: 1, max: 20, def: 6 },
  { f: 'p_media_photo_size_mb', t: 'int', g: '耍伴资料', label: '资质/荣誉单张照片大小上限', unit: 'MB', min: 1, max: 20, def: 3 },
  // ── 消息(会话列表分页大小; 前端 pageSize 与 im-conv 默认一致) ──
  { f: 'msg_page_size', t: 'int', g: '消息', label: '消息会话每页加载数', unit: '条', min: 5, max: 50, def: 15 },
  // ── 发布与展示(P0-P2 数量/分页/字数后台化; 前端 CONFIG 兜底同源, 服务端强约束在上) ──
  { f: 'publish_content_options_max', t: 'int', g: '发布与展示', label: '服务内容最多项数', unit: '项', min: 1, max: 10, def: 3 },
  { f: 'workbench_income_show', t: 'int', g: '发布与展示', label: '工作台流水展示条数', unit: '条', min: 1, max: 20, def: 5 },
  { f: 'order_page_size', t: 'int', g: '发布与展示', label: '订单列表每页条数', unit: '条', min: 5, max: 50, def: 20 },
  { f: 'page_index_nearby', t: 'int', g: '发布与展示', label: '首页附近单页条数', unit: '条', min: 1, max: 50, def: 10 },
  { f: 'page_index_square', t: 'int', g: '发布与展示', label: '首页广场单页条数', unit: '条', min: 1, max: 50, def: 20 },
  { f: 'page_square_limit', t: 'int', g: '发布与展示', label: '广场列表单页条数', unit: '条', min: 1, max: 100, def: 50 },
  { f: 'page_nearby_limit', t: 'int', g: '发布与展示', label: '附近列表分页条数', unit: '条', min: 1, max: 50, def: 20 },
  { f: 'page_wallet_withdraw', t: 'int', g: '发布与展示', label: '钱包提现单页条数', unit: '条', min: 1, max: 50, def: 20 },
  { f: 'page_notice_limit', t: 'int', g: '发布与展示', label: '通知单页条数', unit: '条', min: 1, max: 100, def: 50 },
  { f: 'share_title_max', t: 'int', g: '发布与展示', label: '分享标题字数上限', unit: '字', min: 5, max: 60, def: 30 },
  { f: 'order_reason_max_len', t: 'int', g: '发布与展示', label: '改期/加时原因字数上限', unit: '字', min: 20, max: 500, def: 200 },
  // ── 费率(公益单时薪后台可调) ──
  { f: 'welfare_hourly_rate_fen', t: 'int', g: '费率', label: '公益单时薪', unit: '分', min: 0, max: 100000, def: 3000 },
  // ── 信用阈值(好评星级阈值; 决定评价自动勾选口碑标签的分界) ──
  { f: 'order_good_review_min_stars', t: 'int', g: '信用阈值', label: '好评星级阈值', unit: '星', min: 1, max: 5, def: 4 },
  // ── 耍伴资料(个人简介字数上限) ──
  { f: 'p_bio_len', t: 'int', g: '耍伴资料', label: '个人简介字数上限', unit: '字', min: 20, max: 500, def: 200 }
];

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

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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
function dayKey(ts) {
  const d = new Date(ts);
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  const action = event.action;
  log.d(`admin-action action=${action} openid=${openid || 'none'}`);

  const config = await getConfig();
  const adminOpenids = config.admin_openids || [];

  // ───────── 例外: 白名单为空时首个管理员自助声明(仅一次, 事务 CAS 防并发刷空) ─────────
  if (action === 'claim_admin') {
    if (!openid) return { ok: false, code: 'admin_no_openid', msg: '未获取到登录身份' };
    let now = Date.now();
    try {
      const txRes = await db.runTransaction(async (t) => {
        // 事务内重读: 两个并发 claim 只有一方看到空名单
        const docR = await t.collection('admin_config').doc('global').get();
        const list = (docR.data && docR.data.admin_openids) || [];
        if (list.length > 0) {
          const err = new Error('admin already initialized');
          err.bizCode = 'admin_forbidden';
          throw err;
        }
        now = Date.now();
        await t.collection('admin_config').doc('global').update({
          data: { admin_openids: [openid], updated_at: now }
        });
        return { at: now };
      });
      await logEvent('P2', 'admin_bootstrap', openid, { at: txRes.at });
      return { ok: true, data: { admin_openids: [openid], msg: '管理员初始化成功' } };
    } catch (e) {
      if (e && e.bizCode === 'admin_forbidden') {
        await logEvent('P1', 'admin_probe', openid, { action, reason: 'claim_after_init' });
        return { ok: false, code: 'admin_forbidden', msg: '无权限' };
      }
      return { ok: false, code: 'admin_claim_fail', msg: '初始化失败' };
    }
  }

  // ───────── 例外: 公开配置(免鉴权) ─────────
  // 普通用户拉运营参数的唯一入口: 仅返回公开字段白名单(按前端 CLOUD_MAP 嵌套结构组装),
  // 绝不返回 admin_openids/admin_web_key/idcard_aes_key/env/block_words 等敏感字段。
  // 缺失字段返回 undefined, 前端 flatten+deepAssign 自动跳过, 走本地 CONFIG 兜底。
  if (action === 'config_public') {
    const cfgRaw = config || {};
    return { ok: true, data: {
      version: cfgRaw.version,
      timeouts: {
        s0_timeout_min: cfgRaw.s0_timeout_min,
        s1_timeout_min: cfgRaw.s1_timeout_min,
        interrupt_timeout_h: cfgRaw.interrupt_timeout_h,
        eval_window_h: cfgRaw.eval_window_h,
        default_star: cfgRaw.default_star
      },
      credits: { credit_freeze_line: cfgRaw.credit_freeze_line },
      rate_range: { rate_min_fen: cfgRaw.rate_min_fen, rate_max_fen: cfgRaw.rate_max_fen },
      scene_default_rate_fen: cfgRaw.scene_default_rate_fen,
      // 扁平字段与 CONFIG_SCHEMA/config_set 写入一致; 缺省给 schema 默认值(def 1440/360)
      time_redline: {
        open_min: cfgRaw.time_redline_open_min !== undefined ? cfgRaw.time_redline_open_min : 360,
        close_min: cfgRaw.time_redline_close_min !== undefined ? cfgRaw.time_redline_close_min : 1440
      },
      limits: {
        publish_distance_max_km: cfgRaw.publish_distance_max_km,
        take_distance_max_km: cfgRaw.take_distance_max_km,
        youth_limit_fen: cfgRaw.youth_limit_fen
      },
      insurance: {
        coverage_accident_fen: cfgRaw.insurance && cfgRaw.insurance.coverage_accident_fen,
        coverage_property_fen: cfgRaw.insurance && cfgRaw.insurance.coverage_property_fen
      },
      fast_withdraw: {
        per_order_max_fen: cfgRaw.fast_withdraw && cfgRaw.fast_withdraw.per_order_max_fen,
        per_day_max_fen: cfgRaw.fast_withdraw && cfgRaw.fast_withdraw.per_day_max_fen
      },
      modify_config: cfgRaw.modify_config,
      // 平台总开关(缺省=true 正常态; false=维护态, C 端展示维护提示并阻断入口)
      switches: {
        switch_access: cfgRaw.switch_access !== false,
        switch_blog: cfgRaw.switch_blog !== false,
        switch_im: cfgRaw.switch_im !== false
      },
      // 耍伴接单配置(前端「接单配置」页只读展示: 每日上限由平台统一设定)
      partner_accept: {
        daily_take_limit: cfgRaw.partner_daily_take_limit || 5
      },
      // 实名认证(实名页读取: mock=测试期模拟人脸 / wx=官方人脸核验)
      realname: {
        face_mode: cfgRaw.realname_face_mode || 'mock'
      },
      // 实名签署所需协议全文(与留证 hash 同源; 仅实名页按需读取, 不进 bootstrap 映射)
      legal_public: {
        service_agreement: cfgRaw.legal_service_agreement || '',
        aa_promise: cfgRaw.legal_aa_promise || '',
        pet_authorization: cfgRaw.legal_pet_authorization || ''
      },
      // 耍伴资料维护页数量/字数限制(前端校验与后端强约束同源; 缺失走 schema def, 防 0 被 || 吞)
      partner_profile: {
        skills_max: cfgRaw.p_skills_max !== undefined ? cfgRaw.p_skills_max : 10,
        skills_len: cfgRaw.p_skills_len !== undefined ? cfgRaw.p_skills_len : 12,
        highlights_max: cfgRaw.p_highlights_max !== undefined ? cfgRaw.p_highlights_max : 3,
        highlight_len: cfgRaw.p_highlight_len !== undefined ? cfgRaw.p_highlight_len : 30,
        media_title_max: cfgRaw.p_media_title_max !== undefined ? cfgRaw.p_media_title_max : 20,
        media_len: cfgRaw.p_media_len !== undefined ? cfgRaw.p_media_len : 20,
        media_photo_max: cfgRaw.p_media_photo_max !== undefined ? cfgRaw.p_media_photo_max : 6,
        media_photo_size_mb: cfgRaw.p_media_photo_size_mb !== undefined ? cfgRaw.p_media_photo_size_mb : 3,
        bio_len: cfgRaw.p_bio_len !== undefined ? cfgRaw.p_bio_len : 200
      },
      // 消息会话列表分页大小(前端 pageSize 与 im-conv 默认同源)
      message: {
        page_size: cfgRaw.msg_page_size !== undefined ? cfgRaw.msg_page_size : 15
      },
      // 发布与展示(P0-P2 后台化: 服务内容项数/公益时薪/好评阈值/分享标题/改期加时原因字数)
      publish: {
        content_options_max: cfgRaw.publish_content_options_max !== undefined ? cfgRaw.publish_content_options_max : 3,
        welfare_hourly_rate_fen: cfgRaw.welfare_hourly_rate_fen !== undefined ? cfgRaw.welfare_hourly_rate_fen : 3000,
        good_review_min_stars: cfgRaw.order_good_review_min_stars !== undefined ? cfgRaw.order_good_review_min_stars : 4,
        reason_max_len: cfgRaw.order_reason_max_len !== undefined ? cfgRaw.order_reason_max_len : 200,
        share_title_max: cfgRaw.share_title_max !== undefined ? cfgRaw.share_title_max : 30
      },
      // 列表分页大小(订单/首页/广场/附近/钱包/通知)
      paging: {
        order_page_size: cfgRaw.order_page_size !== undefined ? cfgRaw.order_page_size : 20,
        index_nearby: cfgRaw.page_index_nearby !== undefined ? cfgRaw.page_index_nearby : 10,
        index_square: cfgRaw.page_index_square !== undefined ? cfgRaw.page_index_square : 20,
        square_limit: cfgRaw.page_square_limit !== undefined ? cfgRaw.page_square_limit : 50,
        nearby_limit: cfgRaw.page_nearby_limit !== undefined ? cfgRaw.page_nearby_limit : 20,
        wallet_withdraw: cfgRaw.page_wallet_withdraw !== undefined ? cfgRaw.page_wallet_withdraw : 20,
        notice_limit: cfgRaw.page_notice_limit !== undefined ? cfgRaw.page_notice_limit : 50
      },
      // 工作台(流水展示条数)
      workbench: {
        income_show: cfgRaw.workbench_income_show !== undefined ? cfgRaw.workbench_income_show : 5
      },
      // 支付/资金(dev 下发; prod 随 mock_payment_enabled 总开关 fail-closed: 测试期打开则打赏一并可用, 上线前关闭自动恢复禁用)
      payment: {
        tip_enabled: cfgRaw.env === 'dev' || cfgRaw.mock_payment_enabled === true
      }
    } };
  }

  // ───────── 账号登录(免鉴权, RBAC S1): admin_accounts 账号+密码 → admin_web_sessions 会话 ─────────
  // 会话 token 主键存储(ADMT-*), 12h 有效; 后续请求经网关透传 __admin_token
  if (action === 'admin_login') {
    await ensureAdminColls();
    const acc = String(event.account || '').trim();
    const password = event.password || '';
    if (!acc || !password) return { ok: false, code: 'login_invalid', msg: '账号和密码必填' };
    const accR = await col('admin_accounts').where({ account: acc, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
    const u = (accR.data && accR.data[0]) || null;
    if (!u || u.status !== 'active') return { ok: false, code: 'login_bad', msg: '账号或密码错误' };
    if (hashAdminPassword(password, u.password_salt) !== u.password_hash) {
      return { ok: false, code: 'login_bad', msg: '账号或密码错误' };
    }
    const token = 'ADMT-' + crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const expires_at = now + 12 * 3600 * 1000;
    await col('admin_web_sessions').doc(token).set({
      data: { account: acc, role: u.role, openid: openid || '', created_at: now, expires_at, is_deleted: false }
    });
    await logEvent('P2', 'admin_login', openid, { account: acc, role: u.role });
    return { ok: true, data: { token, role: u.role, account: acc, display_name: u.display_name || acc, expires_at } };
  }

  if (action === 'admin_logout') {
    const t = String(event.__admin_token || '');
    if (t) await col('admin_web_sessions').doc(t).update({ data: { is_deleted: true, updated_at: Date.now() } }).catch(() => {});
    return { ok: true, data: {} };
  }

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
  const grants = ROLE_GRANTS[action];
  if (operatorRole !== 'R1' && (!grants || grants.indexOf(operatorRole) < 0)) {
    await logEvent('P1', 'role_forbidden', openid, { action, role: operatorRole, account: operatorAccount });
    return { ok: false, code: 'role_forbidden', msg: `无权限执行此操作(需 ${(grants || ['R1']).map((r) => ADMIN_ROLE_LABEL[r]).join('/')} 角色)` };
  }

  // ───────── 账号管理(仅 R1 超管) ─────────
  if (action === 'admin_account_list') {
    const r = await col('admin_accounts').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
    return ok({ list: (r.data || []).map((a) => ({
      account: a.account, role: a.role, display_name: a.display_name || '',
      status: a.status || 'active', created_at: a.created_at
    })) });
  }

  if (action === 'admin_account_create') {
    await ensureAdminColls();
    const acc = String(event.account || '').trim();
    const { password, role, display_name } = event;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(acc)) return fail('acc_bad_account', '登录名需 3-20 位字母/数字/下划线');
    if (!password || String(password).length < 8) return fail('acc_bad_pwd', '密码至少 8 位');
    if (!ADMIN_ROLES.includes(role)) return fail('acc_bad_role', '角色只能是 R1/R2/R3');
    const salt = crypto.randomBytes(16).toString('hex');
    try {
      await col('admin_accounts').add({ data: {
        account: acc, password_hash: hashAdminPassword(password, salt), password_salt: salt,
        role, display_name: String(display_name || '').slice(0, 30),
        status: 'active', created_at: Date.now(), updated_at: Date.now(), is_deleted: false
      } });
      await logEvent('P2', 'admin_account_create', openid, { account: acc, role, by: operatorAccount });
      return ok({ account: acc, role });
    } catch (e) { return fail('acc_fail', '创建失败: ' + ((e && e.errCode) || (e && e.message) || e)); }
  }

  if (action === 'admin_account_set_status') {
    const { account, status } = event;
    const acc = String(account || '').trim();
    if (!['active', 'disabled'].includes(status)) return fail('acc_bad_status', '状态只能是 active/disabled');
    if (acc === operatorAccount && status === 'disabled') return fail('acc_self', '不能禁用自己');
    const r = await col('admin_accounts').where({ account: acc, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
    if (!(r.data && r.data[0])) return fail('acc_not_found', '账号不存在');
    await col('admin_accounts').doc(r.data[0]._id).update({ data: { status, updated_at: Date.now() } });
    if (status === 'disabled') {
      await col('admin_web_sessions').where({ account: acc, is_deleted: _.neq(true) }).update({
        data: { is_deleted: true, updated_at: Date.now() }
      }).catch(() => {});
    }
    await logEvent('P2', 'admin_account_set_status', openid, { account: acc, status, by: operatorAccount });
    return ok({ account: acc, status });
  }

  // ───────── 1. 数据看板(统计卡 + 7天趋势 + 待办 + 财务汇总) ─────────
  if (action === 'dashboard') {
    const t7 = todayStart() - 6 * 86400000;
    const [userR, partnerR, reviewR, demandR, activeR, disputeR,
           users7, demands7, orders7, pays7, reportR, payExpiredR,
           payAgg, refundAgg, tipAgg] = await Promise.all([
      col('user_account').where({ is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('partner_profile').where({ status: 'approved', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('partner_profile').where({ status: 'pending_review', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('demand').where({ created_at: _.gte(todayStart()), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('order_main').where({ status: _.in(ACTIVE_STATUS), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('order_main').where({ status: 'S10.5', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('user_account').where({ created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
      col('demand').where({ created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
      col('order_main').where({ created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
      col('pay_transaction').where({ type: 'pay', status: 'success', created_at: _.gte(t7), is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] })),
      col('safety_report').where({ status: 'active', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('order_main').where({ status: 'S0', pay_expire_at: _.lt(now), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      // 资金聚合带 90 天窗: 规避全表扫描触达网关 3s 硬限(上线至今未满 90 天语义等价全量)
      sumTx('pay', now - 90 * 86400000), sumTx('refund', now - 90 * 86400000), sumTx('tip', now - 90 * 86400000)
    ]);
    const days = last7Days();
    return ok({
      user_count: userR.total || 0,
      partner_count: partnerR.total || 0,
      today_demand_count: demandR.total || 0,
      active_order_count: activeR.total || 0,
      pending_review_count: reviewR.total || 0,
      dispute_count: disputeR.total || 0,
      gmv_fen: payAgg.total || 0,
      trend: {
        days,
        users: bucketCount(days, users7.data, 'created_at'),
        demands: bucketCount(days, demands7.data, 'created_at'),
        orders: bucketCount(days, orders7.data, 'created_at'),
        gmv_fen: bucketFen(days, pays7.data)
      },
      todo: {
        pending_review: reviewR.total || 0,
        dispute: disputeR.total || 0,
        report_active: reportR.total || 0,
        pay_expired: payExpiredR.total || 0
      },
      finance: {
        gmv_fen: payAgg.total || 0,
        refund_fen: refundAgg.total || 0,
        tip_fen: tipAgg.total || 0,
        fee_fen: payAgg.fee || 0
      }
    });
  }

  // ───────── 2. 用户管理 ─────────
  if (action === 'user_list') {
    const { keyword, status, is_partner, sort } = event;
    const pg = pager(event);
    let q = { is_deleted: _.neq(true) };
    const conds = [];
    if (status) q.status = status;
    if (is_partner === true || is_partner === 'true') q.roles = 'partner';
    if (keyword) {
      const kw = String(keyword).trim();
      if (isOpenid(kw)) conds.push({ openid: kw });
      else conds.push({ nickname: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) });
    }
    if (conds.length) q = _.and([q, _.or(conds)]);
    const query = col('user_account').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy(sort === 'credit' ? 'user_credit_score' : 'created_at', 'desc')
        .skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    const list = (rows.data || []).map((u) => ({
      openid: u.openid,
      nickname: u.nickname || '微信用户',
      avatar: u.avatar || '',
      roles: u.roles || [],
      status: u.status || 'normal',
      user_credit_score: u.user_credit_score || 800,
      partner_credit_score: u.partner_credit_score || 800,
      is_realname_done: !!u.is_realname_done,
      phone: maskPhone(u.phone),
      created_at: u.created_at
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  if (action === 'user_detail') {
    const { target_openid } = event;
    if (!isOpenid(target_openid)) return fail('detail_bad_openid', 'openid 格式不正确');
    const [uR, ecR, dCnt, oUser, oPartner, logsR] = await Promise.all([
      col('user_account').where({ openid: target_openid }).limit(1).get().catch(() => ({ data: [] })),
      col('emergency_contact').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] })),
      col('demand').where({ creator_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('order_main').where({ user_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('order_main').where({ partner_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('credit_score_log').where({ openid: target_openid, is_deleted: _.neq(true) })
        .orderBy('created_at', 'desc').limit(10).get().catch(() => ({ data: [] }))
    ]);
    const u = uR.data && uR.data[0];
    if (!u) return fail('user_not_found', '用户不存在');
    const profileR = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
    const p = profileR.data && profileR.data[0];
    return ok({
      user: maskDoc({
        openid: u.openid, nickname: u.nickname, avatar: u.avatar, roles: u.roles || [],
        status: u.status || 'normal', age: u.age || null,
        user_credit_score: u.user_credit_score || 800, partner_credit_score: u.partner_credit_score || 800,
        is_realname_done: !!u.is_realname_done, phone: u.phone, id_card: u.id_card,
        banned_reason: u.banned_reason || '', created_at: u.created_at
      }),
      partner: p ? {
        status: p.status, accept_scenes: p.accept_scenes || [], accept_switch: !!p.accept_switch,
        scene_rates: p.scene_rates || {}, applied_at: p.applied_at
      } : null,
      emergency_contact: ecR.data && ecR.data[0] ? maskDoc({
        name: ecR.data[0].name || ecR.data[0].contact_name || '',
        phone: ecR.data[0].phone || ecR.data[0].contact_phone || '',
        relation: ecR.data[0].relation || ''
      }) : null,
      stats: { demand_count: dCnt.total || 0, order_as_user: oUser.total || 0, order_as_partner: oPartner.total || 0 },
      credit_logs: (logsR.data || []).map((l) => ({
        type: l.type, delta: l.delta, score: l.score, reason: l.reason || '',
        is_system: !!l.is_system, created_at: l.created_at
      }))
    });
  }

  // 紧急联系人后台查改(运营/超管; 覆盖 1-2 名, 槽位复用与 user-login set_emergency_contact 同构)
  // ⚠️ 合规: 变更同样受 30 天频控约束, 触发后台置 emergency_changed_at
  if (action === 'user_ec_update') {
    const { target_openid, contacts } = event;
    if (!isOpenid(target_openid)) return fail('ec_bad_openid', 'openid 格式不正确');
    if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > 2) {
      return fail('ec_count', '紧急联系人需 1-2 名');
    }
    for (const c of contacts) {
      if (!c.name || !/^1\d{10}$/.test(c.phone || '')) return fail('ec_field', '姓名/手机号格式有误');
    }
    const nowEc = Date.now();
    const existR = await col('emergency_contact')
      .where({ openid: target_openid, is_deleted: false }).orderBy('created_at', 'asc').limit(2).get();
    const existDocs = existR.data || [];
    await Promise.all(contacts.map((c, i) => {
      if (existDocs[i]) {
        return col('emergency_contact').doc(existDocs[i]._id).update({
          data: { name: c.name, phone: c.phone, relation: c.relation || '', updated_at: nowEc }
        });
      }
      return col('emergency_contact').add({
        data: { openid: target_openid, name: c.name, phone: c.phone, relation: c.relation || '', created_at: nowEc, updated_at: nowEc, is_deleted: false }
      });
    }));
    for (let i = contacts.length; i < existDocs.length; i++) {
      await col('emergency_contact').doc(existDocs[i]._id).update({ data: { is_deleted: true, updated_at: nowEc } });
    }
    await col('user_account').where({ openid: target_openid }).update({ data: { emergency_changed_at: nowEc, updated_at: nowEc } });
    await logEvent('P2', 'user_ec_update', openid, { target_openid, by: operatorAccount, count: contacts.length });
    return ok({ target_openid, contacts: contacts.map((c) => ({ name: c.name, phone: c.phone.slice(0, 3) + '****' + c.phone.slice(-4), relation: c.relation || '' })) });
  }

  if (action === 'user_freeze' || action === 'user_unfreeze') {
    const { target_openid, reason } = event;
    if (!isOpenid(target_openid)) return fail('freeze_bad_openid', 'openid 格式不正确');
    const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
    if (!ur.data || !ur.data[0]) return fail('user_not_found', '用户不存在');
    const freeze = action === 'user_freeze';
    const patch = { status: freeze ? 'frozen' : 'normal', updated_at: now };
    if (freeze) { patch.frozen_reason = reason || ''; patch.frozen_at = now; patch.frozen_by = openid; }
    await col('user_account').doc(ur.data[0]._id).update({ data: patch });
    if (freeze) {
      await col('partner_profile').where({ openid: target_openid }).update({ data: { accept_switch: false, updated_at: now } }).catch(() => {});
    }
    await logEvent('P2', freeze ? 'user_frozen' : 'user_unfrozen', openid, {
      target_openid, reason: reason || '', before: ur.data[0].status, after: patch.status
    });
    return ok({ openid: target_openid, status: patch.status });
  }

  // 人工调整信用分(delta 非零整数; reason 必填; 写 credit_score_log + P2)
  if (action === 'user_credit_adjust') {
    const { target_openid, score_type, delta, reason } = event;
    if (!isOpenid(target_openid)) return fail('credit_bad_openid', 'openid 格式不正确');
    const d = parseInt(delta, 10);
    if (!Number.isInteger(d) || d === 0) return fail('credit_bad_delta', '调整分值须为非零整数');
    if (d < -100 || d > 100) return fail('credit_bad_delta', '单次调整范围 -100 ~ 100');
    if (!reason || !String(reason).trim()) return fail('credit_no_reason', '请填写调整原因');
    if (score_type !== 'user' && score_type !== 'partner') return fail('credit_bad_type', 'score_type 须为 user/partner');
    const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
    if (!ur.data || !ur.data[0]) return fail('user_not_found', '用户不存在');
    const u = ur.data[0];
    const field = score_type === 'partner' ? 'partner_credit_score' : 'user_credit_score';
    const before = u[field] || 800;
    const after = Math.max(0, Math.min(1000, before + d));
    await col('user_account').doc(u._id).update({ data: { [field]: after, updated_at: now } });
    try {
      await col('credit_score_log').add({ data: {
        openid: target_openid, type: 'admin_adjust', score_type,
        delta: d, score: after, reason: String(reason).trim(),
        order_id: null, is_system: false, admin_openid: openid,
        created_at: now, updated_at: now, is_deleted: false
      }});
    } catch (e) {}
    await logEvent('P2', 'credit_adjust', openid, {
      target_openid, score_type, before, after, delta: d, reason: String(reason).trim()
    });
    return ok({ openid: target_openid, score_type, before, after });
  }

  // ───────── 3. 耍伴管理 ─────────
  if (action === 'partner_list') {
    const { status } = event;   // pending_review/approved/rejected/不传=全部
    const pg = pager(event);
    let q = { is_deleted: _.neq(true) };
    if (status) q.status = status;
    const query = col('partner_profile').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('applied_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    const openids = (rows.data || []).map((p) => p.openid);
    const userMap = {};
    if (openids.length) {
      const ur = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get().catch(() => ({ data: [] }));
      for (const u of (ur.data || [])) {
        userMap[u.openid] = {
          nickname: u.nickname || '', phone: maskPhone(u.phone),
          user_credit_score: u.user_credit_score || 800, partner_credit_score: u.partner_credit_score || 800,
          age: u.age || '', status: u.status || 'normal'
        };
      }
    }
    const list = (rows.data || []).map((p) => ({
      openid: p.openid,
      nickname: p.nickname || (userMap[p.openid] && userMap[p.openid].nickname) || '耍伴',
      avatar: p.avatar || '',
      status: p.status,
      accept_scenes: p.accept_scenes || [],
      scene_rates: p.scene_rates || {},
      accept_switch: !!p.accept_switch,
      applied_at: p.applied_at,
      review_note: p.review_note || '',
      max_distance_km: p.max_distance_km === undefined ? null : p.max_distance_km,
      accept_rate_min_fen: p.accept_rate_min_fen === undefined ? null : p.accept_rate_min_fen,
      accept_rate_max_fen: p.accept_rate_max_fen === undefined ? null : p.accept_rate_max_fen,
      home_lat: (p.home_location && Number(p.home_location.latitude)) || null,
      home_lng: (p.home_location && Number(p.home_location.longitude)) || null,
      user: userMap[p.openid] || null
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  if (action === 'partner_detail') {
    const { target_openid } = event;
    if (!isOpenid(target_openid)) return fail('detail_bad_openid', 'openid 格式不正确');
    const [pR, uR, oCnt, doneCnt, evR] = await Promise.all([
      col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] })),
      col('user_account').where({ openid: target_openid }).limit(1).get().catch(() => ({ data: [] })),
      col('order_main').where({ partner_openid: target_openid, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('order_main').where({ partner_openid: target_openid, status: _.in(['S5', 'S8', 'S9']), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
      col('evaluation').where({ to_openid: target_openid, is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }))
    ]);
    const p = pR.data && pR.data[0];
    if (!p) return fail('partner_not_found', '耍伴不存在');
    const u = uR.data && uR.data[0];
    const evs = evR.data || [];
    const avgStar = evs.length ? Math.round(evs.reduce((s, e) => s + (e.star || 0), 0) / evs.length * 10) / 10 : 0;
    return ok({
      profile: {
        openid: p.openid, nickname: p.nickname, avatar: p.avatar, status: p.status,
        accept_scenes: p.accept_scenes || [], scene_rates: p.scene_rates || {},
        accept_switch: !!p.accept_switch, city: p.city || [],
        applied_at: p.applied_at, reviewed_at: p.reviewed_at, review_note: p.review_note || ''
      },
      user: u ? maskDoc({
        nickname: u.nickname, phone: u.phone, status: u.status || 'normal',
        user_credit_score: u.user_credit_score || 800, partner_credit_score: u.partner_credit_score || 800,
        is_realname_done: !!u.is_realname_done
      }) : null,
      stats: {
        order_count: oCnt.total || 0,
        done_count: doneCnt.total || 0,
        eval_count: evs.length,
        avg_star: avgStar
      }
    });
  }

  // 强制下架/恢复耍伴接单(不影响其发单人身份)
  if (action === 'partner_offline' || action === 'partner_online') {
    const { target_openid, reason } = event;
    if (!isOpenid(target_openid)) return fail('partner_bad_openid', 'openid 格式不正确');
    const pr = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get();
    if (!pr.data || !pr.data[0]) return fail('partner_not_found', '耍伴不存在');
    const online = action === 'partner_online';
    if (pr.data[0].status !== 'approved' && online) return fail('partner_not_approved', '仅审核通过的耍伴可恢复接单');
    await col('partner_profile').doc(pr.data[0]._id).update({
      data: { accept_switch: online, updated_at: now }
    });
    await logEvent('P2', online ? 'partner_online' : 'partner_offline', openid, {
      target_openid, reason: reason || '', before: pr.data[0].accept_switch, after: online
    });
    return ok({ openid: target_openid, accept_switch: online });
  }

  // 耍伴资料审核待审列表(profile_audit_status='pending'; 返回待审内容 + 现快照对比)
  if (action === 'partner_profile_pending_list') {
    const pg = pager(event);
    const query = col('partner_profile').where({ profile_audit_status: 'pending', is_deleted: _.neq(true) });
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('profile_submit_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    // 死锁治愈: status=pending 但所有栏目待审内容为空(旧版"部分通过"锁判定 bug 遗留)
    //   → 自动解锁 approved 并移出队列, 避免后台队列显示空待审且前端永久锁定
    const healedNow = Date.now();
    const rowsAll = rows.data || [];
    const stillPending = [];
    for (const p of rowsAll) {
      const allEmpty = Object.keys(FIELD_PENDING).every((f) => isFieldEmpty(f, p[FIELD_PENDING[f]]));
      if (allEmpty) {
        col('partner_profile').doc(p._id).update({ data: { profile_audit_status: 'approved', profile_reject_reason: '', updated_at: healedNow } }).catch(() => {});
        log.d('heal deadlock audit lock:', p.openid);
      } else {
        stillPending.push(p);
      }
    }
    rows.data = stillPending;
    if (stillPending.length !== rowsAll.length) {
      totalR.total = Math.max(0, (totalR.total || 0) - (rowsAll.length - stillPending.length));
    }
    const openids = (rows.data || []).map((p) => p.openid);
    const userMap = {};
    if (openids.length) {
      const ur = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get().catch(() => ({ data: [] }));
      for (const u of (ur.data || [])) userMap[u.openid] = { nickname: u.nickname || '', avatar: u.avatar || '' };
    }
    // 收集需展示缩略图的云存储 fileID(待审+快照的资质/荣誉 photos) → 统一切成临时 URL
    const fileIDSet = new Set();
    for (const p of (rows.data || [])) {
      const cols = [
        p.qualifications_pending && p.qualifications_pending.photos,
        p.honors_pending && p.honors_pending.photos,
        p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications && p.profile_audited_snapshot.qualifications.photos,
        p.profile_audited_snapshot && p.profile_audited_snapshot.honors && p.profile_audited_snapshot.honors.photos
      ];
      for (const arr of cols) if (Array.isArray(arr)) for (const f of arr) if (f && typeof f === 'string') fileIDSet.add(f);
    }
    const urlMap = await resolveTempUrls([...fileIDSet]);
    // photos → [{fileid, url}] (前端缩略图/原图用 url)
    const toPhotos = (photos) => (Array.isArray(photos) ? photos.map((f) => ({ fileid: f, url: urlMap[f] || '' })) : []);
    const list = (rows.data || []).map((p) => ({
      openid: p.openid,
      nickname: p.nickname || (userMap[p.openid] && userMap[p.openid].nickname) || '耍伴',
      avatar: p.avatar || (userMap[p.openid] && userMap[p.openid].avatar) || '',
      pending: { bio: p.bio_pending || '', skills: p.skills_pending || [], highlights: p.highlights_pending || [],
        qualifications: { titles: (p.qualifications_pending && p.qualifications_pending.titles) || [], photos: toPhotos(p.qualifications_pending && p.qualifications_pending.photos) },
        honors: { titles: (p.honors_pending && p.honors_pending.titles) || [], photos: toPhotos(p.honors_pending && p.honors_pending.photos) } },
      current: {
        bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
        skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || [],
        highlights: (p.profile_audited_snapshot && p.profile_audited_snapshot.highlights) || [],
        qualifications: { titles: (p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications && p.profile_audited_snapshot.qualifications.titles) || [], photos: toPhotos(p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications && p.profile_audited_snapshot.qualifications.photos) },
        honors: { titles: (p.profile_audited_snapshot && p.profile_audited_snapshot.honors && p.profile_audited_snapshot.honors.titles) || [], photos: toPhotos(p.profile_audited_snapshot && p.profile_audited_snapshot.honors && p.profile_audited_snapshot.honors.photos) }
      },
      reject_reason: p.profile_reject_reason || '',
      submitted_at: p.profile_submit_at,
      audit_history: (p.profile_audit_history || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0))
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  // 耍伴资料审核(approve 覆盖快照+留 prev / reject 留原因), 并推送 system_notice 给耍伴
  if (action === 'partner_profile_review') {
    // 支持按栏目独立通过/驳回: items=[{field,pass,reason}]
    const { target_openid, items } = event;
    if (!isOpenid(target_openid)) return fail('pp_bad_openid', 'openid 格式不正确');
    const pr = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get();
    const p = pr.data && pr.data[0];
    if (!p) return fail('pp_not_found', '耍伴不存在');
    if (p.profile_audit_status !== 'pending') return fail('pp_no_pending', '该耍伴资料不在审核队列');
    if (!Array.isArray(items) || items.length === 0) return fail('pp_no_items', '缺少审核项');
    const _n = Date.now();
    // 收敛: 审核增量由 _shared/partner_audit 唯一实现(与 partner-action 同源, 防漂移)
    const { patch, hist, hasRemainingPending, anyPatched } = buildAuditPatch(p, items, _n, openid);
    if (!anyPatched || Object.keys(patch).length === 0) return fail('pp_no_pending_scope', '所选审核项均无待审内容');
    patch.profile_audit_history = _.push(...hist);
    await col('partner_profile').doc(p._id).update({ data: patch });
    try {
      await col('system_notice').add({ data: {
        to_openid: target_openid, order_id: '', type: hasRemainingPending ? 'partner_profile_rejected' : 'partner_profile_approved',
        title: hasRemainingPending ? '部分资料未通过' : '资料审核通过',
        body: hasRemainingPending ? '你的部分耍伴资料未通过审核，请修改未通过的栏目后重新提交；已通过的栏目已展示。'
          : '你的耍伴资料已通过审核，已在耍伴卡片与详情页展示。',
        action_key: 'partner_profile_edit', action_payload: {}, created_at: _n, updated_at: _n, read: false
      }});
    } catch (e) {}
    await logEvent('P2', hasRemainingPending ? 'pp_profile_partial' : 'pp_profile_approved', openid, { target_openid, fields: items.map((i) => i.field).join(',') });
    return ok({ target_openid, profile_audit_status: hasRemainingPending ? 'pending' : 'approved' });
  }

  // 耍伴审核(通过/驳回)
  if (action === 'review') {
    const { target_openid, decision, note } = event;
    if (!isOpenid(target_openid)) return fail('review_no_openid', '缺少耍伴 openid');
    if (decision !== 'approve' && decision !== 'reject') {
      return fail('review_bad_decision', 'decision 必须为 approve/reject');
    }
    const pr = await col('partner_profile').where({ openid: target_openid, is_deleted: _.neq(true) }).limit(1).get();
    if (!pr.data || !pr.data[0]) return fail('review_not_found', '耍伴申请不存在');
    const profile = pr.data[0];
    const newStatus = decision === 'approve' ? 'approved' : 'rejected';
    await col('partner_profile').doc(profile._id).update({
      data: {
        status: newStatus, review_note: note || '', reviewed_by: openid, reviewed_at: now,
        accept_switch: decision === 'approve' ? true : profile.accept_switch, updated_at: now
      }
    });
    if (decision === 'approve') {
      await col('user_account').where({ openid: target_openid }).update({
        data: { roles: _.addToSet('partner'), updated_at: now }
      }).catch(() => {});
    }
    await logEvent('P2', 'partner_review_' + decision, openid, {
      target_openid, before: profile.status, after: newStatus, note: note || ''
    });
    return ok({ openid: target_openid, status: newStatus });
  }

  // ───────── 4. 需求管理 ─────────
  if (action === 'demand_list') {
    const { keyword, scene, status } = event;
    const pg = pager(event);
    let q = { is_deleted: _.neq(true) };
    if (scene) q.scene = scene;
    if (status) q.status = status;
    const conds = [];
    if (keyword) {
      const kw = String(keyword).trim();
      if (isDocId(kw)) conds.push({ _id: kw }, { creator_openid: kw });
      else conds.push({ demand_no: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) });
    }
    if (conds.length) q = _.and([q, _.or(conds)]);
    const query = col('demand').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    const openids = (rows.data || []).map((d) => d.creator_openid);
    const nameMap = {};
    if (openids.length) {
      const ur = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get().catch(() => ({ data: [] }));
      for (const u of (ur.data || [])) nameMap[u.openid] = u.nickname || '微信用户';
    }
    const list = (rows.data || []).map((d) => ({
      demand_id: d._id, demand_no: d.demand_no,
      creator_openid: d.creator_openid, creator_name: nameMap[d.creator_openid] || '微信用户',
      scene: d.scene, status: d.status,
      content_options: d.content_options || (d.content_option ? [d.content_option] : []),
      remark: d.remark || '',
      start_time: d.start_time, duration_h: d.duration_h,
      location_name: d.location && d.location.name, city: d.location && d.location.city,
      loc_lat: (d.location && Number(d.location.latitude)) || null,
      loc_lng: (d.location && Number(d.location.longitude)) || null,
      rate_fen: d.rate_fen, total_fen: d.total_fen,
      broadcast: !!d.broadcast, match_mode: d.match_mode || 'invite',
      admin_note: d.admin_note || '', created_at: d.created_at
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  // 强制下架违规需求(仅 matching 可下架; 记 admin_note + P2)
  if (action === 'demand_offline') {
    const { demand_id, note } = event;
    if (!isDocId(demand_id)) return fail('demand_bad_id', '需求 ID 格式不正确');
    if (!note || !String(note).trim()) return fail('demand_no_note', '请填写下架原因');
    let d;
    try { d = (await col('demand').doc(demand_id).get()).data; } catch (e) { d = null; }
    if (!d) return fail('demand_not_found', '需求不存在');
    if (d.status !== 'matching') return fail('demand_bad_status', `当前状态(${d.status})不可下架,仅匹配中需求可下架`);
    await col('demand').doc(demand_id).update({
      data: {
        status: 'cancelled', admin_note: String(note).trim(),
        offline_by: openid, offline_at: now, updated_at: now
      }
    });
    await logEvent('P2', 'demand_offline', openid, {
      demand_id, demand_no: d.demand_no, reason: String(note).trim()
    });
    return ok({ demand_id, status: 'cancelled' });
  }

  // ───────── 5. 订单管理 ─────────
  if (action === 'order_list' || action === 'order_query') {
    const { keyword, status, export_mode } = event;
    const pg = pager(event);
    let q = { is_deleted: _.neq(true) };
    const conds = [];
    if (status) q.status = status;
    if (keyword) {
      const kw = String(keyword).trim();
      if (isDocId(kw)) {
        conds.push({ _id: kw }, { user_openid: kw }, { partner_openid: kw }, { demand_id: kw });
      } else {
        conds.push({ order_no: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) });
      }
    }
    if (conds.length) q = _.and([q, _.or(conds)]);
    const query = col('order_main').where(q);
    // CSV 导出模式: 不分页, 上限 10000 行, 返回精简字段供前端拼 CSV(网关 3s 硬限内可行)
    if (export_mode === 'csv') {
      const rows = await query.orderBy('created_at', 'desc').limit(10000).get().catch(() => ({ data: [] }));
      const list = (rows.data || []).map((o) => ({
        order_no: o.order_no, status: o.status, scene: o.scene,
        user_openid: (o.user_openid || '').slice(0, 12), partner_openid: (o.partner_openid || '').slice(0, 12),
        total_yuan: (o.total_fen || 0) / 100, tip_yuan: (o.tip_total_fen || 0) / 100,
        start_time: o.start_time || '', created_at: o.created_at
      }));
      await logEvent('P2', 'order_export_csv', openid, { count: list.length });
      return ok({ list, csv_mode: true });
    }
    const usePage = action === 'order_list';
    const [totalR, rowsR] = await Promise.all([
      usePage ? query.count().catch(() => ({ total: 0 })) : Promise.resolve({ total: 0 }),
      usePage
        ? query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
        : query.orderBy('created_at', 'desc').limit(30).get().catch(() => ({ data: [] }))
    ]);
    const list = (rowsR.data || []).map((o) => maskDoc({
      order_id: o._id, order_no: o.order_no,
      status: o.status, scene: o.scene,
      scene_name: SCENE_NAME[o.scene] || o.scene,
      content_options: o.content_options || (o.content_option ? [o.content_option] : []),
      user_openid: o.user_openid, partner_openid: o.partner_openid,
      total_fen: o.total_fen, tip_total_fen: o.tip_total_fen || 0,
      start_time: o.start_time, created_at: o.created_at,
      help_flag: !!o.help_flag, admin_note: o.admin_note || ''
    }));
    return ok(usePage
      ? { list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) }
      : { list });
  }

  // 订单详情时间线(订单 + 状态流水 + 支付流水 + 评价 + 四确认)
  if (action === 'order_detail') {
    const { order_id } = event;
    if (!isDocId(order_id)) return fail('order_bad_id', '订单 ID 格式不正确');
    let o;
    try { o = (await col('order_main').doc(order_id).get()).data; } catch (e) { o = null; }
    if (!o) return fail('order_not_found', '订单不存在');
    const [logsR, txR, evR, cfR] = await Promise.all([
      col('order_status_log').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(50).get().catch(() => ({ data: [] })),
      col('pay_transaction').where({ order_id, is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit(20).get().catch(() => ({ data: [] })),
      col('evaluation').where({ order_id, is_deleted: _.neq(true) }).limit(10).get().catch(() => ({ data: [] })),
      col('order_confirmations').where({ order_id, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }))
    ]);
    return ok({
      order: maskDoc({
        order_id: o._id, order_no: o.order_no, demand_no: o.demand_no,
        user_openid: o.user_openid, partner_openid: o.partner_openid,
        status: o.status, scene: o.scene,
        content_options: o.content_options || [],
        start_time: o.start_time, duration_h: o.duration_h,
        location: o.location, total_fen: o.total_fen, fee_fen: o.fee_fen,
        partner_income_fen: o.partner_income_fen, tip_total_fen: o.tip_total_fen || 0,
        aa_tier: o.aa_tier, pay_expire_at: o.pay_expire_at,
        help_flag: !!o.help_flag, dispute_reason: o.dispute_reason || '',
        admin_note: o.admin_note || '', created_at: o.created_at
      }),
      status_logs: (logsR.data || []).map((l) => ({
        from: l.from_status, to: l.to_status,
        action: l.action || l.note || '', actor: l.operator || l.actor_openid || l.actor || '',
        created_at: l.created_at
      })),
      transactions: (txR.data || []).map((t) => ({
        pay_no: t.pay_no || t.refund_no || t.tip_no || '',
        type: t.type, amount_fen: t.amount_fen, fee_fen: t.fee_fen || 0,
        status: t.status, created_at: t.created_at || t.paid_at
      })),
      evaluations: (evR.data || []).map((e) => ({
        from_openid: e.from_openid, to_openid: e.to_openid,
        star: e.star, content: e.content, is_system: !!e.is_system, created_at: e.created_at
      })),
      confirmations: cfR.data && cfR.data[0] ? {
        version: cfR.data[0].version,
        items: Object.keys(cfR.data[0].items || {}).map((k) => ({
          key: k,
          user_ok: !!cfR.data[0].items[k].user_ok,
          partner_ok: !!cfR.data[0].items[k].partner_ok
        }))
      } : null
    });
  }

  // 人工强制取消订单(S1/S0 → S6; S1 释放需求回匹配池; 记流水 + P2)
  if (action === 'order_force_cancel') {
    const { order_id, note } = event;
    if (!isDocId(order_id)) return fail('order_bad_id', '订单 ID 格式不正确');
    if (!note || !String(note).trim()) return fail('cancel_no_note', '请填写取消原因');
    let o;
    try { o = (await col('order_main').doc(order_id).get()).data; } catch (e) { o = null; }
    if (!o) return fail('order_not_found', '订单不存在');
    if (o.status !== 'S1' && o.status !== 'S0') {
      return fail('cancel_bad_status', `当前状态(${o.status})不可强制取消,仅待确认/待支付订单可取消`);
    }
    const before = o.status;
    // CAS: 仅 S1/S0→S6, 与用户取消/定时器/支付互斥
    const cr = await col('order_main').where({ _id: order_id, status: _.in(['S1', 'S0']) }).update({
      data: { status: 'S6', admin_note: String(note).trim(), cancel_by: openid, cancel_at: now, updated_at: now }
    });
    if (!cr.stats || cr.stats.updated !== 1) {
      return fail('cancel_conflict', '订单状态已变化,请刷新后重试');
    }
    // 释放需求回匹配池(条件更新, 仅 matched→matching)
    if (o.demand_id && before === 'S1') {
      await col('demand').where({ _id: o.demand_id, status: 'matched' }).update({ data: { status: 'matching', updated_at: now } }).catch(() => {});
    }
    try {
      await col('order_status_log').add({ data: {
        order_id, order_no: o.order_no, from_status: before, to_status: 'S6',
        actor: 'admin', actor_openid: openid, action: 'admin_force_cancel',
        note: String(note).trim(), created_at: now, updated_at: now, is_deleted: false
      }});
    } catch (e) {}
    await logEvent('P2', 'order_force_cancel', openid, {
      order_id, order_no: o.order_no, before, after: 'S6', note: String(note).trim()
    });
    return ok({ order_id, before, after: 'S6' });
  }

  // ───────── 争议处置(S10→S10.5→裁决 S7/S5) ─────────
  if (action === 'dispute_list') {
    const pg = pager(event);
    const query = col('order_main').where({
      status: _.in(['S10.5', 'S10']), is_deleted: _.neq(true)
    });
    const [totalR, r] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('updated_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    return ok({
      list: (r.data || []).map((o) => ({
        order_id: o._id, order_no: o.order_no, status: o.status, scene: o.scene,
        user_openid: o.user_openid, partner_openid: o.partner_openid,
        total_fen: o.total_fen, dispute_reason: o.dispute_reason || '',
        admin_note: o.admin_note || '', updated_at: o.updated_at
      })),
      total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0)
    });
  }

  if (action === 'dispute_handle') {
    const { order_id, decision, note } = event;
    if (!isDocId(order_id)) return fail('dispute_bad_id', '订单 ID 格式不正确');
    let order;
    try { order = (await col('order_main').doc(order_id).get()).data; } catch (e) { order = null; }
    if (!order) return fail('dispute_not_found', '订单不存在');
    const before = order.status;
    let after;
    if (decision === 'open') {
      if (before !== 'S10') return fail('dispute_bad_transition', '仅 S10 已关闭订单可登记争议');
      after = 'S10.5';
    } else if (decision === 'refund') {
      if (before !== 'S10.5') return fail('dispute_bad_transition', '仅争议处理中订单可裁决');
      after = 'S7';
    } else if (decision === 'complete') {
      if (before !== 'S10.5') return fail('dispute_bad_transition', '仅争议处理中订单可裁决');
      after = 'S5';
    } else {
      return fail('dispute_bad_decision', 'decision 必须为 open/refund/complete');
    }
    if (!note || !String(note).trim()) return fail('dispute_no_note', '请填写处置说明');
    const patch = {
      status: after, admin_note: String(note).trim(),
      dispute_handled_by: openid, dispute_handled_at: now, updated_at: now
    };
    if (decision === 'open') patch.dispute_opened_at = now;
    // CAS: 仅当订单仍处于读取时的原状态才允许裁决, 防并发双处置
    const dcr = await col('order_main').where({ _id: order_id, status: before }).update({ data: patch });
    if (!dcr.stats || dcr.stats.updated !== 1) {
      return fail('dispute_conflict', '订单状态已变化,请刷新后重试');
    }
    try {
      await col('order_status_log').add({ data: {
        order_id, order_no: order.order_no, from_status: before, to_status: after,
        actor: 'admin', actor_openid: openid, action: 'dispute_' + decision,
        note: String(note).trim(), created_at: now, updated_at: now, is_deleted: false
      }});
    } catch (e) {}
    await logEvent('P2', 'dispute_' + decision, openid, {
      order_id, order_no: order.order_no, before, after, note: String(note).trim()
    });
    return ok({ order_id, before, after });
  }

  // ───────── 6. 财务流水 ─────────
  if (action === 'finance_list') {
    const { type, status } = event;
    const pg = pager(event);
    let q = { is_deleted: _.neq(true) };
    if (type) q.type = type;
    if (status) q.status = status;
    const query = col('pay_transaction').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    const orderIds = (rows.data || []).map((t) => t.order_id).filter(Boolean);
    const noMap = {};
    if (orderIds.length) {
      const oR = await col('order_main').where({ _id: _.in(orderIds) }).limit(orderIds.length).get().catch(() => ({ data: [] }));
      for (const o of (oR.data || [])) noMap[o._id] = { user_openid: o.user_openid, partner_openid: o.partner_openid };
    }
    const list = (rows.data || []).map((t) => ({
      tx_id: t._id, pay_no: t.pay_no || t.refund_no || t.tip_no || '',
      type: t.type, status: t.status,
      amount_fen: t.amount_fen, fee_fen: t.fee_fen || 0,
      order_id: t.order_id, order_no: t.order_no,
      user_openid: noMap[t.order_id] && noMap[t.order_id].user_openid,
      partner_openid: noMap[t.order_id] && noMap[t.order_id].partner_openid,
      is_mock: !!t.is_mock, created_at: t.created_at || t.paid_at
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  // 财务概览(服务端 aggregate; 禁止前端全量拉取明细做统计, 会触发超时)
  // 入参: days=1-90(默认30) 或 start_ts/end_ts(毫秒, 跨度≤90天)
  if (action === 'finance_stats') {
    const MAX_DAYS = 90;
    const TREND_CAP = 5000;
    let startTs;
    let rangeEnd;
    if (event.start_ts !== undefined || event.end_ts !== undefined) {
      const s = parseInt(event.start_ts, 10);
      const e = parseInt(event.end_ts, 10);
      if (!Number.isInteger(s) || !Number.isInteger(e) || s >= e) {
        return fail('fs_bad_range', 'start_ts/end_ts 须为整数毫秒且 start < end');
      }
      if (e - s > MAX_DAYS * 86400000) return fail('fs_range_too_long', '区间最长 90 天');
      if (s < 1577808000000) return fail('fs_bad_start', '开始时间不合理');
      if (e > Date.now() + 86400000) return fail('fs_bad_end', '结束时间不能晚于明天');
      startTs = s; rangeEnd = e;
    } else {
      let days = parseInt(event.days, 10);
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) days = 30;
      startTs = todayStart() - (days - 1) * 86400000;
      rangeEnd = todayStart() + 86400000;   // 含今天全天
    }
    const start0 = new Date(startTs); start0.setHours(0, 0, 0, 0);
    startTs = start0.getTime();

    // ① 区间内交易按类型一次分组(pay/refund/tip 的金额/手续费; 笔数走 count 与全仓口径一致)
    // ② 耍伴已结算收入: 对齐 payment-mock settledFen 口径仅 S8/S9/S10
    //    (S5=已完成待评价, 收入尚未结算; S7=已退款不计)
    // ③ 趋势明细(仅 pay/refund, 带上限保护, 超量返回 truncated 标志)
    // 注意: 时间区间必须用 _.and 组合, 对象字面量写两个同名 created_at 键会被后者覆盖(丢下界)
    const win = [{ created_at: _.gte(startTs) }, { created_at: _.lt(rangeEnd) }];
    const txBase = { status: 'success', is_deleted: _.neq(true) };
    const incomeBase = { status: _.in(['S8', 'S9', 'S10']), is_deleted: _.neq(true) };
    const [typeAgg, incomeAgg, trendR, payCnt, refundCnt, incomeCnt] = await Promise.all([
      col('pay_transaction').aggregate()
        .match(_.and([txBase].concat(win)))
        .group({ _id: '$type', total: $.sum('$amount_fen'), fee: $.sum('$fee_fen') })
        .end().catch(() => ({ list: [] })),
      col('order_main').aggregate()
        .match(_.and([incomeBase].concat(win)))
        .group({ _id: null, income: $.sum('$partner_income_fen') })
        .end().catch(() => ({ list: [] })),
      col('pay_transaction').where({
        type: _.in(['pay', 'refund']), status: 'success', is_deleted: _.neq(true),
        created_at: _.gte(startTs)
      }).limit(TREND_CAP).get().catch(() => ({ data: [] })),
      col('pay_transaction').where(_.and([Object.assign({}, txBase, { type: 'pay' })].concat(win))).count().catch(() => ({ total: 0 })),
      col('pay_transaction').where(_.and([Object.assign({}, txBase, { type: 'refund' })].concat(win))).count().catch(() => ({ total: 0 })),
      col('order_main').where(_.and([incomeBase].concat(win))).count().catch(() => ({ total: 0 }))
    ]);
    const typeMap = {};
    (typeAgg.list || []).forEach((r) => { typeMap[r._id] = r; });
    const pay = typeMap.pay || { total: 0, fee: 0 };
    const refund = typeMap.refund || { total: 0, fee: 0 };
    const tip = typeMap.tip || { total: 0, fee: 0 };
    const incomeRow = (incomeAgg.list || [])[0] || { income: 0 };

    // 按天分桶(与 dashboard 趋势口径一致: paid_at 优先, 回退 created_at)
    const days = [];
    for (let t = startTs; t < rangeEnd; t += 86400000) days.push(dayKey(t));
    const gmvB = {}, refundB = {}, cntB = {};
    days.forEach((d) => { gmvB[d] = 0; refundB[d] = 0; cntB[d] = 0; });
    (trendR.data || []).forEach((t) => {
      const k = dayKey(t.paid_at || t.created_at);
      if (gmvB[k] === undefined) return;
      if (t.type === 'pay') { gmvB[k] += (t.amount_fen || 0); cntB[k] += 1; }
      else if (t.type === 'refund') refundB[k] += (t.amount_fen || 0);
    });

    return ok({
      range: { start_ts: startTs, end_ts: rangeEnd, days: days.length },
      summary: {
        gmv_fen: pay.total || 0,
        refund_fen: refund.total || 0,
        net_gmv_fen: (pay.total || 0) - (refund.total || 0),
        tip_fen: tip.total || 0,
        platform_fee_fen: pay.fee || 0,
        partner_income_fen: incomeRow.income || 0,
        partner_order_count: incomeCnt.total || 0,
        pay_count: payCnt.total || 0,
        refund_count: refundCnt.total || 0
      },
      trend: {
        days,
        gmv_fen: days.map((d) => gmvB[d]),
        refund_fen: days.map((d) => refundB[d]),
        pay_count: days.map((d) => cntB[d])
      },
      trend_truncated: (trendR.data || []).length >= TREND_CAP
    });
  }

  // ───────── 7. 风控: 举报 / 平台事件 ─────────
  if (action === 'report_list') {
    const { status: rStatus } = event;
    const pg = pager(event);
    let q = { is_deleted: _.neq(true) };
    if (rStatus) q.status = rStatus;
    const query = col('safety_report').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    const list = (rows.data || []).map((r) => ({
      report_id: r._id, order_id: r.order_id, order_no: r.order_no || '',
      reporter_openid: r.reporter_openid, reporter_role: r.reporter_role || '',
      type: r.type, status: r.status, note: r.note || '',
      resolve_note: r.resolve_note || '',
      location: r.location ? (r.location.name || '') : '',
      resolved_at: r.resolved_at, created_at: r.created_at
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  if (action === 'report_handle') {
    const { report_id, note } = event;
    if (!isDocId(report_id)) return fail('report_bad_id', '举报记录 ID 格式不正确');
    if (!note || !String(note).trim()) return fail('report_no_note', '请填写处理说明');
    let r;
    try { r = (await col('safety_report').doc(report_id).get()).data; } catch (e) { r = null; }
    if (!r) return fail('report_not_found', '举报记录不存在');
    await col('safety_report').doc(report_id).update({
      data: {
        status: 'resolved', resolve_note: String(note).trim(),
        resolved_by: openid, resolved_at: now, updated_at: now
      }
    });
    await logEvent('P2', 'report_resolved', openid, {
      report_id, order_no: r.order_no, type: r.type, note: String(note).trim()
    });
    return ok({ report_id, status: 'resolved' });
  }

  // 安全报备/SOS 流水(只读, 事故回溯用)
  // 集合现状: safety_report 仅有 sos(含 sub_type=silent) 与 checkin 两类;
  // 举报类记录未来独立走 report_list, 此处显式限定两类, 口径不混。
  if (action === 'safety_log_list') {
    const { kind, status: slStatus, order_id: slOrderId, target_openid } = event;
    const pg = pager(event);
    const q = { type: _.in(['sos', 'checkin']), is_deleted: _.neq(true) };
    if (kind === 'sos' || kind === 'checkin') q.type = kind;
    if (slStatus) q.status = String(slStatus);
    if (slOrderId) q.order_id = String(slOrderId);
    if (isOpenid(target_openid)) q.reporter_openid = target_openid;
    return paginateList('safety_report', q, pg, (r) => ({
      report_id: r._id, order_id: r.order_id, order_no: r.order_no || '',
      type: r.type, sub_type: r.sub_type || '', status: r.status,
      reporter_openid: r.reporter_openid, reporter_role: r.reporter_role || '',
      note: r.note || '',
      location_name: r.location ? (r.location.name || '') : '',
      resolved_at: r.resolved_at || null, created_at: r.created_at
    }));
  }

  if (action === 'event_list') {
    const { level, type: evType } = event;
    const pg = pager(event);
    let q = { is_deleted: _.neq(true) };
    if (level) q.level = level;
    if (evType) q.type = evType;
    const query = col('platform_event').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    const list = (rows.data || []).map((e) => ({
      event_id: e._id, level: e.level, type: e.type, openid: e.openid,
      payload: e.payload || {}, created_at: e.created_at
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  // ───────── 7.5 用户中心只读: 信用流水/提现/结算/保险 ─────────
  // 仅查询, 不做任何资金写操作(提现审核待接真实支付后单独上双人复核)
  function paginateList(collName, where, pg, mapper) {
    const query = col(collName).where(where);
    return Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]).then(([totalR, rows]) => {
      const list = (rows.data || []).map(mapper);
      return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
    });
  }

  // ───────── IM 内容安全降级消息补审 ─────────
  // sec_degraded 消息 = msgSecCheck 异常时放行并标记的消息(IM 强交互链路不 fail-closed),
  // 后台提供补审列表, 运营人工判断后决定是否删除
  if (action === 'im_degraded_list') {
    const pg = pager(event);
    const q = { sec_degraded: true, is_deleted: _.neq(true) };
    const query = col('im_message').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    // 关联订单号, 便于定位上下文
    const orderIds = Array.from(new Set((rows.data || []).map((m) => m.order_id).filter(Boolean)));
    const orderMap = {};
    if (orderIds.length) {
      try {
        const orders = await col('order_main').where({ _id: _.in(orderIds) }).limit(100).get();
        (orders.data || []).forEach((o) => { orderMap[o._id] = o; });
      } catch (e) { log.d('im_degraded order join fail:', e.message); }
    }
    const list = (rows.data || []).map((m) => ({
      msg_id: m._id, order_id: m.order_id, order_no: (orderMap[m.order_id] && orderMap[m.order_id].order_no) || '',
      from_openid: m.from_openid, from_role: m.from_role || '', text: m.text || '',
      sec_degraded: true, sec_degraded_at: m.sec_degraded_at || m.created_at, created_at: m.created_at
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  // ───────── 会话监管: 按订单/会话只读调取 IM 消息(纠纷仲裁/合规留痕用) ─────────
  // 安全: 仅展示 text/from_role/时间, 不返回 ID 之外的 openid 全文, 不落任何导出; 走分页防超大
  if (action === 'im_message_admin_list') {
    const { conv_id, order_id, order_no } = event;
    const pg = pager(event);
    // 定位会话: 直接给 conv_id 优先; 否则按 order_id / order_no 反查
    let conv = null;
    if (isDocId(conv_id)) {
      const c = await col('im_conversation').doc(conv_id).get().catch(() => null);
      conv = c && c.data ? c.data : null;
    } else {
      const q = { is_deleted: _.neq(true) };
      if (isDocId(order_id)) q.order_id = order_id;
      else if (order_no) {
        // order_no 无直接索引 → 先经 order_main(uk_order_no 唯一索引) 反查 order_id, 再按 uk_order_id 定位会话
        const om = await col('order_main').where({ order_no: String(order_no) }).limit(1).get().catch(() => ({ data: [] }));
        if (om.data && om.data[0]) q.order_id = om.data[0]._id;
        else return fail('im_conv_not_found', '会话不存在');
      }
      else return fail('im_no_target', '请提供 conv_id 或 order_id 或 order_no');
      const c = await col('im_conversation').where(q).limit(1).get();
      conv = (c.data && c.data[0]) || null;
    }
    if (!conv) return fail('im_conv_not_found', '会话不存在');
    const msgQ = { conv_id: conv._id, is_deleted: _.neq(true) };
    const query = col('im_message').where(msgQ);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('created_at', 'asc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    // 聚合双方脱敏身份(仅昵称/角色, 不暴露完整 openid 与手机号)
    const openids = Array.from(new Set((rows.data || []).map((m) => m.from_openid).filter(Boolean)));
    const userMap = {};
    if (openids.length) {
      try {
        const users = await col('user_account').where({ openid: _.in(openids) }).limit(20).get();
        (users.data || []).forEach((u) => { userMap[u.openid] = { nickname: u.nickname || '微信用户', role: (Array.isArray(u.roles) && u.roles.indexOf('partner') >= 0) ? 'partner' : 'user' }; });
      } catch (e) { log.d('im msg user join fail:', e.message); }
    }
    const list = (rows.data || []).map((m) => ({
      msg_id: m._id, from_role: m.from_role || (userMap[m.from_openid] ? userMap[m.from_openid].role : ''),
      from_nickname: (userMap[m.from_openid] && userMap[m.from_openid].nickname) || '',
      type: m.type || 'text', text: m.text || '', template_id: m.template_id || '',
      sec_degraded: !!m.sec_degraded, quote: m.quote || null, created_at: m.created_at
    }));
    return ok({
      list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0),
      conv: { conv_id: conv._id, order_id: conv.order_id, order_no: conv.order_no || '', scene_name: conv.scene_name || '' }
    });
  }

  // ───────── 客服工作台 ─────────
  // 会话列表(分页+处理状态筛选) + 客服回复(写 im_message from_role='kefu' + 通知用户 + 标记已处理)
  // 安全: 复用 im_message_admin_list 脱敏口径; 回复复用内容安全降级 + writeNotice 定向通知双方
  if (action === 'kefu_conv_list') {
    const pg = pager(event);
    const q = { is_deleted: _.neq(true) };
    if (event.kefu_status) q.kefu_status = event.kefu_status;   // unhandled | handled
    if (isDocId(event.order_id)) q.order_id = event.order_id;
    const query = col('im_conversation').where(q);
    const [totalR, rows] = await Promise.all([
      query.count().catch(() => ({ total: 0 })),
      query.orderBy('last_msg_at', 'desc').skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }))
    ]);
    // 脱敏身份: 双方昵称(不暴露完整 openid/手机号)
    const openids = Array.from(new Set((rows.data || []).flatMap((c) => [c.user_openid, c.partner_openid]).filter(Boolean)));
    const userMap = {};
    if (openids.length) {
      try {
        const users = await col('user_account').where({ openid: _.in(openids) }).limit(50).get();
        (users.data || []).forEach((u) => { userMap[u.openid] = { nickname: u.nickname || '微信用户', role: (Array.isArray(u.roles) && u.roles.indexOf('partner') >= 0) ? 'partner' : 'user' }; });
      } catch (e) { log.d('kefu conv user join fail:', e.message); }
    }
    const list = (rows.data || []).map((c) => ({
      conv_id: c._id, order_id: c.order_id, order_no: c.order_no || '',
      conv_type: c.kefu_openid ? 'kefu' : 'order',   // 自建客服会话(kefu_openid 标识) vs 订单会话
      scene_name: c.scene_name || '',
      user_nickname: (userMap[c.user_openid] && userMap[c.user_openid].nickname) || '用户',
      partner_nickname: (userMap[c.partner_openid] && userMap[c.partner_openid].nickname) || '耍伴',
      last_msg_text: c.last_msg_text || '', last_msg_at: c.last_msg_at || 0, last_msg_from: c.last_msg_from || '',
      user_unread: c.user_unread || 0, partner_unread: c.partner_unread || 0,
      kefu_status: c.kefu_status || 'unhandled', handled_at: c.handled_at || 0
    }));
    return ok({ list, total: totalR.total || 0, page: pg.page, has_more: pg.page * pg.size < (totalR.total || 0) });
  }

  if (action === 'kefu_conv_reply') {
    const { conv_id, text } = event;
    if (!isDocId(conv_id)) return fail('kefu_bad_conv', '会话 ID 不合法');
    const msg = String(text || '').trim();
    if (!msg) return fail('kefu_empty', '回复内容不能为空');
    if (msg.length > 500) return fail('kefu_too_long', '回复内容不超过500字');
    const conv = await col('im_conversation').doc(conv_id).get().catch(() => null);
    if (!conv || !conv.data || conv.data.is_deleted) return fail('kefu_conv_not_found', '会话不存在');
    const c = conv.data;
    // 引用支持: 可选 event.quote = { msg_id } → 从库复核同会话消息后存快照(不信前端文本, 防跨会话/防篡改)
    let quote = null;
    const quoteMsgId = event.quote && String(event.quote.msg_id || '').trim();
    if (quoteMsgId) {
      if (!isDocId(quoteMsgId)) return fail('kefu_bad_quote', '引用消息 ID 不合法');
      const qmR = await col('im_message').doc(quoteMsgId).get().catch(() => null);
      const qm = qmR && qmR.data;
      if (!qm || qm.conv_id !== conv_id || qm.is_deleted) return fail('kefu_quote_not_found', '引用的消息不存在或已删除');
      quote = { msg_id: qm._id, text: qm.text || '', from_role: qm.from_role || '', created_at: qm.created_at || 0 };
    }
    // 内容安全: 违规直接拒绝; msgSecCheck 不可用时降级本地违禁词(客服回复为可信来源, 不标 sec_degraded)
    // 注意: msgSecCheck 的 openid 必须是真实小程序用户, admin-web 代理下 openid 是管理员(非小程序用户)会导致调用失败,
    //       且 im-send 用户消息传真实用户 openid 正常(全仓唯一差异), 故此处不传 openid(v2 可选参数)。
    let secDegraded = false;
    try {
      const check = await cloud.openapi.security.msgSecCheck({ content: msg, version: 2, scene: 2 }).catch((e) => {
        log.d('kefu msgSecCheck error:', e && e.message, e && e.errCode);
        return null;
      });
      if (check && check.errCode === 87014) return fail('kefu_blocked', '内容涉及违规,禁止发送');
      if (!check) {
        // msgSecCheck 不可用(网络/权限) → 降级本地违禁词(与 im-send 同口径), 命中即拒
        const words = (config.block_words && config.block_words.length) ? config.block_words : BLOCK_WORDS_FALLBACK;
        const lower = msg.toLowerCase();
        for (const w of words) {
          if (w && lower.indexOf(String(w).toLowerCase()) >= 0) {
            return fail('kefu_blocked', '消息包含平台禁止的内容(如联系方式/转账),请修改后重试');
          }
        }
      }
    } catch (e) { log.d('kefu msgSecCheck throw:', e && e.message); }
    const now = Date.now();
    // 写客服消息(旁路会话, 不占 user/partner 未读角标; from_role='kefu' 供前端区分)
    const msgRes = await col('im_message').add({ data: {
      conv_id, order_id: c.order_id, from_openid: openid, from_role: 'kefu',
      type: 'text', text: msg, template_id: '', sec_degraded: secDegraded,
      quote, created_at: now, updated_at: now, is_deleted: false
    }}).catch((e) => { log.d('kefu msg add fail:', e.message); return null; });
    if (!msgRes) return fail('kefu_write_fail', '回复发送失败,请重试');
    // 更新会话: 最后消息 + 处理状态
    await col('im_conversation').doc(conv_id).update({ data: {
      last_msg_text: msg, last_msg_at: now, last_msg_from: 'kefu',
      kefu_status: 'handled', handled_at: now, updated_at: now
    }}).catch(() => {});
    // 定向通知双方(复用 system_notice; 去重合并按 type 区分)
    const targets = [c.user_openid, c.partner_openid].filter(Boolean);
    for (const to of targets) {
      try {
        const exist = await col('system_notice').where({ to_openid: to, order_id: c.order_id || '', type: 'kefu_reply', read: false }).limit(1).get();
        const data = { title: '客服回复', body: msg, action_key: 'jump_chat', action_payload: { order_id: c.order_id }, updated_at: now };
        if (exist.data && exist.data[0]) {
          await col('system_notice').doc(exist.data[0]._id).update({ data });
        } else {
          await col('system_notice').add({ data: Object.assign({ to_openid: to, order_id: c.order_id || '', type: 'kefu_reply', created_at: now, read: false }, data) });
        }
      } catch (e) { log.d('kefu notice fail:', to, e && e.message); }
    }
    await logEvent('P2', 'kefu_reply', openid, { conv_id, order_id: c.order_id, sec_degraded: secDegraded });
    return ok({ msg_id: msgRes._id, conv_id, kefu_status: 'handled' });
  }

  // 一次性运维接口(仅 R1): 清理客服回复误标 sec_degraded(修复前 msgSecCheck 失败误标)
  // 依据: 真违规(87014)会被直接拒绝不入库, 故 from_role='kefu' 且 sec_degraded=true 必为误标, 可安全置 false
  if (action === 'kefu_mislabel_clear') {
    const r = await col('im_message')
      .where({ from_role: 'kefu', sec_degraded: true }).update({
        data: { sec_degraded: false, sec_degraded_at: null, sec_degraded_fixed_at: Date.now() }
      }).catch(() => null);
    const updated = (r && r.stats && r.stats.updated) || 0;
    await logEvent('P2', 'kefu_mislabel_clear', openid, { updated });
    return ok({ updated });
  }

  if (action === 'credit_log_list') {
    const { target_openid, log_type } = event;
    const pg = pager(event);
    const q = { is_deleted: _.neq(true) };
    if (isOpenid(target_openid)) q.openid = target_openid;
    if (log_type) q.type = String(log_type);
    return paginateList('credit_score_log', q, pg, (l) => ({
      log_id: l._id, openid: l.openid, type: l.type, delta: l.delta, score: l.score,
      reason: l.reason || '', is_system: !!l.is_system, created_at: l.created_at
    }));
  }

  if (action === 'withdraw_list') {
    const { target_openid, status: wdStatus, wd_type } = event;
    const pg = pager(event);
    const q = { is_deleted: _.neq(true) };
    if (isOpenid(target_openid)) q.openid = target_openid;
    if (wdStatus) q.status = String(wdStatus);
    if (wd_type) q.type = String(wd_type);
    return paginateList('withdraw_record', q, pg, (w) => ({
      withdraw_id: w._id, withdraw_no: w.withdraw_no, openid: w.openid,
      type: w.type, amount_fen: w.amount_fen, status: w.status,
      expect_arrive_at: w.expect_arrive_at || null, arrived_at: w.arrived_at || null,
      is_mock: !!w.is_mock, created_at: w.created_at
    }));
  }

  // ───────── 提现审批(PRD §5.1 职责分离: 财务/超管双人复核; 仅处理普通提现 processing) ─────────
  // 账号体系启用时强制双人(第一人提交 → 不同账号确认); 仅 admin_web_key 代理链路(无账号体系)单步放行
  if (action === 'withdraw_review') {
    const { withdraw_id, decision, reason } = event;
    if (!['approve', 'reject'].includes(decision)) return fail('wr_bad_decision', 'decision 只能是 approve/reject');
    if (decision === 'reject' && !String(reason || '').trim()) return fail('wr_need_reason', '驳回必须填原因');
    if (!isDocId(withdraw_id)) return fail('wr_bad_id', 'withdraw_id 格式不正确');
    const wR = await col('withdraw_record').doc(withdraw_id).get().catch(() => null);
    const w = wR && wR.data;
    if (!w || w.is_deleted) return fail('wr_not_found', '提现记录不存在');
    if (w.status !== 'processing') return fail('wr_status', `当前状态(${w.status})不可审核`);
    const now2 = Date.now();
    const accCntR = await col('admin_accounts').where({ status: 'active', is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 }));
    const rbacEnabled = (accCntR.total || 0) > 0;
    if (rbacEnabled && !w.review1_by) {
      await col('withdraw_record').doc(withdraw_id).update({ data: { review1_by: operatorAccount, review1_at: now2, updated_at: now2 } });
      await logEvent('P2', 'withdraw_review1', openid, { withdraw_id, by: operatorAccount });
      return ok({ withdraw_id, step: 1, msg: '已提交审核, 待第二人(不同账号)复核确认' });
    }
    if (rbacEnabled && w.review1_by === operatorAccount) {
      return fail('wr_self', '复核人不能与第一审核人相同(职责分离)');
    }
    const patch = { review2_by: operatorAccount, review2_at: now2, updated_at: now2 };
    if (decision === 'approve') {
      patch.status = 'success';
      patch.arrived_at = now2;
    } else {
      patch.status = 'rejected';
      patch.reject_reason = String(reason).trim();
    }
    await col('withdraw_record').doc(withdraw_id).update({ data: patch });
    await logEvent('P2', decision === 'approve' ? 'withdraw_approve' : 'withdraw_reject', openid, {
      withdraw_id, amount_fen: w.amount_fen, by: operatorAccount, reason: reason || ''
    });
    return ok({ withdraw_id, step: rbacEnabled ? 2 : 1, status: patch.status });
  }

  if (action === 'settlement_list') {
    const { target_openid, order_id, status: stStatus } = event;
    const pg = pager(event);
    const q = { is_deleted: _.neq(true) };
    if (isOpenid(target_openid)) q.openid = target_openid;
    if (order_id) q.order_id = String(order_id);
    if (stStatus) q.status = String(stStatus);
    // settlement 集合字段可能随结算批次演进, 这里白名单透传常见金额/状态字段, 不臆造
    return paginateList('settlement', q, pg, (s) => ({
      settlement_id: s._id, order_id: s.order_id || '', openid: s.openid || '',
      type: s.type || '', amount_fen: s.amount_fen, fee_fen: s.fee_fen,
      income_fen: s.income_fen, status: s.status || '', batch_no: s.batch_no || '',
      created_at: s.created_at
    }));
  }

  if (action === 'insurance_list') {
    const { target_openid, order_id, policy_no } = event;
    const pg = pager(event);
    const q = { is_deleted: _.neq(true) };
    if (isOpenid(target_openid)) q.openid = target_openid;
    if (order_id) q.order_id = String(order_id);
    if (policy_no) q.policy_no = String(policy_no);
    return paginateList('insurance_record', q, pg, (i) => ({
      insurance_id: i._id, order_id: i.order_id, policy_no: i.policy_no,
      openid: i.openid, scene_code: i.scene_code || '', status: i.status,
      coverage_accident_fen: i.coverage_accident_fen, coverage_property_fen: i.coverage_property_fen,
      premium_fen: i.premium_fen, created_at: i.created_at
    }));
  }

  // ───────── 8. 参数配置(白名单字段; 每次修改写 P2 config_change before/after) ─────────
  if (action === 'config_get') {
    return ok({
      env: config.env || 'prod',   // 与 config_set 对称, 后台 UI 显示当前环境(非机密)
      platform_fee_rate_fen: config.platform_fee_rate_fen,
      auto_approve_partner: !!config.auto_approve_partner,
      payment_visible: config.payment_visible !== false,   // 默认 true, false 才隐藏支付入口
      block_words: config.block_words || [],
      city_enabled: config.city_enabled || [],
      test_openids: config.test_openids || [],   // D4-5 测试身份白名单(后台可见可管理)
      error_scan_last_at: config.error_scan_last_at || 0,   // D7 巡检游标(order-timer 每 5min 推进; >0 即巡检在跑)
      error_scan_heartbeat_at: config.error_scan_heartbeat_at || 0,   // D7 心跳(order-timer 每轮刷新; 门禁 check-heartbeat 据此判断巡检是否存活)
      timeouts: {
        // 显式 undefined 判断兜底: 值为 0 时不得被 || 改写成默认值(config_get 掩码修复 2026-09-23)
        s0_timeout_min: config.s0_timeout_min !== undefined ? config.s0_timeout_min : 30,
        s1_timeout_min: config.s1_timeout_min !== undefined ? config.s1_timeout_min : 15,
        interrupt_timeout_h: config.interrupt_timeout_h !== undefined ? config.interrupt_timeout_h : 24,
        eval_window_h: config.eval_window_h !== undefined ? config.eval_window_h : 48,
        default_star: config.default_star !== undefined ? config.default_star : 4,
        milestone_confirm_min: config.milestone_confirm_min !== undefined ? config.milestone_confirm_min : 15
      },
      time_redline: {
        // 禁止用 || 兜底: close=0 合法(全天开放), open=0 合法(00:00), || 会错误改写
        close_min: config.time_redline_close_min !== undefined ? config.time_redline_close_min : 1440,
        open_min: config.time_redline_open_min !== undefined ? config.time_redline_open_min : 360
      },
      limits: {
        publish_distance_max_km: config.publish_distance_max_km !== undefined ? config.publish_distance_max_km : 50,
        take_distance_max_km: config.take_distance_max_km !== undefined ? config.take_distance_max_km : 50,
        youth_limit_fen: config.youth_limit_fen !== undefined ? config.youth_limit_fen : 20000
      },
      insurance: {
        coverage_accident_fen: config.insurance_coverage_accident_fen !== undefined ? config.insurance_coverage_accident_fen : 50000000,
        coverage_property_fen: config.insurance_coverage_property_fen !== undefined ? config.insurance_coverage_property_fen : 5000000
      },
      fast_withdraw: {
        per_order_max_fen: config.fast_withdraw_per_order_max_fen !== undefined ? config.fast_withdraw_per_order_max_fen : 20000,
        per_day_max_fen: config.fast_withdraw_per_day_max_fen !== undefined ? config.fast_withdraw_per_day_max_fen : 200000
      },
      security: {
        security_only_template_before_confirm: config.security_only_template_before_confirm !== false
      },
      modify_config: Object.assign(
        { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 },
        config.modify_config || {}
      ),
      idcard_aes_key_set: !!(config.idcard_aes_key && /^[0-9a-f]{64}$/i.test(config.idcard_aes_key)),
      credits: {
        min_credit_take_order: config.min_credit_take_order !== undefined ? config.min_credit_take_order : 600,
        min_credit_place_order: config.min_credit_place_order !== undefined ? config.min_credit_place_order : 600,
        credit_freeze_line: config.credit_freeze_line !== undefined ? config.credit_freeze_line : 400
      },
      rate_range: {
        rate_min_fen: config.rate_min_fen !== undefined ? config.rate_min_fen : 3000,
        rate_max_fen: config.rate_max_fen !== undefined ? config.rate_max_fen : 10000,
        scene_default_rate_fen: config.scene_default_rate_fen !== undefined ? config.scene_default_rate_fen : 5000
      },
      scene_list: config.scene_list || [],
      system_templates: config.system_templates || [],
      // 参数元数据(Operations.vue schema 驱动渲染的唯一来源)
      config_schema: CONFIG_SCHEMA,
      // 耍伴每日接单上限(平台统一设定, 耍伴端只读展示)
      partner_daily_take_limit: config.partner_daily_take_limit || 5,
      // ── 运营配置独立模块(前端 Operations.vue 数据来源, schema 统一生成) ──
      operations: resolveOperations(config),
      // ── 法律合规模块(前端 Legal.vue 数据来源) ──
      legal: {
        disclaimer_text: config.legal_disclaimer_text || '',
        service_agreement: config.legal_service_agreement || '',
        privacy_policy: config.legal_privacy_policy || '',
        aa_promise: config.legal_aa_promise || '',
        pet_authorization: config.legal_pet_authorization || '',
        scene_disclaimers: config.legal_scene_disclaimers || {}
      }
    });
  }

  if (action === 'config_set') {
    const patch = { updated_at: now };
    const before = {};
    const touch = (k, v) => { before[k] = config[k]; patch[k] = v; };

    // bool 字段统一处理(区间/类型由 schema 声明): auto_approve_partner/payment_visible/三个总开关
    for (const s of CONFIG_SCHEMA) {
      if (s.t === 'bool' && event[s.f] !== undefined) touch(s.f, !!event[s.f]);
    }
    // enum 字段统一校验(CONFIG_SCHEMA 声明 opts 白名单; 超集直接拒绝, 防脏值入库)
    for (const s of CONFIG_SCHEMA) {
      if (s.t !== 'enum' || event[s.f] === undefined) continue;
      const v = String(event[s.f]);
      if (!Array.isArray(s.opts) || s.opts.indexOf(v) < 0) {
        return fail('config_bad_' + s.f, `${s.f} 仅支持: ${(s.opts || []).join(' / ')}`);
      }
      touch(s.f, v);
    }
    // 四确认前仅允许模板消息(关闭后自由聊天, 仅 super 应可操作)
    if (event.security_only_template_before_confirm !== undefined) {
      touch('security_only_template_before_confirm', !!event.security_only_template_before_confirm);
    }
    // 环境开关: dev(允许 mock_openid 测试身份) / prod(强制忽略, 见各函数 openid.js)
    // D6 危险操作确认: 切到 dev 会开放 mock 身份门控(资金/接单全 mock), 须显式 confirm; 切回 prod 是安全方向免确认
    if (event.env !== undefined) {
      const envVal = String(event.env);
      if (envVal !== 'dev' && envVal !== 'prod') return fail('config_bad_env', 'env 仅支持 dev 或 prod');
      if (envVal === 'dev' && (config.env || 'prod') !== 'dev' && event.confirm !== 'SWITCH_DEV') {
        return fail('config_need_confirm', '切到 dev 将开放 mock 身份门控, 须传 confirm=SWITCH_DEV');
      }
      touch('env', envVal);
    }

    // admin_web_key 轮换(安全加固: 历史泄露后紧急轮换, 仅 super 可操作, 需 reason 审计)
    if (event.admin_web_key !== undefined) {
      const newKey = String(event.admin_web_key).trim();
      if (!/^AWK-[a-f0-9]{64}$/.test(newKey)) return fail('config_bad_key', 'admin_web_key 格式不符 AWK-+64位hex');
      if (!event.reason) return fail('config_need_reason', '轮换 admin_web_key 需填 reason');
      touch('admin_web_key', newKey);
      logEvent('P2', 'config_rotate_web_key', openid, { reason: event.reason });
    }

    // 屏蔽词增删
    let words = (config.block_words || []).slice();
    let wordsTouched = false;
    if (Array.isArray(event.block_words_add)) {
      event.block_words_add.map((w) => String(w).trim()).filter(Boolean).forEach((w) => {
        if (words.indexOf(w) < 0) { words.push(w); wordsTouched = true; }
      });
    }
    if (Array.isArray(event.block_words_remove)) {
      const rm = event.block_words_remove.map((w) => String(w).trim());
      const next = words.filter((w) => rm.indexOf(w) < 0);
      if (next.length !== words.length) wordsTouched = true;
      words = next;
    }
    if (wordsTouched) { before.block_words = config.block_words || []; patch.block_words = words; }

    // 测试身份白名单增删(D4-5 is_test 打标源; 命中者建需求/建单自动打标, 供 purge_test_data 精准清理)
    let testOids = (config.test_openids || []).slice();
    let testTouched = false;
    if (Array.isArray(event.test_openids_add)) {
      event.test_openids_add.map((w) => String(w).trim()).filter(Boolean).forEach((w) => {
        if (testOids.indexOf(w) < 0) { testOids.push(w); testTouched = true; }
      });
    }
    if (Array.isArray(event.test_openids_remove)) {
      const rm = event.test_openids_remove.map((w) => String(w).trim());
      const next = testOids.filter((w) => rm.indexOf(w) < 0);
      if (next.length !== testOids.length) testTouched = true;
      testOids = next;
    }
    if (testTouched) { before.test_openids = config.test_openids || []; patch.test_openids = testOids; }

    // 开通城市增删
    let cities = (config.city_enabled || []).slice();
    let citiesTouched = false;
    if (Array.isArray(event.city_add)) {
      event.city_add.map((c) => String(c).trim()).filter(Boolean).forEach((c) => {
        if (cities.indexOf(c) < 0) { cities.push(c); citiesTouched = true; }
      });
    }
    if (Array.isArray(event.city_remove)) {
      const rm = event.city_remove.map((c) => String(c).trim());
      const next = cities.filter((c) => rm.indexOf(c) < 0);
      if (next.length !== cities.length) citiesTouched = true;
      cities = next;
    }
    if (citiesTouched) { before.city_enabled = config.city_enabled || []; patch.city_enabled = cities; }

    // int 参数统一校验(区间由 CONFIG_SCHEMA 单一真相声明; 新增参数零改动)
    const intFields = CONFIG_SCHEMA
      .filter((s) => s.t === 'int')
      .map((s) => [s.f, s.min, s.max]);
    for (const [f, lo, hi] of intFields) {
      if (event[f] !== undefined) {
        const v = parseInt(event[f], 10);
        if (!Number.isInteger(v) || v < lo || v > hi) return fail('config_bad_' + f, `${f} 须为 ${lo}-${hi} 的整数`);
        touch(f, v);
      }
    }
    if (patch.rate_min_fen !== undefined || patch.rate_max_fen !== undefined) {
      const minF = patch.rate_min_fen !== undefined ? patch.rate_min_fen : (config.rate_min_fen || 3000);
      const maxF = patch.rate_max_fen !== undefined ? patch.rate_max_fen : (config.rate_max_fen || 10000);
      if (minF >= maxF) return fail('config_bad_rate_range', '最低时薪必须小于最高时薪');
    }

    // 接单时间红线联动校验: close>0 时 open 必须早于 close; close=0 表示全天开放(open 值无意义)
    if (patch.time_redline_close_min !== undefined || patch.time_redline_open_min !== undefined) {
      const parseCur = (v, d) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : d; };
      const closeR = patch.time_redline_close_min !== undefined
        ? patch.time_redline_close_min
        : parseCur(config.time_redline_close_min, 1440);
      const openR = patch.time_redline_open_min !== undefined
        ? patch.time_redline_open_min
        : parseCur(config.time_redline_open_min, 360);
      if (closeR > 0 && openR >= closeR) {
        return fail('config_bad_time_redline', '接单开放须早于接单截止；截止设 0 表示全天开放');
      }
    }

    // 改期规则对象(部分更新; 与库内已有对象合并, 仅接受 4 个白名单子字段)
    if (event.modify_config !== undefined) {
      if (typeof event.modify_config !== 'object' || Array.isArray(event.modify_config) || event.modify_config === null) {
        return fail('config_bad_modify_config', 'modify_config 须为对象');
      }
      const mcRanges = [
        ['minLeadHours', 0, 72], ['maxTimes', 0, 10],
        ['maxSpanH', 1, 720], ['confirmHours', 1, 168]
      ];
      const nextMC = Object.assign(
        { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 },
        config.modify_config || {}
      );
      for (const [k, lo, hi] of mcRanges) {
        if (event.modify_config[k] !== undefined) {
          const v = parseInt(event.modify_config[k], 10);
          if (!Number.isInteger(v) || v < lo || v > hi) {
            return fail('config_bad_modify_' + k, `modify_config.${k} 须为 ${lo}-${hi} 的整数`);
          }
          nextMC[k] = v;
        }
      }
      before.modify_config = config.modify_config || {};
      patch.modify_config = nextMC;
    }

    // 场景服务项增删(仅对已有场景; 新增服务项需小程序发版后才会在发布页显示)
    let scenes = (config.scene_list || []).map((s) => Object.assign({}, s, { options: (s.options || []).slice() }));
    let scenesTouched = false;
    const sceneOpt = event.scene_option_add || event.scene_option_remove;
    if (sceneOpt) {
      const isAdd = !!event.scene_option_add;
      const req = isAdd ? event.scene_option_add : event.scene_option_remove;
      const sc = scenes.find((s) => s.code === req.scene);
      if (!sc) return fail('config_scene_not_found', '场景不存在: ' + req.scene);
      const opt = String(req.option || '').trim();
      if (!opt || opt.length > 10) return fail('config_bad_option', '服务项名称须为 1-10 字');
      if (isAdd) {
        if ((sc.options || []).length >= 8) return fail('config_too_many_options', '单场景服务项最多 8 个');
        if (sc.options.indexOf(opt) < 0) { sc.options.push(opt); scenesTouched = true; }
      } else {
        const next = sc.options.filter((x) => x !== opt);
        if (next.length !== sc.options.length) { sc.options = next; scenesTouched = true; }
      }
    }
    if (scenesTouched) { before.scene_list = config.scene_list || []; patch.scene_list = scenes; }

    // 场景新增(自定义场景, builtin=false)
    if (event.scene_add) {
      const req = event.scene_add;
      const code = String(req.code || '').trim().toUpperCase();
      const name = String(req.name || '').trim();
      if (!code || !/^W\d{1,3}$/.test(code)) return fail('config_bad_scene_code', '场景编码须为 W + 1-3 位数字(如 W12)');
      if (!name || name.length > 12) return fail('config_bad_scene_name', '场景名称须为 1-12 字');
      if (scenes.find((s) => s.code === code)) return fail('config_scene_exists', '场景编码已存在: ' + code);
      const newScene = {
        code, name,
        options: (req.options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 8),
        disclaimer_type: String(req.disclaimer_type || 'general_disclaimer').trim(),
        builtin: false,
        created_at: now
      };
      scenes.push(newScene);
      before.scene_list = config.scene_list || [];
      patch.scene_list = scenes;
      scenesTouched = true;
    }

    // 场景删除(仅自定义场景可删; builtin=true 的种子场景拦截)
    if (event.scene_delete) {
      const code = String(event.scene_delete || '').trim().toUpperCase();
      const idx = scenes.findIndex((s) => s.code === code);
      if (idx < 0) return fail('config_scene_not_found', '场景不存在: ' + code);
      if (scenes[idx].builtin) return fail('config_scene_builtin', `内置场景 ${code} 不可删除, 仅可修改服务项`);
      if (scenes[idx].options && scenes[idx].options.length > 0) {
        return fail('config_scene_has_options', `场景 ${code} 还有服务项, 请先清空服务项再删除`);
      }
      scenes.splice(idx, 1);
      before.scene_list = config.scene_list || [];
      patch.scene_list = scenes;
      scenesTouched = true;
    }

    // 一次性迁移: 给所有现有场景补 builtin:true(种子场景, 历史遗漏)
    if (event.scene_migrate_builtin) {
      let touched = 0;
      before.scene_list = config.scene_list || [];
      scenes.forEach((s) => { if (s.builtin !== true) { s.builtin = true; touched++; } });
      if (touched > 0) {
        patch.scene_list = scenes;
        scenesTouched = true;
        logEvent('P2', 'scene_migrate_builtin', openid, { count: touched });
      }
    }

    // IM 模板增删
    let templates = (config.system_templates || []).slice();
    let tplTouched = false;
    if (event.template_add) {
      const text = String(event.template_add).trim();
      if (!text || text.length > 30) return fail('config_bad_template', '模板文案须为 1-30 字');
      const maxNum = templates.reduce((m, t) => {
        const n = parseInt(String(t.id || '').replace(/^T/, ''), 10);
        return Number.isInteger(n) && n > m ? n : m;
      }, 0);
      templates.push({ id: 'T' + (maxNum + 1), text });
      tplTouched = true;
    }
    if (event.template_remove) {
      const id = String(event.template_remove).trim();
      const next = templates.filter((t) => t.id !== id);
      if (next.length !== templates.length) { templates = next; tplTouched = true; }
    }
    if (tplTouched) { before.system_templates = config.system_templates || []; patch.system_templates = templates; }

    // 法律文件/免责声明(大文本, 限长, P2 config_change 审计)
    const legalFields = [
      ['legal_disclaimer_text', 0, 8000],      // 通用免责声明(发布前弹)
      ['legal_service_agreement', 0, 20000],   // 服务协议
      ['legal_privacy_policy', 0, 20000],      // 隐私政策
      ['legal_aa_promise', 0, 8000],            // 费用自理承诺书(实名签署留证对象)
      ['legal_pet_authorization', 0, 8000]     // 宠物照料授权书(W9 电子确认留证对象)
    ];
    for (const [f, lo, hi] of legalFields) {
      if (event[f] !== undefined) {
        const v = String(event[f]);
        if (v.length < lo || v.length > hi) return fail('config_bad_' + f, `${f} 长度须为 ${lo}-${hi}`);
        touch(f, v);
      }
    }
    // 各场景专属免责声明({scene_code: text})
    if (event.legal_scene_disclaimers !== undefined) {
      if (typeof event.legal_scene_disclaimers !== 'object' || Array.isArray(event.legal_scene_disclaimers)) {
        return fail('config_bad_scene_disclaimers', 'legal_scene_disclaimers 须为 {scene_code: text} 对象');
      }
      const next = {};
      for (const [code, text] of Object.entries(event.legal_scene_disclaimers)) {
        const t = String(text || '');
        if (t.length > 4000) return fail('config_bad_scene_disclaimer_' + code, `${code} 免责声明不得超过 4000 字`);
        if (t) next[code] = t;
      }
      before.legal_scene_disclaimers = config.legal_scene_disclaimers || {};
      patch.legal_scene_disclaimers = next;
    }

    const changed = Object.keys(patch).filter((k) => k !== 'updated_at');
    if (!changed.length) return fail('config_no_change', '没有需要修改的字段');
    await col('admin_config').where({ _id: 'global' }).update({ data: patch });
    // 变更原因(前端 diff 确认弹窗必填; 旧客户端可能不带, 兼容空值)
    const reason = event.reason !== undefined ? String(event.reason).trim().slice(0, 100) : '';
    const eventPayload = { before, after: patch };
    if (reason) eventPayload.reason = reason;
    await logEvent('P2', 'config_change', openid, eventPayload);
    // config_history 版本快照(专家优化建议 ④, 2026-10-07): 每次 config_set 成功后追加变更版本,
    // 敏感键(admin_web_key/idcard_aes_key 及一切含 key/secret/token 的键)一律掩码 '***';
    // 只保留被修改键的 before/after(避免整份配置冗余); 保留最近 100 版, 超出删最旧。
    try {
      await db.createCollection('config_history').catch(() => {});
      const SENSITIVE_RE = /key|secret|token/i;
      const snapshot = { keys: changed, before: {}, after: {}, reason, operator: operatorAccount || openid || '', at: now };
      changed.forEach((k) => {
        const mask = (v) => (SENSITIVE_RE.test(k) ? '***' : v);
        snapshot.before[k] = mask(before[k]);
        snapshot.after[k] = mask(patch[k]);
      });
      await col('config_history').add({ data: { ...snapshot, created_at: now, updated_at: now, is_deleted: false } });
      const cnt = await col('config_history').where({ is_deleted: _.neq(true) }).count();
      if ((cnt.total || 0) > 100) {
        const extra = await col('config_history').where({ is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit((cnt.total || 0) - 100).get();
        await Promise.allSettled((extra.data || []).map((d) => col('config_history').doc(d._id).remove()));
      }
    } catch (e) { log.d(`config_history write fail: ${e.message}`); }
    return ok({ updated: changed });
  }

  // ───────── 8.4 参数变更日志(platform_event type=config_change 分页倒序) ─────────
  if (action === 'config_log_list') {
    const pg = pager(event);
    const baseQ = { type: 'config_change', is_deleted: false };
    const cnt = await col('platform_event').where(baseQ).count();
    const r = await col('platform_event')
      .where(baseQ).orderBy('created_at', 'desc')
      .skip(pg.skip).limit(pg.size).get();
    return ok({
      total: cnt.total, page: pg.page, size: pg.size,
      list: r.data.map((e) => {
        const p = e.payload || {};
        return {
          _id: e._id,
          created_at: e.created_at,
          openid: e.openid || '',
          reason: p.reason || '',
          before: p.before || {},
          after: p.after || {}
        };
      })
    });
  }

  // ───────── 8.7 实名与签署留证(P0 手写签名+实名正式版) ─────────
  // 重置「模拟实名」账号(上线前必办): 仅清 is_realname_simulated=true 的测试账号,
  // 真实证件+签名留证用户不受影响; 不传 openid 则全量重置
  if (action === 'realname_reset_simulated') {
    const target = event.openid ? String(event.openid).trim() : '';
    if (target && !isOpenid(target)) return fail('rrs_bad_openid', 'openid 格式不正确');
    const q = { is_realname_simulated: true };
    if (target) q.openid = target;
    const r = await col('user_account').where(q).update({ data: {
      is_realname_done: false, is_realname_simulated: false,
      realname_reset_at: now, updated_at: now
    }}).catch(() => ({ stats: { updated: 0 } }));
    const updated = (r.stats && r.stats.updated) || 0;
    await logEvent('P2', 'realname_reset_simulated', openid, { target: target || 'ALL', updated });
    return ok({ updated, target: target || 'ALL' });
  }

  // 签署留证查询(实名协议/场景免责声明): 按 openid/kind/scene 过滤;
  // 传 evidence_id 返回单条完整记录(含协议全文, 供纠纷举证)
  if (action === 'evidence_query') {
    if (event.evidence_id) {
      if (!isDocId(String(event.evidence_id))) return fail('eq_bad_id', 'evidence_id 需为 32 位文档 _id');
      const dr = await col('disclaimer_signature').doc(String(event.evidence_id)).get().catch(() => ({ data: null }));
      if (!dr.data) return fail('eq_not_found', '留证记录不存在');
      return ok({ record: dr.data });
    }
    const pg = pager(event);
    const q = { is_deleted: false };
    if (event.openid) {
      if (!isOpenid(String(event.openid))) return fail('eq_bad_openid', 'openid 格式不正确');
      q.openid = String(event.openid);
    }
    if (event.kind) q.kind = String(event.kind);
    if (event.scene) q.scene = String(event.scene);
    const cnt = await col('disclaimer_signature').where(q).count();
    const r = await col('disclaimer_signature').where(q)
      .orderBy('signed_at', 'desc').skip(pg.skip).limit(pg.size).get();
    return ok({
      total: cnt.total, page: pg.page, size: pg.size,
      list: r.data.map((x) => ({
        _id: x._id,
        kind: x.kind || 'scene_disclaimer',
        openid: String(x.openid || ''),
        role: x.role || '', scene: x.scene || '',
        disclaimer_type: x.disclaimer_type || '',
        agree_type: x.agree_type || (x.verify_method ? 'handwritten' : ''),
        verify_method: x.verify_method || '',
        signature_file_id: x.signature_file_id || '',
        signature_hash: x.signature_hash || '',
        docs: Array.isArray(x.docs) ? x.docs.map((d) => ({ key: d.key, title: d.title, hash: d.hash })) : [],
        signed_at: x.signed_at || x.created_at
      }))
    });
  }

  // ───────── 8.8 行为审计留痕·证据链(认证/授权/确认/注册/平台操作) ─────────
  // audit_log 集合: 每条记录带 prev_hash→chain_hash 哈希链, 事后篡改/删除可被 audit_verify 检出。
  // 写入侧见各业务云函数 audit.js(writeAudit); 本处提供 建集合/查询/链校验 三个动作。
  if (action === 'audit_init') {
    let created = false;
    try {
      await db.createCollection('audit_log');
      created = true;
    } catch (e) {
      log.d(`audit_init createCollection: ${(e && e.message) || e}`);
    }
    // 链查询索引(openid+at): SDK 不支持时降级跳过, 返回 note 说明(不影响写入, 链校验会体现)
    let index = { created: false, note: '' };
    try {
      await col('audit_log').createIndex({ name: 'idx_openid_at', keys: { openid: 1, at: -1 } });
      index = { created: true, note: '' };
    } catch (e) {
      index = { created: false, note: String((e && e.errMsg) || (e && e.message) || e).slice(0, 200) };
    }
    const cnt = await col('audit_log').count().catch(() => ({ total: 0 }));
    await logEvent('P2', 'audit_init', openid, { created, index, total: cnt.total || 0 });
    return ok({ created, index, total: cnt.total || 0 });
  }

  // 审计记录查询(openid/category/result/action/时间范围 过滤, 分页倒序)
  // 注意: event.action 已被本函数占用于动作路由, 审计动作名过滤参数为 action_name
  if (action === 'audit_query') {
    const pg = pager(event);
    const q = {};
    if (event.openid) {
      if (!isOpenid(String(event.openid))) return fail('aq_bad_openid', 'openid 格式不正确');
      q.openid = String(event.openid);
    }
    if (event.action_name) q.action = String(event.action_name);
    if (event.category) q.category = String(event.category);
    if (event.result) q.result = String(event.result);
    if (event.target_id) q.target_id = String(event.target_id);
    const win = [];
    const s = parseInt(event.start_ts, 10);
    const e2 = parseInt(event.end_ts, 10);
    if (Number.isInteger(s)) win.push({ at: _.gte(s) });
    if (Number.isInteger(e2)) win.push({ at: _.lte(e2) });
    const where = win.length ? _.and([q].concat(win)) : q;
    const cnt = await col('audit_log').where(where).count().catch(() => ({ total: 0 }));
    const r = await col('audit_log').where(where).orderBy('at', 'desc')
      .skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }));
    return ok({
      total: cnt.total || 0, page: pg.page, size: pg.size,
      list: (r.data || []).map((x) => ({
        _id: x._id, openid: x.openid || '', role: x.role || '',
        category: x.category || '', action: x.action || '',
        target_type: x.target_type || '', target_id: x.target_id || '',
        detail: x.detail || {}, evidence_id: x.evidence_id || '', doc_hash: x.doc_hash || '',
        result: x.result || 'ok', code: x.code || '',
        client_ip: maskIp(x.client_ip), device: x.device || '', platform: x.platform || '',
        at: x.at, prev_hash: x.prev_hash || '', chain_hash: x.chain_hash || ''
      }))
    });
  }

  // 证据链校验: 按 openid 拉全量(时间升序)逐条重算哈希, 报首个断点(chain_hash_mismatch / prev_hash_link_break)
  // 分页: keyset 游标((at,_id) 元组升序)替代旧 skip<5000 上限 —— 无条数上限, 大 openid 也不会截断
  if (action === 'audit_verify') {
    const target = String(event.openid || '').trim();
    if (!isOpenid(target)) return fail('av_bad_openid', 'openid 格式不正确');
    const crypto = require('crypto');
    const recs = [];
    const BATCH = 100;
    let cursorAt = null;
    let cursorId = null;
    for (let guard = 0; guard < 500; guard++) { // 500 批=最多 5 万条, 超出视为异常截断(防死循环)
      const where = cursorAt === null
        ? { openid: target }
        : _.and([
            { openid: target },
            _.or([
              { at: _.gt(cursorAt) },
              { at: _.eq(cursorAt), _id: _.gt(cursorId) }
            ])
          ]);
      const r = await col('audit_log').where(where)
        .orderBy('at', 'asc').orderBy('_id', 'asc').limit(BATCH).get().catch(() => ({ data: [] }));
      const rows = r.data || [];
      for (const x of rows) recs.push(x);
      if (rows.length < BATCH) break;
      const last = rows[rows.length - 1];
      cursorAt = last.at;
      cursorId = last._id;
    }
    // 篡改 vs 分叉噪声区分(Phase2-A2):
    // - chain_hash_mismatch(重算哈希对不上本条内容) = 真篡改/内容被改, 立即中断并报 broken
    // - prev_hash_link_break 但本条自身哈希可重算通过 = 并发写入/同毫秒多条导致的分叉或排序噪声,
    //   收集到 noise 列表继续校验(内容未被篡改); 终极消除需引入 audit_chain_head 事务链头
    let broken = null;
    const noise = [];
    let prevChain = '';
    for (let i = 0; i < recs.length; i++) {
      const x = recs[i];
      const expect = crypto.createHash('sha256').update([
        x.prev_hash || '', x.openid || '', x.action || '', x.target_id || '', x.at,
        JSON.stringify(x.detail || {})
      ].join('|'), 'utf8').digest('hex');
      const mismatch = expect !== (x.chain_hash || '');
      const linkBreak = i > 0 && (x.prev_hash || '') !== prevChain;
      if (mismatch) {
        broken = {
          index: i, record_id: x._id, action: x.action, at: x.at,
          reason: 'chain_hash_mismatch'
        };
        break;
      }
      if (linkBreak) {
        noise.push({ index: i, record_id: x._id, action: x.action, at: x.at, reason: 'prev_hash_link_break' });
      }
      prevChain = x.chain_hash || '';
    }
    const verdict = broken ? 'tampered' : (noise.length ? 'fork_noise' : 'ok');
    return ok({
      openid: target, total: recs.length,
      ok: !broken && noise.length === 0,
      verdict,
      first_ts: recs.length ? recs[0].at : 0,
      last_ts: recs.length ? recs[recs.length - 1].at : 0,
      broken,
      noise,
      note: noise.length
        ? '存在分叉/排序噪声(同毫秒多条或并发写入), 未发现内容篡改; 如需消除分叉需引入 audit_chain_head 事务链头'
        : '',
      checked_at: now
    });
  }

  // ───────── 8.45 活动图片上传(admin-web → base64 → 云存储; 格式/大小服务端强校验) ─────────
  // 规格建议(前端上传时按用途校验尺寸): banner 750×360 横向 / cover 750×750 方形, jpg/png/webp ≤2MB
  // 服务端只强校验格式与大小; 尺寸由前端读图校验提示, 避免上传非目标比例的图导致 C 端展示变形
  if (action === 'upload_image') {
    const use = event.use === 'cover' ? 'cover' : 'banner';
    const b64 = String(event.fileData || '').replace(/^data:image\/\w+;base64,/, '').trim();
    if (!b64) return fail('up_bad_data', '图片数据为空');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return fail('up_bad_data', '图片数据为空');
    if (buf.length > 2 * 1024 * 1024) return fail('up_too_big', '图片大小不能超过 2MB');
    let ext = '';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
    else if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ext = 'png';
    else if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') ext = 'webp';
    if (!ext) return fail('up_bad_ext', '仅支持 jpg/png/webp 格式');
    const day = (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
    const cloudPath = `admin_web/activity/${day}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    let up;
    try {
      up = await cloud.uploadFile({ cloudPath, fileContent: buf });
    } catch (e) {
      log.d('upload_image fail:', e && e.message);
      return { ok: false, code: 'up_fail', msg: '图片上传失败,请重试' };
    }
    await logEvent('P2', 'upload_image', openid, { use, size: buf.length, cloudPath });
    return ok({ fileID: up.fileID });
  }

  // ───────── 8.5 首页活动管理(CRUD, 存 admin_config.home_activities) ─────────
  if (action === 'home_activity_list') {
    const list = (config.home_activities || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return ok({ list });
  }

  if (action === 'home_activity_create') {
    const a = event.activity || {};
    if (!a.title || String(a.title).length > 30) return fail('act_bad_title', '活动标题须为 1-30 字');
    if (!a.type || !['banner', 'card', 'both'].includes(a.type)) return fail('act_bad_type', 'type 须为 banner/card/both');
    if (!a.jump_to || !['demand_publish', 'scene_list', 'webview', 'activity_detail'].includes(a.jump_to)) {
      return fail('act_bad_jump', 'jump_to 不合法');
    }
    if (a.start_at && a.end_at && a.start_at >= a.end_at) return fail('act_bad_time', '开始时间必须早于结束时间');
    const c = a.content || {};
    if (c && (!Array.isArray(c.rules) || c.rules.some((x) => typeof x !== 'string'))) {
      return fail('act_bad_content', 'content.rules 须为字符串数组');
    }
    const list = config.home_activities || [];
    const id = 'A' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const newAct = {
      id,
      title: String(a.title).trim(),
      subtitle: String(a.subtitle || '').trim().slice(0, 60),
      banner_image: String(a.banner_image || '').trim(),
      cover_image: String(a.cover_image || '').trim(),
      type: a.type,
      jump_to: a.jump_to,
      jump_param: a.jump_param || {},
      start_at: a.start_at || now,
      end_at: a.end_at || (now + 30 * 86400000),
      status: a.status || 'active',
      priority: Number(a.priority) || 0,
      scene_code: a.scene_code || '',
      content: {
        time_text: String(c.time_text || '').trim().slice(0, 60),
        location: String(c.location || '').trim().slice(0, 60),
        rules: Array.isArray(c.rules) ? c.rules.map((r) => String(r).trim().slice(0, 60)).filter(Boolean).slice(0, 10) : [],
        body: String(c.body || '').trim().slice(0, 500),
        cta_text: String(c.cta_text || '').trim().slice(0, 12)
      },
      created_at: now,
      created_by: openid
    };
    list.push(newAct);
    await col('admin_config').where({ _id: 'global' }).update({ data: { home_activities: list, updated_at: now } });
    await logEvent('P2', 'home_activity_create', openid, { id, title: newAct.title });
    return ok({ activity: newAct });
  }

  if (action === 'home_activity_update') {
    const { id, patch } = event;
    if (!id) return fail('act_bad_id', '活动 id 必填');
    const list = config.home_activities || [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return fail('act_not_found', '活动不存在');
    const allowed = ['title', 'subtitle', 'banner_image', 'cover_image', 'type', 'jump_to', 'jump_param', 'start_at', 'end_at', 'status', 'priority', 'scene_code', 'content'];
    const updated = Object.assign({}, list[idx]);
    for (const k of allowed) {
      if (patch[k] !== undefined) updated[k] = patch[k];
    }
    if (updated.content && (!Array.isArray(updated.content.rules) || updated.content.rules.some((x) => typeof x !== 'string'))) {
      return fail('act_bad_content', 'content.rules 须为字符串数组');
    }
    if (updated.start_at && updated.end_at && updated.start_at >= updated.end_at) {
      return fail('act_bad_time', '开始时间必须早于结束时间');
    }
    updated.updated_at = now;
    updated.updated_by = openid;
    list[idx] = updated;
    await col('admin_config').where({ _id: 'global' }).update({ data: { home_activities: list, updated_at: now } });
    await logEvent('P2', 'home_activity_update', openid, { id, patch });
    return ok({ activity: updated });
  }

  if (action === 'home_activity_delete') {
    const { id } = event;
    if (!id) return fail('act_bad_id', '活动 id 必填');
    const list = config.home_activities || [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return fail('act_not_found', '活动不存在');
    list.splice(idx, 1);
    await col('admin_config').where({ _id: 'global' }).update({ data: { home_activities: list, updated_at: now } });
    await logEvent('P2', 'home_activity_delete', openid, { id });
    return ok({ deleted: id });
  }

  // ───────── 认证考试管理(exam_bank 独立集合, 答案不随 admin_config 导出) ─────────
  // 科目 doc: { code, title, desc, pass_line, requires[], enabled, questions[{question,options,answer_idx}], is_deleted }
  // 题目上限 60 题/科目(网关 100KB body 限制); 删除科目须无其它科目 requires 引用(防悬挂)
  // 题库 FALLBACK(SSOT 与 partner-action EXAM_BANK 同源): 仅 exam_bank_seed 使用, 读库失败兜底由 partner-action 自己持有
  const EXAM_BANK_FALLBACK = {
    base: { title: '耍伴基础考试', desc: '全体耍伴接单前置，满分 100 分通过', pass_line: 100, requires: [], questions: [
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
    ] },
    W1: { title: '陪诊提升考试', desc: '就医陪诊场景专项，满分 100 分通过；需先通过基础考试', pass_line: 100, requires: ['base'], questions: [
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
    ] }
  };

  // 校验题目/科目数据(返回 fail 结果或 null=通过)
  function validateExamSubject(d, existingCodes, allowCode) {
    const code = String(d.code || '').trim();
    if (!/^[A-Za-z0-9_]{1,20}$/.test(code)) return fail('exam_bad_code', '科目 code 须为 1-20 位字母/数字/下划线');
    const title = String(d.title || '').trim();
    if (!title || title.length > 20) return fail('exam_bad_title', '科目标题须为 1-20 字');
    if (d.desc !== undefined && String(d.desc).length > 100) return fail('exam_bad_desc', '科目说明不超过 100 字');
    const passLine = Number(d.pass_line);
    if (!Number.isInteger(passLine) || passLine < 0 || passLine > 100) return fail('exam_bad_pass_line', '通过线须为 0-100 整数');
    if (!Array.isArray(d.requires)) return fail('exam_bad_requires', 'requires 须为数组');
    for (const r of d.requires) {
      if (!existingCodes.includes(r)) return fail('exam_bad_require_ref', `前置科目 ${r} 不存在`);
      if (r === code) return fail('exam_bad_require_self', '科目不能前置自身');
    }
    const qs = d.questions;
    if (!Array.isArray(qs) || qs.length < 1 || qs.length > 60) return fail('exam_bad_qcount', '题目须为 1-60 条');
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      if (!q || typeof q !== 'object') return fail('exam_bad_q', `第 ${i + 1} 题格式错误`);
      const text = String(q.question || '').trim();
      if (!text || text.length > 500) return fail('exam_bad_q_text', `第 ${i + 1} 题题干须为 1-500 字`);
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return fail('exam_bad_q_opts', `第 ${i + 1} 题须 2-6 个选项`);
      for (let j = 0; j < q.options.length; j++) {
        const o = String(q.options[j] || '').trim();
        if (!o || o.length > 50) return fail('exam_bad_q_opt', `第 ${i + 1} 题第 ${j + 1} 个选项须为 1-50 字`);
      }
      const ai = Number(q.answer_idx);
      if (!Number.isInteger(ai) || ai < 0 || ai >= q.options.length) return fail('exam_bad_q_ans', `第 ${i + 1} 题答案索引不合法`);
    }
    return null;
  }
  // 整理单科目输出(列表脱敏: 不含 questions)
  const examSubjectMeta = (s) => ({
    code: s.code, title: s.title, desc: s.desc || '', pass_line: s.pass_line,
    requires: s.requires || [], enabled: !!s.enabled,
    question_count: Array.isArray(s.questions) ? s.questions.length : 0,
    updated_at: s.updated_at || 0
  });

  if (action === 'exam_subject_list') {
    await ensureAdminColls();
    const r = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
    const list = (r.data || []).sort((a, b) => (a.code === 'base' ? 0 : 1) - (b.code === 'base' ? 0 : 1) || (a.created_at || 0) - (b.created_at || 0));
    return ok({ list: list.map(examSubjectMeta) });
  }

  if (action === 'exam_subject_detail') {
    await ensureAdminColls();
    const code = String(event.code || '').trim();
    if (!code) return fail('exam_bad_code', '科目 code 必填');
    const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
    const s = (r.data && r.data[0]) || null;
    if (!s) return fail('exam_not_found', '科目不存在');
    return ok({ subject: examSubjectMeta(s), questions: s.questions || [] });
  }

  if (action === 'exam_subject_create' || action === 'exam_subject_update') {
    await ensureAdminColls();
    const isCreate = action === 'exam_subject_create';
    const code = String(event.code || '').trim();
    const allR = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
    const existingCodes = (allR.data || []).map((s) => s.code);
    if (isCreate && existingCodes.includes(code)) return fail('exam_exists', `科目 ${code} 已存在, 请用编辑`);
    if (!isCreate && !existingCodes.includes(code)) return fail('exam_not_found', '科目不存在');
    const v = validateExamSubject({ code, title: event.title, desc: event.desc, pass_line: event.pass_line, requires: event.requires, questions: event.questions }, existingCodes, code);
    if (v) return v;
    const cleanQs = (event.questions || []).map((q) => ({
      question: String(q.question || '').trim().slice(0, 500),
      options: q.options.map((o) => String(o || '').trim().slice(0, 50)),
      answer_idx: Number(q.answer_idx)
    }));
    if (isCreate) {
      const doc = {
        code, title: String(event.title).trim(), desc: String(event.desc || '').trim().slice(0, 100),
        pass_line: Number(event.pass_line), requires: (event.requires || []).filter((r) => existingCodes.includes(r)),
        enabled: event.enabled !== false, questions: cleanQs,
        is_deleted: false, created_at: now, updated_at: now, created_by: openid, updated_by: openid
      };
      await col('exam_bank').add({ data: doc });
      await logEvent('P2', 'exam_subject_create', openid, { code, title: doc.title, qcount: cleanQs.length, pass_line: doc.pass_line });
      return ok({ subject: examSubjectMeta(doc) });
    }
    const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
    const cur = (r.data && r.data[0]) || null;
    if (!cur) return fail('exam_not_found', '科目不存在');
    const patch = {
      title: String(event.title).trim(), desc: String(event.desc || '').trim().slice(0, 100),
      pass_line: Number(event.pass_line), requires: (event.requires || []).filter((r) => existingCodes.includes(r)),
      enabled: event.enabled !== false, questions: cleanQs,
      updated_at: now, updated_by: openid
    };
    await col('exam_bank').doc(cur._id).update({ data: patch });
    await logEvent('P2', 'exam_subject_update', openid, { code, title: patch.title, qcount: cleanQs.length, pass_line: patch.pass_line });
    return ok({ subject: examSubjectMeta(Object.assign({}, cur, patch)) });
  }

  if (action === 'exam_subject_delete') {
    await ensureAdminColls();
    const code = String(event.code || '').trim();
    if (!code) return fail('exam_bad_code', '科目 code 必填');
    const allR = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
    const refs = (allR.data || []).filter((s) => (s.requires || []).includes(code)).map((s) => s.code);
    if (refs.length > 0) return fail('exam_in_use', `科目被 ${refs.join('/')} 前置引用, 不可删除`);
    const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
    const cur = (r.data && r.data[0]) || null;
    if (!cur) return fail('exam_not_found', '科目不存在');
    await col('exam_bank').doc(cur._id).update({ data: { is_deleted: true, updated_at: now, updated_by: openid } });
    await logEvent('P2', 'exam_subject_delete', openid, { code });
    return ok({ deleted: code });
  }

  if (action === 'exam_bank_seed') {
    await ensureAdminColls();
    const r = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
    const existingCodes = (r.data || []).map((s) => s.code);
    const created = [];
    const skipped = [];
    for (const [code, def] of Object.entries(EXAM_BANK_FALLBACK)) {
      if (existingCodes.includes(code)) { skipped.push(code); continue; }
      const doc = {
        code, title: def.title, desc: def.desc, pass_line: def.pass_line, requires: def.requires,
        enabled: true, questions: def.questions, is_deleted: false,
        created_at: now, updated_at: now, created_by: openid, updated_by: openid
      };
      await col('exam_bank').add({ data: doc });
      created.push(code);
    }
    await logEvent('P2', 'exam_bank_seed', openid, { created, skipped });
    return ok({ created, skipped });
  }

  // ───────── 8.6 通知群发(system_notice 广播 → 用户消息中心) ─────────
  // audience: all(全部用户) / partner(仅耍伴) / user(仅普通用户) / one(指定用户)
  // 频控: 群发(>1 人)同操作者 10 分钟内仅 1 次; 发送记录走 logEvent P2(platform_event + audit_log), 无需额外表
  if (action === 'notice_send') {
    const t = String(event.title || '').trim();
    const b = String(event.body || '').trim();
    const audience = event.audience;
    if (!t || t.length > 30) return fail('notice_bad_title', '标题必填且不超过30字');
    if (!b || b.length > 500) return fail('notice_bad_body', '内容必填且不超过500字');
    if (['all', 'partner', 'user', 'one'].indexOf(audience) < 0) {
      return fail('notice_bad_audience', '群发对象不合法');
    }
    // 目标 openid 集合
    let targets = [];
    if (audience === 'one') {
      if (!isOpenid(event.target_openid)) return fail('notice_bad_openid', 'openid 格式不正确');
      targets = [event.target_openid];
    } else {
      const q = { is_deleted: _.neq(true) };
      if (audience === 'partner') q.roles = 'partner';
      else if (audience === 'user') q.roles = _.neq('partner');
      const ur = await col('user_account').where(q).field({ openid: true }).limit(1000).get()
        .catch(() => ({ data: [] }));
      targets = (ur.data || []).map((d) => d.openid).filter(Boolean);
    }
    if (targets.length === 0) return fail('notice_no_target', '没有可发送的目标用户');
    // 群发频控(>1 人): 10 分钟内同操作者仅 1 次
    if (targets.length > 1) {
      const recent = await col('platform_event').where({
        type: 'notice_send', openid, created_at: _.gte(now - 10 * 60 * 1000)
      }).count().catch(() => ({ total: 0 }));
      if ((recent.total || 0) > 0) return fail('notice_too_frequent', '群发10分钟内仅可1次');
    }
    // fan-out 批量写入(单次上限 1000 人, 分块 100 写避免超时/批量上限)
    const cap = Math.min(targets.length, 1000);
    const docs = targets.slice(0, cap).map((to) => ({
      to_openid: to, type: 'broadcast', title: t, body: b,
      action_key: '', action_payload: {}, read: false,
      created_at: now, updated_at: now, is_deleted: false
    }));
    for (let i = 0; i < docs.length; i += 100) {
      await col('system_notice').add({ data: docs.slice(i, i + 100) });
    }
    await logEvent('P2', 'notice_send', openid, { audience, count: docs.length, total_targets: targets.length, title: t });
    return ok({ sent: docs.length, total_targets: targets.length, cap: 1000 });
  }

  // ───────── 8.7 云端备份导出(L2 admin_config 快照 + L3 DB 分页导出) ─────────
  // 允许导出的 collection 白名单(20+)
  const EXPORT_COLLECTIONS = new Set([
    // ── 实际在用(2026-09-22 按云函数代码核实) ──
    'admin_config', 'admin_web_sessions',
    'user_account', 'partner_profile',
    'demand', 'demand_draft',
    'order_main', 'order_status_log', 'order_confirmations',
    'emergency_contact', 'credit_score_log', 'platform_event', 'audit_log',
    'system_notice', 'disclaimer_signature', 'evaluation',
    'blog_post', 'blog_like', 'blog_comment',
    'safety_report',
    'im_conversation', 'im_message',
    'withdraw_record',
    // ── 认证考试题库(2026-10-03 新增: 题库为运营配置数据, 答案管理员可读, 纳入备份) ──
    'exam_bank',
    // ── 配置变更版本史(2026-10-07 新增: config_set 快照, 敏感键已掩码入库, 纳入备份/可稽核) ──
    'config_history',
    // ── 旧表/低频(保留兼容, 不存在返回空) ──
    'user_profile', 'partner_exam', 'partner_apply',
    'dispute', 'withdraw_request', 'credit_log',
    'insurance_record', 'report', 'sms_log', 'device_bind'
  ]);
  // 敏感字段脱敏规则: 字段名 → 脱敏函数
  // 2026-09-23 备份查证补全: idcard(历史明文证件号)/sms_target(原样手机号)/sms_code(验证码)/
  //   *_aes_key/*_web_key(密钥, 此前 export_collection 会原样导出) 均在 L3 导出中泄露过
  // 敏感字段脱敏规则与递归脱敏已提升到模块顶层(SENSITIVE_MASK / maskDocDeep), 避免函数内声明 TDZ 崩溃
  // L2: admin_config 完整快照(不走 export_collection, 因为只有一个 _id=global 文档且字段特殊)
  if (action === 'export_admin_config') {
    // 二次确认(敏感导出, PRD §17.2 敏感接口二次鉴权)
    if (event.confirm !== true) return fail('export_need_confirm', '敏感导出需 confirm:true 二次确认');
    const cfgR = await col('admin_config').doc('global').get();
    const cfg = (cfgR.data) || {};
    const safe = maskDocDeep(cfg);
    // 密钥类字段只返回存在性布尔, 不返回值
    if (safe.idcard_aes_key !== undefined) safe.idcard_aes_key_set = !!safe.idcard_aes_key;
    delete safe.idcard_aes_key;
    if (safe.admin_web_key !== undefined) safe.admin_web_key_set = !!safe.admin_web_key;
    delete safe.admin_web_key;
    await logEvent('P2', 'export_admin_config', openid, { size: JSON.stringify(safe).length });
    return ok({ config: safe, exported_at: now });
  }

  // L3: 按 collection 分页导出
  if (action === 'export_collection') {
    // 二次确认(敏感导出, PRD §17.2 敏感接口二次鉴权)
    if (event.confirm !== true) return fail('export_need_confirm', '敏感导出需 confirm:true 二次确认');
    const collection = String(event.collection || '').trim();
    if (!EXPORT_COLLECTIONS.has(collection)) {
      return fail('export_bad_collection', `不在导出白名单: ${collection}`);
    }
    const page = Math.max(1, parseInt(event.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(event.page_size, 10) || 100));
    const skip = (page - 1) * pageSize;
    const limit = Math.min(10000, skip + pageSize);
    const totalR = await col(collection).count().catch(() => ({ total: 0 }));
    const total = totalR.total || 0;
    const docs = await col(collection).skip(skip).limit(pageSize).get().catch(() => ({ data: [] }));
    const list = (docs.data || []).map(maskDocDeep);
    await logEvent('P2', 'export_collection', openid, { collection, page, pageSize, count: list.length });
    return ok({
      collection,
      page,
      page_size: pageSize,
      total,
      has_more: (page * pageSize) < total && (page * pageSize) < 10000,
      truncated: total > 10000,
      list
    });
  }

  // ───────── 9. 封禁/解封 ─────────
  if (action === 'user_ban' || action === 'user_unban') {
    const { target_openid, reason } = event;
    if (!isOpenid(target_openid)) return fail('ban_bad_openid', 'openid 格式不正确');
    const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
    if (!ur.data || !ur.data[0]) return fail('ban_user_not_found', '用户不存在');
    const ban = action === 'user_ban';
    if (ban && (!reason || !String(reason).trim())) return fail('ban_no_reason', '请填写封禁原因');
    const patch = { status: ban ? 'banned' : 'normal', updated_at: now };
    if (ban) {
      patch.banned_reason = String(reason).trim();
      patch.banned_at = now; patch.banned_by = openid;
    } else {
      patch.unbanned_at = now; patch.unbanned_by = openid;
    }
    await col('user_account').doc(ur.data[0]._id).update({ data: patch });
    if (ban) {
      await col('partner_profile').where({ openid: target_openid }).update({
        data: { accept_switch: false, updated_at: now }
      }).catch(() => {});
    }
    await logEvent('P2', ban ? 'user_banned' : 'user_unbanned', openid, {
      target_openid, reason: reason || '', before: ur.data[0].status, after: patch.status
    });
    return ok({ openid: target_openid, status: patch.status });
  }

  // ───────── V3 分级处罚: warning(警告) / suspend_7d(暂停7天) / ban(永久封号) ─────────
  if (action === 'penalty') {
    const { target_openid, level, reason } = event;
    if (!isOpenid(target_openid)) return fail('pen_bad_openid', 'openid 格式不正确');
    if (!['warning', 'suspend_7d', 'ban'].includes(level)) {
      return fail('pen_bad_level', 'level 须为 warning/suspend_7d/ban');
    }
    if (!reason || !String(reason).trim()) return fail('pen_no_reason', '请填写处罚原因');
    const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
    if (!ur.data || !ur.data[0]) return fail('pen_user_not_found', '用户不存在');

    const now = Date.now();
    let patch = { updated_at: now };
    if (level === 'warning') {
      patch.status = 'normal';
      patch.last_warning = { reason: String(reason).trim(), at: now, by: openid };
    } else if (level === 'suspend_7d') {
      patch.status = 'suspended';
      patch.suspend_until = now + 7 * 24 * 3600 * 1000;
      patch.suspend_reason = String(reason).trim();
      patch.suspend_at = now; patch.suspend_by = openid;
    } else {
      patch.status = 'banned';
      patch.banned_reason = String(reason).trim();
      patch.banned_at = now; patch.banned_by = openid;
    }
    await col('user_account').doc(ur.data[0]._id).update({ data: patch });
    // 暂停/封号时关闭耍伴接单开关
    if (level !== 'warning') {
      await col('partner_profile').where({ openid: target_openid }).update({
        data: { accept_switch: false, updated_at: now }
      }).catch(() => {});
    }
    await logEvent('P1', `penalty_${level}`, openid, {
      target_openid, reason: reason, level
    });
    return ok({ openid: target_openid, level, status: patch.status });
  }

  // ───────── 10. 管理员权限 ─────────
  if (action === 'admin_list') {
    return ok({ admins: adminOpenids, count: adminOpenids.length });
  }

  if (action === 'admin_add') {
    const { target_openid } = event;
    if (!isOpenid(target_openid)) return fail('admin_bad_openid', 'openid 格式不正确');
    if (adminOpenids.indexOf(target_openid) >= 0) return fail('admin_exists', '该 openid 已是管理员');
    const next = adminOpenids.concat([target_openid]);
    await col('admin_config').where({ _id: 'global' }).update({
      data: { admin_openids: next, updated_at: now }
    });
    await logEvent('P2', 'admin_add', openid, { target_openid });
    return ok({ admins: next });
  }

  if (action === 'admin_remove') {
    const { target_openid } = event;
    if (!isOpenid(target_openid)) return fail('admin_bad_openid', 'openid 格式不正确');
    if (target_openid === openid) return fail('admin_cannot_remove_self', '不能移除当前登录的管理员自己');
    if (adminOpenids.length <= 1) return fail('admin_last_one', '至少保留 1 名管理员');
    const next = adminOpenids.filter((x) => x !== target_openid);
    if (next.length === adminOpenids.length) return fail('admin_not_found', '该 openid 不在管理员名单');
    await col('admin_config').where({ _id: 'global' }).update({
      data: { admin_openids: next, updated_at: now }
    });
    await logEvent('P2', 'admin_remove', openid, { target_openid });
    return ok({ admins: next });
  }

  // ─────────────── 服务动态(blog)管理 ───────────────
  if (action === 'blog_list') {
    const status = ['normal', 'offline', 'deleted'].indexOf(event.status) >= 0 ? event.status : '';
    const { page, size, skip } = pager(event);
    const where = status ? { status } : {};
    const countAll = await col('blog_post').where(where).count();
    const r = await col('blog_post').where(where).orderBy('created_at', 'desc')
      .skip(skip).limit(size + 1).get();
    const rows = r.data || [];
    const has_more = rows.length > size;
    const list = (has_more ? rows.slice(0, size) : rows).map((p) => ({
      _id: p._id, author_openid: p.author_openid,
      author_nickname: p.author_nickname || '微信用户',
      scene: p.scene || '', content: p.content, image_count: (p.images || []).length,
      like_count: p.like_count || 0, comment_count: p.comment_count || 0,
      view_count: p.view_count || 0, status: p.status || 'normal', created_at: p.created_at
    }));
    return ok({ list, has_more, page, total: countAll.total });
  }

  if (action === 'blog_offline') {
    const { post_id, note } = event;
    if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
    if (!note || !String(note).trim()) return fail('blog_note_required', '请填写下架原因');
    const doc = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
    if (!doc) return fail('blog_gone', '动态不存在');
    if (doc.status === 'offline') return fail('blog_already_offline', '该动态已下架');
    await col('blog_post').doc(post_id).update({ data: { status: 'offline', offline_by: openid, offline_note: String(note).trim(), updated_at: now } });
    await logEvent('P2', 'blog_offline', openid, { post_id, author_openid: doc.author_openid, note: String(note).trim() });
    return ok({ msg: '已下架' });
  }

  if (action === 'blog_restore') {
    const { post_id } = event;
    if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
    const doc = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
    if (!doc) return fail('blog_gone', '动态不存在');
    if (doc.status !== 'offline') return fail('blog_not_offline', '仅已下架动态可恢复');
    await col('blog_post').doc(post_id).update({ data: { status: 'normal', updated_at: now } });
    await logEvent('P2', 'blog_restore', openid, { post_id });
    return ok({ msg: '已恢复' });
  }

  if (action === 'blog_delete') {
    const { post_id, note } = event;
    if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
    if (!note || !String(note).trim()) return fail('blog_note_required', '请填写删除原因');
    const doc = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
    if (!doc || doc.is_deleted) return fail('blog_gone', '动态不存在');
    await col('blog_post').doc(post_id).update({ data: { status: 'deleted', is_deleted: true, delete_by: openid, delete_note: String(note).trim(), updated_at: now } });
    await logEvent('P2', 'blog_delete', openid, { post_id, author_openid: doc.author_openid, note: String(note).trim() });
    return ok({ msg: '已删除' });
  }

  if (action === 'blog_comment_list') {
    const { post_id } = event;
    if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
    const { page, size, skip } = pager(event);
    const r = await col('blog_comment').where({ post_id }).orderBy('created_at', 'desc')
      .skip(skip).limit(size + 1).get();
    const rows = r.data || [];
    const has_more = rows.length > size;
    const list = (has_more ? rows.slice(0, size) : rows).map((c) => ({
      _id: c._id, author_openid: c.author_openid, author_nickname: c.author_nickname || '微信用户',
      content: c.content, status: c.status || 'normal', created_at: c.created_at
    }));
    return ok({ list, has_more, page });
  }

  if (action === 'blog_comment_delete') {
    const { comment_id, note } = event;
    if (!isDocId(comment_id)) return fail('blog_bad_comment_id', '评论 ID 格式不正确');
    if (!note || !String(note).trim()) return fail('blog_note_required', '请填写删除原因');
    const cdoc = await col('blog_comment').doc(comment_id).get().then((r) => r.data).catch(() => null);
    if (!cdoc || cdoc.is_deleted) return fail('blog_comment_gone', '评论不存在');
    await col('blog_comment').doc(comment_id).update({ data: { status: 'deleted', is_deleted: true, delete_by: openid, updated_at: now } });
    if (cdoc.status !== 'deleted') {
      await col('blog_post').doc(cdoc.post_id).update({ data: { comment_count: db.command.inc(-1) } }).catch(() => {});
    }
    await logEvent('P2', 'blog_comment_delete', openid, { comment_id, post_id: cdoc.post_id, note: String(note).trim() });
    return ok({ msg: '评论已删除' });
  }

  return fail('admin_unknown_action', '未知动作');
};
