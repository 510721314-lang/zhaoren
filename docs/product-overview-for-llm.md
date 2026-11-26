# 找人帮忙（zhaoren）· 产品与技术配置简述

> 用途：供大模型理解本产品时投喂的简明事实卡。
> 生成日期：2026-11-26
> 数据来源：仓库实证文件（project.config.json / miniprogram/app.json / envList.js / config/index.js / cloudfunctions/_shared/scene_meta.js / cloudfunctions/admin-action/action_export.js / PRD/PRD.md），非凭记忆编写。
> 注意：标注「规划/未实现」的能力不在此列，本文只描述**已落地**的现状。

---

## 一、项目概况

| 项 | 值 | 出处 |
|---|---|---|
| 产品名 | 找个人帮忙（生活服务信息撮合微信小程序） | PRD/PRD.md |
| AppID | `wxbc4a4afacdf234f5` | project.config.json L7 |
| 微信云开发环境 ID | `cloud1-d9gkefwcp5c777088` | miniprogram/envList.js L3（全项目唯一来源） |
| 适用端 | 微信小程序端（原生）+ admin-web 运营后台 | PRD §0 |
| 基础库版本 | 3.4.10 | project.config.json L6 |
| 体验版版本 | v1.6.x | PRD 记录 v1.6.98 |
| 云开发 HTTP 网关 | `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api` | cloud-backup-restore 技能常量 |

## 二、技术栈 / 开发环境

- **前端**：原生微信小程序（WXML / WXSS / JS），无前端框架；`style: v2`、`darkmode: true`、`lazyCodeLoading: requiredComponents`。
- **后端**：微信云开发云函数（`wx-server-sdk ^4.0.2`），Node.js；接口形态统一为 `wx.cloud.callFunction({ name, data:{ action } })`。
- **数据库**：云开发文档型数据库（类 MongoDB），共 **38 个集合**，白名单权威定义见 `cloudfunctions/admin-action/action_export.js` L4-24。
- **运营后台**：admin-web（Vue SPA），走云开发 HTTP 网关 + `admin_web_key` 会话票据鉴权（token 12h）。
- **测试与门禁**：`node:test` 零依赖单测 + `miniprogram-automator` E2E；`npm run verify:offline` 串联 28 项静态扫描门禁 + A/B 等价性 473 用例。
- **部署**：tcb CLI（`@cloudbase/cli` 3.x）+ 微信开发者工具 `cli.bat`；云函数代码下载/部署走 tcb（不依赖 DevTools 登录态）。

## 三、数据配置（配置驱动）

- **运行时 SSOT**：云端 `admin_config` 集合（doc `global`），运营可改；前端启动拉取 `config_public` 覆盖本地兜底值。前端 `miniprogram/config/index.js` 仅作本地兜底，标 `V15.1 可运营参数唯一来源`。
- **场景白名单**：9 个场景码，以 `admin_config.scene_list` 为准（运营可改名/新增）：

  | 码 | 中文名 | 码 | 中文名 |
  |---|---|---|---|
  | W1 | 就医陪诊 | W7 | 情绪陪伴 |
  | W2 | 学习陪伴 | W8 | 生活协助 |
  | W3 | 健身陪伴 | W9 | 宠物陪伴 |
  | W4 | 游玩陪伴 | W10 | 出行陪伴 |
  | | | W11 | 线上陪伴 |

  兜底映射见 `cloudfunctions/_shared/scene_meta.js`。

- **数据库 38 集合**：
  `admin_config`、`admin_web_sessions`、`user_account`、`partner_profile`、`demand`、`demand_draft`、`order_main`、`order_status_log`、`order_confirmations`、`emergency_contact`、`credit_score_log`、`platform_event`、`audit_log`、`system_notice`、`disclaimer_signature`、`evaluation`、`blog_post`、`blog_like`、`blog_comment`、`safety_report`、`im_conversation`、`im_message`、`withdraw_record`、`exam_bank`、`config_history`、`no_show_report`、`complaint`、`user_profile`、`partner_exam`、`partner_apply`、`dispute`、`withdraw_request`、`credit_log`、`insurance_record`、`report`、`sms_log`、`device_bind`、`legal_doc`。

- **订单状态机**：16 个 S 码（S0 待支付 → S10.5 争议处理中，含 S2_5/S2_6/S3_6/S3.5/S4 等中间态）。
- **金额单位**：分（双整数，前端展示除以 100），禁止浮点运算。
- **信用分**：初始 800 / 满分 1000 / 及格线 600 / 冻结线 400。
- **模拟能力（非真实）**：
  - 支付：全链路走 `payment-mock`，打 `is_mock=true`，收银台显著提示「模拟支付，不产生真实扣款」。
  - 人脸核验：`realname_face_mode = mock`，无真实人脸对接。
- **安全合规**：敏感字段（手机/证件/姓名/openid）云端导出脱敏；密钥（`idcard_aes_key` / `admin_web_key`）只存存在性布尔，不返回值；`export_*` 需 `confirm:true` 二次确认。

