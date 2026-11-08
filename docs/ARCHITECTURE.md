# ARCHITECTURE · 系统架构与模块地图

> 事实源：`miniprogram/app.json`、`miniprogram/app.js`、`miniprogram/utils/cloud.js`、`cloudfunctions/**`、`cloudfunctions/*/config.json`（实测 2026-11-08）。
> 本章合并并取代 `docs/dev-manual/01-architecture.md` 与 `02-module-map.md`；与旧稿不一致处以本文为准（差异见附录 B）。

## 1. 总体形态：三端 + 一朵云

| 组成 | 位置 | 形态 | 关键事实 |
|---|---|---|---|
| 小程序端 | `miniprogram/` | 原生小程序，无框架 | 主包 19 页 + 4 分包 26 页；自定义 tabBar（4 项） |
| 云函数层 | `cloudfunctions/` | 微信云开发 Node.js | 20 个业务函数 + `_shared` 规范源 |
| 后台管理端 | `admin-web-frontend/` | SPA 源码 | 构建产物 copy 到 `cloudfunctions/admin-web/public` 后随函数部署 |
| 云开发后端 | 微信云开发环境 | 云数据库 / 云存储 / 定时触发器 | **无自建服务器**，后台不是独立站点 |

## 2. 小程序端请求链路

```
页面 / 组件
  └─ utils/cloud.js  callCloud(name, data)
       └─ app.cloudCall(name, data, opts)      ← 等 cloudReady + 读写策略 + device 注入
            └─ wx.cloud.callFunction({ name, data })
                 └─ 云函数 index.js  exports.main → 按 event.action 分发
```

`app.cloudCall` 的确定性行为（[app.js](../miniprogram/app.js)）：

| 项 | 值 | 依据 |
|---|---|---|
| 云就绪 | 先 `await globalData.cloudReady` | `cloudCall` 首行 `this.globalData.cloudReady.then(...)` |
| 读写判定 | 用 `WRITE_RE` 匹配 action 名中的写动词（create/add/pay/tip/refund/cancel/confirm…） | 同文件 `WRITE_RE` 常量 |
| 重试 | 写 0 次；读 2 次（`opts.retries` 可覆盖） | 同文件 `retries` 计算 |
| 重试间隔 | 1500ms | `waitMs` 默认值 |
| 单次超时 | 12000ms（2026-10-27 由 6s 上调） | `timeout` 默认值 |
| 设备摘要 | 每次调用注入 `device = brand model|system|platform`（截断 200 字符） | `wx.getDeviceInfo` 分支 |
| 失败返回 | `{ ok:false, code:'cloud_timeout'|'cloud_error'|'cloud_empty', msg }` | 超时/fail/空结果三分支 |

`utils/cloud.js` 的兜底：`getApp()` 不可用或 `globalData.cloudReady` 缺失时，退化为直连 `wx.cloud.callFunction`，返回 `{ ok:false, code:'cloud_error' }`。

## 3. 后台管理端链路

```
admin-web-frontend (SPA)
  └─ axios（统一注入 X-Admin-Token）
       └─ 云函数 admin-web（HTTP 网关）
            ├─ 静态服务：./public（SPA）
            └─ 写操作代理 → admin-action（全部后台写操作 + 配置单一源）
```

网关硬约束（[admin-web/index.js](../cloudfunctions/admin-web/index.js)）：

- CloudBase HTTP 网关 **3s 硬限**；函数内 `PROXY_TIMEOUT_MS = 2500`（`3000 - 500` 安全边际），超时即 504。
- CORS 允许头：`Content-Type, X-Admin-Key, X-Admin-Token`。
- `admin_login` / `admin_logout` 由网关本地处理（`./admin-login` 副本），其余写操作代理到 `admin-action`。
- 静态文件兼容两种部署布局（正常 `public/` 目录 / DevTools Windows 打包把嵌套条目拍平为反斜杠文件名）。

`admin-action` 的鉴权与分发（[admin-action/index.js](../cloudfunctions/admin-action/index.js)）：

