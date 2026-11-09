# 找个人帮忙 · 产品需求文档（PRD）

**版本**：V2.0 · 现状版
**日期**：2026-11-08
**文档性质**：以本项目**当前已实现功能**为主体的现状说明；未落地规划单列，不与现状混写。
**适用范围**：微信小程序端（原生）、微信云开发（云函数 + 云数据库 + 云存储）、admin-web 运营后台。
**V1 原文出处**：本文所有「V1 原文」引用指 V15／V15.1 两版之一——
- `PRD_v15.1.md`（仓库根目录，V15.1，9,707 行）：可直接打开，比 V15 多一条修订记录；
- V15 原文（9,702 行 / 1,022,011 字节）：`git show de85424:PRD/PRD.md` 取得（`git show HEAD:PRD/PRD.md` 同为该版）。

**不存在单独的 V1 备份副本**：此前「V1 已另存为 20261108 独立备份文件」的记述，经 git 全历史（含各分支与 reflog）、工作区 `.backup-lark-*`、`%TEMP%` 与回收站逐项核查均不成立；为免仓库膨胀，也不新建 1MB 级副本（V1 原文取法见上两条）。

---

## 0. 版本变更说明（V1 → V2.0）

### 0.1 为什么升版

V1（V15，2026-09-06 定稿）是**规划态**文档：功能覆盖、技术选型、数据模型、接口契约均按「计划要做」编写，且历经多轮补丁式追加，正文与附录之间存在前后不一致。项目已进入可运行状态（体验版 v1.6.98），继续以规划口径作为需求基线，会导致「文档说有、代码里没有」和「代码里有、文档里没写」两类偏差同时存在。

V2.0 的目标只有一个：**把 PRD 拉回与代码、台账一致的真值基线**。

### 0.2 V2.0 改了什么

| 序号 | 变更 | 依据 |
|---|---|---|
| 1 | 全文改为「现状 / 未落地规划 / 冲突作废」三段标注，禁止把规划写成现状 | 本次逐项核对（见 §0.4） |
| 2 | 订单状态机由 V1「13 态」订正为代码实际的 16 个 S 码 | `cloudfunctions/order-action/order_state.js:18`（S1/S0/S2/S2_6/S2_5/S3/S3_6/S3.5/S4/S5/S8/S10.5/S6/S7/S10/S9）。S9 在状态机中列为存量兼容态（`LEGACY_STATES`），但自动评价仍写 S9，口径待统一，见 §4.1 |
| 3 | 删除/降级 V1 中不成立的技术选型（Redis、RocketMQ、Elasticsearch、OSS、GPU、K8s、SQL 建表、JWT/REST） | 实际仅用微信云开发；接口为 `wx.cloud.callFunction({name, data:{action}})`；后台走 HTTP 网关 + 会话票据 |
| 4 | 真实支付、分账、二清、T+0 提现全部标注为「未实现（仅模拟）」 | `payment-mock` 全链路打 `is_mock=true`；发布验收清单 4.6 行 |
| 5 | 人脸核验标注为「未实现（仅 mock）」 | `realname_face_mode` 当前为 `mock`；发布验收清单 4.5 行 |
| 6 | 保险、AI 五维风控、心理危机 AI 识别、B 端机构/主子单、会员体系、TRTC 音视频陪伴标注为「未落地规划」 | 代码检索无对应实现（详见 §1.6、§3.7、§3.8、§5.3、附录 N、附录 U） |
| 7 | 补充 V1 未覆盖的实际能力：线上陪伴 W11、博客、活动、公益单、附近地图与位置共享、小程序内置管理页、平台事件与审计哈希链、备份/发布门禁 | 页面与云函数清单（§15）、`docs/FUNCTION-REGISTRY.md` |
| 8 | 「已验证」一律绑定台账编号（REGISTRY #N），不再使用无出处的「已支持」 | `docs/FUNCTION-REGISTRY.md`（153 条） |
| 9 | 新增附录 S（V1→V2 冲突与作废对照）、附录 T（功能实现核对总表）、附录 U（未落地规划与待确认） | 见文末 |
| 10 | 版本号、修订记录、文档治理规则同步更新 | 本文件 §0.3、§0.4 |

### 0.3 现状标注约定（全文强制）

| 标记 | 含义 | 写法要求 |
|---|---|---|
| 【已实现】 | 代码存在且入口可达，台账有验收记录 | 必须附证据：`文件:行号` 或 REGISTRY 编号 |
| 【部分实现】 | 主链路可用，但边界能力缺失或仅 mock | 必须写明缺什么 |
| 【未实现·规划】 | 仅存在于 V1 或路线图，代码无实现 | 必须写明「无代码依据」 |
| 【已废弃】 | V1 有、现网已移除或明确不做 | 必须写明替代方案或裁定出处 |
| 【待确认】 | 证据不足、两侧口径不一致 | 禁止写成结论，列入附录 U |

### 0.4 证据来源与核对方法

核对顺序（真值优先级从高到低）：

1. **代码**：`miniprogram/`（`app.json` 页面注册、`pages-v2/`、`pkg-low/`、`components/`、`utils/`）、`cloudfunctions/`（`index.js` + `action_*.js` + `_shared/`）、`admin-web-frontend/src/`。
2. **云端配置**：`admin_config`（运营参数，运行时 SSOT），以 `admin-action/config_schema.js` 的字段清单为结构依据。
3. **台账**：`docs/FUNCTION-REGISTRY.md`（153 条已验证功能）、`docs/CHANGELOG.md`、`docs/deploy-log.md`、`docs/runbooks/`（发布/回归/备份/运维）、`docs/HANDOFF-20261108.md`。
4. **V1 原文**：仅作为「计划口径」对照，不作为现状依据。

本文不臆造接口名、集合名、页面路径、状态字段。凡未在代码或台账中实证的内容，一律标注【待确认】并汇总到附录 U。

### 0.5 与 V1 冲突/作废总览

| # | V1 口径 | V2.0 实测 | 结论 | 证据 |
|---|---|---|---|---|
| 1 | 订单 13 态（S0–S10，含 S3.5/S10.5） | 实际 16 个 S 码，另有 S2_5、S2_6、S3_6；S9 为存量兼容态但自动评价仍写 S9（见 §4.1） | **冲突，以代码为准** | `order-action/order_state.js:18`；附录 B/G |
| 2 | 评价超时 → S9 评价超时 | S5 后 48h 未评价，定时器写 S9 + `eval_state`（与「S9 退役」声明冲突，待统一） | **冲突·待确认** | `order-timer/action_lifecycle.js:86`；附录 U C1 |
| 3 | 技术栈含 Redis/RocketMQ/ES/OSS/K8s/GPU | 仅微信云开发 + 云存储 + 云函数 | **作废** | §14、§15 |
| 4 | 数据库为 MySQL 表结构 + SQL DDL | 云数据库 NoSQL 集合；无 SQL | **作废** | §16 |
| 5 | 接口为 RESTful + JWT | 云函数 action 协议；后台为 HTTP 网关 + 会话票据 | **作废** | §17 |
| 6 | 真实微信支付 + 平台分账 + 二清 | 仅 `payment-mock`，`is_mock=true` | **未实现** | §7、§3.5 |
| 7 | 人脸核验接入公安/腾讯云 | 仅 `realname_face_mode=mock` | **未实现** | §7.5 |
| 8 | 保险实投（按单投保、保单回执） | 仅 `insurance_record` 写入 mock 记录 | **未实现** | §3.7 |
| 9 | AI 五维风控评分、心理危机识别 | 无模型；仅有违禁词、`msgSecCheck`、红线规则、审计 | **未实现** | §3.8 |
| 10 | B 端机构账号、批量订单、主子单 | 无机构角色；`login` 机构入口已取消 | **未实现/已废弃** | `pages-v2/login/login.js` 注释；§1.6 |
| 11 | 会员/增值服务定价体系 | 无会员开通、无扣费实现 | **未实现** | 附录 U |
| 12 | 线上陪伴为音视频（TRTC） | W11 已开放，但为文字/任务陪伴，无音视频 | **部分实现** | §3.3、附录 N |
| 13 | 四确认前完全禁发消息 | 四确认前仅系统模板；`free_chat` 由状态推导 | **一致** | `cloudfunctions/im-send/index.js:19-20,42` |
| 14 | 定金/尾款两段支付 | 实际为预付全款（模拟） | **冲突** | §3.5、§8 |
| 15 | 公益订单为运营概念 | 已实现：公益归入一口价，价格取后台配置，未配置则不可发布 | **已实现（V1 未写清）** | `demand-publish/action_publish.js:187-196` |

---

## 目录

- 第 1 章 产品整体概述
- 第 2 章 核心机制设计
- 第 3 章 功能需求详述
- 第 4 章 异常场景与兜底机制
- 第 5 章 B 端与运营后台
- 第 6 章 商业模型
- 第 7 章 合规与实名体系
- 第 8 章 平台核心规则
- 第 9 章 UI/UX 设计规范
- 第 10 章 非功能性需求
- 第 11 章 MVP 范围与分期规划
- 第 12 章 上线验收标准
- 第 13 章 风险与应对
- 第 14 章 技术选型
- 第 15 章 系统架构拓扑
- 第 16 章 数据库设计
- 第 17 章 接口设计规范
- 第 18 章 安全与风控设计
- 第 19 章 降级策略与高并发兜底
- 第 20 章 质量保障与自动化验证体系
- 第 21 章 数据驱动的迭代机制
- 附录 A 术语表
- 附录 B 订单状态机流转图（按代码订正）
- 附录 D 外部依据与检索来源
- 附录 E 用户注册与维护字段对照表
- 附录 F 术语表（SSOT 精简版）
- 附录 G 订单状态机转移矩阵（按代码订正）
- 附录 H 上线前置合规自查清单
- 附录 I 风险登记册
- 附录 J 规则字典（可配置规则集）
- 附录 K 非功能需求汇总表
- 附录 L 废止条款存档
- 附录 M 参数总表
- 附录 N 线上陪伴场景专章
- 附录 O 场景调整说明
- 附录 P 健身陪伴场所扩展说明
- 附录 Q 陪诊场所扩展说明
- 附录 R 项目创新分析
- 附录 S V1 → V2.0 冲突与作废对照（V2.0 新增）
- 附录 T 功能实现核对总表（V2.0 新增）
- 附录 U 未落地规划与待确认清单（V2.0 新增）

---

## 第 1 章 产品整体概述

### 1.1 产品定位与边界

