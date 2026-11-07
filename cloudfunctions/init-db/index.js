// @VERIFIED 2026-10-13 已真机验证：init-db force_set_env 切 dev 同刻写 dev_until(4h 与 force_expire_at 同刻自毁)+openid 规范源 prod 兜底（依据：project_memory L109-110, L126）
// 对应 PRD 章节：16 数据库设计与数据模型 / 附录M 参数总表
// init-db 是部署工具函数,用于一次性初始化数据库集合、索引与运营参数种子配置
// 幂等:重复运行不报错、不覆盖已有数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { resolveAdminBootstrap } = require('./security_policy');

// 19 个业务集合(rules.md 第五节第7条; 2026-09-16 +withdraw_record/+demand_draft; 2026-09-17 +withdraw_lock)
const COLLECTIONS = [
  'user_account', 'partner_profile', 'demand', 'order_main', 'order_confirmations',
  'order_status_log', 'pay_transaction', 'im_conversation', 'im_message', 'safety_report',
  'credit_score_log', 'emergency_contact', 'evaluation', 'settlement', 'platform_event', 'admin_config',
  'disclaimer_signature', 'withdraw_record', 'demand_draft', 'withdraw_lock',
  'system_notice', 'insurance_record', 'audit_log', 'admin_accounts',
  // 第三批 3B: 爽约申诉记录(用户举证 + 管理端裁定, 状态 received/defense/decided)
  'no_show_report',
  // 2026-10-10 补登记: 投诉记录(order-action complaint 写入, 后台纠纷处理详情时间线数据源)
  'complaint',
  // 2026-10-26 学习考试中心 S2(26→31): 题目 SSOT / 考试留痕 / 证书 / 学习进度 / 学习内容
  'questions', 'exam_sessions', 'certificates', 'study_records', 'study_content'
];

