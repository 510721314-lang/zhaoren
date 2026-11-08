# CODE_DOC_MAPPING · 代码 ↔ 文档双向映射（骨架）

> 用途：① 生成文档时定位「这段代码该写进哪一章」；② R7 差异自检（文档有代码无 / 代码有文档无）的底座。
> 数据来源：`miniprogram/app.json` + 目录枚举（实测 2026-11-08）。**本表不含推断内容**，未实测的列一律写「待 RN 实测」。

## 0. 维护规则

- 新增/删除页面、云函数、组件、`utils` → 同步本表对应行。
- 「章节」列在目标文档生成后回填为 `文档名#锚点`。
- 本表与 [README.md](README.md) 文档地图必须同时更新，否则视为文档债。

## 1. 页面（45）

主包 19 + 分包 4 个（`pkgAdmin` 8 / `pkgAgreement` 1 / `pkgPrivacy` 1 / `pkgLow` 16）。

| # | 页面路径 | 分包 | PAGE_SPEC 章节 | 状态 |
|---|---|---|---|---|
| 1 | `pages-v2/index/index` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 2 | `pages-v2/square/square` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 3 | `pages-v2/message/message` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 4 | `pages-v2/profile/profile` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 5 | `pages-v2/login/login` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 6 | `pages-v2/publish/publish` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 7 | `pages-v2/demand-detail/demand-detail` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 8 | `pages-v2/nearby-list/nearby-list` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 9 | `pages-v2/nearby-map/nearby-map` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 10 | `pages-v2/partner-detail/partner-detail` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 11 | `pages-v2/chat/chat` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 12 | `pages-v2/pay/pay` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 13 | `pages-v2/order-detail/order-detail` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 14 | `pages-v2/workbench/workbench` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 15 | `pages-v2/orders/orders` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 16 | `pages-v2/my-demands/my-demands` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 17 | `pages-v2/blog/blog` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 18 | `pages-v2/blog-publish/blog-publish` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 19 | `pages-v2/blog-detail/blog-detail` | 主包 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 20 | `pages-v2/admin/admin` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 21 | `pages-v2/admin/users` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 22 | `pages-v2/admin/partners` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 23 | `pages-v2/admin/demands` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 24 | `pages-v2/admin/orders` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 25 | `pages-v2/admin/finance` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 26 | `pages-v2/admin/config` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 27 | `pages-v2/admin/user-detail` | pkgAdmin | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 28 | `pages-v2/agreement/agreement` | pkgAgreement | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 29 | `pages-v2/privacy/privacy` | pkgPrivacy | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 30 | `pages-v2/pkg-low/wallet/wallet` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 31 | `pages-v2/pkg-low/credit/credit` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 32 | `pages-v2/pkg-low/contacts/contacts` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 33 | `pages-v2/pkg-low/notices/notices` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 34 | `pages-v2/pkg-low/partner-apply/partner-apply` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 35 | `pages-v2/pkg-low/partner-profile-edit/partner-profile-edit` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 36 | `pages-v2/pkg-low/accept-config/accept-config` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 37 | `pages-v2/pkg-low/activity-detail/activity-detail` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 38 | `pages-v2/pkg-low/realname/realname` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 39 | `pages-v2/pkg-low/safety/safety` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 40 | `pages-v2/pkg-low/evaluate/evaluate` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 41 | `pages-v2/pkg-low/exam/exam` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 42 | `pages-v2/pkg-low/exam-status/exam-status` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 43 | `pages-v2/pkg-low/study/study` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 44 | `pages-v2/pkg-low/kefu/kefu` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 45 | `pages-v2/pkg-low/no-show-report/no-show-report` | pkgLow | `PAGE_SPEC.md` §1 索引 | 已就绪 |

## 2. 云函数（20 业务 + `_shared`）