【已实现】产品是「同城/线上非标服务撮合平台」：需求方发布需求 → 耍伴报名或被邀请 → 双方四确认 → 预付（模拟）→ 履约双端确认 → 评价。平台不代收真实资金，不做运输/医疗/心理咨询等需资质服务。

【已实现】去暧昧红线落在代码而非口号：`miniprogram/utils/redline.js` + `pages-v2/*` 拦截词与场景限制，服务端 `im-send` 二次校验。

【未实现·规划】V1 的「功能层 / 情感层」双层产品定位，在产品形态上没有对应入口或分流；首页仅按场景宫格组织。该分层是否保留，列入附录 U 待确认。

### 1.2 核心价值主张

【已实现】
- 安全：实名（mock 阶段）、紧急联系人、安全中心、订单内 SOS/静默求助、位置共享。
- 可信：初始信用分 800，双字段（`user_credit_score` / `partner_credit_score`）分别计分；订单全链路 `order_status_log` 留痕。
- 可预期：四确认 + 双端履约确认 + 评价，减少口头约定争议。
- 低门槛：微信一键登录，无需注册表单。

### 1.3 用户痛点（产品假设）

【待确认】V1 列出的痛点（孤独经济、信任缺失、时间碎片化）为立项假设，代码与台账无法验证。V2.0 保留为「需求假设」，不作为已证实结论。

### 1.4 场景白名单

【已实现】当前线上白名单以云端 `admin_config.scene_list` 为运行时 SSOT，实测 9 个：W1 就医陪诊、W2 学习陪伴、W3 健身陪伴、W4 游玩陪伴、W7 情绪陪伴、W8 生活协助、W9 宠物陪伴、W10 出行陪伴、W11 线上陪伴。

【已废弃】W5 探店、W6 演出：已终止不做（`miniprogram/config/enums.js` 注释）。

【部分实现】W3 健身陪伴在前端枚举中标注为「当前隐藏、置于文末」，但云端白名单包含 W3；可见性以云端 `scene_list.visible` 与场景子项配置为准，前端不得自行写死。【待确认】W3 的最终可见状态需运营确认，见附录 U。

【已实现】前端场景枚举与云函数 `SCENE_CODES_FALLBACK` 保持子集关系，由 `scripts/check-ssot.js` 守护；运行时以云端为准。

### 1.5 平台红线

【已实现】红线条目分布在三层：
1. 客户端：`utils/redline.js`（词表 + 场景限制 + 夜间遮蔽）。
2. 服务端：`im-send` 关键词与状态校验、`demand-publish` 场景/资质校验。
3. 内容安全：微信 `security.msgSecCheck`（文本）。

【冲突】V1 红线中「订单 13 态」的表述已被 16 态实现取代，见附录 B/G。

### 1.6 角色体系

【已实现】实际只有两类业务身份，同一微信号可同时持有：
- 需求方（user）：发布需求、确认、支付、评价。
- 耍伴（partner）：认证、接单、履约、结算。

【已实现】双身份共存依据：`user_account` + `partner_profile` 两集合按 openid 关联；工作台按 `role` 过滤可执行操作。

【已废弃】B 端机构账号、采购方角色：无实现；`pages-v2/login/login.js` 中机构登录入口已注释取消（约 L155）。

### 1.7 年龄与未成年人保护

【已实现】18–22 岁用户与耍伴单笔订单上限 200 元，服务端校验（`youth_limit_fen` 配置）。

【未实现·规划】60 岁以上需监护人确认的流程，代码无实现。【待确认】是否仍在范围内，见附录 U。

### 1.8 冷启动与增长

【未实现·规划】V1 的校园大使、公益订单引流、企业福利采购等增长方案，代码层仅有「公益单」发布能力（见 §3.3），无对应运营工具与数据看板。

【部分实现】可用的运营抓手：活动（`home-action` 活动列表/详情）、运营位、场景排序（云端 `scene_list` 数组序）、新手/信用门槛（智能匹配 L3 门槛）。无 A/B 实验平台、无裂变工具。

---

## 第 2 章 核心机制设计

### 2.1 履约起止的双端确认机制

【已实现】现行主链路（与 V1 不同，以代码为准）：

| 阶段 | 发起方 | 动作（云函数 action） | 状态变化 | 证据 |
|---|---|---|---|---|
| 开始履约 | 耍伴 | `order-action.start_apply`（先传证据） | S2 → S2_6（履约开始确认中） | REGISTRY #61/#67 |
| 需求方确认开始 | 需求方 | `order-action.start_confirm` | S2_6 → S3（履约中） | REGISTRY #66 |
| 需求方拒绝开始 | 需求方 | `order-action.start_reject` | S2_6 → S2（首次）；连续 2 次或超时 → S10_5 | REGISTRY #66；`action_lifecycle.js:372,459` |
| 需求方拒绝完成 | 需求方 | `order-action.finish_reject` | S3_6 → S3（首次）；连续 2 次或超时 → S10_5 | `action_lifecycle.js:724-731` |
| 完成履约 | 耍伴 | `order-action.finish_apply`（先传证据） | S3 → S3_6（履约完成确认中） | REGISTRY #69 |
| 需求方确认完成 | 需求方 | `order-action.finish_confirm` | S3_6 → S5（已完成） | REGISTRY #127 |

【已废弃】旧版直连入口 `start_service` / `complete_service`：handler 与状态声明已删除，仅保留墓碑守卫返回 `oa_legacy_retired`，A/B 等价性基线已同步（HANDOFF-20261108）。

【已实现】拒绝与超时：S2_6/S3_6 超时或拒绝进入 S10_5，由 `order-timer` 与客服/仲裁链路处理；具体超时分钟数以 `admin_config` 为准（配置项存在，默认值见 §8.4）。

【已实现】证据前置：`start_apply`/`finish_apply` 要求先上传证据，防止「无凭证确认」。

### 2.2 撮合与派单机制

【已实现】三种撮合模式（`demand.match_mode`）：
- `broadcast`：广播，符合条件耍伴可报名。
- `select`：精选，需求方从报名者中选择。
- `direct`：定向邀请。

【已实现】耍伴侧入口：`demand-match` 云函数的 `top5`（推荐列表）、`hall_list`（大厅）、`apply`（报名）、`confirm_apply`（确认接单）、`invite`（邀请）、`broadcast`（广播）。

【已实现】接单锁：`demand` 上的接单人/接单时间字段 + 条件更新防并发；同一需求不可被两人同时接单（REGISTRY #17/#18）。

【已实现】即时/批量两档推送：报名人数达到阈值（20 人）即时推送；未达阈值由 `order-timer` 批量扫描推送（REGISTRY #90/#92）。

【部分实现】距离、信用分、资质、夜间限制参与可接单过滤；无「智能排序算法」，推荐为规则排序（距离/信用/时间），非机器学习。

【未实现·规划】V1 的「AI 智能匹配、动态定价、供需预测」无实现。

---

## 第 3 章 功能需求详述

> 本章按功能域拆解。每个功能域先写**现状**，再单列**未落地/差异**。页面路径均以 `miniprogram/app.json` 注册为准。

### 3.1 用户登录与账号体系

【已实现】
- 微信一键登录：`pages-v2/login/login`，勾选《用户协议》《隐私政策》后登录。
- 登录态持久化：`utils/bootstrap.js` 维护登录态，会话过期自动跳登录（导航兜底已补 `fail` 提示，REGISTRY 对应条目）。
- 服务端 `user-login` 已实现短信验证码、手机号登录、密码登录、资料读写、头像上传等 action（20 个）。
- 账号主键：`user_account` 按 `openid` 关联；17 个云函数使用同一 `env`，openid 同源。
- 手机号：`phone_mask` 脱敏展示 + `phone_hash` 用于匹配，不明文传播（见 §18）。
- 实名：`pages-v2/pkg-low/realname`；耍伴认证要求实名前置。

【部分实现】前端登录页当前只暴露「微信一键登录」；短信/手机号/密码登录仅服务端具备。V1 的「手机号+验证码注册」「账号密码登录」在前端**未开放**。【待确认】是否本期开放，见附录 U。

【未实现·规划】第三方登录（QQ/Apple）、邮箱登录、企业微信登录。

### 3.2 首页、广场与搜索

【已实现】
- 首页 `pages-v2/index`：场景宫格（常用 5 个 + 更多）、搜索入口、附近可接单池（**仅耍伴端**拉取，**60 秒**轮询，页面隐藏即停）、活动卡片、运营位。
- 广场 `pages-v2/square`：需求列表、筛选、分页、报名入口；场景 chips 跟随云端配置。
- 消息 `pages-v2/message`：系统通知、会话列表、未读徽标（30 秒内去重刷新）。
- 搜索：按标题/描述/场景关键词检索（服务端 `demand-publish` 列表能力）。

【已实现】排序与展示顺序以云端 `admin_config.scene_list` 数组序为准，运营可在后台调整。

【未实现·规划】个性化推荐流、猜你喜欢、热度榜。

### 3.3 需求发布

【已实现】发布页 `pages-v2/publish`，能力清单：

| 能力 | 现状 | 证据 |
|---|---|---|
| 场景与子项 | 场景取自云端白名单；每个场景有固定服务项 `options` | `miniprogram/config/enums.js` |
| 计价 | 时薪 `hourly` / 一口价 `fixed`；金额一律「分」 | `demand-publish/action_publish.js:187` |
| 公益单 | 归入一口价，价格取 `welfare_fixed_price_fen`；未配置则 `publish_welfare_not_open` | `action_publish.js:193-196` |
| 标题/描述 | 独立字段，字数上限分别由后台配置控制 | 项目记忆 + `admin_config` |
| 免责声明 | 按场景弹对应免责文案，签字后写 `disclaimer_signature` | `signature-canvas` 组件 + `order-create.sign_disclaimer` |
| AA 费用 | AA 档位（0-50/50-200/200 以上/自定义）+《线下费用自理承诺书》勾选 | `config/enums.js` AA 映射；发布页校验 |
| 代发 | 支持代他人发布（11 位手机号） | 发布页 + `demand-publish` |
| 草稿 | 保存/读取/删除草稿（`demand_draft`） | `save_draft`/`list_drafts`/`delete_draft` |
| 定位 | 地图选点，需位置权限（隐私指引已申请） | `wx.chooseLocation` + 隐私配置 |
| 匹配模式 | `broadcast` / `select` / `direct` | `demand.match_mode` |
| 编辑/下架 | 发布者可编辑、取消；草稿可删 | `update`/`cancel`/`lazy_expire` |

