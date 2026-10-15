// @VERIFIED 2026-10-13 已真机验证：admin-action 181例等价零差异/83 action 分发/鉴权门+图片1:1强制校验(up_not_square)+JPEG填充字节跳过（依据：project_memory L69, L104, L111, L95, L107）
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
// 第三批 3B: 爽约申诉/举证/裁定纯规则(规范源 _shared/no_show_rules.js, 修改后跑 sync-no-show-rules.ps1)
const { noShowCfg, verdictOutcome, VERDICTS, REPORT_STATUS, DAY_MS } = require('./no_show_rules');

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
  'dispute_list': ['R2', 'R3'], 'dispute_detail': ['R2', 'R3'], 'dispute_handle': ['R2'],
  // 第三批 3B: 爽约申诉列表/裁定(裁定人 R2/R3, 设计稿 §2.2)
  'no_show_report_list': ['R2', 'R3'], 'no_show_decide': ['R2', 'R3'],
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
// config_set 区间校验 + config_get 输出 schema + admin-web Operations.vue 动态渲染,
// 新增参数只需在此加一行, 三端自动生效。字段:
//   f=admin_config 键名  t=int|bool  g=卡片分组  label=中文标签
//   unit=单位(渲染)  min/max=区间  def=默认值  d=设置说明(运营配置页表单内嵌展示, 供运维查阅)
//   clock=true 表示该值是「自 0:00 起算的分钟数」, 页面额外换算显示 HH:MM(clockZero=值为 0 时的展示文案)
const CONFIG_SCHEMA = [
  // ── 距离与限额 ──
  { f: 'publish_distance_max_km', t: 'int', g: '距离与限额', label: '发布距离上限', unit: 'km', min: 1, max: 500, def: 50, d: '发布需求时可选距离范围的上限；需求只推送给该范围内的耍伴' },
  { f: 'take_distance_max_km', t: 'int', g: '距离与限额', label: '接单距离上限', unit: 'km', min: 1, max: 500, def: 50, d: '平台接单距离上限；展示过滤与接单校验取「耍伴自配距离」与该值的较小值' },
  { f: 'youth_limit_fen', t: 'int', g: '距离与限额', label: '青年最低预算', unit: '分', min: 1000, max: 100000, def: 20000, d: '青少年保护：双方任一为 18-22 岁时，订单总价不得超过该值' },
  { f: 'partner_daily_take_limit', t: 'int', g: '距离与限额', label: '耍伴每日接单上限', unit: '单', min: 1, max: 50, def: 5, d: '耍伴每日最多接单数；超限会被服务端拦截' },
  // ── 订单超时 ──
  { f: 's0_timeout_min', t: 'int', g: '订单超时', label: 'S0 待支付', unit: '分钟', min: 1, max: 1440, def: 30, d: 'S0 待支付超时：下单后未支付超过该时长自动关单' },
  { f: 's1_timeout_min', t: 'int', g: '订单超时', label: 'S1 待确认', unit: '分钟', min: 1, max: 1440, def: 15, d: 'S1 待确认超时：接单后超过该时长未完成四确认自动关单（S6）' },
  { f: 'interrupt_timeout_h', t: 'int', g: '订单超时', label: '中断超时', unit: '小时', min: 1, max: 168, def: 24, d: 'S3.5 履约中断超时：中断超过该时长自动转 S4 裁定' },
  // Wave2 止血: S8 售后窗口届满归档 / S4 裁定期兜底（此前仅前端 CONFIG 有值，服务端无对应键）
  { f: 'after_sale_days', t: 'int', g: '订单超时', label: '售后窗口', unit: '天', min: 1, max: 365, def: 15, d: 'S8 售后窗口：订单完成后超过该天数未发起售后自动归档' },
  { f: 'partial_judge_days', t: 'int', g: '订单超时', label: 'S4 裁定期', unit: '天', min: 1, max: 90, def: 7, d: 'S4 裁定期兜底：进入裁定状态超过该天数自动流转' },
  // Wave2 止血⑥: S2 履约催办三段式阈值（自动链路 order-timer + 手动催办上限）
  { f: 'remind_after_h', t: 'int', g: '订单超时', label: '催办-用户通知', unit: '小时', min: 0, max: 168, def: 1, d: 'S2 履约催办第一段：约定开始后该小时数自动提醒耍伴并通知用户' },
  { f: 'escalate_after_h', t: 'int', g: '订单超时', label: '催办-引导申诉', unit: '小时', min: 1, max: 336, def: 4, d: '催办第二段：再过该小时数升级为引导用户申诉' },
  { f: 'urge_max_count', t: 'int', g: '订单超时', label: '催办-手动上限', unit: '次', min: 1, max: 10, def: 2, d: '用户手动催办（加急提醒耍伴）每单次数上限' },
  { f: 'eval_window_h', t: 'int', g: '订单超时', label: '评价窗口', unit: '小时', min: 1, max: 720, def: 48, d: '评价窗口：订单完成后该小时数内可评价，超时按默认星级计' },
  { f: 'milestone_confirm_min', t: 'int', g: '订单超时', label: '里程碑确认', unit: '分钟', min: 1, max: 1440, def: 15, d: '里程碑验收等待对方确认的时限' },
  // 加时确认窗口(2026-10-12 立键; 2026-10-13 改分钟制, 默认 20 分钟): 加时申请对方未及时回复 → 超时自动拒绝的时长; 0=跟随「改期确认窗口」
  { f: 'extend_confirm_min', t: 'int', g: '订单超时', label: '加时确认窗口(0=跟随改期)', unit: '分钟', min: 0, max: 10080, def: 20, d: '加时申请等待对方回复的时限（分钟），超时自动拒绝；缺省 20 分钟，0=跟随改期确认窗口' },
  // 履约双确认阶段 G(2026-10-15): S2.6/S3.6 等待响应超时 → 自动转 S10.5 争议; 读取侧 order-timer 早已动态读取, 此处注册后运营页可改
  { f: 'start_apply_timeout_min', t: 'int', g: '订单超时', label: 'S2.6开始履约申请超时', unit: '分钟', min: 1, max: 1440, def: 15, d: '耍伴发起履约申请(S2.6)后需求方超过该时长未确认/拒绝 → 自动转争议处理 S10.5；缺省 15 分钟（真机造数可临时设 1 分钟，验毕改回）' },
  { f: 'finish_confirm_timeout_min', t: 'int', g: '订单超时', label: 'S3.6完毕确认超时', unit: '分钟', min: 1, max: 1440, def: 30, d: '耍伴发起履约完毕确认(S3.6)后需求方超过该时长未确认/不确认 → 自动转争议处理 S10.5；缺省 30 分钟（真机造数可临时设 1 分钟，验毕改回）' },
  { f: 'default_star', t: 'int', g: '订单超时', label: '默认星级', unit: '星', min: 1, max: 5, def: 4, d: '评价超时未评时系统给出的默认星级' },
  // ── 时间红线 ──
  { f: 'time_redline_close_min', t: 'int', g: '时间红线', label: '接单截止', unit: '分钟', min: 0, max: 1440, def: 1440, d: '每日接单截止时刻（自 0:00 起算的分钟数）；0=全天开放不受限', clock: true, clockZero: '全天开放' },
  { f: 'time_redline_open_min', t: 'int', g: '时间红线', label: '接单开放', unit: '分钟', min: 0, max: 1440, def: 360, d: '每日接单开放起始时刻（自 0:00 起算的分钟数）；可接单时段为「开放时刻 ~ 截止时刻」', clock: true },
  // ── 信用阈值 ──
  { f: 'min_credit_take_order', t: 'int', g: '信用阈值', label: '最低接单刷分', unit: '分', min: 0, max: 1000, def: 600, d: '信用分低于该值不可接单（耍伴申请与接单校验）' },
  { f: 'min_credit_place_order', t: 'int', g: '信用阈值', label: '最低发单刷分', unit: '分', min: 0, max: 1000, def: 600, d: '信用分低于该值不可发布需求' },
  { f: 'credit_freeze_line', t: 'int', g: '信用阈值', label: '冻结线', unit: '分', min: 0, max: 1000, def: 400, d: '信用冻结线：低于该分触发冻结（限制交易）' },
  // ── 费率 ──
  { f: 'rate_min_fen', t: 'int', g: '费率', label: '最低时薪', unit: '分', min: 0, max: 100000, def: 3000, d: '平台最低时薪（时薪滑杆下限）' },
  { f: 'rate_max_fen', t: 'int', g: '费率', label: '最高时薪', unit: '分', min: 0, max: 100000, def: 10000, d: '平台最高时薪（时薪滑杆上限）' },
  // 一口价区间(无 def=留空不钳制; 显式判空, 禁 || 兜底; 0 是合法下限)
  { f: 'fixed_price_min_fen', t: 'int', g: '费率', label: '一口价下限(留空不钳制)', unit: '分', min: 0, max: 10000000, d: '一口价单金额下限；留空=不钳制' },
  { f: 'fixed_price_max_fen', t: 'int', g: '费率', label: '一口价上限(留空不钳制)', unit: '分', min: 0, max: 10000000, d: '一口价单金额上限；留空=不钳制' },
  { f: 'scene_default_rate_fen', t: 'int', g: '费率', label: '场景默认时薪', unit: '分', min: 0, max: 100000, def: 5000, d: '场景未单独配置时薪时的默认时薪' },
  // ── 保险与提现 ──
  { f: 'insurance_coverage_accident_fen', t: 'int', g: '保险与提现', label: '意外险保额', unit: '分', min: 0, max: 1000000000, def: 50000000, d: '意外险保障额度（展示口径，单位分）' },
  { f: 'insurance_coverage_property_fen', t: 'int', g: '保险与提现', label: '财产险保额', unit: '分', min: 0, max: 1000000000, def: 5000000, d: '财产险保障额度（展示口径，单位分）' },
  { f: 'fast_withdraw_per_order_max_fen', t: 'int', g: '保险与提现', label: '极速提现单笔上限', unit: '分', min: 0, max: 1000000, def: 20000, d: '极速提现单笔金额上限' },
  { f: 'fast_withdraw_per_day_max_fen', t: 'int', g: '保险与提现', label: '极速提现日上限', unit: '分', min: 0, max: 10000000, def: 200000, d: '极速提现单日累计上限' },
  // ── AA 记账防滥用(线下台账仅记账不代收, 上限防刷) ──
  { f: 'aa_record_max_fen', t: 'int', g: 'AA记账', label: 'AA单笔记账上限', unit: '分', min: 100, max: 10000000, def: 100000, d: 'AA 单笔记账金额上限（仅记账不代收）' },
  { f: 'aa_ledger_max_fen', t: 'int', g: 'AA记账', label: 'AA单订单累计上限', unit: '分', min: 100, max: 100000000, def: 300000, d: '同一订单 AA 累计记账金额上限' },
  { f: 'aa_ledger_max_records', t: 'int', g: 'AA记账', label: 'AA单订单条数上限', unit: '条', min: 1, max: 1000, def: 50, d: '同一订单 AA 最多记账条数' },
  // ── 通用开关 ──
  { f: 'auto_approve_partner', t: 'bool', g: '通用开关', label: '自动通过耍伴申请', def: false, d: '开启后耍伴申请自动过审（跳过人工审核）' },
  { f: 'payment_visible', t: 'bool', g: '通用开关', label: '显示支付入口', def: true, d: '关闭后 C 端隐藏支付入口' },
  { f: 'platform_fee_rate_fen', t: 'int', g: '通用开关', label: '平台抽成', unit: '万分比', min: 0, max: 10000, def: 1000, d: '平台抽成比例（万分比，1000=10%）' },
  // 模拟支付开关(测试期): 仅影响资金 mock 入口(mock_pay/refund/ins/withdraw/fast_withdraw), prod 开放供真机/提审演示闭环;
  // 打赏(mock_tip)恒随 env 关闭(硬约束), 正式上线前必须置回 false(fail-closed 默认关)
  { f: 'mock_payment_enabled', t: 'bool', g: '通用开关', label: '模拟支付开关(测试期)', def: false, d: '模拟支付开关（mock 支付/退款/提现）；正式上线前必须置回 false' },
  // audit_log 留存清理(2026-10-07 P2 采纳): dry-run 只统计不删; 置 false 后每日 UTC 19 点真删 90 天前 audit_log(order-timer auditPrune)
  { f: 'audit_prune_dry_run', t: 'bool', g: '通用开关', label: '审计日志清理(仅统计不删除)', def: true, d: '开启=每日清理仅统计不删除；关闭后真删 90 天前 audit_log' },
  // ── 平台总开关(关停=维护态, 各云函数服务端拦截 + C 端维护提示) ──
  { f: 'switch_access', t: 'bool', g: '平台总开关', label: '核心交易(下单/接单)', def: true, d: '核心交易（下单/接单）；关闭=维护态，服务端拦截并提示' },
  { f: 'switch_blog', t: 'bool', g: '平台总开关', label: '动态社区', def: true, d: '动态社区；关闭=维护态' },
  { f: 'switch_im', t: 'bool', g: '平台总开关', label: '私信沟通', def: true, d: '私信沟通；关闭=维护态' },
  // ── 私信频控(滑动窗口; im-send 服务端计数拦截) ──
  { f: 'im_rate_window_min', t: 'int', g: '私信频控', label: '频控统计窗口', unit: '分钟', min: 1, max: 60, def: 5, d: '频控滑动窗口长度（分钟）' },
  { f: 'im_rate_max_count', t: 'int', g: '私信频控', label: '窗口内最多消息', unit: '条', min: 1, max: 200, def: 30, d: '窗口内最多发送消息数，超限拦截' },
  // ── 实名与签署(测试期 mock; 类目资质审批后切 wx 走微信官方人脸核验) ──
  { f: 'realname_face_mode', t: 'enum', opts: ['mock', 'wx'], g: '实名与签署', label: '人脸核验模式', def: 'mock', d: 'mock=测试期模拟核验；wx=微信官方人脸核验（类目资质审批后切换）' },
  // ── 耍伴资料(数量/字数限制后台可配; 前端校验+后端强约束+后台表单同源) ──
  { f: 'p_skills_max', t: 'int', g: '耍伴资料', label: '技能标签条数上限', unit: '条', min: 1, max: 50, def: 10, d: '技能标签最多条数' },
  { f: 'p_skills_len', t: 'int', g: '耍伴资料', label: '技能标签单条字数', unit: '字', min: 1, max: 50, def: 12, d: '单条技能标签字数上限' },
  { f: 'p_highlights_max', t: 'int', g: '耍伴资料', label: '服务亮点条数上限', unit: '条', min: 1, max: 20, def: 3, d: '服务亮点最多条数' },
  { f: 'p_highlight_len', t: 'int', g: '耍伴资料', label: '服务亮点单条字数', unit: '字', min: 1, max: 100, def: 30, d: '单条服务亮点字数上限' },
  { f: 'p_media_title_max', t: 'int', g: '耍伴资料', label: '资质/荣誉标题条数上限', unit: '条', min: 1, max: 50, def: 20, d: '资质/荣誉标题最多条数' },
  { f: 'p_media_len', t: 'int', g: '耍伴资料', label: '资质/荣誉单条标题字数', unit: '字', min: 1, max: 50, def: 20, d: '单条资质/荣誉标题字数上限' },
  { f: 'p_media_photo_max', t: 'int', g: '耍伴资料', label: '资质/荣誉照片张数上限', unit: '张', min: 1, max: 20, def: 6, d: '资质/荣誉照片最多张数' },
  { f: 'p_media_photo_size_mb', t: 'int', g: '耍伴资料', label: '资质/荣誉单张照片大小上限', unit: 'MB', min: 1, max: 20, def: 3, d: '单张照片大小上限（MB）' },
  // ── 消息(会话列表分页大小; 前端 pageSize 与 im-conv 默认一致) ──
  { f: 'msg_page_size', t: 'int', g: '消息', label: '消息会话每页加载数', unit: '条', min: 5, max: 50, def: 15, d: '消息会话列表每页加载条数' },
  // ── 发布与展示(P0-P2 数量/分页/字数后台化; 前端 CONFIG 兜底同源, 服务端强约束在上) ──
  { f: 'publish_content_options_max', t: 'int', g: '发布与展示', label: '服务内容最多项数', unit: '项', min: 1, max: 10, def: 3, d: '发布时最多可勾选的服务内容项数' },
  { f: 'workbench_income_show', t: 'int', g: '发布与展示', label: '工作台流水展示条数', unit: '条', min: 1, max: 20, def: 5, d: '工作台首页流水展示条数' },
  { f: 'order_page_size', t: 'int', g: '发布与展示', label: '订单列表每页条数', unit: '条', min: 5, max: 50, def: 20, d: '订单列表每页条数' },
  { f: 'page_index_nearby', t: 'int', g: '发布与展示', label: '首页附近单页条数', unit: '条', min: 1, max: 50, def: 10, d: '首页「附近」区块单页条数' },
  { f: 'page_index_square', t: 'int', g: '发布与展示', label: '首页广场单页条数', unit: '条', min: 1, max: 50, def: 20, d: '首页「广场」区块单页条数' },
  { f: 'page_square_limit', t: 'int', g: '发布与展示', label: '广场列表单页条数', unit: '条', min: 1, max: 100, def: 50, d: '广场列表页单页条数' },
  { f: 'page_nearby_limit', t: 'int', g: '发布与展示', label: '附近列表分页条数', unit: '条', min: 1, max: 50, def: 20, d: '附近列表页分页条数' },
  { f: 'page_wallet_withdraw', t: 'int', g: '发布与展示', label: '钱包提现单页条数', unit: '条', min: 1, max: 50, def: 20, d: '钱包提现记录单页条数' },
  { f: 'page_notice_limit', t: 'int', g: '发布与展示', label: '通知单页条数', unit: '条', min: 1, max: 100, def: 50, d: '通知列表单页条数' },
  { f: 'share_title_max', t: 'int', g: '发布与展示', label: '分享标题字数上限', unit: '字', min: 5, max: 60, def: 30, d: '微信分享标题字数上限' },
  { f: 'order_reason_max_len', t: 'int', g: '发布与展示', label: '改期/加时原因字数上限', unit: '字', min: 20, max: 500, def: 200, d: '改期/加时原因字数上限' },
  // 场景卡「服务项」展示上限(批3.2): 前端场景卡/发布页/后台预览最多展示几项; 展示层截断, 与勾选上限 content_options_max 不同
  { f: 'scene_option_display_max', t: 'int', g: '发布与展示', label: '场景卡服务项展示数', unit: '项', min: 1, max: 8, def: 3, d: '场景卡/发布页最多展示前几项服务项（展示层截断）' },
  // ── 费率(公益单时薪后台可调) ──
  { f: 'welfare_hourly_rate_fen', t: 'int', g: '费率', label: '公益单时薪', unit: '分', min: 0, max: 100000, def: 3000, d: '公益单时薪' },
  // 公益一口价(无 def=留空; 未配置时公益单不可发布, fail-closed)
  { f: 'welfare_fixed_price_fen', t: 'int', g: '费率', label: '公益一口价(留空=公益不可发布)', unit: '分', min: 0, max: 1000000, d: '公益一口价；留空=公益单不可发布' },
  // ── 信用阈值(好评星级阈值; 决定评价自动勾选口碑标签的分界) ──
  { f: 'order_good_review_min_stars', t: 'int', g: '信用阈值', label: '好评星级阈值', unit: '星', min: 1, max: 5, def: 4, d: '评价达到该星级视为好评（自动勾选口碑标签的分界）' },
  // ── 耍伴资料(个人简介字数上限) ──
  { f: 'p_bio_len', t: 'int', g: '耍伴资料', label: '个人简介字数上限', unit: '字', min: 20, max: 500, def: 200, d: '个人简介字数上限' },
  // ── 爽约申诉与处罚(第三批 3B, N10: 全部数值后台可配; 服务端读实配值, 前端仅兜底) ──
  { f: 'no_show_report_window_h', t: 'int', g: '爽约处罚', label: '申诉时限(约定开始后)', unit: '小时', min: 1, max: 168, def: 48, d: '约定开始后多久内可提交爽约申诉' },
  { f: 'no_show_defense_window_h', t: 'int', g: '爽约处罚', label: '举证窗口(被诉方)', unit: '小时', min: 1, max: 168, def: 48, d: '被诉方收到申诉后的举证时限' },
  { f: 'no_show_score_deduct', t: 'int', g: '爽约处罚', label: '裁定成立扣分(0=仅计次)', unit: '分', min: 0, max: 100, def: 20, d: '裁定成立扣除信用分；0=仅计次不扣分' },
  { f: 'no_show_suspend_threshold', t: 'int', g: '爽约处罚', label: '累计几次停用', unit: '次', min: 1, max: 10, def: 3, d: '滚动窗口内爽约成立累计达该次数即停用' },
  { f: 'no_show_suspend_days', t: 'int', g: '爽约处罚', label: '停用天数', unit: '天', min: 1, max: 90, def: 7, d: '每次停用天数（到期自动恢复）' },
  { f: 'no_show_count_window_days', t: 'int', g: '爽约处罚', label: '次数统计滚动窗口', unit: '天', min: 7, max: 365, def: 180, d: '停用判定的滚动统计窗口（天）' },
  { f: 'no_show_evidence_max', t: 'int', g: '爽约处罚', label: '双方举证照片上限', unit: '张', min: 1, max: 9, def: 3, d: '申诉/举证照片张数上限' },
  { f: 'no_show_reason_min_len', t: 'int', g: '爽约处罚', label: '申诉理由最短字数', unit: '字', min: 5, max: 200, def: 10, d: '申诉理由最短字数' },
  { f: 'no_show_max_per_order', t: 'int', g: '爽约处罚', label: '同订单单方申诉上限', unit: '条', min: 1, max: 3, def: 1, d: '同一订单单方最多申诉次数' },
  // ── 评价激励(D, 2026-10-14): 评价完成后按配置给「用户」「耍伴」双方分别发放 现金(mock)+信用分; 缺省 0=不发(fail-closed) ──
  { f: 'eval_reward_user_fen', t: 'int', g: '评价激励', label: '用户评价激励(现金)', unit: '分', min: 0, max: 100000, def: 0, d: '用户完成评价后按其配置发放的现金激励（mock，禁真实打款）；0=不发' },
  { f: 'eval_reward_user_credit', t: 'int', g: '评价激励', label: '用户评价激励(信用分)', unit: '分', min: 0, max: 100, def: 0, d: '用户完成评价后增加的信用分；0=不加' },
  { f: 'eval_reward_partner_fen', t: 'int', g: '评价激励', label: '耍伴评价激励(现金)', unit: '分', min: 0, max: 100000, def: 0, d: '评价完成后按耍伴配置发放的现金激励（mock）；0=不发' },
  { f: 'eval_reward_partner_credit', t: 'int', g: '评价激励', label: '耍伴评价激励(信用分)', unit: '分', min: 0, max: 100, def: 0, d: '评价完成后给耍伴增加的信用分；0=不加' }
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
// 支付/退款流水号生成(与 payment-mock genPayNo 同构: prefix + YYYYMMDD + 16hex 随机, 防并发碰撞)
function genPayNo(prefix) {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const r = crypto.randomBytes(8).toString('hex');
  return `${prefix}${ymd}${r}`;
}
// 订单状态中文名(云函数侧无 enums 模块, 与 miniprogram/config/enums.js 对齐)
// Wave1 标签对齐(2026-10-10, Q2=A 以前端 enums.js ORDER_STATUS 为准), 修正 5 处错位:
//   S2 履约中→已支付待履约 / S3 已确认→履约中 / S3.5 履约完成→履约中断 / S8 已结算→已评价 / S9 已评价→评价超时
const STATUS_LABEL = {
  S0: '待支付', S1: '待确认', S2: '已支付待履约', S3: '履约中', 'S3.5': '履约中断',
  S4: '部分完成', S5: '已完成', S6: '已取消', S7: '已退款', S8: '已评价',
  S9: '评价超时', S10: '已关闭', 'S10.5': '争议处理中'
};
// 支付流水类型中文名
const TX_LABEL = { pay: '支付', refund: '退款', tip: '打赏', tip_refund: '打赏退款', withdraw: '提现', settle: '结算' };
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
  require('./action_dispute_handle'),
  require('./action_audit'),
  require('./action_config_set'),
  require('./action_audit_verify')
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
  const grants = ROLE_GRANTS[action];
  if (operatorRole !== 'R1' && (!grants || grants.indexOf(operatorRole) < 0)) {
    await logEvent('P1', 'role_forbidden', openid, { action, role: operatorRole, account: operatorAccount });
    return { ok: false, code: 'role_forbidden', msg: `无权限执行此操作(需 ${(grants || ['R1']).map((r) => ADMIN_ROLE_LABEL[r]).join('/')} 角色)` };
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