// 索引清单(rules.md 第五节第7条索引设计规范)
// unique 唯一索引 / 复合索引按查询模式建
// ⚠️ 2026-10-08 实证: wx-server-sdk **无 createIndex API**(调用报 "createIndex is not a function"),
//    故本清单仅作「索引设计台账」, 实际索引需在云开发控制台「数据库→集合→索引管理」手工创建;
//    bootstrap 会把非"已存在"类错误写入 warnings 供识别(既往该错误被静默吞进 skipped)。
const INDEXES = [
  { coll: 'user_account', name: 'uk_openid', keys: { openid: 1 }, unique: true },
  // P0-3 整改(2026-10-12): 手机号改密文存储后, 登录/注册按确定性 HMAC 键查询 → 需索引
  { coll: 'user_account', name: 'idx_phone_hash', keys: { phone_hash: 1 } },
  { coll: 'partner_profile', name: 'uk_openid', keys: { openid: 1 }, unique: true },
  { coll: 'demand', name: 'idx_creator_status_created', keys: { creator_openid: 1, status: 1, created_at: -1 } },
  { coll: 'demand', name: 'idx_status_created', keys: { status: 1, created_at: -1 } },
  { coll: 'demand', name: 'idx_expire_at', keys: { expire_at: 1 } },
  // 大厅查询: home-action square 用 (等值 is_deleted+status+broadcast) → orderBy created_at → 范围 expire_at
  { coll: 'demand', name: 'idx_hall_broadcast_status_created', keys: { is_deleted: 1, status: 1, broadcast: 1, created_at: -1, expire_at: 1 } },
  // 大厅按场景查询: 多一个 scene 等值条件
  { coll: 'demand', name: 'idx_hall_scene_status_created', keys: { is_deleted: 1, status: 1, broadcast: 1, scene: 1, created_at: -1, expire_at: 1 } },
  // P3-12(2026-10-28): 云端实有但 init-db 未声明 → 补登记(非唯一; order-timer 抢单通知扫描)
  { coll: 'demand', name: 'grab_pending_scan', keys: { grab_notify_pending: 1, status: 1, created_at: -1 } },
  { coll: 'order_main', name: 'uk_order_no', keys: { order_no: 1 }, unique: true },
  { coll: 'order_main', name: 'idx_demand_id', keys: { demand_id: 1 } },
  { coll: 'order_main', name: 'idx_partner_status', keys: { partner_openid: 1, status: 1 } },
  { coll: 'order_main', name: 'idx_user_status', keys: { user_openid: 1, status: 1 } },
  { coll: 'order_main', name: 'idx_created', keys: { created_at: -1 } },
  { coll: 'pay_transaction', name: 'idx_order_id', keys: { order_id: 1 } },
  // 2026-11-01: 流水单号全局唯一(pay/refund/tip/eval_reward 各带前缀, 由 genPayNo 生成) → 防并发双写
  { coll: 'pay_transaction', name: 'uk_pay_no', keys: { pay_no: 1 }, unique: true },
  { coll: 'order_status_log', name: 'idx_order_created', keys: { order_id: 1, created_at: -1 } },
  { coll: 'im_conversation', name: 'uk_order_id', keys: { order_id: 1 }, unique: true },
  // 会话监管: 后台按 order_no 定位会话(2026-10-01 admin-action im_message_admin_list)
  { coll: 'im_conversation', name: 'idx_order_no', keys: { order_no: 1 } },
  // 会话列表: 按用户/耍伴 + 最后消息时间排序(2026-10-27 提审前清零, 已云端实测)
  { coll: 'im_conversation', name: 'idx_user_last_msg', keys: { user_openid: 1, last_msg_at: -1 } },
  { coll: 'im_conversation', name: 'idx_partner_last_msg', keys: { partner_openid: 1, last_msg_at: -1 } },
  // 后台账号体系(RBAC S1): 登录名唯一 + 会话按 token 主键查询
  { coll: 'admin_accounts', name: 'uk_account', keys: { account: 1 }, unique: true },
  { coll: 'im_message', name: 'idx_conv_created', keys: { conv_id: 1, created_at: -1 } },
  { coll: 'evaluation', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'settlement', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'withdraw_record', name: 'idx_openid_created', keys: { openid: 1, created_at: -1 } },
  { coll: 'demand_draft', name: 'idx_openid_updated', keys: { openid: 1, updated_at: -1 } },
  // safety_report 查询: SOS 进行中单(order_id+type+status orderBy created_at) / 报备列表(order_id+type)
  { coll: 'safety_report', name: 'idx_order_type_status_created', keys: { order_id: 1, type: 1, status: 1, created_at: -1 } },
  // checkin 频控: 同订单同人报备最新一条(order_id+reporter_openid+type orderBy created_at)
  { coll: 'safety_report', name: 'idx_order_reporter_type_created', keys: { order_id: 1, reporter_openid: 1, type: 1, created_at: -1 } },
  // system_notice: 消息中心按收件人查, 未读过滤, 点击后标记已读
  { coll: 'system_notice', name: 'idx_to_read_created', keys: { to_openid: 1, read: 1, created_at: -1 } },
  { coll: 'system_notice', name: 'idx_order_created', keys: { order_id: 1, created_at: -1 } },
  { coll: 'system_notice', name: 'idx_to_created', keys: { to_openid: 1, created_at: -1 } },
  // audit_log 行为审计: 单用户链查询(writeAudit 取上一条 orderBy at desc) 与 audit_verify 全量升序
  { coll: 'audit_log', name: 'idx_openid_at', keys: { openid: 1, at: -1 } },
  // P3-12(2026-10-28): order-timer 扫描支撑索引
  // auditPrune 按 at<cutoff 范围查询、errorScan 按 result=fail + at>window 计数 → 范围字段 at 在前
  { coll: 'audit_log', name: 'idx_at_result', keys: { at: 1, result: 1 } },
  // errorScan: P0/P1 事件(level in + created_at>window, orderBy created_at asc)
  { coll: 'platform_event', name: 'idx_level_created', keys: { level: 1, created_at: 1 } },
  // errorScan: 网关鉴权失败突增(type=gateway_bad_key + created_at>window)
  { coll: 'platform_event', name: 'idx_type_created', keys: { type: 1, created_at: 1 } },
  // no_show_report(第三批 3B 爽约申诉): 幂等查重(order_id)/管理端列表(status+created_at)/被诉方历史
  { coll: 'no_show_report', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'no_show_report', name: 'idx_status_created', keys: { status: 1, created_at: -1 } },
  { coll: 'no_show_report', name: 'idx_target_created', keys: { target_openid: 1, created_at: -1 } },
  // credit_score_log 裁定聚合核心索引: 滚动窗口内"第 N 次爽约"(openid+type+created_at)
  { coll: 'credit_score_log', name: 'idx_openid_type_created', keys: { openid: 1, type: 1, created_at: -1 } },
  // 学习考试中心 S2(2026-10-26, 33→40): 题目拉取/题号唯一; 考试留痕按人/科目倒序;
  // 证书按人+科目取最新; 学习进度 upsert 键唯一; 学习内容按科目章节排序
  { coll: 'questions', name: 'idx_subject_status_paper', keys: { subject: 1, status: 1, paper: 1 } },
  { coll: 'questions', name: 'uk_subject_qid', keys: { subject: 1, qid: 1 }, unique: true },
  { coll: 'exam_sessions', name: 'idx_openid_submitted', keys: { openid: 1, submitted_at: -1 } },
  { coll: 'exam_sessions', name: 'idx_subject_submitted', keys: { subject: 1, submitted_at: -1 } },
  { coll: 'certificates', name: 'idx_openid_subject_issued', keys: { openid: 1, subject: 1, issued_at: -1 } },
  { coll: 'study_records', name: 'uk_openid_subject_chapter', keys: { openid: 1, subject: 1, chapter_id: 1 }, unique: true },
  { coll: 'study_content', name: 'idx_subject_module_chapter_sort', keys: { subject: 1, module_id: 1, chapter_id: 1, sort: 1 } },
  // 2026-11-04 P3-12 / P3-15①：云端已建（以 `listIndexes` 原始回执为证，见 tech-debt P3-12/P3-15）
  //   order-timer scanAll 各 status 段等值 seek + _id 游标（复合 _id 键 CloudBase 实测可建）
  { coll: 'order_main', name: 'idx_status_id', keys: { status: 1, _id: 1 } },
  //   法律文档版本库 (doc_type, scope, version) 唯一（防并发发布产生重复版本）
  { coll: 'legal_doc', name: 'uniq_doc_type_scope_version', keys: { doc_type: 1, scope: 1, version: 1 }, unique: true }
];