【部分实现】公益单为「可按配置开放」状态，当前是否对外开放取决于 `welfare_fixed_price_fen` 是否配置。【待确认】当前云端该字段是否为空，见附录 U。

【未实现·规划】批量发布、模板复用、AI 文案生成、动态定价。

### 3.4 即时通讯（IM）

【已实现】
- 会话与消息：`im-conv`（`open`/`messages`/`my_convs`/`kefu_open`/`kefu_messages`），`im-send`（`send_text`/`send_kefu`/`send_template`）。
- 状态限制：`S6 已取消`、`S10 已关闭` 禁止收发（`CHAT_BLOCKED`）。
- 自由聊天门槛：`FREE_CHAT_STATUS = S0/S2/S3/S3.5/S4/S5/S7/S8/S9/S10.5`；**不在白名单的状态（含 S1、S2_5、S2_6、S3_6）仅允许系统模板消息**（`im-send/index.js:19-20,295,333`）。
- 内容安全：每条文本先过硬性拦截与 `msgSecCheck`，再落库。
- 频控：滑动窗口（默认 5 分钟 / 30 条，可后台配置 `im_rate_window_min`、`im_rate_max_count`）。
- 客服会话：独立 `kefu_*` 通道。

【部分实现】聊天为「进入会话拉取 + 发送后刷新」，无 WebSocket 长连接、无实时推送；新消息依赖轮询/重进页面。

【未实现·规划】语音/图片/视频消息、消息撤回、已读回执、敏感图片识别。

### 3.5 订单与交易

【已实现】
- 下单：`order-create`（`check_signed` → `sign_disclaimer` → `check_take_result` → `create_from_take`），前置校验签字与接单结果。
- 状态机：16 个 S 码，全量流转见附录 B/G；每次流转写 `order_status_log`。
- 支付：`pages-v2/pay` 收银台 + `payment-mock`（13 个 action）；**全部订单与流水打 `is_mock=true`，页面显著提示「模拟支付，不产生真实扣款」**。
- 资金四态：分账中 / 可提现 / 提现处理中 / 已提现（`config/enums.js` `FUND_STATUS`）。
- 退款/取消/改期/加时/催办/部分完成/争议：由 `order-action`（`index.js` + 9 个 `action_*.js`：`action_change.js`/`action_change_s2.js`/`action_confirm.js`/`action_dispute.js`/`action_lifecycle.js`/`action_modify_extend.js`/`action_nudge.js`/`action_query.js`/`action_timeline.js`）分发；`action_tip.js` 属 `payment-mock`（打赏归支付域）。
- 防连点：写操作按钮统一防双击；关键 action 幂等。

【部分实现】「分账」为本地计算结果（平台抽成 + 耍伴实收），**不涉及真实资金划转**；提现为 mock 记录（`withdraw_record`/`withdraw_lock`）。

【未实现】微信支付商户号、平台分账、二清合规、T+0 垫资、真实退款、发票。

【冲突】V1 的「定金 + 尾款两段支付」未实现；现行为预付全款（模拟）。

### 3.6 安全保障与紧急求助

【已实现】`safety-report`（11 个 action）：
- 订单内：`sos`（一键求助，P0 事件）、`silent_sos`（静默求助）、`cancel_silent_sos`（本人撤销）、`resolve_sos`（解除）。
- 报平安：`checkin`（带位置，60 秒冷却）。
- 举报：`report_user`、`report_order`。
- 无单自由求助：`free_sos`、`free_sos_status`、`free_sos_resolve`（本人/客服解除，10 分钟冷却）。
- 状态查询：`status`。

【已实现】安全中心页 `pages-v2/pkg-low/safety`；紧急联系人 `emergency_contact`；位置共享开关（`nearby-map` / 订单安全卡）；夜间遮蔽组件 `night-mask`。

【未实现·规划】自动报警对接、录音/录像留存、第三方安防联动、心跳失联自动告警（当前 `checkin` 为手动）。

### 3.7 保险

【部分实现】仅有 `insurance_record` 集合与 `mock_ins`（模拟投保）记录，**无真实保司接口、无保单号回执、无理赔链路**。

【未实现·规划】按单投保、保费计算、保单查询、理赔协助。

【冲突】V1 3.7 描述的「与保险公司系统对接、按单出单」未落地，不得作为现状对外表述。

### 3.8 风控与信用

【已实现】
- 信用分：初始 800、满分 1000、及格 600、冻结 400（`config/index.js` `CREDIT`）；用户与耍伴分字段计算。
- 信用等级：L1 新手 600-699（日限 10）、L2 标准 700-799（15）、L3 优质 800-899（20）、L4 金牌 900-1000（25）（`config/enums.js:147-153`）。
- 扣分/加分：`credit_score_log` 明细；评价、违约、爽约、投诉触发。
- 行为风控：违禁词、`msgSecCheck`、红线规则、频控、审计日志（`audit_log` 哈希链）、平台事件（`platform_event`）。
- 爽约：`no_show_report` + 申诉（`no_show_grace_min` 默认 30 分钟）。

【未实现·规划】V1 的「AI 五维风控评分、设备指纹画像、心理危机 AI 识别」无模型、无代码。

### 3.9 数据埋点

【部分实现】仅有 `miniprogram/utils/report.js` 的轻量上报 + 微信官方 `wx.reportAnalytics` 少量点位 + 服务端 `platform_event` 业务事件。

【未实现·规划】全链路埋点表、漏斗分析、留存看板、A/B 实验框架。

### 3.10 耍伴工作台

【已实现】`pages-v2/workbench`：
- 今日待履约、本周收入、累计单量等卡片。
- 一键导航、联系需求方、上传证据、开始/完成履约申请。
- 一键报警与无单自由求助入口。
- 接单配置 `pages-v2/pkg-low/accept-config`（可接场景、距离、时间）。
- 考试与学习：`pages-v2/pkg-low/exam`、`exam-status`、`study`；题库 `exam_bank`、证书 `certificates`、学习记录 `study_records`。
- 认证：`pages-v2/pkg-low/partner-apply`、`partner-profile-edit`；认证资料为审核快照，`partner-detail` 只读展示（fail-closed）。

【部分实现】收入为账面金额（模拟支付口径），不可真实提现。

### 3.11 个人中心与内容社区

【已实现】
- 个人中心 `pages-v2/profile`：昵称、头像、信用分、钱包、订单、我的发布、认证状态、设置。
- 钱包 `pkg-low/wallet`：余额、流水、提现（mock）。
- 信用 `pkg-low/credit`：分数、等级、明细。
- 通知 `pkg-low/notices`：系统通知（`system_notice`）。
- 客服 `pkg-low/kefu`：客服会话。
- 协议与隐私：`pages-v2/agreement`（用户协议）、`pages-v2/privacy`（隐私政策）。
- 博客：`pages-v2/blog`、`blog-publish`、`blog-detail`；集合 `blog_post`/`blog_like`/`blog_comment`。
- 活动：`pkg-low/activity-detail`；数据来自 `home-action`。
- 附近：`nearby-list`（列表）、`nearby-map`（地图，角色异色针）。

【已废弃】V1 的「会员中心、成长任务、积分商城」无实现。

---

## 第 4 章 异常场景与兜底机制

### 4.1 超时规则（代码实测）

| 场景 | 超时阈值 | 处置 | 证据 |
|---|---|---|---|
| S1 待确认（四确认未完成） | 15 分钟 | 自动 S6 并释放需求 | `order-timer/index.js:77`（`s1_timeout_min`） |
| S0 待支付 | 30 分钟 | 自动 S6 | `order-timer/index.js:77`（`s0_timeout_min`） |
| S2_6 开始履约待确认 | 15 分钟 | 按 `start_apply_timeout_min` 处理 | `order-timer/index.js:549` |
| S3_6 完成履约待确认 | 30 分钟 | 按 `finish_confirm_timeout_min` 处理 | `order-timer/index.js:550` |
| S3.5 履约中断 | 24 小时 | 默认转 S4 部分完成 | `order-timer/index.js:77`（`interrupt_timeout_h`） |
| S5 已完成未评价 | 48 小时 | 系统默认 4 星评价 | `order-timer/index.js:77`（`eval_window_h`/`default_star`） |
| S2 改期 | 后台改期超时 | 自动拒绝，回 S2 | `order-timer` `processChangeTimeout`/`processS2ChangeTimeout` |

【已实现】定时器 `orderTimer` 每 30 分钟执行一次，单次超时 60 秒（`cloudfunctions/order-timer/config.json:9`）。

【冲突·待确认】评价超时的落库状态：状态机声明将 S9 列为「退役态、仅存量兼容」（`order_state.js:77-80`），但 `action_lifecycle.js:86` 在自动评价时仍写入 `status:'S9'`。文档与实现口径不一致，列入附录 U。

### 4.2 取消、退款与争议

【已实现】
- 用户/耍伴取消：按状态机合法边执行（S0→S6、S1→S6、S2→S10 等），非法流转服务端拒绝并记录。
- 退款：S7 已退款为账面状态，`payment-mock` 生成退款流水；**无真实资金退回**。
- 争议：S10 → S10.5；`order-action/action_dispute.js` + 后台 `dispute_handle`；争议期间订单冻结。
- 部分完成：S3.5 → S4；S4 → S5。

【已实现】同一订单的爽约与投诉入口通过 `frozen` 字段互斥，不会重复立案。

### 4.3 爽约与申诉

【已实现】`no_show_report` 集合 + 后台 `no_show_report_list` / `no_show_decide`。

| 规则 | 默认值 | 证据 |
|---|---|---|
| 申诉时限（约定开始后） | 48 小时 | `no_show_report_window_h` |
| 被诉方举证窗口 | 48 小时 | `no_show_defense_window_h` |
| 到点提醒延迟 | 30 分钟 | `no_show_grace_min` |
| 裁定成立扣分 | 20 分 | `no_show_score_deduct` |
| 累计停用阈值 | 3 次 | `no_show_suspend_threshold` |
| 停用天数 | 7 天 | `no_show_suspend_days` |
| 次数统计滚动窗口 | 180 天 | `no_show_count_window_days` |
| 单方举证照片上限 | 3 张 | `no_show_evidence_max` |
| 同订单单方申诉上限 | 1 条 | `no_show_max_per_order` |

【已实现】爽约裁定必须走 `admin-action` 业务链，禁止直接改库（项目规则）。

【待确认】提醒任务需带「不超过 48 小时申诉窗口」下界判断，历史订单是否已全量排除，见附录 U。