| # | 函数 | 入口 | API 章节 | 状态 |
|---|---|---|---|---|
| 1 | `admin-action` | `cloudfunctions/admin-action/index.js` | `API.md#315-admin-action` | 已就绪（入口契约段） |
| 2 | `admin-web` | `cloudfunctions/admin-web/index.js` | `API.md#316-admin-web` | 已就绪（入口契约段） |
| 3 | `blog-action` | `cloudfunctions/blog-action/index.js` | `API.md#314-blog-action` | 已就绪（入口契约段） |
| 4 | `demand-match` | `cloudfunctions/demand-match/index.js` | `API.md#35-demand-match` | 已就绪（入口契约段） |
| 5 | `demand-publish` | `cloudfunctions/demand-publish/index.js` | `API.md#34-demand-publish` | 已就绪（入口契约段） |
| 6 | `evaluation-submit` | `cloudfunctions/evaluation-submit/index.js` | `API.md#39-evaluation-submit` | 已就绪（入口契约段） |
| 7 | `home-action` | `cloudfunctions/home-action/index.js` | `API.md#313-home-action` | 已就绪（入口契约段） |
| 8 | `im-conv` | `cloudfunctions/im-conv/index.js` | `API.md#310-im-conv` | 已就绪（入口契约段） |
| 9 | `im-send` | `cloudfunctions/im-send/index.js` | `API.md#311-im-send` | 已就绪（入口契约段） |
| 10 | `init-db` | `cloudfunctions/init-db/index.js` | `API.md#317-init-db` | 已就绪（入口契约段） |
| 11 | `order-action` | `cloudfunctions/order-action/index.js` | `API.md#37-order-action` | 已就绪（入口契约段） |
| 12 | `order-create` | `cloudfunctions/order-create/index.js` | `API.md#36-order-create` | 已就绪（入口契约段） |
| 13 | `order-timer` | `cloudfunctions/order-timer/index.js` | `API.md#319-order-timer` | 已就绪（入口契约段） |
| 14 | `partner-action` | `cloudfunctions/partner-action/index.js` | `API.md#32-partner-action` | 已就绪（入口契约段） |
| 15 | `partner-apply` | `cloudfunctions/partner-apply/index.js` | `API.md#33-partner-apply` | 已就绪（入口契约段） |
| 16 | `payment-mock` | `cloudfunctions/payment-mock/index.js` | `API.md#38-payment-mock` | 已就绪（入口契约段） |
| 17 | `safety-report` | `cloudfunctions/safety-report/index.js` | `API.md#312-safety-report` | 已就绪（入口契约段） |
| 18 | `user-login` | `cloudfunctions/user-login/index.js` | `API.md#31-user-login` | 已就绪（入口契约段） |
| 19 | `zz-seed-orders` | `cloudfunctions/zz-seed-orders/index.js` | `API.md#318-zz-seed-orders` | 已就绪（入口契约段） |
| 20 | `zz-warmup` | `cloudfunctions/zz-warmup/index.js` | `API.md#320-zz-warmup` | 已就绪（入口契约段） |
| — | `_shared`（非云函数） | `cloudfunctions/_shared/` | `ARCHITECTURE.md#_shared-多副本机制` | 已就绪 |

## 3. 组件（25）

`app.json` 全局挂载 3 个：`night-mask` / `empty-state` / `bottom-sheet`。