- 分发表：`HANDLERS = Object.assign({}, require('./action_*'), ...)`，共 **33 个 `action_*.js`**。
- 另有 `HANDLERS_PRE`（`action_config_public` + `action_auth_pre`）：**免鉴权前置动作**，在统一鉴权门之前执行。
- 鉴权：`getWXContext().OPENID` 必须命中 `admin_config.admin_openids` 白名单，否则拒绝并写 `platform_event(P1, admin_probe)`；`claim_admin` 为一次性自助初始化例外。
- 网关代理身份：`event.__admin_web_proxy` + `_admin_web_proxy_key` 与 `admin_config.admin_web_key` 比对，命中才采用网关声明的 openid（fail-closed）。

> 【待人工确认】后台鉴权优先级（`X-Admin-Token` → `admin_login` 免 key → `X-Admin-Key` 兜底）来自旧稿，R4 需逐行复核后再定为结论。

## 4. 身份与环境：fail-closed

规范源 [_shared/openid.js](../cloudfunctions/_shared/openid.js)，17 个业务函数持有同源副本。

| 场景 | 行为 |
|---|---|
| `env !== 'dev'` | 一律按 prod，忽略 `event.mock_openid` |
| `env === 'dev'` 且 `dev_until` 为未来时间戳 | 允许 `mock_openid` |
| `env === 'dev'` 但 `dev_until` 过期/缺失 | 回落 prod（fail-closed） |
| `dev_bypass === true` | 跳过过期校验（回滚开关） |
| 读 `admin_config` 失败 | 按 prod 处理，只短缓存 10s |
| 环境缓存 | 模块级 5 分钟；`invalidateEnvCache()` 供 `init-db` 强制刷新 |

## 5. 定时链

| 触发器 | 云函数 | 频率（`config.json`） | 超时 | 结构 |
|---|---|---|---|---|
| `orderTimer` | `order-timer` | `0 */30 * * * * *`（每 30 分钟） | 60s | 4 个段落模块：`action_timeout` / `action_modify` / `action_lifecycle` / `action_account` |
| `warmup-15min` | `zz-warmup` | `0 */15 7-22 * * * *`（7–22 点每 15 分钟） | 10s | 单入口 `run` |

`order-timer` 关键机制（[order-timer/index.js](../cloudfunctions/order-timer/index.js)）：

- `SECTIONS` 由 4 个 `action_*.js` 合并，段内禁止 `require('./index')`。
- 扫描采用**游标分页**（`_id > lastId`，禁用 `skip`），每页 `BATCH=50`，单轮上限 `SCAN_MAX=500`。
- 取满一页即记 `backlog` 并 `log.w` 告警，供运维观测积压。
- 超时规则（S1 15 分钟、S0 30 分钟、S3.5 24 小时、S2.5 确认时限、S5 48 小时默认评价）由 `_shared` 规则模块驱动，规则文本以 `.trae/rules` 附录 A 为准。

> 部署注意：`deploy` 只上传代码，**不应用** `config.json` 的 `timeout` / `triggers`；触发器与超时须另经 `tcb` 或控制台更新（详见 R6 `RELEASE.md`）。

## 6. 配置单一源

| 层 | 位置 | 说明 |
|---|---|---|
| 云端运行配置 | `admin_config` 集合 `doc('global')` | 场景白名单、开关、超时参数等 |
| 配置 schema | [admin-action/config_schema.js](../cloudfunctions/admin-action/config_schema.js) | 后台配置页字段定义唯一源 |
| 规则默认值 | [admin-action/config_defaults.js](../cloudfunctions/admin-action/config_defaults.js) + `.json` | `MODIFY_DEFAULTS` / `S2_CHANGE_DEFAULTS` |
| 进程内缓存 | `_shared/config_cache.js` | 30s 缓存，4 个函数持有副本 |
| 前端配置源 | `miniprogram/config/enums.js`、`miniprogram/config/index.js` | 场景/枚举展示 |

一致性门禁：`check-ssot.js`（前后端场景 code 对齐）、`check-config-defaults.js`（默认值与 schema 对齐）、`check-collections-consistency.js`（集合声明对齐）、`check-shared-sync.js`（副本 SHA 对齐）。

