# 《找个人帮忙》小程序 —— PRD 约定 vs 当前实现对照表

> 生成日期：2026-10-01
> 依据文档：`PRD_v15.1.md`（V15.1 正式版，9706 行）
> 盘点范围：C 端小程序 + 云函数 + B 端后台 + 核心业务规则
> 状态图例：
> - **已实现** = 前后端闭环可跑
> - **部分/Mock** = 主流程在用 Mock 通道或规则细节未全覆盖
> - **未实现** = PRD 约定但当前无落地

---

## 修复更新记录（增量维护，最新在上）

| 更新时间 | 修复项 | 关联 PRD | 变更内容 | 状态 |
|---|---|---|---|---|
| 2026-10-01 | 产品埋点与数据指标 | 3.9 | 新增 `miniprogram/utils/report.js`（wx.reportAnalytics 封装，不写自建库）；已埋北极星漏斗 10 事件：app_launch / login_success / realname_done / demand_publish / order_take / order_pay / order_start / order_finish / eval_submit / withdraw；微信后台「事件分析」绑定事件名后可看漏斗 | 已实现 |
| 2026-10-01 | mock 支付上线冻结检查 | 3.5.1 / 12.1 | init-db `quick_check` 新增 `mock_gate` 字段：prod 且 `mock_payment_enabled=true` 时 `status=BLOCK` 并提示「正式上线前必须置回 false」；实测生效（当前 prod 开关仍开 → 持续 BLOCK 提示直至关闭） | 已实现（硬校验） |

> 注：上表两行与正文对应表格（3.9 埋点行、关键缺口清单「真实支付」行）已同步为最新状态，后续修复请在此表中追加行，并在正文对应行同步改状态。

---

## 一、登录与账号体系（PRD 3.1）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| 微信授权登录，协议勾选、年龄红线、用户类型分流 | 已实现 | `login.js`、user-login.login；三份协议勾选；用户类型选择后不可变更 |
| 手机号实名（姓名+身份证）→ 人脸核验 → 未实名禁发布/接单 | 部分 | AES-256-GCM 加密 + 手写签名留证；人脸为测试期 mock（`realname_face_mode='wx'` 才切官方核验，需资质） |
| 紧急联系人：短信验证码、7 天确认、30 天限改、强制人群 | 部分 | set/get_emergency_contact + 发布前置校验；验证码为 mock 通道（dev 可用）；「18-22/60+ 强制」细节待核 |
| 信用分体系（初始 800/双字段/加减分/修复/新号防刷） | 已实现 | get_my_credit + credit 页 + user_credit_score/partner_credit_score 双字段；爽约-20/扣分规则对齐 |
| 耍伴认证：5 场景专项认证 + 背景审查三档 | 部分 | partner-apply + audit 流程已跑通；背景审查（公安/失信等）未接入真实数据源 |
| 博客动态 | 已实现 | blog-action 全套（feed/评论/点赞/隐私分级），页面为 v1 旧页（非主路径） |

## 二、首页 · 广场 · 需求发布（PRD 3.2 / 3.3）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| 首页三段式：场景入口 + 同城广场 + 个性化推荐 | 已实现 | `index.js`（场景分组/banner/活跃耍伴横滑）+ `square.js` + scene_groups 懒加载 |
| 广场排序/筛选、公益免费、被抢态、距离 | 已实现 | square/nearby-list 综合/距离/最新/单价排序；demand-card 组件化 |
| 需求发布：场景白名单 + 撮合三模式 | 已实现 | publish.js：broadcast/direct/智能派单（含 L3 信用门槛）；R9 场景白名单动态读取 |
| 服务内容多选、敏感词拦截、AA 费用自理、公益单规则 | 已实现 | publish_content_options_max 后台化；敏感词库；4000 分公益时薪阈值后台化 |
| 草稿箱（30 天归档/20 条上限/自动保存） | 部分 | save_draft/list_drafts/delete_draft 已落地；30 天归档销毁规则未见实现 |
| 需求管理（匹配前可改/撤销、取消重发） | 已实现 | demand-publish update/cancel/my_demands + 时间窗冲突判定 |
| 紧急需求 24h 过期、状态匹配中/已匹配等 | 已实现 | lazy_expire + expire_at + hall 过滤 status=matching |