| # | 组件 | 全局挂载 | 使用页面 | COMPONENTS 章节 | 状态 |
|---|---|---|---|---|---|
| 1 | `auth-sign-sheet` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 2 | `bottom-sheet` | 是 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 3 | `confirm-progress` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 4 | `demand-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 5 | `dispute-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 6 | `empty-state` | 是 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 7 | `evidence-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 8 | `finance-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 9 | `nav-bar` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 10 | `night-mask` | 是 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 11 | `no-show-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 12 | `order-progress` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 13 | `partner-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 14 | `safe-sell-bar` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 15 | `safety-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 16 | `scene-picker` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 17 | `signature-canvas` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 18 | `status-tag` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 19 | `tag-chip` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 20 | `timeline-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 21 | `tm-template-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 22 | `ui-card` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 23 | `ui-cell` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 24 | `ui-empty` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |
| 25 | `ui-skeleton` | 否 | 见 COMPONENTS.md §1 | `COMPONENTS.md` §1 一览表 | 已就绪 |

> 注：既有 `docs/dev-manual/` 记载组件数为 21，与本表实测 25 不符（已记入 R7 差异报告）。

## 4. `miniprogram/utils/`（22）

职责列待 R3 逐文件实测后回填；本轮只锁定文件清单。

| # | 文件 | 职责 | 文档章节 | 状态 |
|---|---|---|---|---|
| 1 | `bootstrap.js` | 待实测 | `TECH_DESIGN.md#登录与启动链` | 待 R3 |
| 2 | `cloud.js` | 待实测 | `ARCHITECTURE.md#请求链路` | 待 R3 |
| 3 | `constants.js` | 待实测 | `DATA_MODEL.md#常量与枚举` | 待 R4 |
| 4 | `draft-store.js` | 待实测 | `TECH_DESIGN.md#草稿存储` | 待 R3 |
| 5 | `geo-guard.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 6 | `geo-wx.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 7 | `location.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 8 | `onboard-chain.js` | 待实测 | `TECH_DESIGN.md#登录与启动链` | 待 R3 |
| 9 | `once-anchor.js` | 待实测 | `TECH_DESIGN.md#一次性提示` | 待 R3 |
| 10 | `order-evidence.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 11 | `order-poll.js` | 待实测 | `ARCHITECTURE.md#轮询与保温` | 待 R3 |
| 12 | `order-view.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 13 | `photo-watermark.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 14 | `publish-locate.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 15 | `publish-validate.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 16 | `redline.js` | 待实测 | `TECH_DESIGN.md#红线校验` | 待 R3 |
| 17 | `report.js` | 待实测 | `TECH_DESIGN.md#日志与上报` | 待 R3 |
| 18 | `signature-quality.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 19 | `swr.js` | 待实测 | `ARCHITECTURE.md#缓存策略` | 待 R3 |
| 20 | `take-order.js` | 待实测 | `PAGE_SPEC.md` §1 索引 | 已就绪 |
| 21 | `testmode.js` | 待实测 | `TECH_DESIGN.md#测试态` | 待 R3 |
| 22 | `util.js` | 待实测 | `TECH_DESIGN.md#工具函数` | 待 R3 |

## 5. 配置与门禁

| 代码 | 文档章节 | 状态 |
|---|---|---|
| `miniprogram/app.json` | `ARCHITECTURE.md#页面与分包` / `PAGE_SPEC.md` | 待 R3 |
| `project.config.json` | `RELEASE.md#环境与-appid` | 待 R6 |
| `cloudbaserc.json` | `RELEASE.md#环境` | 待 R6 |
| `package.json`（scripts） | `TECH_DESIGN.md#门禁命令` | 待 R3 |
| `scripts/check-*.js`（25 段门禁） | `TECH_DESIGN.md#门禁清单` | 待 R3 |
| `cloudfunctions/*/config.json`（timeout / triggers） | `RELEASE.md#触发器与超时` | 待 R6 |

## 6. 文档 → 代码反向索引

| 文档 | 主要引用代码 |
|---|---|
| `TECH_DESIGN.md` | `package.json`、`scripts/`、`.trae/rules/` |
| `ARCHITECTURE.md` | `miniprogram/app.json`、`cloudfunctions/*/index.js`、`cloudfunctions/_shared/` |
| `DATA_MODEL.md` | `cloudfunctions/init-db/`、`cloudfunctions/admin-action/config_schema.js` |
| `API.md` | `cloudfunctions/*/index.js` + `action_*.js`、`miniprogram/utils/cloud.js` |
| `COMPONENTS.md` | `miniprogram/components/**` |
| `PAGE_SPEC.md` | `miniprogram/pages-v2/**`、`miniprogram/custom-tab-bar/` |
| `RELEASE.md` | `scripts/build-admin-web.ps1`、`cloudfunctions/*/config.json`、`docs/runbooks/` |
| `PRD.md` | `PRD/PRD.md`（指针） |

## 7. 差异报告（R7 填充）

| 类型 | 条目 | 处置 |
|---|---|---|
| 代码有文档无 | 待 R7 | 只报不改，待裁决 |
| 文档有代码无 | 待 R7 | 只报不改，待裁决 |
| 数字漂移 | `dev-manual` 组件 21 vs 实测 25 | 已登记 |
| 数字漂移 | 根目录 `pages-spec.md` 16 页 / `pages/` 路径 vs 实测 45 页 / `pages-v2/` | 已登记 |
