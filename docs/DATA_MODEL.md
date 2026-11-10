# DATA_MODEL · 数据模型与配置口径

> 事实源：代码实测（2026-11-08）。集合/索引取自 [init-db/index.js](../cloudfunctions/init-db/index.js)，配置键取自 [admin-action/config_schema.js](../cloudfunctions/admin-action/config_schema.js)，状态码取自 [order-action/order_state.js](../cloudfunctions/order-action/order_state.js)。
> **口径同源声明**：本文件的机械数字与 `scripts/check-prd-drift.js` 完全同源（同一文件、同一正则、同一枚举方式），不另立第二套口径。门禁任一断言变化时，本文件随之修订。

## 1. 同源机械数字（门禁口径）

| 指标 | 值 | 机械依据 |
|---|---|---|
| 页面合计 | **45** | [app.json](../miniprogram/app.json)：主包 19 + 分包 4 个 26 页 |
| 云函数目录 / 业务函数 | **21 / 20** | `cloudfunctions/` 目录枚举（`_shared` 不计业务函数） |
| 数据库集合 | **38 = 31 声明 + 7 运行时** | `init-db` 的 `COLLECTIONS` + PRD §16.1 运行时清单（逐项在代码命中） |
| 订单状态码 | **16** | `order_state.js` 的 `OrderStatus` typedef |
| 自定义组件 | **25** | `miniprogram/components/` 目录枚举 |
| 后台视图 | **32** | `admin-web-frontend/src/views/` 递归 `.vue` |
| 配置键（门禁口径） | **29** | PRD 附录 J 逐键对 `config_schema.js`；其中 `env` 为云端特殊键，不参与 schema 校验 |
| 配置键（SSOT 全量） | **105** | `config_schema.js` 中 `{ f: '…' }` 条目数（与门禁同一正则） |
| 索引台账 | **49 条 / 25 集合 / 9 唯一** | `init-db` 的 `INDEXES` 数组实测 |

> 两个配置键数字不是冲突：**29 = 附录 J 列出的「核心可配置规则」**（PRD 声明 + 门禁断言）；**105 = schema 定义的全量键**（含分页、长度、展示开关等细粒度项）。写作与评审一律先看 §1 表，不再引用旧稿数字。

## 2. 集合清单（38）

### 2.1 `init-db` 声明（31，来源 `COLLECTIONS`）