## 三、IM 与四确认（PRD 3.4）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| 四确认前仅模板+结构化选项、禁自由文本/联系方式 | 已实现 | im-send 后端强制 send_template；chat.js TM_FIELD 映射，AI 实时拦截见下 |
| 结构化四确认（时间/地点/内容/费用自动算费） | 已实现 | chat 8 位双方确认模型 + order-action confirm_item/confirm_all |
| 聊天留存：未成单 30 天/成单 90 天、2 分钟撤回 | 部分 | 留存/撤回元数据有实现；精确到期自动删除待核 |
| 多模态内容审核（OCR/ASR） | 部分 | 文本敏感词 + 内容安全降级（IM 放行标记 sec_degraded）；图片/语音审核未接入 |

## 四、订单交易系统（PRD 3.5，核心）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| 订单 13 态状态机（含 S3.5/S10.5） | 已实现 | enums.js ORDER_STATUS 13 key + order-timer 超时换态 + order-detail 引导 |
| 四确认→S1；S0 待支付 30min 自动取消 | 已实现 | order-timer + pay_expire_at |
| 里程碑 30%/60%/100% + 比例确认 | 已实现 | milestone_submit/confirm + partial/ratio_confirm |
| 履约中断 S3.5：双向确认、超时转部分完成 | 已实现 | resume_service/partial_confirm + order-timer 自动触发 |
| 改期：≤2 次、前 4h、幅度≤72h、首次免费/二次 5% | 已实现 | modify/modify_confirm/reject + CONFIG.MODIFY 参数化 |
| 加时补差（≤8h 统一、结束前发起） | 已实现 | extend/extend_confirm/reject |
| 取消梯度退款（≥24h 全额/4-24h 80%/<4h 50%） | 已实现 | order-action.cancel 裁决 + mock_refund |
| 爽约处置（扣 20 分/3 次停 7 天/平台赔 10%） | 部分 | 扣分已落地；赔付路由细节待核 |
| 评价：双向匿名、默认 4 星、48h 窗口、24h 内可改 | 已实现 | evaluation-submit + order-timer eval_wait |
| 提现：最低 10 元 T+1、极速提现 T+0 前 10 单、四要素 | Mock | payment-mock withdraw/fast_withdraw（真实通道未接）；四要素风控为 mock |
| 资金担保与分账（服务商分账/AA 不经过平台） | 未实现 | 全流程使用 mock 支付/提现，未接微信服务商分账 |
| 退款时效违约金（0.05%/日） | 未实现 | 未见实现 |
| 投诉仲裁（一审→二审→终审） | 部分 | complaint + admin dispute_list/handle；终审/法务小组流程未落地 |

## 五、安全报备 · 保险 · AI 风控（PRD 3.6 / 3.7 / 3.8 / 4A）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| 安全报备：位置共享 + 30 分钟打卡 + 心跳容错 | 部分 | safety.js 仅 S3/S3.5/S4 开放 + checkin/status；心跳 Redis/离线补传未实现 |
| 紧急求助：一键/静默可撤销、断网短信兜底 | 已实现 | safety-report sos/silent_sos/cancel/resolve + 一键拨打 110/120/联系人 |
| 双向地图位置共享（对称、15min 覆盖） | 已实现 | nearby-map + set_map_share/report_map_gps |
| 订单级责任险（每单投保、50 万人身+5 万财产、前置风控） | Mock | mock_ins + pay.js 保险 0 平台承担 + insurance_list；真实投保/理赔未接 |
| 撤保与改期原子性、>24h 免费撤保规则 | 未实现 | 未落地（依赖真实保险） |
| 五维 AI 风控 + 团伙欺诈 + 心理危机 L1/L2/L3 | 未实现 | `zz-ai-guard` 为空占位（仅 node_modules）；`ai_guard_enabled` 默认 false（上线后规划） |
| 风控申诉通道 + 误判分级补偿 | 未实现 | 未落地 |
| 产品埋点与数据指标（3.9：北极星=周有效履约订单量） | 已实现 | `utils/report.js` 封装 wx.reportAnalytics；漏斗事件已埋：app_launch / login_success / realname_done / demand_publish / order_take / order_pay / order_start / order_finish / eval_submit / withdraw（微信后台「事件分析」面板查看） |

