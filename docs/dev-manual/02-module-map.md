# Ch2 · 目录与模块地图

> 事实来源：仓库实测枚举（2026-10）。完整 action 清单、`_shared` 副本映射、页面→云函数映射见 [00-factbase.md](file:///c:/zhaoren/docs/dev-manual/00-factbase.md) §1b/§2b/§3b。

## 2.1 仓库顶层结构

| 目录/文件 | 角色 |
|---|---|
| [miniprogram/](file:///c:/zhaoren/miniprogram) | 小程序端源码（`miniprogramRoot`） |
| [cloudfunctions/](file:///c:/zhaoren/cloudfunctions) | 云函数源码（`cloudfunctionRoot`），含 `_shared/` 规范源 |
| [admin-web-frontend/](file:///c:/zhaoren/admin-web-frontend) | 后台管理端 SPA 源码 |
| [scripts/](file:///c:/zhaoren/scripts) | 门禁与运维脚本 |
| [.predeploy/](file:///c:/zhaoren/.predeploy) | 预部署脚本（备份/恢复/冒烟） |
| [package.json](file:///c:/zhaoren/package.json) | 测试与门禁入口（零依赖，Node 内置 `node:test`） |
| [project.config.json](file:///c:/zhaoren/project.config.json) | 小程序项目配置（含 appid，勿外传） |
| [cloudbaserc.json](file:///c:/zhaoren/cloudbaserc.json) | 云开发环境配置（含 envId，勿外传） |

## 2.2 云函数层

共 **20 个业务云函数** + `_shared` 规范源。分发模式有两类：

- **HANDLERS 注册表 / `switch` / `if(action===)`**：单文件 `index.js` 内分发。
- **`action_*.js` 拆分**：巨型入口按 action 组抽离为同级文件，`index.js` 汇总。当前有两处：
  - `admin-action`：30 个 `action_*.js`（86 个 action）
  - `order-action`：7 个 `action_*.js`（32 个 action）

| 函数 | 职责 | action 数 |
|---|---|---|
| admin-action | 后台全部写操作 + 配置单一源（CONFIG_SCHEMA）+ 上传/导出/恢复导入 | 86 |
| admin-web | HTTP 网关：代理 admin-action、静态托管、admin_login 免 key 入口 | — |
| blog-action | 博客/资讯读写 | 11 |
| demand-match | 供需匹配（大厅/邀请/广播） | 7 |
| demand-publish | 需求发布/编辑/草稿 | 10 |
| evaluation-submit | 评价提交 + 信用分 | 2 |
| home-action | 首页聚合（场景分组缓存/附近/广场/活动） | 8 |
| im-conv | 会话列表/建会话 | 5 |
| im-send | 消息发送 | 3 |
| init-db | 数据库初始化/种子/环境切换/quick_check/lookup | 8 |
| order-action | 订单全生命周期写操作 | 32 |
| order-create | 下单（签约/接单结果校验） | 3 |
| order-timer | 定时任务（无 action，`exports.main` 直接执行扫描链） | — |
| partner-action | 耍伴侧操作（抢单/资质/上下线/考试） | 13 |
| partner-apply | 耍伴入驻申请 | 1 |
| payment-mock | 支付/退款/打赏/钱包 | 14 |
| safety-report | 安全上报（SOS/签到/举报） | 8 |
| user-login | 登录/身份/实名/地图共享 | 20 |
| zz-seed-orders | 种子订单批量注入（临时自测，勿部署） | 11 |
| zz-warmup | 首屏保温探针 | 1 |

> 完整 action 名逐条清单见 [00-factbase.md §1b](file:///c:/zhaoren/docs/dev-manual/00-factbase.md)。

## 2.3 `_shared` 多副本机制

微信云函数按**单目录打包**，无法跨函数共享依赖。项目采用**「规范源 + 复制 + SHA 门禁」**：

1. 规范源集中在 [cloudfunctions/_shared/](file:///c:/zhaoren/cloudfunctions/_shared)。
2. `sync-<module>.ps1` 把规范源复制到各消费者云函数目录（13 个同步脚本）。
3. [scripts/check-shared-sync.js](file:///c:/zhaoren/scripts/check-shared-sync.js) 校验各副本 SHA-256 与规范源一致，纳入 `npm run verify`。

**「模块 → 持有副本」映射（门禁权威口径）**：

| 模块 | 持有副本的云函数 |
|---|---|
| take_rules.js | order-create, demand-publish, order-action, home-action, partner-apply, partner-action |
| money_rules.js | payment-mock, order-create, order-action |
| test_data.js | demand-publish, order-create, admin-action, init-db |
| partner_audit.js | partner-action, admin-action |
| no_show_rules.js | order-action, admin-action |
| order_state.js | order-action, order-timer |
| urge_rules.js | order-timer, order-action |
| credit_rules.js | evaluation-submit, order-timer |
| scene_meta.js | payment-mock, im-send, im-conv, demand-publish, order-action, admin-action, home-action |
| phone_crypt.js | user-login, demand-publish, admin-action |
| logger.js | 16 个（含 order-action / order-timer / admin-action …） |
| audit.js | 11 个 |
| openid.js | 15 个 |

> **有意变体（不参与同步，改动需手工）**：`admin-action/openid.js`（超集）、`init-db/openid.js`（独立变体）。
> **修改共享逻辑的正确姿势**：只改 `_shared/` 规范源 → 跑对应 `sync-*.ps1` → `npm run verify` 校验 SHA。

其余 `_shared` 资产：`*.test.js`（入口/规则单测）、`ab_equivalence.js`（A/B 等价重放）、`_mock_sdk.js`（内存 mock 拦截 `wx-server-sdk`）、`_replay.js`。

## 2.4 小程序端模块

- **主包页面（19）**：index, square, message, profile, login, publish, demand-detail, nearby-list, nearby-map, partner-detail, chat, pay, order-detail, workbench, orders, my-demands, blog, blog-publish, blog-detail。入口页 `pages-v2/index/index`。
- **分包（4）**：
  - `pkgAdmin`（admin, users, partners, demands, orders, finance, config）
  - `pkgAgreement`（agreement）
  - `pkgPrivacy`（privacy）
  - `pkgLow`（wallet, credit, contacts, notices, partner-apply, partner-profile-edit, accept-config, activity-detail, realname, safety, evaluate, exam, exam-status, kefu, no-show-report）
- **preloadRule**：进入 login 预载 pkgAgreement+pkgPrivacy；进入 profile 预载 pkgLow。
- **components（21）**：bottom-sheet, confirm-progress, demand-card, empty-state, nav-bar, night-mask, order-progress, partner-card, safe-sell-bar, section-card, signature-canvas, status-tag, tag-chip, tm-template-card, ui-button, ui-card, ui-cell, ui-empty, ui-skeleton, ui-tag。
- **utils（10）**：bootstrap.js, cloud.js, constants.js, order-view.js, redline.js, report.js, swr.js, take-order.js, testmode.js, util.js。
- **config（2）**：enums.js, index.js（前端配置源）。
- **其他**：custom-tab-bar/（自定义 tab，4 项）、styles/tokens.wxss（设计 token）、mock/（6 组 mock 数据）、images/（仅 2 个 marker PNG，业务图片走云端）。
- 关键开关（[app.json](file:///c:/zhaoren/miniprogram/app.json)）：`darkmode: true`、`lazyCodeLoading: "requiredComponents"`、`__usePrivacyCheck__: true`。

**页面 → 云函数调用**：见 [00-factbase.md §3b](file:///c:/zhaoren/docs/dev-manual/00-factbase.md)（逐页映射表）。约定：所有调用统一经 `utils/cloud.js` 的 `callCloud`。

## 2.5 后台管理端（admin-web-frontend）

- 技术栈：Vue 3.5 + Vite 8 + Element Plus 2.14 + axios 1.20 + vue-router 4.6。
- views（36）：Accounts, Audit, Blog, Comment, Config, ConfigLog, Conversation, Dashboard, Demand, Dispute, Exam, Export, Finance, Insurance, Kefu, Layout, Legal, Login, NoShow, Notice, Operations, Orders, PartnerProfileReview, Partners, Report, Review, SafetyLog, Users 等。
- 通信层：[src/api/admin.js](file:///c:/zhaoren/admin-web-frontend/src/api/admin.js)（统一注入 `X-Admin-Token`；`bad_token` 时清本地会话并跳登录）。
- 构建：[scripts/build-admin-web.ps1](file:///c:/zhaoren/scripts/build-admin-web.ps1)（`npm run build` → 清空并复制 `dist/*` 到 `cloudfunctions/admin-web/public`），产物已出库（`.gitignore`），部署前必须重新构建。

## 2.6 scripts 脚本清单（22）

- **检查器（7）**：check-syntax, check-ssot, check-shared-sync, check-handlers, check-index-ledger, check-deploy-config, check-manual-links
- **辅助检查**：check-nightmask, check-audit-prune, check-heartbeat
- **构建/部署**：build-admin-web.ps1, create-warmup-trigger.js, gate.ps1
- **密钥**：rotate-admin-key.js, rehearse-key-rotation.js
- **数据/索引**：tcb-exec.js, tcb-scan-indexes.js, tcb-diff-indexes.js, dump-index-ledger.js, backfill-phone-enc.js
- **图表**：bp-charts.js