## 7. 目录地图

### 7.1 仓库顶层

| 路径 | 角色 |
|---|---|
| `miniprogram/` | 小程序源码（`miniprogramRoot`） |
| `cloudfunctions/` | 云函数源码（`cloudfunctionRoot`），含 `_shared/` |
| `admin-web-frontend/` | 后台 SPA 源码 |
| `scripts/` | 门禁与运维脚本 |
| `.predeploy/` | 预部署备份/恢复/冒烟 |
| `.trae/rules/` | 常驻规则（唯一规则源） |
| `PRD/PRD.md` | 需求正本 |
| `docs/` | 本文档体系 + 台账 + runbooks |

### 7.2 小程序端（实测）

| 项 | 数量 | 明细 |
|---|---|---|
| 主包页面 | 19 | `index` `square` `message` `profile` `login` `publish` `demand-detail` `nearby-list` `nearby-map` `partner-detail` `chat` `pay` `order-detail` `workbench` `orders` `my-demands` `blog` `blog-publish` `blog-detail` |
| `pkgAdmin` | 8 | `admin` `users` `partners` `demands` `orders` `finance` `config` `user-detail` |
| `pkgAgreement` | 1 | `agreement` |
| `pkgPrivacy` | 1 | `privacy` |
| `pkgLow` | 16 | `wallet` `credit` `contacts` `notices` `partner-apply` `partner-profile-edit` `accept-config` `activity-detail` `realname` `safety` `evaluate` `exam` `exam-status` `study` `kefu` `no-show-report` |
| 自定义组件 | 25 | 见 `COMPONENTS.md`（R5）；`app.json` 全局挂载 3 个：`night-mask` / `empty-state` / `bottom-sheet` |
| `utils` | 22 | 见 [CODE_DOC_MAPPING.md](CODE_DOC_MAPPING.md) §4 |
| `config` | 2 | `enums.js`、`index.js` |
| 其他 | — | `custom-tab-bar/`、`styles/`、`mock/`、`images/` |

关键开关（[app.json](../miniprogram/app.json)）：`darkmode: true`、`lazyCodeLoading: "requiredComponents"`、`__usePrivacyCheck__: true`、`requiredPrivateInfos: [getLocation, chooseLocation]`、`preloadRule`（login 预载 agreement+privacy；profile 预载 pkgLow）。

### 7.3 云函数层

20 个业务函数：`admin-action` `admin-web` `blog-action` `demand-match` `demand-publish` `evaluation-submit` `home-action` `im-conv` `im-send` `init-db` `order-action` `order-create` `order-timer` `partner-action` `partner-apply` `payment-mock` `safety-report` `user-login` `zz-seed-orders` `zz-warmup`；另有 `_shared/`（非云函数）。

分发形态两类：

- **switch / if 链**：`blog-action`、`demand-match`、`evaluation-submit`、`im-conv`、`im-send`、`partner-apply`、`safety-report`、`admin-web`。
- **`action_*.js` 拆分 + HANDLERS/SECTIONS**：`admin-action`（33 文件）、`order-action`（9）、`order-timer`（4）、`demand-publish`（5）、`home-action`（4）、`init-db`（4）、`partner-action`（5）、`payment-mock`（4）、`user-login`（4）、`order-create`（2）、`zz-seed-orders`（5）。

## 8. 页面 → 云函数映射（实测 45 页）