### 4.4 资金异常

【已实现】卡死提现监控：`processing` 超过 48 小时计入巡检问题项（`order-timer/index.js:152-155`）。

【已实现】支付幂等：同一订单重复支付请求返回既有结果，不重复生成流水。

【未实现】真实支付回调、对账文件、差错处理。

### 4.5 系统级兜底

【已实现】
- 订阅消息双通道：云调用失败时走 HTTPS 直连重试（`order-timer/push_https.js`、`sub_msg.js`）。
- 平台事件：`platform_event` 记录 P0/P1 异常（支付失败、鉴权失败、SOS 等）。
- 定时巡检：`order-timer` 的 errorScan 检查 P0/P1 事件、`audit_log result=fail`、卡死提现、网关鉴权失败突增。
- 缓存兜底：配置读取带本地缓存与默认值链。
- 云函数超时：业务函数按需配置（`order-timer` 60s、`zz-seed-orders` 20s；其余以各 `config.json` 为准）。

【未实现】多可用区容灾、自动扩缩容策略、熔断降级开关。

---

## 第 5 章 B 端与运营后台

### 5.1 后台形态

【已实现】`admin-web-frontend`：Vite 构建的独立 SPA，部署到云开发静态托管，接口经 HTTP 网关（`/api`）转发到 `admin-web` 云函数。

【已实现】后台页面（`admin-web-frontend/src/views/`，32 个视图）：

| 域 | 页面 |
|---|---|
| 总览 | Dashboard、Report |
| 用户与耍伴 | Users、Partners、PartnerProfileReview、Accounts |
| 需求与订单 | Demand、Orders、Dispute、NoShow |
| 安全与内容 | SafetyLog、Report、Blog、Comment、Review、Conversation、Kefu |
| 财务 | Finance、Insurance、Export |
| 配置与治理 | Config、ConfigLog、Audit、Notice、Operations、Legal |
| 考试 | Exam（含题库/科目/内容预览子组件） |
| 入口 | Login、Layout |

### 5.2 权限模型

【已实现】三级 RBAC（`admin-action/authz.js:5-9`）：
- R1 超管：全部 action，含敏感写（导出、配置写、强制操作）。
- R2 审核：审核、证据、举报、IM 监管、内容下架、争议裁定。
- R3 运营：配置读、活动、通知、订单/财务只读、用户查询、考试管理。

【已实现】未在 `ROLE_GRANTS` 声明的 action 默认仅 R1 可执行；全部写操作落 P1 审计事件。

### 5.3 运营能力

【已实现】
- 配置中心 `Config`：字段清单来自 `admin-action/config_schema.js`，含费率、超时、爽约、IM 频控、场景、埋点等分组；变更留 `config_history`。
- 场景管理：`admin_config.scene_list`（顺序、可见性、服务项）。
- 内容治理：博客下架/恢复/删除、评论删除、举报处理。
- 通知：`notice_send` 发系统通知。
- 活动：`home_activity_create/update/delete`、运营位。
- 法律文档：`legal_doc` 版本库（发布/回滚）。
- 导出：`export_*`（仅 R1 或显式授权）。

【未实现·规划】V1 的「机构入驻审核、批量采购、结算单、发票管理」无实现。

---

## 第 6 章 商业模型

### 6.1 收入模型

【部分实现】平台抽成：`platform_fee_rate_fen`，单位万分比，默认 1000 = **10%**（`config_schema.js:83`）。可在后台调整，非 V1 所述的固定 20% 或多档阶梯。

【部分实现】公益单：`welfare_hourly_rate_fen`（默认 30 元/时）、`welfare_fixed_price_fen`（留空则公益单不可发布）。

【未实现】会员费、增值服务费、广告位售卖、保险佣金、机构服务费。

### 6.2 定价与结算

【已实现】时薪区间：`rate_min_fen` 默认 3000（30 元）、`rate_max_fen` 默认 10000（100 元）；场景默认时薪 `scene_default_rate_fen` 默认 5000（50 元）。

【已实现】结算为账面计算：订单金额 − 平台抽成 = 耍伴实收；资金四态流转；提现为 mock。

### 6.3 单位经济模型

【待确认】V1 的 LTV/CAC、履约成本、毛利测算为规划假设，项目无真实交易数据可验证。V2.0 不将其列为结论。

---

## 第 7 章 合规与实名体系

### 7.1 实名认证

【部分实现】实名页 `pkg-low/realname` 采集姓名 + 身份证号，服务端加密存储；**人脸核验为 mock**（`realname_face_mode=mock`），不调用公安/腾讯云实人接口。

【待确认】提审前是否切换 `realname_face_mode=wx`，见附录 U。

### 7.2 隐私与授权

【已实现】
- 小程序隐私协议：`pages-v2/privacy` 展示端内隐私政策；`app.json` 已启用隐私检查。
- 隐私接口声明：位置（`chooseLocation`/`getLocation`）、相册/相机（上传证据/头像）、手机号（代发/绑定）。
- 申请资料：`docs/privacy-application-guide-20261108.md`（6 条信息类型、位置接口权限、服务器域名、订阅消息模板）。
- 数据最小化：手机号脱敏 `phone_mask` + 哈希 `phone_hash`；身份证/银行卡等敏感字段加密存储。

【未实现】第三方 SDK 清单披露、个人信息导出/删除自助入口（需人工客服处理）。

### 7.3 内容安全

【已实现】文本 `msgSecCheck` + 本地违禁词 + 红线规则；图片仅做上传鉴权，未接入图片内容识别。

【未实现】图片/语音自动审核。

### 7.4 交易合规

【未实现】真实支付资质、平台二清/分账合规方案、发票、税务代扣。当前以 `is_mock=true` 明示模拟支付，规避真实资金风险。

### 7.5 数据安全

【已实现】敏感字段 AES-256-GCM 加密；手机号 HMAC 索引；审计日志哈希链（`audit_log` 防篡改）；后台登录失败锁定与审计；数据软删（`is_deleted`）。

【已实现】审计日志保留与清理：`audit_prune` 默认清理 90 天前数据，单日上限 5000 条，仅删最早连续段以保护哈希链。

---

## 第 8 章 平台核心规则

### 8.1 订单状态机

【已实现】代码状态集合（`order-action/order_state.js:18`）：
`S1`、`S0`、`S2`、`S2_6`、`S2_5`、`S3`、`S3_6`、`S3.5`、`S4`、`S5`、`S8`、`S10.5`、`S6`、`S7`、`S10`、`S9`。

【已实现】主轴 11 态：S1 → S0 → S2 → S2_6 → S3 → S3_6 → S3.5 → S4 → S5 → S8（`MAIN_AXIS`）；S2_5 为改期中间态；S6/S7/S10/S10.5 为终态/争议态；S9 为存量兼容态（`LEGACY_STATES`），但自动评价仍写 S9，见 §4.1。

【已实现】合法流转以 `order_state.js` 的转移表为准；服务端拒绝非法流转并记录日志。

【冲突】V1 附录 G 的 13 态图已不适用，V2.0 以代码为准，详见附录 B/G。

### 8.2 四确认

【已实现】时间/地点/内容/费用四项，双方各确认一次共 8 位；任一项变更 8 位全重置；费用变更被接受时 fee 位双确认、其余重置。落库 `order_confirmations`。

【已实现】四确认完成前（S1）IM 仅系统模板；四确认后进入支付/履约主链路开放自由文本，但改期与双端确认中间态（S2_5/S2_6/S3_6）仍只允许模板（`im-send/index.js:19-20,333`）。

### 8.3 信用分

【已实现】初始 800 / 满分 1000 / 及格 600 / 冻结 400；低于 600 禁止下单与接单，低于 400 冻结账号。

【已实现】等级与日接单上限：L1 600-699（10 单）、L2 700-799（15 单）、L3 800-899（20 单）、L4 900-1000（25 单）。

【已实现】扣分项：爽约成立（默认 −20）、投诉成立、违规内容；加分项：好评、完成单量。

### 8.4 时间与费用

【已实现】超时阈值见 §4.1；金额一律「分」的双整数，禁止浮点。

【已实现】青少年（18–22 岁）单笔上限 200 元，服务端校验。

【已实现】AA 费用：四档（0-50 / 50-200 / 200 以上 / 自定义）+ 承诺书勾选，不勾选不能提交。

### 8.5 场景白名单

【已实现】以云端 `admin_config.scene_list` 为准（实测 9 个）；服务端校验 `scene` 字段；前端枚举为子集并由 `check-ssot.js` 守护。

### 8.6 评价

【已实现】用户评价写 `evaluation`，订单转 S8；48 小时未评价系统默认 4 星，文案固定「系统默认评价」。

【冲突·待确认】自动评价写入 S9 还是保留 S8，见 §4.1 与附录 U。

### 8.7 紧急求助

【已实现】订单内 SOS / 静默求助 / 报平安 / 解除；无单自由求助（10 分钟冷却）；均写 `platform_event`（P0）与安全日志；不做真实报警对接。

---

## 第 9 章 UI/UX 设计规范

### 9.1 设计系统

【已实现】
- 单位：`rpx`，750 设计稿基准。
- 全局 token：`app.wxss` 中的 CSS 变量（颜色、圆角、阴影、间距）；页面禁止散落色值。
- 组件库：25 个自定义组件（`miniprogram/components/`），含 `nav-bar`、`bottom-sheet`、`ui-card`、`ui-cell`、`ui-empty`、`ui-skeleton`、`empty-state`、`status-tag`、`tag-chip`、`timeline-card`、`evidence-card`、`finance-card`、`order-progress`、`confirm-progress`、`demand-card`、`partner-card`、`safe-sell-bar`、`safety-card`、`dispute-card`、`no-show-card`、`night-mask`、`scene-picker`、`signature-canvas`、`auth-sign-sheet`、`tm-template-card`。

### 9.2 交互约定

【已实现】
- 所有 `wx.navigateTo` / `wx.redirectTo` 带 `fail` toast 兜底（2026-11-08 全量复扫闭环）。
- tabBar 页跳转统一 `wx.switchTab`，禁止 `navigateTo`。
- 写操作二次确认 + 防双击。
- 空态/骨架屏/加载态统一组件。
- 安全区适配、深色模式（`darkmode: true`）、字体缩放兼容。

【待确认】V1 的品牌视觉规范（主色、插画、IP）是否仍沿用，需设计确认。

---

## 第 10 章 非功能性需求

### 10.1 性能