## 六、耍伴工作台 · 个人中心（PRD 3.10 / 3.11）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| 接单配置：场景/时段/单价/距离 + 休息日 | 已实现 | accept-config 场景认证/日常位置/场景费率 |
| 收益与钱包（明细/提现/冻结资金查询） | Mock | wallet.js + payment-mock balance_info/income_list/withdraw |
| 耍伴日程/通勤（冲突检测含通勤、提醒） | 部分 | workbench + route_plan 通勤；日历视图/服务清单未完整 |
| 上岗考核与复考（80 分/题库） | 未实现 | 未落地 |
| 发票/完税证明 | 未实现 | 未落地 |
| 虚拟号联系 | 未实现 | 未落地 |
| 个人中心：数据查阅/导出/更正/变更、注销 30 天冷静期 | 部分 | close_account 已落地；数据导出/冷静期 UI 未见 |
| 拉黑三层机制（个人/平台/风险标记） | 未实现 | 仅有 report_user 举报，无拉黑 |

## 七、B 端运营后台（PRD 第 5 章）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| RBAC 权限模型（6 角色/最小权限/双授权） | 部分 | admin-action 3 角色（R1/R2/R3）精简版已落地；与 PRD 6 角色有差距 |
| 后台 10 大模块 | 已实现 | admin-web 8 模块 21 页面 + 70 个 admin-action（Dashboard/Users/Partners/Demands/Orders/Finance/Risk/Content/Operations/Accounts/Export…） |
| 客服与争议 SLA（30 秒受理/工单分级） | 未实现 | dispute/report 管理有实现；SLA/工单体系未见 |
| 抽成等可运营参数后台化 | 已实现 | CONFIG_SCHEMA + Operations.vue 动态渲染；15+ 参数（消息分页/照片大小/数量限制等）后台可调 |

## 八、平台统一规则（PRD 第 8 章）

| PRD 约定 | 状态 | 实现情况 |
|---|---|---|
| 信用分加减统一表（履约+5/好评+3/爽约-20…） | 已实现 | credit_score_log + admin credit_adjust/penalty |
| 平台抽成矩阵（冷启动 8%/成长 12%…） | Mock | platform_fee_rate_fen 前台参数化；抽成在 mock 支付闭环中体现，真实分账未接 |
| 状态超时统一表（30min/24h/48h/梯度退款） | 已实现 | order-timer + CONFIG 参数表统一管理 |
| 违规分级处罚 V1-V5 | 部分 | penalty + 信用扣分落地；永久封禁/移交司法未涉及 |
| 不可变红线（年龄≥18/时间红线/公共场所/人脸合规） | 已实现 | redline.js（23:00-06:00）、年龄校验、人脸单独同意 |
| 可运营参数动态调整 | 已实现 | admin_config SSOT + 5 分钟缓存 TTL |

---

## 关键缺口清单（上线前高危）

| 缺失项 | PRD 章节 | 说明 |
|---|---|---|
| **真实支付/分账/提现** | 3.5.1 | 全部为 payment-mock；`mock_payment_enabled` 生产暂开。**已加上线冻结硬校验**：init-db `quick_check` 返回 `mock_gate.status=BLOCK`（prod 且开关开时），正式上线前必须置回 false |
| **真实保险投保/理赔** | 3.7 | mock_ins；真实保险 API 循环未接 |
| **真人脸核验** | 3.1.1/3.5 | mock 通道；`realname_face_mode='wx'` 需家政服务类目资质 |
| **AI 风控 + 心理危机干预** | 3.8/3.6.4 | zz-ai-guard 空占位；`ai_guard_enabled=false`（上线后灰度） |
| **博客页主路径化** | 3.1.4 | blog-action 可用，页面仍为 v1（提审需清理注册，联动 R1） |
| **后台 SLA/工单、智能客服** | 5.2/3.11.3 | 未实现 |