| # | 集合 | 用途 | 主要写入方 |
|---|---|---|---|
| 1 | `user_account` | 用户主账号（实名、信用、地图共享态） | user-login |
| 2 | `partner_profile` | 耍伴经营资料与审核态 | partner-apply / partner-action |
| 3 | `demand` | 需求单（大厅与匹配源） | demand-publish / zz-seed-orders |
| 4 | `order_main` | 订单主表（履约主对象） | order-create（[action_take.js:501](../cloudfunctions/order-create/action_take.js)） |
| 5 | `order_confirmations` | 下单前「四确认」逐项记录 | order-create（[action_take.js:505](../cloudfunctions/order-create/action_take.js)） |
| 6 | `order_status_log` | 订单状态流水（时间线源） | order-action / order-create / payment-mock |
| 7 | `pay_transaction` | 支付/退款/加时/打赏流水 | payment-mock（[action_pay.js:129](../cloudfunctions/payment-mock/action_pay.js)） |
| 8 | `im_conversation` | 会话（订单会话 / 客服会话） | im-conv |
| 9 | `im_message` | 私信消息 | im-send |
| 10 | `safety_report` | 安全上报（SOS / 报备 / 签到） | safety-report |
| 11 | `credit_score_log` | 信用分流水（裁定聚合源） | evaluation-submit（[index.js:288](../cloudfunctions/evaluation-submit/index.js)）/ order-timer |
| 12 | `emergency_contact` | 紧急联系人 | user-login |
| 13 | `evaluation` | 订单评价 | evaluation-submit（[index.js:270](../cloudfunctions/evaluation-submit/index.js)） |
| 14 | `settlement` | 结算单 | order-timer / admin-action |
| 15 | `platform_event` | 平台事件（P0–P3 巡检源）；已知事件：`pay_compensate_fail`（P0，支付事务补偿失败）、`gateway_bad_key`（P2，网关鉴权失败） | 全函数 `logEvent` |
| 16 | `admin_config` | 运营配置单一源（`doc('global')`） | init-db / admin-action |
| 17 | `disclaimer_signature` | 协议签署留证 | order-create（[action_take.js:525](../cloudfunctions/order-create/action_take.js)） |
| 18 | `withdraw_record` | 提现记录 | payment-mock |
| 19 | `demand_draft` | 需求草稿 | demand-publish |
| 20 | `withdraw_lock` | 提现并发锁 | payment-mock |
| 21 | `system_notice` | 站内通知（消息中心） | order-action / order-timer / evaluation-submit |
| 22 | `insurance_record` | 保险购买记录 | payment-mock |
| 23 | `audit_log` | 行为审计（哈希链） | `_shared/audit.js` |
| 24 | `admin_accounts` | 后台账号（RBAC） | admin-action |
| 25 | `no_show_report` | 爽约申诉（received / defense / decided / withdrawn） | order-action / admin-action |
| 26 | `complaint` | 投诉记录（纠纷时间线源） | order-action |
| 27 | `questions` | 题库 SSOT（`subject + qid` 唯一） | admin-action（[action_question.js:63](../cloudfunctions/admin-action/action_question.js)） |
| 28 | `exam_sessions` | 考试留痕 | partner-action |
| 29 | `certificates` | 考试证书 | partner-action |
| 30 | `study_records` | 学习进度（`openid + subject + chapter_id` 唯一索引已建）；**【待确认】实测无写入方** | 无（`cloudfunctions/` 中无 `study_records` 写入点） |
| 31 | `study_content` | 学习内容（`subject/module_id/chapter_id/sort`） | 唯一写路径 `scripts/seed-study-content.js`（Markdown → 集合）；admin-action / partner-action 只读 |

### 2.2 运行时另建/使用（7，来源 PRD §16.1 + 代码检索命中）

| # | 集合 | 用途 | 创建/写入点 |
|---|---|---|---|
| 32 | `admin_web_sessions` | 后台登录会话（12h，可被停用账号撤销） | [action_admin_account.js:47](../cloudfunctions/admin-action/action_admin_account.js) |
| 33 | `exam_bank` | 旧题库（旧 `exam_subject_*` 写入已退役，只读兼容） | [action_exam.js](../cloudfunctions/admin-action/action_exam.js) |
| 34 | `config_history` | 配置变更快照（后台历史列表数据源） | [action_config_read.js:83](../cloudfunctions/admin-action/action_config_read.js) |
| 35 | `blog_post` | 服务动态主表（`status: normal/offline/deleted`） | [action_blog.js:9](../cloudfunctions/admin-action/action_blog.js) |
| 36 | `blog_like` | 动态点赞 | blog-action |
| 37 | `blog_comment` | 动态评论（软删 + 主表 `comment_count` 回写） | [action_blog.js:66](../cloudfunctions/admin-action/action_blog.js) |
| 38 | `legal_doc` | 法律文档版本库（`doc_type + scope + version` 唯一） | [action_legal_doc.js](../cloudfunctions/admin-action/action_legal_doc.js) |

## 3. 核心集合主要字段

> 下列字段为**主要写入字段**，不等于完整 schema；以写入方代码为准。未列出的字段一律视为【待后端确认】。

### 3.1 `order_main`（履约核心）