【待确认】项目尚未建立性能基线（首屏耗时、包体、云函数 P95）。`docs/runbooks/release-zero-checklist.md` 记录了包体与首屏待测项，未形成结论。

【已实现】已知约束：主包/分包体积限制、云函数超时、网关 2.5 秒硬限（大批量操作需走云端测试面板）。

### 10.2 可用性与容量

【已实现】单环境（`cloud1-d9gkefwcp5c777088`），无多地域容灾；云开发按量配额。

【风险】自动备份当前失效：备份根目录 H 盘不存在、计划任务未注册（2026-11-08 实测），仅有 2026-11-07 全量副本。详见 `docs/HANDOFF-20261108.md`。

### 10.3 可观测性

【已实现】`platform_event`（业务/安全事件）、`audit_log`（后台操作哈希链）、云函数日志、`order-timer` 巡检问题汇总、后台 `Audit`/`SafetyLog`/`Report` 页。

【未实现】指标监控大盘、告警到人（企业微信/短信）、链路追踪。

### 10.4 安全

【已实现】HTTPS、云函数鉴权（openid 上下文）、后台会话票据 + RBAC、登录失败锁定、敏感字段加密、审计留痕、软删。

【未实现】WAF、防重放 nonce、接口签名、渗透测试报告。

---

## 第 11 章 MVP 范围与分期规划

### 11.1 已交付（体验版 v1.6.98）

【已实现】交付物清单：

| 类别 | 数量 | 说明 |
|---|---|---|
| 主包页面 | 19 | `miniprogram/pages-v2/`（`app.json` 的 `pages` 数组，不含分包） |
| 分包页面 | 26 | `pkgLow` 16 页；`pkgAdmin` 8 页；`pkgAgreement` 1 页；`pkgPrivacy` 1 页（`app.json` 共 4 个分包） |
| 自定义组件 | 25 | `miniprogram/components/` |
| 云函数目录 | 21 | 业务 20 + `_shared` |
| 数据库集合 | 31 声明 + 7 运行时动态 = 38 | 见 §16 |
| 后台视图 | 32 | `admin-web-frontend/src/views/` |
| 自动化用例 | 866 通过 | `npm test`，A/B 456 等价 |

【已实现】功能分期（按实际落地倒推，非 V1 计划）：
- P1 核心：登录、实名、发布、撮合、四确认、订单状态机、模拟支付、履约双端确认、评价、信用分、安全求助。
- P2 增强：博客、活动、线上陪伴 W11、附近地图、公益单、考试/学习、包内管理页。
- P3 治理：后台 RBAC/审计、配置中心、平台事件、备份与发布门禁、导航兜底、巨型云函数拆分。

### 11.2 未交付（提审后或后续版本）

【未实现·规划】真实支付与分账、真实人脸核身、保险实投、AI 风控/心理识别、B 端机构与批量订单、会员体系、TRTC 音视频陪伴、全链路埋点、性能基线、多地域容灾。

【状态】提审未提交：`release-zero-checklist` 2.3（提交审核）与 2.4（备案表核对）仍为 ⬜。

---

## 第 12 章 上线验收标准

### 12.1 当前清零状态（实测）

| 项 | 状态 | 证据 |
|---|---|---|
| B-1 隐私保护指引已通过 | ✅ 2026-11-04 | `release-zero-checklist.md:12` |
| B-2 位置接口开通 | ✅ 2026-11-04 | 同上 L13 |
| B-3 request 域名 + 关闭「不校验合法域名」 | ✅ 2026-11-04 | 同上 L14 |
| B-4 可提审体验版包 | ✅ 2026-11-08（v1.6.98） | 同上 L15 |
| 2.3 提交审核 | ⬜ | 需人工点击 |
| 2.4 备案表 F1~F6 一致 | ⬜ | 需人工核对 |
| 4.2 隐私指引按 11 项填报 | ⏸ 待后台填报 | 同上 L54 |
| 4.5 人脸模式保持 mock | ✅ 已拍板 | 同上 L57 |
| 4.6 模拟支付保持开启 | ✅ 已拍板 | 同上 L58 |

【冲突·待确认】B-1 记「隐私保护指引已通过（2026-11-04）」，4.2 又记「按 11 项填报待后台完成（2026-11-08 口径订正）」。两处是否为同一份指引、旧指引是否已被新口径取代，需以 mp 后台实际状态为准，列入附录 U。

### 12.2 自动化门禁（每次提交前）

【已实现】
- 全量单测：`npm test`（866/866）。
- A/B 等价：456 cases（237 explicit + 219 auto；79 known-evolution）。
- 语法：`node --check` / `check-syntax`。
- SSOT：`check-ssot`（前后端场景/枚举一致）。
- 规范源同步：`check-shared-sync`（`SHARED SYNC ALL OK`）。
- 规则体积：`check-rules-size`（≤30720B）。
- 文档链接：`check-doc-links`。
- 离线总门禁：`npm run verify:offline`（EXIT=0 才可提交）。
- 发布前：`predeploy` + 冒烟（2026-11-05 记录 5 PASS + 1 SKIP）。

### 12.3 真机验收要求

【已实现】发布清单第 3 节共 12 项已真机/自动化通过（含选点、相册、实名、导航/联系、订阅消息存量兼容、栈满兜底、时区、S2 文案、变更/改期）。

【待确认】iOS 与 Android 双端是否覆盖全部页面（清单只记录逐项结论，未记录机型矩阵）。

---

## 第 13 章 风险与应对

| # | 风险 | 现状 | 应对 |
|---|---|---|---|
| R1 | 自动备份失效 | 备份根目录 H 盘不存在，计划任务未注册；仅 2026-11-07 全量副本 | 恢复 H 盘或改盘 + 重注册任务 + 完整性校验（待用户批准） |
| R2 | 模拟支付被误认为真实支付 | `is_mock=true` + 收银台提示 + 提审说明 | 对外口径统一；接真实支付前另立合规评估 |
| R3 | 人脸核验为 mock | `realname_face_mode=mock`，提审说明已写「不做人脸采集」 | 保持 mock；后续接 `wx` 需真机回归 |
| R4 | 隐私指引状态口径冲突 | B-1 ✅ 与 4.2 ⏸ 并存 | 以后台状态为准，先核对再提交 |
| R5 | 单环境、无容灾 | 仅一个云开发环境 | 依赖云开发 SLA；关键数据备份 |
| R6 | 云开发配额 | 配额决策为「暂缓加购」 | 监控用量；避免并行大批量部署 |
| R7 | 前端三个大页面未拆分 | `order-detail.js`/`chat.js`/`publish.js` 裁定不拆 | 重开条件：先补页面级测试断言 |
| R8 | 状态机文档与实现漂移 | S9 退役声明 vs 自动评价写 S9 | 统一口径后再更新附录 B/G |
| R9 | 订阅消息额度 | 用户授权额度用尽后仅站内送达 | 已实现额度提示与重新授权入口 |

---

## 第 14 章 技术选型

### 14.1 实际选型

| 层 | 选型 | 证据 |
|---|---|---|
| 小程序 | 原生 WXML/WXSS/JS，无跨端框架 | `miniprogram/` |
| 后端 | 微信云开发云函数（Node.js 16.13） | `cloudfunctions/*/config.json` / 云端运行时 |
| 数据库 | 云数据库（NoSQL 文档） | 全部 `db.collection` 调用 |
| 存储 | 云存储（证据、头像、博客图） | `upload_*` / `cloud.uploadFile` |
| 定时 | 云函数定时触发器 | `order-timer` 每 30 分钟；`zz-warmup` 每 15 分钟（7–22 时） |
| 消息 | 微信订阅消息（云调用 + HTTPS 双通道） | `order-timer/sub_msg.js`、`push_https.js` |
| 后台 | Vue 3.5 + Element Plus + Vite 8 + axios | `admin-web-frontend/package.json` |
| 后台接入 | HTTP 网关 `/api` + `X-Admin-Key` + 会话票据 | `admin-web` 云函数 |
| 测试 | `node --test` + miniprogram-automator | `package.json`、`scripts/` |
| 部署 | 微信开发者工具 CLI / `@cloudbase/cli` / `tcb` | `docs/runbooks/deploy.md` |

### 14.2 V1 选型中未采用的部分

【已废弃】Redis、RocketMQ、Elasticsearch、对象存储 OSS、GPU 推理、Kubernetes、独立 MySQL、JWT 网关。以上在代码与部署台账中均无对应实现，V2.0 不再作为技术约束。

---

## 第 15 章 系统架构拓扑

### 15.1 端侧

【已实现】
- 主包 19 页 + 4 个分包（`pkgAdmin` 8 页、`pkgAgreement` 1 页、`pkgPrivacy` 1 页、`pkgLow` 16 页），合计 45 页。
- 自定义 tabBar（4 项：首页/广场/消息/我的）。
- 全局组件：`night-mask`、`empty-state`、`bottom-sheet`。
- 自定义组件 25 个（含全局组件，见 §9.1）。
- 工具层：`utils/bootstrap.js`（登录态）、`utils/redline.js`（红线）、`utils/report.js`（上报）、`config/index.js`（时效与阈值）、`config/enums.js`（枚举 SSOT）。

### 15.2 云函数（20 个业务函数）

| 云函数 | 职责 | 备注 |
|---|---|---|
| `user-login` | 登录、资料、头像、手机号/密码/短信 | 20 个 action |
| `partner-apply` | 耍伴认证申请与资料 | 审核快照 |
| `partner-action` | 耍伴工作台、接单配置、考试/学习 | 17 个 action |
| `demand-publish` | 发布/编辑/草稿/详情/我的需求/取消 | 含公益与计价 |
| `demand-match` | 大厅、Top5、报名、确认接单、邀请、广播 | 撮合核心 |
| `order-create` | 签字校验、下单 | 前置校验 |
| `order-action` | 状态机流转、生命周期、争议、催办/查询 | `index.js` + 9 个 `action_*.js` |
| `order-timer` | 超时、自动评价、提醒、巡检 | 每 30 分钟 |
| `payment-mock` | 模拟支付/退款/提现/打赏 | 13 个 action，`is_mock=true` |
| `evaluation-submit` | 评价提交与默认星级 | — |
| `im-conv` | 会话、消息拉取、客服会话 | — |
| `im-send` | 发文本/模板/客服消息 | 内容安全 + 频控 |
| `safety-report` | SOS、静默求助、报平安、举报、自由求助 | 11 个 action |
| `home-action` | 首页聚合、广场、场景、附近、活动 | — |
| `blog-action` | 博客发布/列表/详情/点赞/评论 | 11 个 action |
| `admin-action` | 后台全部业务 action | 101 个 action（33 个 `action_*.js`；102 个导出键 − 1 个测试辅助 `readImageDims`），RBAC |
| `admin-web` | 后台 HTTP 网关 | 鉴权 + 转发 |
| `init-db` | 建集合/索引/种子/诊断/环境/密钥 | 9 个 action（含 `run_seed`；无 action 时默认执行 `run_seed`），仅运维 |
| `zz-seed-orders` | 造数（测试） | 11 个 action，20s 超时 |
| `zz-warmup` | 云函数保温 | 每 15 分钟 |