| 页面 | 调用云函数 |
|---|---|
| `index/index` | `home-action`、`order-action`、`user-login` |
| `square/square` | `home-action` |
| `message/message` | `im-conv`、`order-action` |
| `profile/profile` | `demand-publish`、`order-action`、`partner-action`、`user-login` |
| `login/login` | `user-login` |
| `publish/publish` | `admin-action`、`demand-publish`、`home-action`、`partner-action`、`user-login` |
| `demand-detail/demand-detail` | `demand-publish` |
| `nearby-list/nearby-list` | `home-action` |
| `nearby-map/nearby-map` | `user-login` |
| `partner-detail/partner-detail` | `blog-action`、`partner-action`、`safety-report` |
| `chat/chat` | `admin-action`、`im-conv`、`im-send`、`order-action`、`partner-action` |
| `pay/pay` | `payment-mock` |
| `order-detail/order-detail` | `admin-action`、`order-action`、`partner-action`、`payment-mock`、`safety-report` |
| `workbench/workbench` | `home-action`、`order-action`、`partner-action`、`payment-mock`、`safety-report`、`user-login` |
| `orders/orders` | `order-action` |
| `my-demands/my-demands` | `demand-publish` |
| `blog/blog`、`blog-publish/blog-publish`、`blog-detail/blog-detail` | `blog-action` |
| `admin/*`（8 页） | `admin-action` |
| `agreement/agreement`、`privacy/privacy` | 无云调用（静态页，实测未检出 `callCloud`） |
| `pkg-low/wallet` | `payment-mock` |
| `pkg-low/credit`、`contacts` | `user-login` |
| `pkg-low/notices` | `order-action` |
| `pkg-low/partner-apply` | `partner-action`、`user-login` |
| `pkg-low/partner-profile-edit` | `admin-action`、`partner-action` |
| `pkg-low/accept-config` | `admin-action`、`home-action`、`partner-action` |
| `pkg-low/activity-detail` | `home-action` |
| `pkg-low/realname` | `admin-action`、`user-login` |
| `pkg-low/safety` | `order-action`、`safety-report` |
| `pkg-low/evaluate` | `evaluation-submit`、`order-action` |
| `pkg-low/exam`、`exam-status`、`study` | `partner-action` |
| `pkg-low/kefu` | `im-conv`、`im-send` |
| `pkg-low/no-show-report` | `order-action` |

非页面调用方：`app.js` → `home-action`；`utils/draft-store.js` → `demand-publish`；`utils/onboard-chain.js` → `partner-action`；`utils/order-poll.js` → `order-action`、`payment-mock`；`utils/take-order.js` → `order-create`、`partner-action`。

> 提取口径：静态匹配 `callCloud('fn'` / `cloudCall('fn'`。动态拼接云函数名或经封装间接调用的，本表可能漏项，标【待后端确认】。

## 9. `_shared` 规范源与副本

微信云函数按目录打包，无法跨函数共享依赖，故采用「规范源 + 复制 + SHA 门禁」：

1. 规范源：[cloudfunctions/_shared/](../cloudfunctions/_shared)
2. 同步：`_shared/sync-<module>.ps1`（实测 **20 个**）
3. 校验：`scripts/check-shared-sync.js` 比对副本 SHA-256，纳入 `npm run verify`

实测「模块 → 持有副本函数数」（2026-11-08 目录枚举）：

| 模块 | 持有数 | 持有函数 |
|---|---|---|
| `openid.js` | 17 | 全部业务函数（除 `zz-warmup` 等无身份入口） |
| `logger.js` | 16 | 除 `admin-web`、`init-db`、`zz-*` 外 |
| `audit.js` | 12 | admin-action, admin-web, blog-action, demand-publish, evaluation-submit, im-send, order-action, order-create, partner-action, payment-mock, safety-report, user-login |
| `scene_meta.js` | 7 | admin-action, demand-publish, home-action, im-conv, im-send, order-action, payment-mock |
| `take_rules.js` | 6 | demand-publish, home-action, order-action, order-create, partner-action, partner-apply |
| `config_cache.js` | 4 | order-action, order-timer, partner-action, user-login |
| `phone_crypt.js` | 4 | admin-action, demand-publish, safety-report, user-login |
| `security_policy.js` | 4 | admin-action, admin-web, init-db, user-login |
| `test_data.js` | 4 | admin-action, demand-publish, init-db, order-create |
| `cert_state.js` | 3 | order-create, partner-action, partner-apply |
| `config_defaults.js` | 3 | admin-action, order-action, order-timer |
| `heal.js` | 3 | demand-match, order-create, partner-action |
| `money_rules.js` | 3 | order-action, order-create, payment-mock |
| `sub_msg.js` | 3 | order-action, order-timer, partner-action |
| `admin-login.js` | 2 | admin-action, admin-web |
| `credit_rules.js` | 2 | evaluation-submit, order-timer |
| `no_show_rules.js` | 2 | order-action, admin-action |
| `order_state.js` | 2 | order-action, order-timer |
| `partner_audit.js` | 2 | admin-action, partner-action |
| `urge_rules.js` | 2 | order-action, order-timer |
| `timeout_remind_rules.js` | 1 | order-timer |

