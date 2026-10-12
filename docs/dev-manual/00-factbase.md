# 技术开发手册 · 事实底座（Implementation Factbase）

> 本文件是《技术开发手册》的事实依据，**全部来自实际代码**（2026-10 实测）。
> 手册正文以此为准；与任何既有文档冲突时，以代码为唯一事实源。
> 缺口项标注 `TODO`，写正文时需补齐。

## 1. 云函数清单（c:\zhaoren\cloudfunctions，20 个业务函数 + `_shared`）

| 函数 | 职责（待正文细化） | 拆分(action_*.js) | timeout | 定时触发器 |
|---|---|---|---|---|
| admin-action | 后台管理全部写操作 + 配置单一源(CONFIG_SCHEMA) + 上传/导出 | 29 | 20 | — |
| admin-web | HTTP 网关：代理 admin-action、静态资源托管、admin_login 免 key 入口 | 0 | 20 | — |
| blog-action | 博客/资讯读写（switch 分发） | 0 | 20 | — |
| demand-match | 供需匹配 | 0 | 20 | — |
| demand-publish | 需求发布 | 0 | 20 | — |
| evaluation-submit | 评价提交 + 信用分 | 0 | 8 | — |
| home-action | 首页聚合（场景分组缓存/附近需求） | 0 | 8 | — |
| im-conv | 会话列表/建会话 | 0 | 20 | — |
| im-send | 消息发送 | 0 | 20 | — |
| init-db | 数据库初始化/种子/索引/quick_check/lookup | 0 | 20 | — |
| order-action | 订单全生命周期写操作（HANDLERS 拆分） | 7 | 20 | — |
| order-create | 下单 | 0 | 20 | — |
| order-timer | 定时任务：9 段分页扫描 + 状态推进 + 错误巡检 + 订阅消息推送 | 0 | 60 | `0 */5 * * * * *` |
| partner-action | 耍伴侧操作（抢单/资质/上下线） | 0 | 8 | — |
| partner-apply | 耍伴入驻申请 | 0 | 20 | — |
| payment-mock | 支付（mock/真实） | 0 | 10 | — |
| safety-report | 安全上报（SOS 等） | 0 | 8 | — |
| user-login | 登录/身份/peek_login | 0 | 8 | — |
| zz-seed-orders | 种子订单批量注入 | 0 | — | — |
| zz-warmup | 首屏云函数保温探针（唤醒 home-action/user-login） | 0 | 10 | `0 */5 * * * * *` |

> 计数为 0 的函数并非无 action——多使用 `HANDLERS` 注册表、`switch` 或 `if (action===...)` 分发。

### 1b. action 清单（实测枚举：`action_*.js` 导出 / HANDLERS / switch / `action===`）

