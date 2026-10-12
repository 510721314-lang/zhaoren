# Ch3 · 数据模型与配置（CONFIG_SCHEMA）

> 事实来源：代码实测（2026-10）。集合清单/索引台账取自 [init-db/index.js](file:///c:/zhaoren/cloudfunctions/init-db/index.js)，配置键组取自 [admin-action/index.js](file:///c:/zhaoren/cloudfunctions/admin-action/index.js) 的 `CONFIG_SCHEMA` 与 [action_config_set.js](file:///c:/zhaoren/cloudfunctions/admin-action/action_config_set.js)。
> 本章**自含**：所有集合与配置键均在此定义，不依赖任何外部文档。

## 3.1 数据层总览

- **存储**：微信云开发云数据库（文档型），单一环境（envId 见 [cloudbaserc.json](file:///c:/zhaoren/cloudbaserc.json)，**手册不写值**）。
- **SDK**：所有云函数经 `wx-server-sdk` 访问；`db = cloud.database()`，`_ = db.command`。SDK 无 `createIndex` API，索引须控制台手工建（见 §3.4）。
- **命名约定**：
  - 集合名：小写 + 下划线（`order_main`、`no_show_report`）。
  - 金额字段：一律以「分」为单位的整数，后缀 `_fen`。
  - 时间字段：毫秒时间戳整数，后缀 `_at`；「时长/窗口」用 `_min`（分）/ `_h`（时）/ `_d`（天）/ `_days`。
  - 基础字段：多数业务集合含 `created_at` / `updated_at` / `is_deleted`（软删除，查询用 `_.neq(true)` 过滤）。
- **写入唯一性**：集合由 [init-db/index.js](file:///c:/zhaoren/cloudfunctions/init-db/index.js) 的 `COLLECTIONS` 台账统一创建（幂等），另有 3 个运行时按需创建的集合（`config_history` / `admin_web_sessions` / `exam_bank`）。

## 3.2 集合清单与用途

`COLLECTIONS` 台账（26 个）实测于 [init-db/index.js](file:///c:/zhaoren/cloudfunctions/init-db/index.js#L10-L20)：

| 集合 | 用途 | 主要写入方 | 关键字段 |
|---|---|---|---|
| `user_account` | 用户主账号（含实名、信用、地图共享态） | user-login | openid, nickname, avatar, phone_hash, real_name, idcard_enc, idcard_mask, age, is_realname_done, credit, allow_map_share, status |
| `partner_profile` | 耍伴经营资料与审核态 | partner-apply / partner-action | openid, nickname, accept_scenes, scene_rates, exam_scores, city, accept_switch, status, profile_audited_snapshot |
| `demand` | 需求单（大厅/匹配源） | demand-publish | creator_openid, scene, start_time, duration_h, location, publish_location, content_options, remark, rate_fen, budget_fen, match_mode, status, broadcast, expire_at, is_deleted |
| `order_main` | 订单主表（履约主对象） | order-create | order_no, demand_id, user_openid, partner_openid, amount_fen, status, eval_state, dispute_state, dispute_type, frozen, fund, cancel_request, pending_extend |
| `order_confirmations` | 下单前「四确认」逐项确认记录 | order-action | order_id, item, confirmed, confirmed_by, role |
| `order_status_log` | 订单状态流水（时间线数据源） | order-action / order-timer | order_id, from_status, to_status, action, operator |
| `pay_transaction` | 支付/退款/加时/打赏流水 | payment-mock / order-create | pay_no, order_id, order_no, type, amount_fen, fee_fen, channel, is_mock, status, paid_at |
| `im_conversation` | 会话（订单会话 / 客服会话） | im-conv | order_id（客服固定 ''）, order_no, members, last_msg, updated_at |
| `im_message` | 私信消息 | im-send | conv_id, from_openid, content, type, created_at |
| `safety_report` | 安全上报（SOS / 报备 / 签到 / 举报） | safety-report | order_id, reporter_openid, type, status, payload |
| `credit_score_log` | 信用分流水（裁定聚合源） | evaluation-submit / order-timer | openid, type, score, delta, order_id |
| `emergency_contact` | 紧急联系人 | user-login | openid, name, phone, relation |
| `evaluation` | 订单评价 | evaluation-submit | order_id, rater_openid, target_openid, star, tags, content, anonymous |
| `settlement` | 结算单 | order-timer / admin-action | order_id, partner_openid, base_fen, fee_fen, net_fen, state |
| `platform_event` | 平台事件（P0/P1/P2/P3 巡检源） | 全函数 logEvent | level, type, openid, payload |
| `admin_config` | 运营配置单一源（`doc('global')`） | admin-action / init-db | 见 §3.5 |
| `disclaimer_signature` | 免责声明/协议签署留证 | order-create | kind, openid, role, disclaimer_type, signature_file_id, signature_hash, docs, signed_at |
| `withdraw_record` | 提现记录 | payment-mock | openid, amount_fen, state, arrived_at |
| `demand_draft` | 需求草稿 | demand-publish | openid, payload, updated_at |
| `withdraw_lock` | 提现并发锁 | payment-mock | openid, locked_until |
| `system_notice` | 站内通知（消息中心） | order-action / order-timer | to_openid, order_id, type, title, body, action_key, action_payload, read |
| `insurance_record` | 保险购买记录 | payment-mock | order_id, openid, coverage, premium_fen, state |
| `audit_log` | 行为审计日志（哈希链） | `_shared/audit.js` | openid, role, category, action, target_type, target_id, detail, doc_hash, prev_hash, chain_hash, at |
| `admin_accounts` | 后台账号（RBAC） | admin-action | account（唯一）, password_hash, role, status |
| `no_show_report` | 爽约申诉记录 | order-action（规则 [_shared/no_show_rules.js](file:///c:/zhaoren/cloudfunctions/_shared/no_show_rules.js)） | order_id, reporter_openid, target_openid, status(received/defense/decided), evidence, reason |
| `complaint` | 投诉记录（纠纷详情时间线源） | order-action | order_id, complainant_openid, reason, evidence, status |

**运行时按需创建**（不在 `COLLECTIONS` 台账，由 admin-action `db.createCollection` 兜底）：
`config_history`（配置变更快照，最多留存 100 条）、`admin_web_sessions`（后台会话 12h）、`exam_bank`（耍伴考试题库）。

### 3.2b 订单主表 `order_main` 关键字段（履约域核心）

`order_main` 承载订单全生命周期，**返回 null 状态由业务上下文决定**。代表字段（见 [order-create/index.js](file:///c:/zhaoren/cloudfunctions/order-create/index.js) 与 [_shared/order_state.js](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js)）：

- 主轴：`status`（S 码，见 Ch9）；`order_no`（唯一）；`demand_id`；`user_openid` / `partner_openid`。
- 正交位（见 §9.2）：`eval_state`、`dispute_state`、`dispute_type`、`frozen`、`fund{paid_fen, refunded_fen, settle_state, settled_at}`。
- 挂起字段：`cancel_request{by, reason, pre_amount_fen, expire_at}`（S2 协商取消链，见 §9.4）；`pending_extend{...}`（加时申请）。
- 金额：`amount_fen`（总额）、`base_fen`（结算基数）。

> 正交位默认值由 `orthoDefaults()` 生成（[_shared/order_state.js](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L91-L99)）。

## 3.3 字段与下标命名的强约定

- **联合主键式软删**：业务集合以 `_id` 为主键，逻辑删除用 `is_deleted: true`，查询侧普遍 `where({ is_deleted: _.neq(true) })`。
- **手机号密文**：`user_account.phone_hash`（确定性 HMAC，供查询）+ 密文列，脱敏展示列 `138****5678`。密钥由 [phone_crypt.js](file:///c:/zhaoren/cloudfunctions/_shared/phone_crypt.js) 管理，**手册不写密钥**。
- **身份证密文**：`idcard_enc`（密文）+ `idcard_mask`（脱敏展示）。
- **哈希链审计**：`audit_log` 每条记录 `prev_hash` → `chain_hash`，`audit_verify` 可全量校验（见 [audit.js](file:///c:/zhaoren/cloudfunctions/_shared/audit.js)）。
- **敏感字段掩码入库**：`config_set` 写审计时对键名匹配 `/key|secret|token/i` 的字段深度掩码为 `***`（[action_config_set.js](file:///c:/zhaoren/cloudfunctions/admin-action/action_config_set.js#L368-L376)）。

## 3.4 索引台账（`INDEXES`）

> ⚠️ SDK 无 `createIndex`，本台账**仅作设计 SSOT**，实际须在云开发控制台「数据库→索引管理」手工创建。台账实测于 [init-db/index.js](file:///c:/zhaoren/cloudfunctions/init-db/index.js#L27-L72)。

| 集合 | 索引名 | 键 | 唯一 |
|---|---|---|---|
| user_account | uk_openid | openid↑ | ✅ |
| user_account | idx_phone_hash | phone_hash↑ | |
| partner_profile | uk_openid | openid↑ | ✅ |
| demand | idx_creator_status_created | creator_openid↑, status↑, created_at↓ | |
| demand | idx_status_created | status↑, created_at↓ | |
| demand | idx_expire_at | expire_at↑ | |
| demand | idx_hall_broadcast_status_created | is_deleted↑, status↑, broadcast↑, created_at↓, expire_at↑ | |
| demand | idx_hall_scene_status_created | is_deleted↑, status↑, broadcast↑, scene↑, created_at↓, expire_at↑ | |
| order_main | uk_order_no | order_no↑ | ✅ |
| order_main | idx_demand_id | demand_id↑ | |
| order_main | idx_partner_status | partner_openid↑, status↑ | |
| order_main | idx_user_status | user_openid↑, status↑ | |
| order_main | idx_created | created_at↓ | |
| pay_transaction | idx_order_id | order_id↑ | |
| order_status_log | idx_order_created | order_id↑, created_at↓ | |
| im_conversation | uk_order_id | order_id↑ | ✅ |
| im_conversation | idx_order_no | order_no↑ | |
| admin_accounts | uk_account | account↑ | ✅ |
| im_message | idx_conv_created | conv_id↑, created_at↓ | |
| evaluation | idx_order_id | order_id↑ | |
| settlement | idx_order_id | order_id↑ | |
| withdraw_record | idx_openid_created | openid↑, created_at↓ | |
| demand_draft | idx_openid_updated | openid↑, updated_at↓ | |
| safety_report | idx_order_type_status_created | order_id↑, type↑, status↑, created_at↓ | |
| safety_report | idx_order_reporter_type_created | order_id↑, reporter_openid↑, type↑, created_at↓ | |
| system_notice | idx_to_read_created | to_openid↑, read↑, created_at↓ | |
| system_notice | idx_order_created | order_id↑, created_at↓ | |
| system_notice | idx_to_created | to_openid↑, created_at↓ | |
| audit_log | idx_openid_at | openid↑, at↓ | |
| no_show_report | idx_order_id | order_id↑ | |
| no_show_report | idx_status_created | status↑, created_at↓ | |
| no_show_report | idx_target_created | target_openid↑, created_at↓ | |
| credit_score_log | idx_openid_type_created | openid↑, type↑, created_at↓ | |

**关键约束**：`im_conversation.uk_order_id` 唯一索引 —— 客服场景固定 `order_id: ''`，故全局仅一条客服会话（见 [05-redlines.md](file:///c:/zhaoren/docs/dev-manual/05-redlines.md) §5.6）。

## 3.5 admin_config 与 CONFIG_SCHEMA

### 3.5.1 单一文档

平台所有可运营参数集中于 `admin_config` 集合的 `doc('global')`。读取侧经 `config_get` / `config_public`（[action_config_read.js](file:///c:/zhaoren/cloudfunctions/admin-action/action_config_read.js)）；写入侧唯一入口 `config_set`（[action_config_set.js](file:///c:/zhaoren/cloudfunctions/admin-action/action_config_set.js)），**所有写入前置 `CONFIG_SCHEMA` 校验 + 事务更新 + `config_history` 快照 + `platform_event` 审计**。

### 3.5.2 环境开关（安全红线相关）

| 键 | 语义 | 取值/约束 |
|---|---|---|
| `env` | 运行环境 | `dev` / `prod`；切 dev 须 `confirm=SWITCH_DEV` 且带 `dev_hours`(1-24) 或 `dev_bypass=true` |
| `dev_until` | dev 有效期截止 | 时间戳；到期自动回 prod 兜底（4h 兜底见 Ch5） |
| `dev_bypass` | 回滚开关（旧无过期） | bool |
| `admin_web_key` | 后台网关共享密钥 | 格式 `AWK-` + 64 hex；轮换须 `reason` |
| `security_only_template_before_confirm` | 四确认前仅模板消息 | bool |
| `mock_payment_enabled` | 模拟支付开关（测试期） | bool，默认 false；`mock_tip` 恒随 env 关闭 |
| `auto_approve_partner` | 自动通过耍伴申请 | bool，默认 false |

### 3.5.3 `CONFIG_SCHEMA` 键组（运营参数，分组）

`CONFIG_SCHEMA` 定义于 [admin-action/index.js](file:///c:/zhaoren/cloudfunctions/admin-action/index.js#L98-L204)；每项含 `{f:键, t:类型(int/bool/enum), g:分组, label, unit?, min?, max?, def?, opts?}`。类型 `int` 走区间校验，`enum` 走白名单校验，`bool` 直转。

| 分组 | 键（`f`） | 说明 |
|---|---|---|
| 距离与限额 | publish_distance_max_km, take_distance_max_km, youth_limit_fen, partner_daily_take_limit | 发布/接单距离上限、青年单笔预算、耍伴每日接单上限 |
| 订单超时 | s0_timeout_min, s1_timeout_min, interrupt_timeout_h, after_sale_days, partial_judge_days, remind_after_h, escalate_after_h, urge_max_count, eval_window_h, milestone_confirm_min, extend_confirm_h, default_star | 各状态超时窗口、催办三段式阈值、评价窗口、里程碑确认、加时确认、默认星级 |
| 时间红线 | time_redline_close_min, time_redline_open_min | 接单开放/截止（0=00:00；close=0 表示全天开放） |
| 信用阈值 | min_credit_take_order, min_credit_place_order, credit_freeze_line, order_good_review_min_stars | 接单/发单最低分、冻结线、好评星级阈值 |
| 费率 | rate_min_fen, rate_max_fen, fixed_price_min_fen, fixed_price_max_fen, scene_default_rate_fen, welfare_hourly_rate_fen, welfare_fixed_price_fen | 时薪区间、一口价区间、场景默认时薪、公益单时薪/一口价 |
| 保险与提现 | insurance_coverage_accident_fen, insurance_coverage_property_fen, fast_withdraw_per_order_max_fen, fast_withdraw_per_day_max_fen | 意外/财产险保额、极速提现单笔/日上限 |
| AA 记账 | aa_record_max_fen, aa_ledger_max_fen, aa_ledger_max_records | AA 单笔/单订单累计/条数上限（线下台账仅记账不代收） |
| 通用开关 | auto_approve_partner, payment_visible, platform_fee_rate_fen, mock_payment_enabled, audit_prune_dry_run | 抽成（万分比）、支付入口显隐、审计清理 dry-run 等 |
| 平台总开关 | switch_access, switch_blog, switch_im | 核心交易 / 动态社区 / 私信（关停=维护态，服务端拦截） |
| 私信频控 | im_rate_window_min, im_rate_max_count | 滑动窗口分钟数 + 窗口内消息上限（im-send 服务端计数） |
| 实名与签署 | realname_face_mode | `mock` / `wx`（类目资质审批后切微信官方人脸核验） |
| 耍伴资料 | p_skills_max, p_skills_len, p_highlights_max, p_highlight_len, p_media_title_max, p_media_len, p_media_photo_max, p_media_photo_size_mb, p_bio_len | 技能/亮点/资质/简介的数量与字数上限 |
| 消息 | msg_page_size | 会话列表每页加载数 |
| 发布与展示 | publish_content_options_max, workbench_income_show, order_page_size, page_index_nearby, page_index_square, page_square_limit, page_nearby_limit, page_wallet_withdraw, page_notice_limit, share_title_max, order_reason_max_len, scene_option_display_max | 各类分页/字数/展示条数上限 |
| 爽约处罚 | no_show_report_window_h, no_show_defense_window_h, no_show_score_deduct, no_show_suspend_threshold, no_show_suspend_days, no_show_count_window_days, no_show_evidence_max, no_show_reason_min_len, no_show_max_per_order | 申诉/举证窗口、扣分、停用阈值与天数、举证张数、理由字数、单方申诉上限 |

> 交叉校验（`config_set` 内）：`rate_min_fen < rate_max_fen`、`fixed_price_min_fen ≤ fixed_price_max_fen`、`time_redline_open_min < time_redline_close_min`（close>0 时）。

### 3.5.4 非 SCHEMA 配置键（散点写入）

以下键**不在 `CONFIG_SCHEMA`**，由 `config_set` 以专用分支写入（部分带独立校验）：

| 键 | 语义 | 校验要点 |
|---|---|---|
| `city_enabled` | 开通城市 | `city_add`/`city_remove` 增量 |
| `block_words` | 本地兜底敏感词库 | `block_words_add`/`block_words_remove` 增量 |
| `test_openids` | 测试白名单 | 增量 |
| `error_scan_exempt_types` | 巡检豁免项 | 全量替换；`type` 或 `type:reason`；≤50 条、≤60 字 |
| `modify_config` | 改期规则 | `{minLeadHours,maxTimes,maxSpanH,confirmHours}` 区间校验 |
| `sub_msg_templates` | 订阅模板 ID | 白名单键 `demand_grab`/`demand_urge`；ID 格式校验 |
| `sub_msg_https` | 订阅 HTTPS 通道凭据（opt-in） | `{appid, secret}`；appid 须 `wx`+16hex |
| `scene_list` | 场景白名单 | 增删场景/服务项/可见性；内置场景不可删（`builtin`）；名称 ≤12、服务项 ≤8 |
| `system_templates` | IM 系统模板消息 | `template_add`/`template_remove`；文案 ≤30 字 |
| `legal_disclaimer_text` / `legal_service_agreement` / `legal_privacy_policy` / `legal_aa_promise` / `legal_pet_authorization` | 法律文本 | 长度校验 |
| `legal_scene_disclaimers` | 分场景免责声明 | `{scene_code: text}`，单条 ≤4000 字 |

### 3.5.5 种子配置（`SEED_CONFIG`）

init-db 的 `SEED_CONFIG`（[init-db/index.js](file:///c:/zhaoren/cloudfunctions/init-db/index.js#L75-L146)）是 `doc('global')` 的初始快照：含 `platform_fee_rate_fen=1000`（10%）、9 个开放场景 `scene_list`（W1/W2/W3/W4/W7/W8/W9/W10/W11，W5/W6 已终止）、8 条 IM 系统模板、`block_words` 兜底词库、`version='V15-MVP'` 等。**仅幂等补齐，不覆盖已有值**。

> **配置一致性红线**：`SEED_CONFIG.scene_list` 必须与云端 `admin_config.scene_list` 的开放场景保持一致（补充前先核对线上 `config_get`）。

## 3.6 配置生效时延（运营侧须知）

- `admin_config.scene_list` 缓存 **5 分钟**；`home-action.scene_groups` 缓存 **60 秒**。
- 后台改显隐/服务项后，C 端最长约 **5 分钟**生效。后台 `config_set` 成功统一提示「约 5 分钟内生效」。

## 3.7 数据一致性约定小结

1. **单源**：运营参数只在 `admin_config.global`；集合清单只在 `COLLECTIONS`；共享逻辑只在 `_shared/`（SHA 门禁，见 Ch6）。
2. **不可绕过的写入入口**：配置写 → `config_set`；状态流转 → `casTransition`（乐观锁，见 Ch9）。
3. **fail-closed**：配置读取失败按 prod 兜底、按默认值兜底，不隐式放开 mock。
4. **脱敏到边界**：手机/身份证密文+掩码；审计掩码敏感键；订单时间线不暴露原始 openid。