**正确改法**：只改 `_shared/` 规范源 → 跑对应 `sync-*.ps1` → `npm run verify` 复核 SHA。直接改副本必被门禁拦下。

其余 `_shared` 资产：`*.test.js`（规则/入口单测）、`ab_equivalence.js`（A/B 等价重放）、`_mock_sdk.js`（内存 mock `wx-server-sdk`）、`_replay.js`。

## 附录 A · 云函数 action 清单（静态提取）

> 口径：`module.exports` 顶层键 + `exports.x =` + `case 'x':`，排除 `main`。**该口径可能漏掉以对象字面量/动态注册的 handler**，故数量仅作索引，权威逐条契约在 R4 `API.md`。

| 函数 | 分发形态 | 提取数 | action 名单 |
|---|---|---|---|
| `admin-action` | HANDLERS + HANDLERS_PRE（33 个 `action_*.js`） | 60 | admin_account_list, admin_list, audit_init, audit_verify, blog_list, claim_admin, config_get, config_public, config_restore, config_set, content_detail, content_list, credit_log_list, dashboard, demand_list, demand_offline, dispute_detail, dispute_handle, dispute_list, exam_bank_seed, exam_subject_create, exam_subject_delete, exam_subject_detail, exam_subject_list, exam_subject_meta_update, exam_subject_overview, exam_subject_update, export_admin_config, finance_stats, home_activity_list, im_degraded_list, kefu_conv_list, legal_doc_list, no_show_decide, no_show_report_list, notice_send, order_detail, order_list, order_query, partner_offline, partner_online, partner_profile_pending_list, partner_profile_review, penalty, question_bulk_status, question_delete, question_detail, question_import_markdown, question_list, question_upsert, report_list, review, upload_image, user_ban, user_credit_adjust, user_freeze, user_list, user_unban, user_unfreeze, withdraw_review |
| `admin-web` | if 链（HTTP 入口，非 `callFunction` action） | 22 | admin_login, admin_logout, fn_migrate_tip_partner, fn_probe_tip_list, generate_admin_web_key, home_probe_modify_audit, home_probe_square, home_probe_system_notice, init_db, order_probe_tip, seed_backfill_matched, seed_cleanup, seed_cleanup_seed_orders, seed_cleanup_sim, seed_count, seed_count_sim, seed_fix_sdm_city, seed_night_orders, seed_run, seed_scene_demands, seed_service_orders, seed_simulate |
| `blog-action` | switch | 11 | author_home, comment_add, comment_delete, comment_list, delete_my, detail, feed_list, like, my_list, publish, unlike |
| `demand-match` | switch | 7 | apply, broadcast, confirm_apply, hall_list, invite, status, top5 |
| `demand-publish` | HANDLERS + switch（5 文件） | 9 | cancel, delete_draft, detail, detail_light, list_drafts, my_demands, publish, save_draft, update |
| `evaluation-submit` | if 链 | 2 | get_default_star, submit |
| `home-action` | HANDLERS + switch（4 文件） | 8 | activity_detail, home_activity_list, nearby, overview, scene_groups, scene_list, square, user_home |
| `im-conv` | if 链 | 5 | kefu_messages, kefu_open, messages, my_convs, open |
| `im-send` | if 链 | 3 | send_kefu, send_template, send_text |
| `init-db` | HANDLERS（4 文件） | 4 | force_migrate_scenes, generate_admin_web_key, lookup, purge_test_data |
| `order-action` | HANDLERS（9 文件） | 19 | cancel, change_apply, complaint, complete_service, detail, extend, extend_confirm, extend_reject, get_confirmation, modify, modify_confirm, modify_reject, no_show_report_submit, nudge_partner, partial_confirm, ratio_confirm, s2_change_apply, start_service, timeline |
| `order-create` | HANDLERS（2 文件） | 4 | check_signed, check_take_result, create_from_take, sign_disclaimer |
| `order-timer` | SECTIONS（4 文件）+ index 内 2 个扫描函数，无 action，`main` 直接扫描 | 21 | action_timeout: processS1Timeout / processS0Timeout / processStartApplyTimeout / processFinishConfirmTimeout / processStartApplyRemind / processFinishConfirmRemind / processNoShowDefenseOverdue / processNoShowGuide；action_modify: processModifyTimeout / processExtendTimeout / processChangeTimeout / processS2ChangeTimeout；action_lifecycle: processInterruptPartial / processMilestoneConfirm / processAutoEval / processS8Archive / processS4Escalate；action_account: processSuspendRestore / processDisputeEscalate；index.js: processDemandNotify / processUrgeReminder |
| `partner-action` | HANDLERS + switch（5 文件） | 17 | apply, audit_partner_profile, detail, exam_subjects, get_exam_questions, init_draft, my_profile, review, route_plan, set_switch, study_detail, study_list, sub_authorize, submit_exam, take_readiness, update_config, update_partner_profile |
| `partner-apply` | if 链 | 1 | debug_profile |
| `payment-mock` | HANDLERS + switch（4 文件） | 13 | aa_record, balance_info, cashier_info, fast_withdraw, income_list, mock_ins, mock_pay, mock_refund, mock_tip, tip_income_list, tip_list, withdraw, withdraw_list（`migrate_tip_partner` 2026-11-08 已删除，见 API.md §5.13） |
| `safety-report` | if 链 | 11 | cancel_silent_sos, checkin, free_sos, free_sos_resolve, free_sos_status, report_user, resolve, resolve_sos, silent_sos, sos, status |
| `user-login` | HANDLERS + switch（4 文件） | 20 | bind_idcard, bind_phone, close_account, get_emergency_contact, get_my_credit, global_config, login, nearby_map_list, password_login, password_register, peek_login, phone_login, phone_register, report_map_gps, send_sms_code, set_emergency_contact, set_map_share, simulate_realname, submit_realname, update_profile |
| `zz-seed-orders` | HANDLERS（5 文件） | 5 | count, night_orders, scene_demands, service_orders, simulate |
| `zz-warmup` | 直调 `run` | 1 | run |