| 函数 | actions |
|---|---|
| admin-action (84) | admin_list, admin_add, admin_remove, admin_account_list, admin_account_create, admin_account_set_status, audit_init, audit_query, audit_verify, claim_admin, admin_login, admin_logout, blog_list, blog_offline, blog_restore, blog_delete, blog_comment_list, blog_comment_delete, config_public, config_get, config_history_list, config_log_list, config_set, dashboard, demand_list, order_list, order_query, order_detail, dispute_detail, dispute_handle, exam_subject_list, exam_subject_detail, exam_subject_create, exam_subject_update, exam_subject_delete, exam_bank_seed, export_admin_config, export_collection, finance_stats, dispute_list, finance_list, home_activity_list, home_activity_create, home_activity_update, home_activity_delete, im_degraded_list, im_message_admin_list, kefu_conv_list, kefu_conv_reply, kefu_mislabel_clear, withdraw_review, report_list, report_handle, safety_log_list, event_list, credit_log_list, withdraw_list, settlement_list, insurance_list, upload_image, realname_reset_simulated, evidence_query, readImageDims, no_show_decide, no_show_report_list, notice_send, demand_offline, order_force_cancel, partner_offline, partner_online, partner_profile_pending_list, partner_profile_review, review, user_ban, user_unban, penalty, user_freeze, user_unfreeze, user_credit_adjust, user_list, user_detail, user_ec_update, partner_list, partner_detail |
| admin-web | HTTP 网关：`require('wx-server-sdk')` 不参与；入口为 HTTP path 路由，代理 admin-action 与静态托管；含 admin_login 免 key 入口、generate_admin_web_key。 |
| blog-action (11) | feed_list, detail, publish, delete_my, like, unlike, comment_list, comment_add, comment_delete, my_list, author_home |
| demand-match (7) | top5, status, invite, broadcast, apply, confirm_apply, hall_list |
| demand-publish (10) | publish, cancel, my_demands, lazy_expire, detail, detail_light, save_draft, list_drafts, delete_draft, update |
| evaluation-submit (2) | get_default_star, submit |
| home-action (8) | overview, square, scene_groups, scene_list, nearby, user_home, home_activity_list, activity_detail |
| im-conv (5) | kefu_open, kefu_messages, open, messages, my_convs |
| im-send (3) | send_kefu, send_template, send_text |
| init-db (8) | lookup, quick_check, purge_test_data, force_migrate_scenes, set_env, force_set_env, generate_admin_web_key, check_pp |
| order-action (32) | get_confirmation, update_item, confirm_item, confirm_all, complaint, complaint_withdraw, no_show_report_submit, no_show_report_defense, no_show_report_withdraw, no_show_report_detail, cancel, start_service, complete_service, milestone_submit, milestone_confirm, resume_service, modify, modify_confirm, modify_reject, extend, extend_confirm, extend_reject, partial_confirm, ratio_confirm, nudge_partner, detail, my_orders, my_counts, notice_list, notice_poll, notice_read, timeline |
| order-create (3) | check_signed, sign_disclaimer, check_take_result |
| order-timer | **无 action 分发**：`exports.main` 内直接执行定时扫描链（9 段分页 + 状态推进 + errorScan 巡检 + 订阅消息）。 |
| partner-action (13) | apply, set_switch, update_config, sub_authorize, my_profile, get_exam_questions, submit_exam, exam_subjects, review, update_partner_profile, audit_partner_profile, detail, route_plan |
| partner-apply (1) | debug_profile |
| payment-mock (14) | cashier_info, mock_pay, mock_refund, mock_tip, tip_list, mock_ins, aa_record, balance_info, income_list, tip_income_list, migrate_tip_partner, withdraw, fast_withdraw, withdraw_list |
| safety-report (8) | report_user, sos, silent_sos, cancel_silent_sos, resolve_sos, resolve, checkin, status |
| user-login (20) | login, update_profile, bind_phone, bind_idcard, submit_realname, simulate_realname, set_emergency_contact, get_emergency_contact, get_my_credit, close_account, peek_login, set_map_share, report_map_gps, nearby_map_list, send_sms_code, phone_login, phone_register, password_register, password_login, global_config |
| zz-seed-orders (11) | count, cleanup, count_sim, cleanup_sim, simulate, service_orders, night_orders, scene_demands, fix_sdm_city, cleanup_seed_orders, backfill_matched |
| zz-warmup (1) | run |

> `check-handlers.js` 用真实 mock SDK 逐 action 过 index.js，断言「0 抛错」（覆盖 order-action + admin-action，共 115 条运行路径）。

## 2. `_shared` 共享模块（多副本机制）

- **规范源 + 复制 + SHA 门禁**：`sync-*.ps1` 把规范源复制到各云函数目录，`scripts/check-shared-sync.js` 校验 SHA 一致。
- 共享规则模块：`order_state.js` / `take_rules.js` / `money_rules.js` / `no_show_rules.js` / `urge_rules.js` / `credit_rules.js` / `partner_audit.js` / `scene_meta.js` / `phone_crypt.js` / `logger.js` / `audit.js` / `heal.js` / `openid.js` / `test_data.js`
- 测试：`*.test.js`（14 个入口/规则测试）+ `ab_equivalence.js`（A/B 等价，203 例，7 known-evolution）+ `_mock_sdk.js`（拦截 wx-server-sdk）+ `_replay.js`
- 13 个同步脚本：`sync-audit / sync-credit-rules / sync-logger / sync-money-rules / sync-no-show-rules / sync-openid / sync-order-state / sync-partner-audit / sync-phone-crypt / sync-scene-meta / sync-take-rules / sync-test-data / sync-urge-rules`（`.ps1`）。

