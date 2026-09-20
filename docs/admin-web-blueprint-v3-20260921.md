# 找人帮忙 · Web 管理后台蓝图 v3（含工作分期）

- 版本：v3（用户已拍板接受，v2 菜单废弃）
- 日期：2026-09-21
- 关联：交付方式沿用既定原则「三期合并一次交付、内部两个自测检查点」
- 架构基线：Vue3 + Element Plus → CloudBase 静态托管 → 新建 `admin-web` HTTP 云函数 → `shared-admin` 公共层 → 现有云数据库
- 鉴权基线：`admins` 集合（scrypt 加盐哈希）+ HMAC token（2h 过期，jti 可吊销）+ `admin_sessions` + 失败 5 次锁 15 分钟；4 角色 super/ops/finance/readonly，fail-closed

---

## 1. v2 → v3 评审修订依据（已核验代码）

| 编号 | 问题 | 修订 | 代码证据 |
|---|---|---|---|
| M1 | 菜单按集合切分，处置一个用户要跨「用户运营」「用户中心」两个一级菜单 | 按业务对象聚合：信用流水/实名并入用户详情；钱统一进财务 | IA 原则 |
| M2 | 「财务概览」计划纯前端聚合全量流水，不可行 | 新增云端 `finance_stats` 服务端聚合 | [admin-action/config.json](file:///c:/Users/DC/Desktop/zhaoren/cloudfunctions/admin-action/config.json) timeout=20s；分页 PAGE_SIZE=15；`dashboard` 已有 `sumTx('pay'/'refund'/'tip')` 可扩展（[index.js:104](file:///c:/Users/DC/Desktop/zhaoren/cloudfunctions/admin-action/index.js#L104)、[L176-193](file:///c:/Users/DC/Desktop/zhaoren/cloudfunctions/admin-action/index.js#L176-L193)） |
| M3 | CSV 导出无承接页，一次性导出受 20s 超时限制 | 系统管理增加「导出任务/下载中心」，异步任务+云存储时效链接+审批脱敏 | — |
| M4 | `settlement` 集合无任何业务写入方，结算页上线即空 | 结算记录页占位禁用，待结算落库批次同步开放 | 全仓检索：settlement 仅出现在 init-db（建集合/种子）与 admin-action（只读 list） |
| M5 | `user_detail` 证件信息对财务/只读角色过度暴露 | 证件/实名明细仅 S/O；F/R 只见实名状态布尔 | 脱敏收紧 |
| M6 | 通知群发属全量触达高危操作，权限过松 | 仅 S，加频次限制 + 全量审计 | — |
| M7 | 普通提现 T+1 无定时器回写，processing 永久挂起无感知 | 列表「挂起超 24h」异常角标 + 工作台待办告警；人工处置商用前补 | [payment-mock/index.js:638](file:///c:/Users/DC/Desktop/zhaoren/cloudfunctions/payment-mock/index.js#L638) 注释「无定时器回写,保持 processing」 |
| S1 | 缺 IM 会话监管，纠纷无法举证聊天 | 安全与风控加「会话监管」（只读，按订单查，二期） | im_message 集合 |
| S2 | 免责声明签署记录无入口（纠纷举证） | 不新增菜单，做进订单详情 Tab | disclaimer_signature 集合 |
| S3 | 保险是订单附属物，放用户中心不合理 | 移入「订单与履约」 | insurance_record 按 order_id 关联 |

---

## 2. 菜单结构（8 个一级菜单 / 21 个页面）

```
├─ 1. 工作台        指标看板 · 待办中心（含提现异常角标）
├─ 2. 订单与履约     订单列表 · 订单详情(签署记录/状态流水Tab) · 纠纷处理 · 安全报备 · 保险记录
├─ 3. 用户与耍伴     发单用户(详情聚合:实名/联系人/信用流水) · 耍伴管理 · 耍伴审核
├─ 4. 财务与资产     交易流水 · 财务概览(云端聚合) · 提现记录(挂起异常角标) · 结算记录(占位)
├─ 5. 内容中心       需求广场 · 博客管理 · 评论管理
├─ 6. 安全与风控     举报处理 · 会话监管(二期,只读)
├─ 7. 运营配置       9 组配置(env/费率/群发类仅 S)
└─ 8. 系统管理       管理员 · 操作审计 · 通知群发(仅S) · 导出任务/下载中心
```

状态图例：✅ 云端 action 已就绪 ｜ 🆕 本轮已新增 ｜ 🔲 待开发 ｜ 🔒 商用前补 ｜ ⏸ 占位禁用

### 2.1 工作台 `/dashboard`

| 区块 | 内容 | action |
|---|---|---|
| 指标看板 | 今日订单/GMV/新增用户/待审耍伴/待处理纠纷/待处理举报 | `dashboard` ✅（扩 `finance_stats` 后增强） |
| 待办中心 | 待办直达 + 7 日趋势 + **提现挂起超 24h 异常角标** 🔲 | `withdraw_list` 🆕 + 前端 SLA 计算 |

### 2.2 订单与履约

| 页面 | 操作 | action | 状态 |
|---|---|---|---|
| 订单列表 | 多条件查询、强制取消（原因+二次确认） | `order_list` `order_query` `order_force_cancel` | ✅ |
| 订单详情 | 14 态时间轴、加时/改期记录、支付分账、评价、报备、**免责签署 Tab**、**保险 Tab** | `order_detail` ✅；签署/保险数据读取 🔲 | ✅/🔲 |
| 纠纷处理 | 待处理/已处理、SLA 计时、处理结论 | `dispute_list` `dispute_handle` | ✅ |
| 安全报备 | SOS+报备流水、位置、时间（事故回溯） | `safety_log_list` | ✅ 已部署（2026-09-21，待云端面板回归） |
| 保险记录 | 保单号、场景、意外/财产保额、保费，按订单/耍伴筛选 | `insurance_list` 🆕 | ✅（页面待做） |

### 2.3 用户与耍伴

| 页面 | 操作 | action | 状态 |
|---|---|---|---|
| 发单用户 | 列表、冻结/解冻、封禁/解封、信用分调整（原因必填） | `user_list` `user_freeze/unfreeze` `user_ban/unban` `user_credit_adjust` `penalty` | ✅ |
| 用户详情（聚合 Tab） | 基础资料、**实名/证件（S/O 可见，F/R 仅状态）**、紧急联系人脱敏、订单统计、**信用流水 Tab（与调分写操作同处）** | `user_detail` ✅、`credit_log_list` 🆕 | ✅/🆕 |
| 耍伴管理 | 详情（证照/考分）、强制下线/恢复 | `partner_list` `partner_detail` `partner_offline/online` | ✅ |
| 耍伴审核 | 通过/驳回（驳回填原因）；生产红线 `auto_approve_partner=false` | `review` | ✅ |

### 2.4 财务与资产

| 页面 | 内容 | action | 状态 |
|---|---|---|---|
| 交易流水 | 支付/退款/分账/加时补款筛选；导出走下载中心 | `finance_list` | ✅ |
| 财务概览 | GMV/平台收入/耍伴分账/退款、趋势 | `finance_stats`（服务端 aggregate，扩展 sumTx） | ✅ 已部署（2026-09-21，待云端面板回归） |
| 提现记录 | 普通/极速、processing/success、金额、预计到账、**挂起超 24h 角标** | `withdraw_list` 🆕 | ✅/🔲角标 |
| 结算记录 | ⏸ 集合无写入方，页面占位禁用；落库批次完成后开放 | `settlement_list` 🆕（暂空） | ⏸ |
| 提现审核/驳回 | 🔒 mock 阶段不做；接真实商户号后补双人复核 | `withdraw_approve/reject` | 🔲🔒 |

### 2.5 内容中心

| 页面 | 操作 | action |
|---|---|---|
| 需求广场 | 查看、下架（原因必填） | `demand_list` `demand_offline` ✅ |
| 博客管理 | 下架/恢复/删除 | `blog_list` `blog_offline/restore/delete` ✅ |
| 评论管理 | 删除评论 | `blog_comment_list` `blog_comment_delete` ✅ |

### 2.6 安全与风控

| 页面 | 内容 | action | 状态 |
|---|---|---|---|
| 举报处理 | 举报列表、处理结论、联动封禁/下架 | `report_list` `report_handle` | ✅ |
| 会话监管 | 按 order_id 只读调取 IM 消息，供纠纷仲裁；不留存导出 | `im_message_admin_list` | 🔲 P1（二期） |

### 2.7 运营配置（9 组，diff 确认 + 服务端校验 + 操作审计）

| 组 | 字段 | 可写角色 |
|---|---|---|
| ① 平台开关 | env、payment_visible、auto_approve_partner、security_only_template_before_confirm 🆕 | env/auto_approve 仅 S；其余 S/O |
| ② 费率与金额 | platform_fee_rate_fen、rate_min/max/default_fen、youth_limit_fen 🆕 | 仅 S |
| ③ 信用门槛 | min_credit_take/place_order、credit_freeze_line | S/O |
| ④ 距离与城市 | publish_distance_max_km 🆕、take_distance_max_km 🆕、city_enabled | S/O |
| ⑤ 订单时效 | s0/s1_timeout_min、interrupt_timeout_h、eval_window_h、default_star 🆕、milestone_confirm_min 🆕、modify_confirm_h 🆕 | S/O |
| ⑥ 改期规则 | modify_config：maxTimes/minLeadHours/maxSpanH/confirmHours 🆕 | S/O |
| ⑦ 场景与服务项 | scene_list 子服务项增删（场景整体增删为独立批次） | S/O |
| ⑧ 内容与 IM | block_words、system_templates | S/O |
| ⑨ 密钥状态 | idcard_aes_key_set（只读布尔，永不回传密钥） | S |

### 2.8 系统管理

| 页面 | 内容 | 可访问 | 状态 |
|---|---|---|---|
| 管理员 | Web 账号增删、角色、停用、改密 | 仅 S | 🔲（随基建） |
| 操作审计 | config_change、冻结封禁、处置等全量日志 | S；F 仅财务相关 | `event_list` ✅ |
| 通知群发 | 分人群 system_notice、发送记录、频次限制、全量审计 | 仅 S | 🔲 |
| 导出任务/下载中心 | 异步导出任务状态、云存储时效链接、脱敏审批 | 按数据域限角色 | 🔲 |

---

## 3. 角色权限矩阵（v3）

S=super O=ops F=finance R=readonly

| 模块 | S | O | F | R |
|---|:-:|:-:|:-:|:-:|
| 1 工作台 | ✅ | ✅ | ✅ | ✅ |
| 2 订单查看 | ✅ | ✅ | ✅ | ✅ |
| 2 强制取消/纠纷处置 | ✅ | ✅ | – | – |
| 2 保险记录 | ✅ | ✅ | ✅ | – |
| 3 用户查看（基础） | ✅ | ✅ | ✅ | ✅ |
| 3 证件/实名明细 | ✅ | ✅ | 仅状态 | 仅状态 |
| 3 冻结/封禁/调分/审核 | ✅ | ✅ | – | – |
| 4 流水/概览/提现 | ✅ | 只读 | ✅ | – |
| 4 导出 | ✅ | – | ✅（审批后） | – |
| 5 内容查看/处置 | ✅ | ✅ | – | – |
| 6 举报处置 | ✅ | ✅ | – | – |
| 6 会话监管 | ✅ | ✅ | – | – |
| 7 运营配置 | ✅ | 部分 | – | – |
| 7 费率/env/auto_approve | ✅ | – | – | – |
| 8 管理员 | ✅ | – | – | – |
| 8 通知群发 | ✅ | – | – | – |
| 8 操作审计 | ✅ | – | 财务相关 | – |

所有矩阵未显式授权的组合默认拒绝（fail-closed），前后端双重校验，以后端为准。

---

## 4. 工作分期

总策略：**一次交付上线，内部设两个自测检查点（CP1/CP2）**；域名备案为外部长周期事项，第 0 天并行启动，开发期使用 `xxx.tcloudbaseapp.com` 临时域名。

### 阶段 0｜基建与外部前置（约先行 1-2 周，与备案并行）

| 项 | 内容 |
|---|---|
| 域名 | ICP 备案启动（外部 1-2 周硬阻塞）；同步申请临时托管域名用于开发 |
| 数据库 | 新建 `admins`、`admin_sessions` 集合（init-db 补定义+索引） |
| 云端 | 新建 `admin-web` HTTP 云函数：登录/登出/token 校验/失败锁定/RBAC 中间件/审计写入 |
| 复用层 | 抽 `shared-admin`：鉴权、校验、分页、审计、脱敏公共方法 |
| 前端 | Vue3+Element Plus 工程骨架、路由守卫、4 角色菜单渲染、布局 |
| 账号 | 首个 super 账号创建方式（待定：种子脚本一次性注入，强制首登改密） |

**验收**：4 角色账号登录、越权请求全部 fail-closed、token 过期/锁定/吊销生效。

### 阶段 1｜只读运营闭环 → CP1（内部自测检查点 1）

云端先补两个 P0 只读 action，前端只做**查看类**页面（写按钮不启用）：

- 🔲 `finance_stats`：服务端 aggregate GMV/平台收入/分账/退款/趋势（复用 sumTx 模式）
- 🔲 `safety_log_list`：安全报备/SOS 只读分页
- 页面：工作台、订单列表/详情（含签署/保险 Tab）、纠纷（只看）、安全报备、保险记录、用户/耍伴列表与详情（含信用流水 Tab、证件 S/O 门控）、耍伴审核（只看）、需求/博客/评论（只看）、举报（只看）、交易流水、财务概览、提现记录（含挂起角标）、结算记录（占位禁用）

**CP1 验收**：21 页中 17 个查看页数据打通；权限矩阵逐格走查；F/R 看不到证件明文；提现挂起角标正确；空 settlement 页明确「暂未开放」而非报错。

### 阶段 2｜配置与处置 → CP2（内部自测检查点 2）

- 运营配置 9 组全量表单：编辑前 diff 预览、服务端范围校验、写审计、env/费率类仅 S
- 已有写操作接通：强制取消、冻结/解冻、封禁/解封、信用调分、耍伴审核/上下线、需求/博客/评论处置、纠纷处置、举报处置
- 系统管理：管理员管理、操作审计（按角色过滤）
- 订单详情免责签署 Tab 数据接通

**CP2 验收**：每类写操作验证「二次确认→落库→审计可查→对方端生效」；配置越界值全部被服务端拒绝；冻结用户实时失去发单/抢单能力；生产环境 `auto_approve_partner=false` 不可被 O 角色开启。

### 阶段 3｜增强与上线交付

- 通知群发（仅 S：人群选择→预览→频控→审计→发送记录）
- 导出任务/下载中心（异步：提交→生成→云存储时效链接；默认脱敏）
- 会话监管（按 order_id 只读，二期能力）
- 全局穿透跳转（保险/流水/举报/报备 ↔ 用户详情/订单详情）
- 正式备案域名切换、全站 HTTPS、账号回收演练、交付验收

**上线验收**：4 角色全矩阵回归 + 越权用例库 + 高危操作审计完整性核对。

### 商用前补丁清单（不阻塞内部上线，独立排期）

MFA、高危双人复核、微信支付三方对账、退款状态机、提现人工处置（接真实商户号）、结算落库与 `settlement_*`、脱敏导出审批流、审计只增不删、监控告警、隐私合规接口。

---

## 5. 待开发 action 汇总

| 优先级 | action | 阶段 | 说明 |
|---|---|---|---|
| P0 | `finance_stats` | 1 | ✅ 已部署 c0175d9（待云端面板回归）。入参 `days`(1-90,默认30) 或 `start_ts/end_ts`；返回 summary(gmv/refund/net/tip/platform_fee/partner_income+笔数) 与日趋势(trend 明细 5000 上限, 超限 `trend_truncated=true`)。耍伴收入口径=S8/S9/S10（对齐 payment-mock settledFen，不含 S5 待评价/S7 已退款），区间按订单/交易创建时间归属 |
| P0 | `safety_log_list` | 1 | ✅ 已部署 c0175d9（待云端面板回归）。仅查 safety_report 的 sos(含 silent)/checkin；支持 kind/status/order_id/target_openid 过滤；举报类未来走 report_list 不混口径 |
| P1 | `im_message_admin_list` | 3 | 会话监管只读，按 order_id，禁止导出 |
| P1 | `export_task_create` / `export_task_list` | 3 | 异步导出任务+下载中心（M3） |
| P1 | `notice_broadcast` | 3 | 群发，仅 S，频控+审计（M6） |
| 基建 | admin-web 登录/鉴权族 | 0 | HTTP 函数，非 admin-action action |
| 商用前 | `withdraw_approve/reject/mark` | 商用 | 双人复核（M7） |
| 商用前 | `settlement_*` 落库 | 商用 | 先于结算页开放（M4） |

已就绪无需开发：dashboard/order_*/user_*/partner_*/review/demand_*/blog_*/report_*/dispute_*/finance_list/event_list/config_get/config_set + 本轮新增 `credit_log_list`/`withdraw_list`/`settlement_list`(空)/`insurance_list`。

---

## 6. 关键约束与风险

1. **业务参数禁写死**：新增配置项必须先进 `config_set` 白名单与 9 组配置页，不得在后台代码内写死（密钥/版本号/技术常量除外）。
2. **云函数 20s 超时**：列表一律服务端分页（15/页），统计一律服务端 aggregate，导出一律异步任务。
3. **配置双口径债务**：`modify_config.confirmHours`（order-action，默认 24）与 `modify_confirm_h`（order-timer，默认 2）须在阶段 2 前合并统一。
4. **待云化存量**：payment-mock 保额（coverage_accident/property_fen）、极速提现日上限 200000（[payment-mock/index.js:631](file:///c:/Users/DC/Desktop/zhaoren/cloudfunctions/payment-mock/index.js#L631)）、时间红线、前端 B 层 20+ 组（见 miniprogram/config），随配置批次迁移，迁移完成前禁止新增写死值。
5. **备案风险**：备案延期不阻塞开发（临时域名），但阻塞正式上线，须第 0 天启动。