【已实现】`_shared/` 为跨函数规范源（状态机、场景、金额、超时提醒等），通过 `sync-*.ps1` 同步并由 `check-shared-sync` 守护。

### 15.3 数据与集成

【已实现】云数据库 38 个集合（见 §16）；云存储；订阅消息；微信内容安全；腾讯位置服务（`apis.map.qq.com`，已配置合法域名）。

【未实现】外部支付、保险、实名、短信、IM、地图之外的三方系统集成。

---

## 第 16 章 数据库设计

### 16.1 集合清单（38 个）

【已实现】`init-db` 声明 31 个：

`user_account`、`partner_profile`、`demand`、`order_main`、`order_confirmations`、`order_status_log`、`pay_transaction`、`im_conversation`、`im_message`、`safety_report`、`credit_score_log`、`emergency_contact`、`evaluation`、`settlement`、`platform_event`、`admin_config`、`disclaimer_signature`、`withdraw_record`、`demand_draft`、`withdraw_lock`、`system_notice`、`insurance_record`、`audit_log`、`admin_accounts`、`no_show_report`、`complaint`、`questions`、`exam_sessions`、`certificates`、`study_records`、`study_content`。

【已实现】代码运行时另建/使用的 7 个：

`admin_web_sessions`、`exam_bank`、`config_history`、`blog_post`、`blog_like`、`blog_comment`、`legal_doc`。

### 16.2 设计约定

【已实现】
- 主键 `_id`；业务单号 `order_no` / `demand_no`。
- 软删：`is_deleted` + `deleted_at`。
- 时间：毫秒时间戳整数（展示层转 UTC+8）。
- 金额：整数「分」，双整数运算。
- 索引：`init-db` 的 `INDEXES` 为**设计台账**；云开发 SDK 无 `listIndexes`，无法回读真实索引，恢复时需人工在控制台按台账重建。
- 唯一索引：`order_main.order_no` 必须存在唯一索引（防重复单号）。

### 16.3 与 V1 的差异

【已废弃】V1 的 MySQL 表结构、SQL DDL、外键、事务隔离级别描述不适用于云数据库；V2.0 以集合 + 字段约定为准。

【待确认】完整字段级数据字典未在本次核对中逐字段产出；V1 附录 E 仅覆盖用户注册与维护字段，其余集合字段以 `_shared` 与各云函数写入结构为准。

---

## 第 17 章 接口设计规范

### 17.1 小程序侧协议

【已实现】统一调用形态：

```js
wx.cloud.callFunction({
  name: '<cloudFunctionName>',
  data: { action: '<action>', ...payload }
})
```

【已实现】统一返回：`{ ok: boolean, code?: string, msg?: string, data?: object }`；失败以 `code` 区分（如 `oa_legacy_retired`、`publish_welfare_not_open`、`sr_checkin_too_frequent`）。

【已实现】鉴权：云函数从上下文取 `OPENID`，不信任前端传入身份；管理类 action 额外校验角色。

### 17.2 后台侧协议

【已实现】`admin-web` 网关：Header `X-Admin-Key` + 登录后会话票据；请求体 `{ action, ... }`；网关校验后转发 `admin-action`；失败写 `platform_event`（`gateway_bad_key`）。

【已实现】密钥归一化：`trim` + 剥离 `AWK_KEY=` 前缀，避免整行粘贴导致 401。

### 17.3 与 V1 的差异

【已废弃】V1 的 RESTful 资源路由、JWT、OAuth2、OpenAPI 文档不适用；V2.0 以 action 协议为准。

【未实现】接口版本号、幂等键统一头、限流网关、开放平台 API。

---

## 第 18 章 安全与风控设计

### 18.1 数据安全

【已实现】
- 敏感字段 AES-256-GCM 加密（身份证、银行卡等）。
- 手机号：`phone_mask` 展示 + `phone_hash`（HMAC）索引，不明文检索。
- 传输：HTTPS；云开发内网调用。
- 存储：云存储文件按权限读取。

### 18.2 访问控制

【已实现】
- 小程序：openid 上下文鉴权；订单参与方校验（非参与方不可读写）。
- 后台：`X-Admin-Key` + 会话票据 + R1/R2/R3 RBAC；登录失败锁定与审计。
- 管理页：包内 `pages-v2/admin/*` 需管理员身份，失败跳登录。

### 18.3 内容与行为风控

【已实现】违禁词、`msgSecCheck`、红线规则、IM 频控、设备/IP 审计字段、`platform_event` 告警、审计哈希链。

【未实现】图片/语音审核、设备指纹、行为序列模型、团伙识别。

---

## 第 19 章 降级策略与高并发兜底

### 19.1 降级

【已实现】
- 配置读取：本地缓存 + 默认值链（后台不可用时用默认值，不阻断主链路）。
- 订阅消息：云调用失败 → HTTPS 直连 → 失败仅站内消息。
- 首页聚合：分区失败不拖垮整页（分区容错）。
- 定时器：单任务异常不影响其他 section（`Promise.allSettled`）。
- 网关：2.5 秒硬限，超时由前端提示重试。

### 19.2 并发

【已实现】
- 状态流转使用条件更新（CAS）防并发覆盖。
- 接单锁：`demand` 条件更新 + 唯一接单人。
- 提现锁：`withdraw_lock` 集合。
- 幂等：支付、SOS、催办、评价等关键写操作幂等。
- 子消息计数：点路径原子更新，避免整对象覆盖丢失兄弟 key。

【未实现】分布式锁服务、消息队列削峰、限流熔断、读写分离。

---

## 第 20 章 质量保障与自动化验证体系

### 20.1 门禁

【已实现】见 §12.2；基线为 `tests 866 / pass 866 / fail 0`、`A/B EQUIVALENT: 456 cases`、`verify:offline EXIT=0`。

### 20.2 自动化测试

【已实现】
- 单元/契约：`node --test`，覆盖状态机、金额、超时、权限、入口契约。
- A/B 等价：拆分前后逐字节/逐行为对比，79 例已知演进。
- UI 自动化：miniprogram-automator 驱动页面断言（S2 文案、时区、栈满兜底等）。
- 冒烟：`home_probe_square` 等 5 项（1 项因数据不足 SKIP）。

### 20.3 发布与回滚

【已实现】
- 部署前 `git bundle` 归档 + `deploy-log` 记录回滚点。
- 云函数部署后 SHA256 回读比对。
- 后台静态托管 `--safe` 发布，禁用 `--prune`。
- 文档台账：CHANGELOG / FUNCTION-REGISTRY / HANDOFF / tech-debt。

【未实现】一键回滚脚本、灰度发布、蓝绿环境。

---

## 第 21 章 数据驱动的迭代机制

### 21.1 可用数据

【部分实现】
- 业务事件：`platform_event`（类型、级别、openid、路径、原因）。
- 审计：`audit_log`（后台操作、结果、哈希链）。
- 运营数据：订单/需求/评价/信用分集合可直接聚合（后台 Dashboard、Report）。
- 客户端：`utils/report.js` 轻量上报 + 微信官方分析。

### 21.2 迭代机制

【已实现】以台账驱动：
1. 问题 → `docs/HANDOFF-*.md` 待办编号。
2. 变更 → `docs/CHANGELOG.md` 一行记录（日期/内容/影响/回归结论）。
3. 功能 → `docs/FUNCTION-REGISTRY.md` 条目（功能/文件/验收步骤/状态/日期）。
4. 技术债 → `docs/tech-debt-inventory-*.md`（含重开条件）。

【未实现】指标看板、漏斗、留存、实验平台。

---

## 附录A 术语表

| 编号 | 术语 | 英文/别名 | 定义（V2.0 现状口径） |
|---|---|---|---|
| T001 | 需求方 | user / 发单人 | 发布需求并支付（模拟）的一方，账号以 `user_account.openid` 标识 |
| T002 | 耍伴 | partner | 通过认证并提供服务的一方，资料存 `partner_profile` |
| T003 | 需求 | demand | 一次服务请求，含场景、时间、地点、金额、匹配模式 |
| T004 | 订单 | order_main | 需求被接单后生成的履约凭证，承载状态机与资金位 |
| T005 | 四确认 | order_confirmations | 时间/地点/内容/费用四项、双方各一次，共 8 位 |
| T006 | 订单状态机 | order FSM | 代码实际 16 个 S 码，主轴 11 态，见附录 B/G |
| T007 | 模拟支付 | mock payment | `payment-mock` 生成 `is_mock=true` 的支付/退款流水，不产生真实扣款 |
| T008 | 信用分 | credit score | 初始 800、满分 1000、及格 600、冻结 400；用户/耍伴分字段 |
| T009 | 履约双端确认 | start/finish apply + confirm | 耍伴申请、需求方确认，中间态 S2_6 / S3_6 |
| T010 | 红线 | redline | 去暧昧与违规内容的客户端 + 服务端双重限制 |
| T011 | 平台事件 | platform_event | P0/P1 级业务与安全事件记录 |
| T012 | 审计哈希链 | audit_log | 后台写操作逐条链接，防篡改 |
| T013 | 公益单 | welfare order | 归入一口价，价格取后台 `welfare_fixed_price_fen`，未配置不可发布 |
| T014 | 自由求助 | free SOS | 无订单场景下的紧急求助，10 分钟冷却 |
| T015 | 耍伴认证 | partner apply | 实名 + 资料 + 考试，审核快照只读展示 |

## 附录B 订单状态机流转图（按代码订正）