// 运营参数种子配置(PRD 附录M / 8.5节 可运营参数 · SSOT)
const SEED_CONFIG = {
  _id: 'global',
  // 抽成:冷启动期 10%(可运营参数)
  platform_fee_rate_fen: 1000,
  city_enabled: ['成都'],
  // 超时规则(PRD 8.3 SSOT)
  s0_timeout_min: 30,        // S0 待支付 30 分钟未支付 → S6
  s1_timeout_min: 15,       // S1 待确认 15 分钟未四确认 → S6
  interrupt_timeout_h: 24,   // S3.5 履约中断 24 小时 → 默认转 S4
  eval_window_h: 48,         // S5 完成后 48 小时未评价 → 系统默认 4 星转 S9
  dispute_escalate_d: 30,  // PRD S10.5 争议升级天数 · 2026-10-13 已落地: 超期→幂等标记+P1 dispute_escalate_overdue 平台事件(见 order-timer §4.8; 裁决仍人工)
  // 批2(2026-11-01): 约定开始后多久给双方发"可提交爽约申诉"提醒(分钟); 只提醒不判定, 与 no_show_report_window_h(申诉时限)独立
  no_show_grace_min: 30,
  // aa_tiers 已下线: 前端 AA_OPTIONS 硬编码, 格式不同; 第二批云化 AA_OPTIONS 时再按 admin_config.aa_tiers 接通
  // 信用分(PRD 8.1 SSOT)
  min_credit_take_order: 600,
  min_credit_place_order: 600,
  credit_freeze_line: 400,
  // 青少年保护(PRD 1.7.1):18-22 岁单笔上限 200 元
  youth_limit_fen: 20000,
  // 耍伴时薪区间 30-100 元/小时
  rate_min_fen: 3000,
  rate_max_fen: 10000,
  // 耍伴默认时薪(可运营, accept-config 首次接场景时补默认值用)
  scene_default_rate_fen: 5000,
  // 学习考试证书(2026-10-26 S2): 只补缺失键不覆盖已有值; 开闸走 config_set 显式留痕
  cert_gate_enabled: false,
  w1_cert_valid_days: 365,
  base_cert_permanent: true,
  // 距离校验(公里, 可运营): 发布位置↔履约地 / 耍伴接单位置↔履约地
  publish_distance_max_km: 50,
  take_distance_max_km: 50,
  // 默认评价:超时未评价记 4 星(非 5 星)
  default_star: 4,
  // 场景白名单(一期放开 9 场景 W1/W2/W3/W4/W7/W8/W9/W10/W11; W5探店/W6演出 已终止)
  // · 每个场景含 disclaimer_type(与 demand-publish/order-create 统一) 与 builtin(后台不可删)
  // · 本种子必须与云端 admin_config.scene_list 的 9 个开放场景保持一致 —— 补充前先核对线上 config_get
  scene_list: [
    { code: 'W1',  name: '就医陪诊', options: ['挂号排队', '取药送药', '陪诊解压'], aa_default: true, disclaimer_type: 'medical_disclaimer', builtin: true },
    { code: 'W2',  name: '学习陪伴', options: ['自习陪伴', '口语陪练', '作业督促'], disclaimer_type: 'general_disclaimer', builtin: true },
    { code: 'W8',  name: '生活协助', options: ['排队代办', '搬家帮手', '采买陪同'], disclaimer_type: 'general_disclaimer', builtin: true },
    { code: 'W10', name: '出行陪伴', options: ['逛街同行', '夜跑陪跑', '活动搭子'], disclaimer_type: 'general_disclaimer', builtin: true },
    { code: 'W11', name: '线上陪伴', options: ['树洞倾听', '游戏陪玩', '打卡监督'], disclaimer_type: 'online_disclaimer', builtin: true },
    { code: 'W3',  name: '健身陪伴', options: ['健身指导', '跑步陪跑', '器械陪同'], disclaimer_type: 'sports_disclaimer', builtin: true },
    { code: 'W4',  name: '游玩陪伴', options: ['景区游览', '博物馆参观', '商圈逛街'], disclaimer_type: 'general_disclaimer', builtin: true },
    { code: 'W7',  name: '情绪陪伴', options: ['陪伴散步', '倾听陪伴', '考前鼓励'], disclaimer_type: 'emotion_disclaimer', builtin: true },
    { code: 'W9',  name: '宠物陪伴', options: ['遛狗陪伴', '喂猫照料', '宠物就医陪同'], disclaimer_type: 'pet_disclaimer', builtin: true }
  ],
  // aa_tiers 已下线: 前端 AA_OPTIONS 硬编码格式不同, 第二批云化 AA_OPTIONS 时再按 admin_config.aa_tiers 接通
  // IM 系统模板消息(PRD 3.3.2 四确认前仅允许这些)
  system_templates: [
    { id: 'TM1', text: '时间确认' },
    { id: 'TM2', text: '地点确认' },
    { id: 'TM3', text: '内容确认' },
    { id: 'TM4', text: '费用确认' },
    { id: 'TM5', text: '特殊需求' },
    { id: 'TM6', text: '到达提醒' },
    { id: 'TM7', text: '取消申请' },
    { id: 'TM8', text: '改期申请' }
  ],
  // 首页活动栏: 后台运营配置, init-db 仅存空数组, 由 admin-action home_activity_create 填充
  home_activities: [],
  // 本地兜底词库(msgSecCheck 不可用时使用)
  block_words: ['加微信', '加V', '转账', '私聊我', '威信', 'VX', 'vx', '加我vx', '扣扣', 'QQ号', '支付宝', '口令红包', '站外交易', '线下转账'],
  // 环境开关: dev(测试期,允许 mock_openid 模拟身份) / prod(上线,强制忽略 mock_openid)
  env: 'prod',
  // 上线前必须改为 false(当前是 true 方便 MVP bootstrap)
  auto_approve_partner: false,
  // 管理员 openid 白名单(阶段 5 由产品经理填入自己的 openid)
  admin_openids: [],
  // 四确认前仅允许模板消息(PRD 3.3.2)
  security_only_template_before_confirm: true,
  version: 'V15-MVP',
  // 基础字段(rules.md 第五节第7条)
  created_at: Date.now(),
  updated_at: Date.now(),
  is_deleted: false
};