| 字段组 | 字段 | 说明 |
|---|---|---|
| 标识 | `order_no`（唯一）、`demand_id`、`user_openid`、`partner_openid` | `uk_order_no` 全表唯一，无部分索引 |
| 主轴 | `status` | S 码，见 §4 |
| 正交位 | `eval_state`、`dispute_state`、`dispute_type`、`frozen`、`fund{paid_fen, refunded_fen, settle_state, settled_at}` | 由 `orthoDefaults()` 生成 |
| 金额 | `amount_fen`、`base_fen`、`total_fen`、`partner_income_fen`、`tip_total_fen` | 整数「分」；`partner_income_fen` 为耍伴实收快照（钱包聚合直接 sum 该字段） |
| 挂起链 | `cancel_request{by, reason, pre_amount_fen, expire_at}`、`pending_extend{…}` | S2 协商取消 / 加时申请 |

### 3.2 其他核心表（字段示例）

| 集合 | 主要字段 |
|---|---|
| `demand` | `creator_openid`、`scene`、`start_time`、`duration_h`、`location`、`publish_location`、`content_options`、`rate_fen`、`budget_fen`、`match_mode`、`status`、`broadcast`、`expire_at`、`is_deleted`、`grab_notify_pending` |
| `user_account` | `openid`（唯一）、`nickname`、`avatar`、`phone_hash`（确定性 HMAC）、`real_name`、`idcard_enc`、`idcard_mask`、`age`、`is_realname_done`、`credit`、`allow_map_share`、`status` |
| `partner_profile` | `openid`（唯一）、`nickname`、`accept_scenes`、`scene_rates`、`exam_scores`、`city`、`accept_switch`、`status`、`profile_audited_snapshot` |
| `pay_transaction` | `pay_no`（唯一）、`order_id`、`order_no`、`type`、`amount_fen`、`fee_fen`、`channel`、`is_mock`、`status`、`paid_at`、`partner_openid`（打赏专栏按人查询快照）、`scene`（场景快照） |
| `safety_report` | `order_id`、`reporter_openid`、`type`（sos / checkin / silent）、`status`、`payload` |
| `im_conversation` | `order_id`（唯一；客服会话用 `kefu_<openid>` 占位）、`order_no`、`members`、`last_msg`、`last_msg_at` |
| `im_message` | `conv_id`、`from_openid`、`content`、`type`、`created_at` |
| `evaluation` | `order_id`、`rater_openid`、`target_openid`、`star`、`tags`、`content`、`anonymous` |
| `settlement` | `order_id`、`partner_openid`、`base_fen`、`fee_fen`、`net_fen`、`state` |
| `audit_log` | `openid`、`role`、`category`、`action`、`target_type`、`target_id`、`detail`、`prev_hash`、`chain_hash`、`at` |
| `admin_accounts` | `account`（唯一）、`password_hash`、`role`、`status` |
| `no_show_report` | `order_id`、`reporter_openid`、`target_openid`、`status`、`evidence`、`reason` |
| `questions` | `subject`、`paper`、`module`、`qid`、`type`（single/multi）、`stem`、`options`、`answer_idx`、`score`、`difficulty`、`knowledge`、`analysis`、`status`、`version` |
| `legal_doc` | `doc_type`、`scope`（场景 code）、`version`、`content`、`title`、`remark`、`status`（published / archived / retired）、`updated_at` |
| `blog_post` | `author_openid`、`author_nickname`、`scene`、`content`、`images`、`like_count`、`comment_count`、`view_count`、`status`、`offline_by`、`offline_note` |

## 4. 状态码与正交位

### 4.1 订单主轴 16 码（`OrderStatus`）

`S0` 待支付、`S1` 待确认、`S2` 已支付待履约、`S2_5` 改期处理中、`S2_6` 开始履约申请中、`S3` 履约中、`S3_6` 履约完毕确认中、`S3.5` 履约中断、`S4` 部分完成、`S5` 已完成、`S6` 已取消、`S7` 已退款、`S8` 已评价、`S9` 评价超时、`S10` 已关闭、`S10.5` 争议处理中。