### 2b. 「模块 → 持有副本的云函数」映射（取自 `scripts/check-shared-sync.js` 的 SYNC_MAP，即门禁权威口径）

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
| logger.js | admin-action, blog-action, demand-match, demand-publish, evaluation-submit, home-action, im-conv, im-send, order-action, order-create, order-timer, partner-action, partner-apply, payment-mock, safety-report, user-login（16） |
| audit.js | admin-action, blog-action, demand-publish, evaluation-submit, im-send, order-action, order-create, partner-action, payment-mock, safety-report, user-login（11） |
| openid.js | blog-action, demand-match, demand-publish, evaluation-submit, home-action, im-conv, im-send, order-action, order-create, order-timer, partner-action, partner-apply, payment-mock, safety-report, user-login（15）|

> **有意变体（显式排除，不参与同步）**：`admin-action/openid.js`（超集，含 admin-web 网关密钥校验）；`init-db/openid.js`（独立变体）。改动这两个需手工同步。

## 3. 小程序端（c:\zhaoren\miniprogram）

- **pages-v2（24 个）**：admin, agreement, blog, blog-detail, blog-publish, chat, demand-detail, index, login, message, my-demands, nearby-list, nearby-map, order-detail, orders, partner-detail, pay, pkg-low, privacy, profile, publish, square, workbench
- **components（21）**：bottom-sheet, confirm-progress, demand-card, empty-state, nav-bar, night-mask, order-progress, partner-card, safe-sell-bar, section-card, signature-canvas, status-tag, tag-chip, tm-template-card, ui-button, ui-card, ui-cell, ui-empty, ui-skeleton, ui-tag
- **utils（10）**：bootstrap.js, cloud.js, constants.js, order-view.js, redline.js, report.js, swr.js, take-order.js, testmode.js, util.js
- **config（2）**：enums.js, index.js（前端配置源）
- **其他**：custom-tab-bar/（自定义 tab）、styles/tokens.wxss（设计 token）、mock/（6 个 mock 数据集：conversations/demands/drafts/incomes/orders/users）、images/（仅 2 个 marker PNG，图片走云端/CDN）
- 分包：4 个（pkgAdmin/pkgAgreement/pkgPrivacy/pkgLow）+ preloadRule + `lazyCodeLoading:"requiredComponents"`

### 3b. 页面 → 云函数.action 映射（实测 `callCloud('fn',{action})` / `app.cloudCall`；子表省略动态 action 变量）

| 页面（pages-v2/） | 调用的 云函数.action |
|---|---|
| index | user-login.peek_login；home-action.nearby / square / home_activity_list / scene_groups |
| login | user-login.peek_login / login |
| publish | home-action.scene_groups；demand-publish.detail / list_drafts / publish；user-login.peek_login；admin-action.config_public；partner-action.detail |
| demand-detail | demand-publish.detail_light / cancel / (发布复用 publish payload) |
| square | home-action.square / home_activity_list |
| nearby-list | home-action.nearby |
| nearby-map | user-login.peek_login / report_map_gps / nearby_map_list / set_map_share |
| orders | order-action.my_orders / detail |
| order-detail | order-action.detail / timeline / notice_poll / notice_read / start_service / complete_service / resume_service / partial_confirm / ratio_confirm / modify_confirm / modify_reject / no_show_report_detail / no_show_report_withdraw / complaint_withdraw；payment-mock.tip_list / mock_tip；safety-report.status / (安全上报) |
| my-demands | demand-publish.my_demands |
| chat | im-conv.open / messages；order-action.get_confirmation / notice_poll / (履约动作)；im-send.send_text / send_kefu |
| message | im-conv.my_convs；order-action.notice_list |
| profile | user-login.peek_login / close_account；partner-action.my_profile / exam_subjects；order-action.my_counts / my_orders / notice_list；demand-publish.my_demands |
| workbench | payment-mock.balance_info / income_list；partner-action.my_profile / set_switch；safety-report.sos |
| partner-detail | partner-action.detail / route_plan / (预约)；blog-action.author_home |
| blog | blog-action.feed_list / my_list |
| blog-detail | blog-action.detail / comment_list / like / unlike / comment_add / delete_my / comment_delete |
| blog-publish | blog-action.publish |
| pay | payment-mock.cashier_info / mock_pay |
| admin（pkgAdmin 子页） | admin-action.admin_list / dashboard / user_list / partner_list / review / order_list / order_force_cancel / finance_list / demand_list / demand_offline / config_get / config_set |
| pkg-low/wallet | payment-mock.balance_info / income_list / tip_income_list / withdraw_list / withdraw / fast_withdraw |
| pkg-low/contacts | user-login.get_emergency_contact / set_emergency_contact |
| pkg-low/safety | order-action.detail；safety-report.checkin / sos / silent_sos / cancel_silent_sos / resolve_sos |
| pkg-low/realname | admin-action.config_public；user-login.submit_realname |
| pkg-low/accept-config | partner-action.my_profile / exam_subjects / sub_authorize / update_config；home-action.scene_groups；admin-action.config_public |
| pkg-low/partner-profile-edit | admin-action.config_public；partner-action.my_profile / update_partner_profile |
| pkg-low/exam-status | partner-action.my_profile / exam_subjects |
| agreement / privacy / pkg-low 静态页 | 无云调用（静态内容） |
| utils/take-order.js（公共工具） | order-create.check_signed / sign_disclaimer / check_take_result |

