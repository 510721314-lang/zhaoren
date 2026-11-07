// T-7.12(2026-11-07): 自 index.js 物理拆分(L95-L244 原样搬移, 零行为变更)。
// 参数元数据(单一真相 SSOT): config_set 区间校验 + config_get 输出 schema + admin-web Operations.vue 动态渲染;
// 新增参数只需在此加一行, 三端自动生效。字段含义见下方原注释。
const { MODIFY_DEFAULTS, S2_CHANGE_DEFAULTS } = require('./config_defaults');

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
  // G3 超时前提醒(2026-10-20): S2.6/S3.6 待确认窗口内各提醒 2 次(站内信); 第 2 档应 ≤ 对应超时 - 5min(order-timer 每 5min 一轮); 读取侧 order-timer 早已动态读取, 此处注册后可通过 config_set 下发
  { f: 'start_apply_remind1_min', t: 'int', g: '订单超时', label: 'S2.6开始履约·第1次提醒', unit: '分钟', min: 0, max: 1440, def: 5, d: 'S2.6(开始履约申请)后第 1 次「超时前提醒」时刻(相对申请时刻)；缺省 5 分钟' },
  { f: 'start_apply_remind2_min', t: 'int', g: '订单超时', label: 'S2.6开始履约·第2次提醒', unit: '分钟', min: 0, max: 1440, def: 10, d: 'S2.6 第 2 次超时前提醒时刻；缺省 10 分钟（应 ≤ S2.6开始履约申请超时 - 5）' },
  { f: 'finish_confirm_remind1_min', t: 'int', g: '订单超时', label: 'S3.6完毕确认·第1次提醒', unit: '分钟', min: 0, max: 1440, def: 10, d: 'S3.6(完毕确认)后第 1 次「超时前提醒」时刻(相对申请时刻)；缺省 10 分钟' },
  { f: 'finish_confirm_remind2_min', t: 'int', g: '订单超时', label: 'S3.6完毕确认·第2次提醒', unit: '分钟', min: 0, max: 1440, def: 20, d: 'S3.6 第 2 次超时前提醒时刻；缺省 20 分钟（应 ≤ S3.6完毕确认超时 - 5）' },
  { f: 'default_star', t: 'int', g: '订单超时', label: '默认星级', unit: '星', min: 1, max: 5, def: 4, d: '评价超时未评时系统给出的默认星级' },
  // ── S2 变更规则(2026-11-05): 已支付待履约阶段「地点/内容」协商; 费用与时间不在此通道 ──
  // 读取侧 order-action/action_change_s2.js s2Cfg: 顶层键优先, 兼容旧 modify_config 嵌套
  { f: 's2ChangeEnabled', t: 'int', g: 'S2变更规则', label: '启用(1开/0关)', min: 0, max: 1, def: S2_CHANGE_DEFAULTS.enabled, d: 'S2 地点/内容变更总开关；0=禁止发起（在途申请仍可反馈）' },
  { f: 's2ChangeBMinHours', t: 'int', g: 'S2变更规则', label: 'B 窗下限', unit: '小时', min: 1, max: 24, def: S2_CHANGE_DEFAULTS.bMinHours, d: '距履约时间的下限：小于该小时数禁止发起变更（默认 1 小时）' },
  { f: 's2ChangeAMinHours', t: 'int', g: 'S2变更规则', label: 'A 窗门槛', unit: '小时', min: 1, max: 72, def: S2_CHANGE_DEFAULTS.aMinHours, d: 'A 窗门槛：距履约大于该小时数走 A 窗（默认 2 小时）；B 窗下限~门槛之间为 B 窗' },
  { f: 's2ChangeAConfirmMin', t: 'int', g: 'S2变更规则', label: 'A 窗确认窗口', unit: '分钟', min: 1, max: 1440, def: S2_CHANGE_DEFAULTS.aConfirmMin, d: 'A 窗内对方反馈时限（分钟），且不晚于履约前 15 分钟' },
  { f: 's2ChangeBConfirmMin', t: 'int', g: 'S2变更规则', label: 'B 窗确认窗口', unit: '分钟', min: 1, max: 1440, def: S2_CHANGE_DEFAULTS.bConfirmMin, d: 'B 窗内对方反馈时限（分钟），且不晚于履约前 15 分钟' },
  { f: 's2ChangePerFieldMax', t: 'int', g: 'S2变更规则', label: '每项次数上限', unit: '次', min: 0, max: 5, def: S2_CHANGE_DEFAULTS.perFieldMax, d: '同一订单同一事项最多发起次数；发起即计数（拒绝/超时也消耗）' },
  { f: 's2ChangeTotalMax', t: 'int', g: 'S2变更规则', label: '全单次数上限', unit: '次', min: 0, max: 10, def: S2_CHANGE_DEFAULTS.totalMax, d: '同一订单地点+内容累计发起次数上限' },
  // ── 改期规则(2026-11-05 移入运营页): 此前仅存在于已下线 Config.vue, C 端文案与存储配置脱节 ──
  // 读取侧 order-action/action_modify_extend.js modifyCfg: 顶层键优先, 兼容旧 modify_config 嵌套
  { f: 'modifyMinLeadHours', t: 'int', g: '改期规则', label: '提前申请(小时)', unit: '小时', min: 0, max: 72, def: MODIFY_DEFAULTS.minLeadHours, d: '距新服务时间至少提前多少小时才可申请改期（0=不限制）' },
  { f: 'modifyMaxTimes', t: 'int', g: '改期规则', label: '最多改期次数', unit: '次', min: 0, max: 10, def: MODIFY_DEFAULTS.maxTimes, d: '同一订单最多改期次数（0=禁止改期）' },
  { f: 'modifyMaxSpanH', t: 'int', g: '改期规则', label: '改期幅度上限', unit: '小时', min: 1, max: 720, def: MODIFY_DEFAULTS.maxSpanH, d: '新时间与原服务时间的最大差值（超出拦截）' },
  { f: 'modifyConfirmHours', t: 'int', g: '改期规则', label: '对方确认窗口', unit: '小时', min: 1, max: 168, def: MODIFY_DEFAULTS.confirmHours, d: '改期申请等待对方同意/拒绝的时限，超时自动拒绝' },
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
  // 需求标题/详细描述字数上限: 前后端同口径(demand-publish 读此两键分别强约束, 前端输入层各自卡)
  { f: 'publish_title_max_len', t: 'int', g: '发布与展示', label: '需求标题字数上限', unit: '字', min: 5, max: 60, def: 20, d: '发布需求时标题字数上限' },
  { f: 'publish_desc_max_len', t: 'int', g: '发布与展示', label: '详细描述字数上限', unit: '字', min: 50, max: 1000, def: 200, d: '发布需求时详细描述字数上限' },
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
  // 批2(2026-11-01): 到点未履约提醒(order-timer §4.10) 的延迟分钟; 只提醒不判定
  { f: 'no_show_grace_min', t: 'int', g: '爽约处罚', label: '到点提醒延迟(约定开始后)', unit: '分钟', min: 5, max: 180, def: 30, d: '约定开始多久后给双方发「可提交爽约申诉」提醒' },
  // ── 评价激励(D, 2026-10-14): 评价完成后按配置给「用户」「耍伴」双方分别发放 现金(mock)+信用分; 缺省 0=不发(fail-closed) ──
  { f: 'eval_reward_user_fen', t: 'int', g: '评价激励', label: '用户评价激励(现金)', unit: '分', min: 0, max: 100000, def: 0, d: '用户完成评价后按其配置发放的现金激励（mock，禁真实打款）；0=不发' },
  { f: 'eval_reward_user_credit', t: 'int', g: '评价激励', label: '用户评价激励(信用分)', unit: '分', min: 0, max: 100, def: 0, d: '用户完成评价后增加的信用分；0=不加' },
  { f: 'eval_reward_partner_fen', t: 'int', g: '评价激励', label: '耍伴评价激励(现金)', unit: '分', min: 0, max: 100000, def: 0, d: '评价完成后按耍伴配置发放的现金激励（mock）；0=不发' },
  { f: 'eval_reward_partner_credit', t: 'int', g: '评价激励', label: '耍伴评价激励(信用分)', unit: '分', min: 0, max: 100, def: 0, d: '评价完成后给耍伴增加的信用分；0=不加' },
  // ── 学习考试证书(2026-10-26 S2): 门禁开关默认关, S6 验证后开闸; 配置变更走 config_set 留痕 ──
  { f: 'cert_gate_enabled', t: 'bool', g: '学习考试', label: '证书接单门禁', def: false, d: '开启后入驻/接单按证书校验（默认关闭走旧考试分数口径）' },
  { f: 'w1_cert_valid_days', t: 'int', g: '学习考试', label: '场景证书有效期', unit: '天', min: 1, max: 3650, def: 365, d: '非 base 科目证书有效期（天）' },
  { f: 'base_cert_permanent', t: 'bool', g: '学习考试', label: 'base 证书永久有效', def: true, d: '开启=base 证书不过期；关闭后按场景证书有效期计' }
];

module.exports = { CONFIG_SCHEMA };