```text
S1 待确认 ──四确认完成──> S0 待支付 ──支付(模拟)──> S2 已支付待履约
   │                        │                         │
   └──15min 超时/取消──> S6  └──30min 超时──> S6       ├──耍伴 start_apply──> S2_6
                                                       │        ├──需求方 start_confirm──> S3
                                                       │        └──首次拒绝──> S2；连续2次/超时──> S10.5
                                                       ├──改期(S2 可发起)──> S2_5 ──确认/拒绝/超时──> S2
                                                       ├──取消/退款──> S10 / S7
                                                       └──争议──> S10 -> S10.5

S3 履约中 ──耍伴 finish_apply──> S3_6
   ├──需求方 finish_confirm──> S5 已完成
   ├──首次拒绝──> S3；连续2次/超时──> S10.5
   └──履约中断──> S3.5 ──24h 默认──> S4 部分完成 ──> S5

S5 已完成 ──48h 未评价──> 系统默认 4 星（落库状态见 §4.1 冲突说明）
S5 ──用户评价──> S8 已评价
S8 / S9 ──> S10 已关闭
S7 已退款 ──> S10
S10 ──> S10.5 争议处理中 ──> S5 / S7
```

【说明】S9 在 `order_state.js` 中列为 `LEGACY_STATES`（存量兼容），但 `order-timer/action_lifecycle.js:86` 自动评价仍写入 S9；该矛盾未在代码层收口，列入附录 U。

## 附录D 外部依据与检索来源

> 编号说明：V1 正文仅有 A/B/D/E 四个附录标题，本身不存在附录 C；为保持 V1 编号连续性，V2.0 不新增 C，直接沿用 D 起的编号。

【沿用】V1 附录 D 的行业检索来源仍作为**立项背景**保留，但其中涉及真实支付、保险投保、人脸核身、Redis/MQ/ES/OSS/K8s 的条目已因「未落地」而**不再作为现状依据**。

【现状依据】本项目 V2.0 的事实来源以 §0.4 所列代码与台账为准，不以外部资料推断实现状态。

## 附录E 用户注册与维护字段对照表

【已实现】`user_account` 新建时的实际字段（`cloudfunctions/user-login/action_account.js:39-46`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `openid` | string | 微信 openid，账号主键关联 |
| `nickname` | string | 默认「微信用户」 |
| `avatar` | string | 头像地址（`cloud://` 或 `https://`） |
| `roles` | array | 当前为 `['user']`；耍伴身份由 `partner_profile` 体现 |
| `user_credit_score` | int | 需求方信用分，初始 800 |
| `partner_credit_score` | int | 耍伴信用分，初始 800 |
| `is_realname_done` | bool | 实名是否完成 |
| `is_realname_simulated` | bool | 是否模拟实名（当前新建账号为 true） |
| `age` | int/null | 年龄（用于青少年限额） |
| `status` | string | `normal`/`frozen`/`banned`/`closed` |
| `register_source` | string | 当前为 `mvp` |
| `created_at` / `updated_at` | int | 毫秒时间戳 |
| `is_deleted` | bool | 软删标记 |

【已实现】手机号相关：`phone`（密文）、`phone_mask`（脱敏展示）、`phone_hash`（HMAC 匹配）；身份证：`idcard`（密文）+ `idcard_masked`。

【待确认】`partner_profile` 与其余集合的完整字段字典未逐字段产出，以各云函数写入结构为准。

## 附录F 术语表（SSOT 精简版）

| 概念 | 唯一口径 | 禁止写法 |
|---|---|---|
| 金额 | 整数「分」，双整数运算 | 浮点元、字符串金额 |
| 订单状态 | 附录 B/G 的 S 码 | V1 的「13 态」 |
| 四确认 | 8 位，变更即全重置（费用变更例外） | 「双方确认一次」 |
| 信用分 | 800/1000/600/400 | 自定义分段 |
| 支付 | 模拟支付，`is_mock=true` | 「已接入微信支付」 |
| 人脸 | `realname_face_mode=mock` | 「已实人认证」 |
| 场景 | 云端 `admin_config.scene_list` | 前端硬编码 9 个 |
| 分成 | `platform_fee_rate_fen` 万分比，默认 1000 | 固定 20% |

## 附录G 订单状态机转移矩阵（按代码订正）

【已实现】核心合法边（规则 + 代码核对；完整逐条矩阵以 `order-action/order_state.js` 为准）：

| 起始态 | 合法去向 | 触发 |
|---|---|---|
| S1 待确认 | S0、S6 | 四确认完成 / 15 分钟超时或取消 |
| S0 待支付 | S2、S6 | 模拟支付成功 / 30 分钟超时 |
| S2 已支付待履约 | S2_6、S2_5、S3、S7、S10 | 开始申请 / 改期 / 直接履约 / 退款 / 关闭 |
| S2_6 开始确认中 | S3、S2、S10.5 | 需求方确认 / 首次拒绝 / 连续 2 次或超时 |
| S2_5 改期处理中 | S2 | 确认、拒绝或超时 |
| S3 履约中 | S3_6、S3.5、S5、S10 | 完成申请 / 中断 / 完成 / 争议关闭 |
| S3_6 完成确认中 | S5、S3、S10.5 | 需求方确认 / 首次拒绝 / 连续 2 次或超时 |
| S3.5 履约中断 | S3、S4 | 恢复 / 24 小时默认部分完成 |
| S4 部分完成 | S5 | 确认完成 |
| S5 已完成 | S8、S9 | 用户评价 / 48 小时系统默认评价 |
| S8 已评价 | S10 | 关闭 |
| S9 评价超时（存量） | S10 | 关闭 |
| S7 已退款 | S10 | 关闭 |
| S10 已关闭 | S10.5 | 发起争议 |
| S10.5 争议处理中 | S5、S7 | 裁定恢复 / 裁定退款 |
| S6 已取消 | 终态 | — |

【待确认】上表为「核心边」汇总，未穷举代码中所有条件分支（如部分完成、加时、催办等旁路）；以 `order_state.js` 为最终真值。

## 附录H 上线前置合规自查清单

【已实现·实测】以 `docs/runbooks/release-zero-checklist.md` 为准：

| 项 | 状态 |
|---|---|
| B-1 隐私保护指引通过 | ✅ 2026-11-04 |
| B-2 位置接口开通 | ✅ 2026-11-04 |
| B-3 request 域名与 urlCheck | ✅ 2026-11-04 |
| B-4 可提审体验版包 | ✅ 2026-11-08（v1.6.98，811,890 B） |
| 2.3 提交审核 | ⬜ |
| 2.4 备案表 F1~F6 一致 | ⬜ |
| 4.2 隐私指引 11 项填报 | ⏸ 待后台 |
| 4.5 人脸保持 mock | ✅ 已拍板 |
| 4.6 模拟支付保持开启 | ✅ 已拍板 |
| 4.7 审计真删 | ✅ |
| 4.8 测试数据清理 | ✅ |

## 附录I 风险登记册

【已实现】见第 13 章 R1–R9。V2.0 不再单列 V1 的 ZP 编号风险表；如后续需要编号化管理，应以第 13 章为基线重新编号。

## 附录J 规则字典（可配置规则集）

【已实现】规则以 `admin_config` 为运行时 SSOT，字段定义见 `cloudfunctions/admin-action/config_schema.js`。核心可配置规则：

| 规则 | 配置键 | 默认值 |
|---|---|---|
| 最低/最高时薪 | `rate_min_fen` / `rate_max_fen` | 3000 / 10000 分 |
| 场景默认时薪 | `scene_default_rate_fen` | 5000 分 |
| 平台抽成 | `platform_fee_rate_fen` | 1000（10%） |
| 公益时薪 / 公益一口价 | `welfare_hourly_rate_fen` / `welfare_fixed_price_fen` | 3000 分 / 留空（不可发布） |
| S1 超时 | `s1_timeout_min` | 15 分钟 |
| S0 超时 | `s0_timeout_min` | 30 分钟 |
| 履约中断超时 | `interrupt_timeout_h` | 24 小时 |
| 评价窗口 | `eval_window_h` | 48 小时 |
| 默认评价星级 | `default_star` | 4 星 |
| 开始履约确认超时 | `start_apply_timeout_min` | 15 分钟 |
| 完成履约确认超时 | `finish_confirm_timeout_min` | 30 分钟 |
| IM 频控窗口/条数 | `im_rate_window_min` / `im_rate_max_count` | 5 分钟 / 30 条 |
| 爽约申诉窗口 | `no_show_report_window_h` | 48 小时 |
| 爽约举证窗口 | `no_show_defense_window_h` | 48 小时 |
| 爽约提醒延迟 | `no_show_grace_min` | 30 分钟 |
| 爽约扣分 | `no_show_score_deduct` | 20 分 |
| 爽约停用阈值/天数/窗口 | `no_show_suspend_threshold` / `no_show_suspend_days` / `no_show_count_window_days` | 3 次 / 7 天 / 180 天 |
| 改期规则 | `modifyMinLeadHours` / `modifyMaxTimes` / `modifyMaxSpanH` | 以云端回读为准（本轮未逐项回读） |
| 模拟支付开关 | `mock_payment_enabled` | schema 默认 false；线上运营值为 true（提审期保持） |
| 实名模式 | `realname_face_mode` | mock |
| 环境 | `env` | prod |
| 审计真删 | `audit_prune_dry_run` | false |

【说明】以上默认值取自 `config_schema.js` 与发布清单云端回读；线上以 `admin_config` 实际值为准。

## 附录K 非功能需求汇总表

【已实现/待确认】见第 10 章。汇总：

| 维度 | 现状 | 结论 |
|---|---|---|
| 性能 | 无基线 | 待测 |
| 可用性 | 单环境 | 无多地域容灾 |
| 可观测 | 事件 + 审计 + 日志 | 无指标大盘与告警到人 |
| 安全 | 加密、脱敏、RBAC、审计链 | 无 WAF/防重放 |
| 容量 | 云开发按量 | 配额暂缓加购 |
| 备份 | 自动备份失效 | 仅 2026-11-07 全量副本 |

## 附录L 废止条款存档

【已废弃】以下 V1 条款在 V2.0 中不再有效：

| # | 废止内容 | 依据/替代 |
|---|---|---|
| L1 | 订单 13 态（S0–S10 + S3.5/S10.5） | 16 个 S 码，附录 B/G |
| L2 | 评价超时独立状态 S9 的「新单路径」 | S9 列为存量兼容，但自动评价仍写 S9（待统一） |
| L3 | 定金 + 尾款两段支付 | 预付全款（模拟） |
| L4 | 真实微信支付、平台分账、二清、T+0 | `payment-mock` |
| L5 | 真实人脸核身 | `realname_face_mode=mock` |
| L6 | 保险按单实投 | 仅 `insurance_record` mock |
| L7 | AI 五维风控、心理危机识别 | 无实现 |
| L8 | B 端机构账号、批量订单、主子单 | 无实现，机构登录入口已取消 |
| L9 | 会员/积分/成长任务 | 无实现 |
| L10 | TRTC 音视频线上陪伴 | W11 仅文字/任务陪伴 |
| L11 | Redis/RocketMQ/ES/OSS/GPU/K8s | 未采用 |
| L12 | MySQL 表结构 + SQL DDL | 云数据库 NoSQL |
| L13 | RESTful + JWT/OAuth2 | 云函数 action 协议 |
| L14 | W5 探店、W6 演出 | 已终止不做 |
| L15 | 旧履约直连 `start_service`/`complete_service` | 墓碑守卫 `oa_legacy_retired` |
| L16 | 机构登录入口 | 已注释取消 |