// 管理身份解析(安全收口):
//  1) admin-web 网关代理链路: 校验共享密钥 _admin_web_proxy_key
//     (评审修复 2026-10-13: openid.js 收敛后, 网关校验在 admin-action 已上移其 index.js 包装层,
//      对应实现为 admin-action/index.js 的 resolveOpenidWithProxy), 不匹配 fail-closed
//  2) 否则用 resolveOpenid 结果(prod 强制真实 wxCtx.OPENID, mock_openid 旁路全关)
//  绝不直接读 event.mock_openid —— 历史漏洞: prod 下任意客户端可伪造管理员身份
async function resolveAdminIdentity(db, event, openid) {
  if (event && event.__admin_web_proxy && event._admin_web_proxy_key !== undefined) {
    try {
      const r = await db.collection('admin_config').doc('global').get();
      const stored = (r.data && r.data.admin_web_key) || '';
      if (stored && event._admin_web_proxy_key && event._admin_web_proxy_key === stored) {
        return event._admin_web_proxy_openid || null;
      }
    } catch (e) {}
    return null; // 代理密钥为空/不匹配: fail-closed, 不再 fallthrough
  }
  return openid || null;
}

// ───────── T-7.26(2026-11-07): 同级 handler 注册(原内联块逐字搬移, 零行为变更) ─────────
const action_diag = require('./action_diag');
const action_env = require('./action_env');
const action_key = require('./action_key');
const { purge_test_data, run_seed } = require('./action_seed');
// Object.assign 普通对象: 四文件不得导出同名 action 键(重复键会静默覆盖)
const HANDLERS = Object.assign({}, action_diag, action_env, action_key, { purge_test_data });