- 13 态红线（`.trae/rules/` 附录 A）+ 3 个中间态（`S2_5` / `S2_6` / `S3_6`）= 16。
- `S2_6` / `S3_6` 为 2026-10-14 履约双确认新增（[order_state.js:74-77](../cloudfunctions/order-action/order_state.js)）：`start_apply` → `S2_6`、`finish_apply` → `S3_6`；两态超时/连续拒绝进 `S10.5`。
- 合法迁移表以 `order_state.js` 的 `TRANSITIONS`（no.1–30）为 SSOT；本文件不复述逐条迁移，避免两套口径。

### 4.2 正交位（与主轴并行，不占状态码）

| 正交位 | 取值 | 说明 |
|---|---|---|
| `eval_state` | `pending` / `user_done` / `auto_done` | 评价位；`S9` 退役收编为 `S8 + auto_done` |
| `dispute_state` | `none` / `open` / `resolved` | 争议位 |
| `dispute_type` | `complaint` / `no_show` / `refund` / `''` | 争议类型 |
| `fund.settle_state` | `pending` / `ready` / `done` | 结算位 |

## 5. `admin_config` 配置键

### 5.1 门禁口径：附录 J 的 29 个核心键

| 分组 | 键 |
|---|---|
| 费率与场景 | `rate_min_fen`、`rate_max_fen`、`scene_default_rate_fen`、`platform_fee_rate_fen`、`welfare_hourly_rate_fen`、`welfare_fixed_price_fen` |
| 超时 | `s0_timeout_min`、`s1_timeout_min`、`interrupt_timeout_h`、`eval_window_h`、`start_apply_timeout_min`、`finish_confirm_timeout_min` |
| 评价 | `default_star` |
| IM 频控 | `im_rate_window_min`、`im_rate_max_count` |
| 爽约 | `no_show_report_window_h`、`no_show_defense_window_h`、`no_show_grace_min`、`no_show_score_deduct`、`no_show_suspend_threshold`、`no_show_suspend_days`、`no_show_count_window_days` |
| 改期 | `modifyMinLeadHours`、`modifyMaxTimes`、`modifyMaxSpanH` |
| 开关与运行 | `mock_payment_enabled`、`realname_face_mode`、`env`（云端特殊键）、`audit_prune_dry_run` |

### 5.2 SSOT 全量：`config_schema.js` 的 105 个键（分组示意）

| 分组 | 代表键 |
|---|---|
| 距离与下单限制 | `publish_distance_max_km`、`take_distance_max_km`、`youth_limit_fen`、`partner_daily_take_limit` |
| 履约双确认/改期 | `s2ChangeEnabled`、`s2ChangeBMinHours`、`modifyConfirmMinutes`（分钟，默认 10）、`time_redline_close_min` |
| 信用 | `min_credit_take_order`、`min_credit_place_order`、`credit_freeze_line` |
| 金额与提现 | `fixed_price_min_fen`、`fast_withdraw_per_order_max_fen`、`aa_ledger_max_records` |
| 分页与长度 | `msg_page_size`、`order_page_size`、`publish_title_max_len`、`p_bio_len` |
| 开关 | `switch_access`、`switch_blog`、`switch_im`、`cert_gate_enabled` |
| 学习证书 | `w1_cert_valid_days`、`base_cert_permanent` |

> 全量逐键清单与默认值以 `config_schema.js` 为准，后台配置页由该 schema 直接渲染；本文件**不复制 105 行表格**，避免与 SSOT 双写。

### 5.3 配置读取与校验

- 读：`config_get` / `config_public`（免鉴权，仅暴露公开子集）。
- 写：`config_set`（管理员），写入前按 schema 校验，成功后写 `config_history` 快照并清缓存。
- 规则默认值另有 `config_defaults.js`（`MODIFY_DEFAULTS` / `S2_CHANGE_DEFAULTS`）经 `sync-*.ps1` 同步副本。