## 四、云函数清单（21 个可部署 + 1 个共享模块）

目录根：`cloudfunctions/`（project.config.json 指定 `cloudfunctionRoot`）。`_shared/` 为跨函数共享模块（非独立部署，由 sync 脚本分发副本并由 SHA-256 门禁守护一致性）。所有函数均具备 `index.js + package.json + config.json` 最小部署集合。

### 业务函数（18 个）

| 云函数 | 职责 | 触发方式 |
|---|---|---|
| `user-login` | 用户登录 / 登录态 / 个人资料 | callFunction |
| `partner-apply` | 耍伴入驻申请 | callFunction |
| `partner-action` | 耍伴动作（接单、资料、接单配置） | callFunction |
| `demand-publish` | 需求发布 / 更新 / 草稿 | callFunction |
| `demand-match` | 需求匹配 / 抢单 / 选单 | callFunction |
| `order-create` | 订单创建（预付） | callFunction |
| `order-action` | 订单状态机流转（16 态：确认/履约/取消/评价等） | callFunction |
| `order-timer` | 订单超时定时任务（S1 15min / S0 30min / S5 48h 等） | 定时触发器 |
| `payment-mock` | 模拟支付收银台 | callFunction |
| `evaluation-submit` | 评价提交 | callFunction |
| `home-action` | 首页数据（附近 / 场景 / 服务） | callFunction |
| `blog-action` | 博客（发帖 / 点赞 / 评论 / 列表） | callFunction |
| `im-conv` | IM 会话管理 | callFunction |
| `im-send` | IM 消息发送（含安全检测） | callFunction |
| `safety-report` | 安全报备 / 紧急求助 | callFunction |
| `admin-action` | 运营后台动作（配置读写 / 备份导出导入 / 首页活动 / SOP / 统计） | callFunction（由 admin-web 代理） |
| `admin-web` | admin-web 后台 HTTP 代理层（Vue SPA 静态服务 + 鉴权 + proxy admin-action） | HTTP 网关触发 |
| `init-db` | 数据库初始化（建集合 / 建索引 / 种子数据 / 诊断） | callFunction（人工触发） |

### 测试 / 运维辅助函数（3 个，`zz-` 前缀）

| 云函数 | 职责 | 触发方式 |
|---|---|---|
| `zz-warmup` | 云函数保温（防冷启动） | 定时触发器 |
| `zz-openapi-probe` | 云开发 openapi 能力探针 | callFunction |
| `zz-seed-orders` | 种子订单夹具注入（测试用） | callFunction |

## 五、页面路由（共 39 页：主包 20 + 分包 19）

权威来源：`miniprogram/app.json`。启动页 `entryPagePath = pages-v2/index/index`；`tabBar` 为自定义（`custom: true`）。

### TabBar（5 个，主包）
首页 / 广场 / 服务 / 消息 / 我的 → `pages-v2/{index,square,service,message,profile}/...`

### 主包页面（20 页）
`index`、`square`、`service`、`message`、`profile`、`login`、`publish`、`demand-detail`、`nearby-list`、`nearby-map`、`partner-detail`、`chat`、`pay`、`order-detail`、`workbench`、`orders`、`my-demands`、`blog`、`blog-publish`、`blog-detail`（均位于 `pages-v2/` 下）

### 分包页面（3 个分包，共 19 页）

| 分包 root | name | 页数 | 页面 |
|---|---|---|---|
| `pages-v2/agreement` | pkgAgreement | 1 | agreement（用户协议） |
| `pages-v2/privacy` | pkgPrivacy | 1 | privacy（隐私指引） |
| `pages-v2/pkg-low` | pkgLow | 17 | wallet 钱包、credit 信用、contacts 紧急联系人、notices 通知、partner-apply 耍伴入驻、partner-profile-edit 资料编辑、accept-config 接单配置、activity-detail 活动详情、realname 实名、safety 安全中心、evaluate 评价、exam 考试、exam-status 考试状态、study 学习、kefu 客服、no-show-report 爽约举报、service-detail 服务详情 |

### 分包预加载规则
- 进入 `login` 页 → 预加载 `pkgAgreement` + `pkgPrivacy`（`network: all`）
- 进入 `profile` 页 → 预加载 `pkgLow`

### 平台能力声明
- 定位：`scope.userLocation`（`getLocation` / `chooseLocation`，用于履约距离与安全报备）
- 隐私：`__usePrivacyCheck__: true`（隐私协议检查已开启）
- 暗黑模式：`darkmode: true`
- 全局组件：`night-mask` / `empty-state` / `bottom-sheet`

---

## 附：真值优先级（供大模型引用时参考）
云端回读（tcb）> 仓库台账（docs/）> 文档描述。本文档数值取自仓库文件，若与云端 `admin_config` 实际值冲突，以云端为准。