exports.main = async (event, context) => {
  const { resolveOpenid, warmEnv, invalidateEnvCache } = require('./openid');
  await warmEnv(cloud);

  // ── force_set_env 过期自毁: 每次 init-db 被调用时检查, 超 4h 自动切回 prod ──
  try {
    const _cfg = (await db.collection('admin_config').doc('global').get()).data;
    if (_cfg && _cfg.force_expire_at && _cfg.force_expire_at < Date.now()) {
      await db.collection('admin_config').doc('global').update({
        data: { env: 'prod', force_expire_at: null, force_operator: null, force_reason: null, force_used_at: null, updated_at: Date.now(), updated_by: { action: 'force_expired_auto_revert', at: Date.now() } }
      });
      console.warn('[init-db] force_set_env 已过期, 自动切回 prod');
    }
  } catch (_) {}

  // ── 鉴权: 管理面动作 lookup/quick_check/check_pp/force_migrate_scenes/purge_test_data 需管理员; 默认幂等种子补齐由 L472 独立门控 ──
  const action = event && event.action;
  const openid = await resolveOpenid(cloud, event);
  // 管理身份(代理密钥 或 真实 OPENID), 供各管理面动作统一使用
  const adminIdentity = await resolveAdminIdentity(db, event, openid);
  const ADMIN_ACTIONS = ['lookup', 'quick_check', 'force_migrate_scenes', 'check_pp', 'purge_test_data'];
  if (ADMIN_ACTIONS.indexOf(action) >= 0) {
    let cfg = null;
    try { cfg = (await db.collection('admin_config').doc('global').get()).data; } catch (e) {}
    const adminOpenids = (cfg && cfg.admin_openids) || [];
    const isAdmin = !!adminIdentity && adminOpenids.indexOf(adminIdentity) >= 0;
    // 鸡生蛋兼容: admin_openids 为空时首次部署放行(等 init-db 建好 admin_config 后 admin-action claim_admin 初始化)
    if (adminOpenids.length > 0 && !isAdmin) {
      return { ok: false, code: 'idb_forbidden', msg: '无权限,仅管理员可调用此动作' };
    }
  }

  // ── 运维/环境/密钥/清理 分发(T-7.26 2026-11-07 拆分, 零行为变更, 原内联块逐字搬入同级文件)──
  // 位置: ADMIN_ACTIONS 鉴权门之后、种子鉴权门之前(与拆分前各 action 判定顺序一致)
  // hasOwnProperty 判定: 防 action='constructor'/'toString' 命中原型链被误当 handler 调用
  if (Object.prototype.hasOwnProperty.call(HANDLERS, action)) {
    return await HANDLERS[action]({ event, db, openid, adminIdentity, SEED_CONFIG, COLLECTIONS, INDEXES, resolveAdminIdentity, resolveAdminBootstrap, invalidateEnvCache });
  }

  // ── 种子/初始化分支鉴权(fail-closed): 匿名可触发会暴露建集合/索引/补 config 的管理面, 提审一票否决 ──
  // 仅"首次部署"(admin_config.global 尚不存在)放行, 以保留自建库/索引能力(鸡生蛋);
  // global 已初始化后必须管理员白名单命中, 否则拒绝。admin_openids 为空也拒绝(防暴露)。
  {
    let _seedCfg = null;
    try { _seedCfg = (await db.collection('admin_config').doc('global').get()).data; } catch (e) { _seedCfg = null; }
    if (_seedCfg) {
      const _admins = (_seedCfg.admin_openids) || [];
      const _isAdmin = !!adminIdentity && _admins.indexOf(adminIdentity) >= 0;
      if (!(_admins.length > 0 && _isAdmin)) {
        return { ok: false, code: 'idb_seed_forbidden', msg: '无权限,仅管理员可执行初始化' };
      }
    }
  }
  return await run_seed({ db, SEED_CONFIG, COLLECTIONS, INDEXES });
};