## 6. 索引台账（`INDEXES`）

- **49 条**定义，覆盖 **25 个集合**，其中 **9 条唯一索引**：
  `user_account.uk_openid`、`partner_profile.uk_openid`、`order_main.uk_order_no`、`pay_transaction.uk_pay_no`、`im_conversation.uk_order_id`、`admin_accounts.uk_account`、`questions.uk_subject_qid`、`study_records.uk_openid_subject_chapter`、`legal_doc.uniq_doc_type_scope_version`。
- **重要边界**：`wx-server-sdk` **无 `createIndex` API**，`INDEXES` 只是**设计台账**；云端实际索引需在控制台或经 `scripts/tcb-*.js` 直连通道创建/回读。台账与云端不一致时**以云端回读为准**。
- 索引逐条明细（键顺序、升降序、补登注记）见 `init-db/index.js` 的 `INDEXES` 数组注释；本文件只锁总数与唯一索引清单，不复制 49 行。

## 7. 数据层约定

| 约定 | 规则 |
|---|---|
| 主键 | `_id`；业务单号 `order_no` / `demand_no` |
| 软删 | `is_deleted: true` + `deleted_at`；查询侧 `_.neq(true)` |
| 时间 | 毫秒时间戳整数；展示层转 UTC+8 |
| 金额 | 整数「分」，字段后缀 `_fen`；禁止浮点 |
| 时长 | `_min`（分）/ `_h`（时）/`_d`（天）/ `_days` |
| 手机号 | `phone_hash`（确定性 HMAC，供查询）+ 密文列 + 脱敏列 |
| 身份证 | `idcard_enc`（密文）+ `idcard_mask`（脱敏） |
| 审计链 | `audit_log` 每条 `prev_hash` → `chain_hash`，`audit_verify` 可全量校验 |
| 敏感配置 | `config_set` 写审计时对键名匹配 `/key|secret|token/i` 的字段深度掩码为 `***` |

## 8. 待人工确认清单

1. **集合字段完整字典缺位**：§3 只列主要写入字段，PRD §16.3 亦标注「完整字段级数据字典未逐字段产出」。若需逐字段字典，应单独立项，不能靠本文补全。
2. **云端真实索引与台账差异**：`INDEXES` 49 条为设计台账，云端实有需用 tcb 直连回读核对；未核对前不能声称「索引已建」。
3. **`exam_bank` 与 `questions` 并存**：旧题库写入已退役、读取仍兼容，何时下线需产品决策。
4. **`study_records` 无写入方**：集合与唯一索引已建，但 `cloudfunctions/` 中无任何写入点。检索范围与命令（2026-11-08 执行，0 命中写入语句）：
   `Get-ChildItem -Recurse -Include *.js | Where-Object { $_.FullName -notmatch 'node_modules|miniprogram_npm' } | Select-String 'study_records'`
   命中仅 3 个文件、5 行：`cloudfunctions/init-db/index.js`（`COLLECTIONS` + `INDEXES` 声明，2 行）、`cloudfunctions_baseline/init-db.js`（同源基线快照，2 行）、`scripts/tcb-scan-indexes.js`（索引核查清单，1 行）；**无 `.add(` / `.set(` / `.update(` 写入**。需产品/后端确认保留或下线。
5. **`S2_6` / `S3_6` 与 13 态红线的口径**：代码位置 [order_state.js:74-81](../cloudfunctions/order-action/order_state.js)（`ALL_STATES` 含 16 码）与 `TRANSITIONS` 的 no.23–30；规则文件 [.trae/rules/project-rules-core.md:120](../.trae/rules/project-rules-core.md) 只列 13 态并仅补录 `S2_5`，全文无 `S2_6`/`S3_6`（grep 0 命中）。需在规则/Spec 层确认是否补录。