## 附录 B · 与 dev-manual 快照的差异（2026-11-08 复测）

| 项 | 旧稿（dev-manual） | 实测 | 依据 |
|---|---|---|---|
| `pkgAdmin` 页数 | 7 | **8**（含 `user-detail`） | `app.json` |
| `pkgLow` 页数 | 15 | **16**（含 `study`） | `app.json` |
| 自定义组件 | 21 | **25** | `components/` 目录枚举 |
| `utils` | 10 | **22** | `utils/*.js` 枚举 |
| `order-timer` 频率 | 每 5 分钟 | **每 30 分钟**（`0 */30`） | `order-timer/config.json` |
| `zz-warmup` 频率 | 每 5 分钟 | **7–22 点每 15 分钟**（`0 */15 7-22`） | `zz-warmup/config.json` |
| 云调用单次超时 | 6s | **12s**（2026-10-27 上调） | `app.js` `timeout` 默认值 |
| `sync-*.ps1` 数量 | 13 | **20** | `_shared/` 枚举 |
| `admin-action` action 数 | 83 / 86 | **静态提取 60**（差额待 R4 复核） | 附录 A 口径 |
| `admin-action` action_*.js | 30 | **33** | 目录枚举 |

## 附录 C · 待人工确认

1. 后台鉴权优先级（`X-Admin-Token` → `admin_login` 免 key → `X-Admin-Key`）需 R4 逐行复核。
2. `admin-action` action 实际总数（提取 60 vs 旧稿 83/86）需逐文件复核后定稿。
3. `order-timer` 「9 段扫描」为旧稿表述，当前 `SECTIONS` 为 4 个模块，段内扫描代数需 R4 核定。
4. 后台两个域名（静态托管 vs HTTP 网关）职责区分需在 R6 `RELEASE.md` 实测确认。