## 附录M 参数总表

【已实现】关键参数见附录 J；补充：

| 参数 | 值 | 出处 |
|---|---|---|
| 云开发环境 | `cloud1-d9gkefwcp5c777088` | 项目配置 |
| 云函数运行时 | Node.js 16.13 | 云端运行时 |
| 订单定时器 | 每 30 分钟，超时 60s | `order-timer/config.json` |
| 保温定时器 | 每 15 分钟（7–22 时） | `zz-warmup/config.json` |
| 造数函数超时 | 20s | `zz-seed-orders/config.json` |
| 网关硬限 | 2.5s | 实测 |
| 信用分 | 800 / 1000 / 600 / 400 | `config/index.js` |
| 信用等级日限 | 10 / 15 / 20 / 25 单 | `config/enums.js` |
| 青少年单笔上限 | 200 元 | 平台红线 |
| 审计保留 | 90 天，单日上限 5000 条 | `audit_prune` |
| 规则文件上限 | 30720 B | `check-rules-size` |

## 附录N 线上陪伴场景专章

【已实现】W11 线上陪伴已开放，服务项：`树洞倾听`、`游戏陪玩`、`打卡监督`；免责文案为《线上陪伴内容协议》，明确不提供心理咨询、医疗建议、法律援助，禁止转账借贷与敏感信息交换。

【未实现】V1 附录 N 的 TRTC 语音/视频通话、通话录制（90 天加密留存）、实时内容审核均无实现。当前为文字陪伴 + 任务打卡。

【待确认】是否引入音视频能力、如何满足录制留存合规，列入附录 U。

## 附录O 场景调整说明

【已实现】
- 当前白名单 9 个：W1、W2、W3、W4、W7、W8、W9、W10、W11。
- W4/W7/W9 于 2026-09-22 放开。
- W5 探店、W6 演出已终止不做。
- 前端 `config/enums.js` 注释标注 W3 当前隐藏、W2 为后台隐藏场景；实际可见性以云端 `scene_list` 的 `visible` 与服务项配置为准。
- 场景顺序 = 云端 `scene_list` 数组序，后台可调。

## 附录P 健身陪伴场所扩展说明

【待确认】V1 对 W3 健身陪伴的场所扩展（健身房/公园/居家）为规划描述；代码侧仅见场景服务项配置，未检索到「场所扩展」独立开关或校验逻辑。是否已废弃，需产品确认。

## 附录Q 陪诊场所扩展说明

【待确认】W1 就医陪诊已上线，但 V1 的「场所扩展」细则（医院类型、科室限制、陪同边界）在代码中未检索到独立实现；现有约束以免责声明与红线规则为准。需产品与合规确认。

## 附录R 项目创新分析

【沿用】V1 附录 R 为立项论证与创新点分析，属于**论述性内容**，不构成功能现状。V2.0 保留其参考价值，但涉及「AI 风控」「智能匹配」「保险闭环」「机构 B 端」的创新表述，均应以第 3/13 章的「未实现·规划」标注为准。

## 附录S V1 → V2.0 冲突与作废对照（V2.0 新增）

§0.5 已列 15 条总览；此处补充「处理方式」：

| # | 冲突 | 处理方式 |
|---|---|---|
| 1 | 13 态 vs 16 S 码 | 以代码为准，V1 状态图作废 |
| 2 | S9 评价超时 | 标为存量兼容，自动评价落库矛盾待统一 |
| 3 | 技术栈 | V1 选型作废，改按实际云开发 |
| 4 | 数据库 | V1 SQL 作废，改 NoSQL 集合 |
| 5 | 接口 | V1 REST/JWT 作废，改 action 协议 |
| 6 | 真实支付/分账 | 标未实现，仅 mock |
| 7 | 人脸核身 | 标未实现，仅 mock |
| 8 | 保险实投 | 标未实现，仅 mock 记录 |
| 9 | AI 风控/心理识别 | 标未实现 |
| 10 | 机构/主子单 | 标未实现，入口已取消 |
| 11 | 会员体系 | 标未实现 |
| 12 | TRTC 陪伴 | 标未实现，W11 仅文字 |
| 13 | 四确认前禁发消息 | 与实现一致，保留 |
| 14 | 定金+尾款 | 标作废，改预付全款（模拟） |
| 15 | 公益订单 | V1 未写清，V2 补为已实现（fail-closed） |

## 附录T 功能实现核对总表（V2.0 新增）

> 全量 153 条已验证功能见 `docs/FUNCTION-REGISTRY.md`；本表按功能域汇总实现状态，代表条目编号仅列已在本轮核对中出现的编号。

| 功能域 | 状态 | 说明 | 代表条目 |
|---|---|---|---|
| 登录与账号 | 已实现 | 微信一键登录；短信/手机号/密码仅服务端 | #52 |
| 实名与认证 | 部分实现 | 实名资料 + mock 人脸；耍伴认证/考试 | — |
| 需求发布 | 已实现 | 场景/计价/公益/AA/代发/草稿/免责签字 | — |
| 撮合匹配 | 已实现 | 大厅/Top5/报名/确认/邀请/广播/接单锁 | #17、#18、#90、#92 |
| 订单状态机 | 已实现 | 16 S 码；双端履约确认 | #61、#66、#67、#69、#127 |
| 支付与退款 | 部分实现 | 全 mock，`is_mock=true`；提现 mock | — |
| 履约确认 | 已实现 | S2_6/S3_6 双端确认 + 证据前置 | #61、#66、#69 |
| IM | 已实现 | 会话/文本/模板/客服/频控/内容安全 | #60 |
| 安全求助 | 已实现 | SOS/静默/报平安/举报/自由求助 | — |
| 评价与信用 | 已实现 | 评价、默认 4 星、双信用分、等级日限 | #32、#33 |
| 后台运营 | 已实现 | 32 视图 + 101 action + R1/R2/R3 | #35 |
| 发布与运维 | 已实现 | 门禁、备份脚本、部署台账（备份当前失效） | — |
| 前端体验 | 已实现 | 导航兜底、tabBar switchTab、骨架/空态 | 2026-11-08 复扫 |
| 保险 | 未实现 | 仅 mock 记录 | — |
| AI 风控/心理识别 | 未实现 | 无模型 | — |
| 机构 B 端/主子单 | 未实现 | 无代码 | — |
| 会员/积分 | 未实现 | 无代码 | — |
| TRTC 音视频 | 未实现 | W11 仅文字 | — |
| 全链路埋点 | 部分实现 | 轻量上报 + 平台事件 | — |

## 附录U 未落地规划与待确认清单（V2.0 新增）

### U.1 未落地规划（代码无实现）

| # | 规划项 | 依据 |
|---|---|---|
| U1 | 真实微信支付、平台分账、二清、T+0 提现 | `payment-mock` 仅模拟 |
| U2 | 真实人脸核身 | `realname_face_mode=mock` |
| U3 | 保险按单实投、保单回执、理赔 | 仅 `insurance_record` |
| U4 | AI 五维风控、心理危机识别 | 无模型/无代码 |
| U5 | B 端机构账号、批量订单、主子单 | 无角色/无集合 |
| U6 | 会员体系、积分商城、成长任务 | 无代码 |
| U7 | TRTC 音视频陪伴、通话录制留存 | W11 仅文字 |
| U8 | 全链路埋点、漏斗、留存、A/B 实验 | 仅轻量上报 |
| U9 | 多地域容灾、灰度/蓝绿发布 | 单环境 |
| U10 | 图片/语音内容审核 | 仅文本 `msgSecCheck` |

### U.2 待确认（口径冲突或证据不足）

| # | 待确认项 | 冲突/缺口 | 建议动作 |
|---|---|---|---|
| C1 | 自动评价落库 S9 还是 S8 | `order_state.js` 列 S9 为退役，`action_lifecycle.js:86` 仍写 S9 | 代码负责人统一口径后回写附录 B/G |
| C2 | 隐私指引状态 | B-1「已通过 2026-11-04」与 4.2「11 项待填报 2026-11-08」并存 | 以 mp 后台状态为准，核对后再提交 |
| C3 | 前端登录方式 | 服务端有短信/手机号/密码，前端仅一键登录 | 产品确认本期是否开放 |
| C4 | 公益单是否对外开放 | 取决于 `welfare_fixed_price_fen` 是否配置 | 运营回读 `admin_config` |
| C5 | W3 健身陪伴可见性 | 前端注释「当前隐藏」，云端白名单含 W3 | 运营确认 `scene_list.visible` |
| C6 | W2 学习陪伴可见性 | 前端注释「后台隐藏场景」 | 同上 |
| C7 | 附件 P/Q 场所扩展 | 代码未检索到独立实现 | 产品确认是否仍保留 |
| C8 | 18–22 岁上限字段名 | 规则明确 200 元，本次未核到具体配置键名 | 以 `config_schema.js` 实测为准 |
| C9 | 用户名下 `roles` 与 `role` | 新建账号写 `roles:['user']`，其他处见 `role:'user'` | 统一字段口径 |
| C10 | 提审提交与备案表 | 清单 2.3/2.4 未完成 | 人工执行 |
| C11 | 自动备份恢复 | H 盘不存在、任务未注册 | 用户批准后重建 |
| C12 | 性能基线 | 无首屏/包体/P95 实测 | 立项测量 |
| C13 | iOS/Android 机型矩阵 | 清单只记录逐项结论 | 补机型记录 |
| C14 | 规则文件配额 | 已满额，新增需等量补偿 | 按 `check-rules-size` 执行 |

---

**文档结束**

> V2.0 仅描述 2026-11-08 磁盘代码与台账可实证的状态；未实证内容一律进入附录 U。V1 原文出处见文首「V1 原文出处」：`PRD_v15.1.md`（V15.1，9,707 行）或 `git show de85424:PRD/PRD.md`（V15，9,702 行）；无单独备份文件。