## 4. 后台管理端（c:\zhaoren\admin-web-frontend）

- 技术栈：Vue 3.5 + Vite 8 + Element Plus 2.14 + axios 1.20 + vue-router 4.6
- **views（36）**：Accounts, Audit, Blog, Comment, Config, ConfigLog, Conversation, Dashboard, Demand, Dispute, Exam, Export, Finance, Insurance, Kefu, Layout, Legal, Login, NoShow, Notice, Operations, Orders, PartnerProfileReview, Partners, Report, Review, SafetyLog, Users …
- 通信：`src/api/admin.js`（axios 封装；统一注入 `X-Admin-Token`；`config_set`/`home_activity_*` 成功统一提示「约 5 分钟内生效」）
- 构建：`scripts/build-admin-web.ps1`（npm build + 清理 assets + 复制 dist 到 public）

## 5. 工程门禁与运维脚本

- **`npm run verify`** = check-syntax → check-ssot → check-shared-sync → check-handlers(116 actions) → check-index-ledger → check-deploy-config → check-manual-links → npm test
- `npm test` = `node --test _shared/*.test.js` + `ab_equivalence.js`
- 现状：**335 pass / 0 fail**；A/B 203 例（87 explicit + 116 auto；7 known-evolution）；手册链接 56 条全有效
- scripts（22）：check-*.js/ps1（7 个检查器，含 check-manual-links.js）、build-admin-web.ps1、create-warmup-trigger.js、rotate-admin-key.js、rehearse-key-rotation.js、tcb-exec.js、tcb-scan-indexes.js、tcb-diff-indexes.js、dump-index-ledger.js、gate.ps1、check-heartbeat.ps1、backfill-phone-enc.js 等

## 6. 环境与部署（脱敏，手册正文不写真实值）

- 环境 ID / AppID / AppSecret / admin key：**手册只写"存放位置与读取机制"，不写明文**
- 部署 CLI：`c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`；云函数**必须串行部署**，部署后等 90-120s，`functions info` 读回
- `deploy` 只上传代码，**不应用** config.json 的 timeout/triggers → 触发器须另经 miniprogram-ci（受 IP 白名单）或控制台

## 7. 缺口清单

**已补齐（阶段一）**
1. ✅ 云函数完整 action 清单 → §1b
2. ✅ `_shared` 模块 → 函数副本映射 → §2b
3. ✅ 页面 → 云函数调用映射 → §3b

**待补齐（阶段二正文）**
4. ✅ 数据集合清单（26 集合）与 CONFIG_SCHEMA 键组 → 见 [Ch3 §3.2/§3.5](file:///c:/zhaoren/docs/dev-manual/03-data-model.md)
5. ✅ 订单状态机全图（14 态 / 22 条迁移 / 正交位 / CAS）→ 见 [Ch9 §9.1](file:///c:/zhaoren/docs/dev-manual/09-business-domains.md)
6. ✅ 实现决策台账 → 见 [90-appendix §A.3](file:///c:/zhaoren/docs/dev-manual/90-appendix.md)（记录「实现为何这么做及其理由」——**不做 PRD 差异对齐**；用户已声明实现超越原 PRD）
