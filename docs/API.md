# API · 云函数入口契约

> 事实源：`cloudfunctions/*/index.js` + 同级 `action_*.js` + `config.json`（实测 2026-11-08）。
> **本段范围**：20 个云函数入口契约（触发方式、鉴权、入参出参、错误码、幂等、数据库操作、返回结构）。
> **已完成的高频详表**：§4 `order-action`（16 态 + 双确认 + 取消/改期/加时/中断/里程碑/投诉）、§5 `payment-mock`（支付/退款/打赏/保险/AA/提现）。
> **下一段范围**：`admin-action` 用户/订单/配置等高频 action 详表（§6 目前只有 action 数核准口径）。
> 与代码不一致时以代码为准，并在 [CHANGELOG.md](CHANGELOG.md) 留痕。

## 1. 统一协议

### 1.1 客户端调用链

小程序端不直接 `wx.cloud.callFunction`，统一经 [utils/cloud.js](../miniprogram/utils/cloud.js) → `app.cloudCall`（[app.js:58](../miniprogram/app.js)）：

| 行为 | 实测值 |
|---|---|
| 入参 | `{ action, ...payload }`；`cloudCall` 额外注入 `device`（品牌 型号｜系统｜平台，截断 200 字） |
| 单次超时 | **12000ms**（2026-10-27 由 6s 上调） |
| 重试 | 读类 **2 次**；写类 **0 次**（`WRITE_RE` 按下划线分词匹配动词表，防重复扣款/重复发消息/重复推进） |
| 重试间隔 | 1500ms |
| 失败码 | `cloud_timeout`（超时）/ `cloud_error`（调用失败）/ `cloud_empty`（结果为空的兜底） |

> 新增写 action 必须让命名命中 `WRITE_RE` 动词表（`create/add/submit/pay/confirm/send/…`），否则会被当成读操作重试。

### 1.2 统一返回结构

```js
{ ok: true,  data?: { ... } }                       // 成功
{ ok: false, code: 'xxx', msg: '给用户看的中文' }    // 失败
```

- 云函数内部统一用 `ok(...)` / `fail(code, msg)` 构造；**不以 HTTP 状态码表达业务错误**（`admin-web` 网关除外）。
- 错误码为稳定契约（前端按 `code` 分支），`msg` 仅供展示，文案可改。

### 1.3 身份与鉴权（fail-closed）

规范源 [_shared/openid.js](../cloudfunctions/_shared/openid.js)（17 个业务函数持同源副本）：

| 场景 | 规则 |
|---|---|
| `prod` | 强制用 `getWXContext().OPENID`，**忽略** `event.mock_openid` |
| `dev` | `mock_openid` 优先，但必须 `admin_config.env=dev` 且 `dev_until` 未过期；`dev_bypass=true` 为回滚开关 |
| 读配置失败 | 按 `prod` 处理，只短缓存 10s；绝不默认放开 mock |
| 缓存 | 5 分钟；`init-db force_set_env` 后由 `invalidateEnvCache()` 清本进程 |

- 管理面（`admin-action`）：`OPENID ∈ admin_config.admin_openids`，否则拒绝并写 `platform_event(P1, admin_probe)`。
- 网关代理链路：`admin-web` 调用 `admin-action` 时携带 `__admin_web_proxy` + `_admin_web_proxy_key`（须等于 `admin_config.admin_web_key`），校验通过才采用网关声明的 openid。
- 定时器/运维函数：不信任客户端，见 §3 各条。

### 1.4 幂等与重试原则

| 层面 | 机制 |
|---|---|
| 客户端 | 写操作 0 重试（§1.1） |
| 状态机 | `order-action` 用 CAS（`casStatus`，期望态匹配才更新）+ `order_status_log` 流水 |
| 业务唯一键 | `order_main.order_no`、`pay_transaction.pay_no`、`im_conversation.order_id`、`questions.subject+qid`、`legal_doc.doc_type+scope+version`、`study_records.openid+subject+chapter_id` |
| 频控/锁 | `withdraw_lock`（提现并发锁）、`safety_report` 签到频控、IM 频控（`im_rate_window_min` / `im_rate_max_count`） |
| 配置写 | `config_set` 写前 schema 校验 + `config_history` 快照 |

## 2. 入口总表（20）

| # | 云函数 | 触发方式 | 分发键（实测） | 鉴权 | 主要集合 |
|---|---|---|---|---|---|
| 1 | `user-login` | 小程序端 | 20 | `resolveOpenid` | `user_account`、`emergency_contact` |
| 2 | `partner-action` | 小程序端 | 17 | `resolveOpenid` | `partner_profile`、`exam_sessions`、`certificates` |
| 3 | `partner-apply` | 【待确认】 | 1 | `resolveOpenid` | `partner_profile` |
| 4 | `demand-publish` | 小程序端 | 10 | `resolveOpenid` | `demand`、`demand_draft` |
| 5 | `demand-match` | 小程序端 | 7 | `resolveOpenid` | `demand`、`order_main` |
| 6 | `order-create` | 小程序端 | 4 | `resolveOpenid` | `order_main`、`order_confirmations`、`disclaimer_signature` |
| 7 | `order-action` | 小程序端 | **46**（47 键含常量 `CHANGE_FIELDS`） | `resolveOpenid` + 参与方校验 | `order_main`、`order_status_log`、`safety_report`、`system_notice` |
| 8 | `payment-mock` | 小程序端 | 13 | `resolveOpenid` + 参与方校验 | `pay_transaction`、`withdraw_record`、`withdraw_lock` |
| 9 | `evaluation-submit` | 小程序端 | 2 | `resolveOpenid` | `evaluation`、`credit_score_log`、`system_notice` |
| 10 | `im-conv` | 小程序端 | 5 | `resolveOpenid` | `im_conversation`、`im_message` |
| 11 | `im-send` | 小程序端 | 3 | `resolveOpenid` | `im_message`、`im_conversation` |
| 12 | `safety-report` | 小程序端 | 11 | `resolveOpenid` | `safety_report`、`platform_event` |
| 13 | `home-action` | 小程序端 | 8 | 可游客（无 openid 走游客视角） | `demand`、`order_main`（只读） |
| 14 | `blog-action` | 小程序端 | 11 | `resolveOpenid` | `blog_post`、`blog_like`、`blog_comment` |
| 15 | `admin-action` | admin-web 网关 | **101**（102 导出键 − 1 测试辅助） | `admin_openids` + 代理密钥 | 见 §3.15 |
| 16 | `admin-web` | HTTP（SPA + 网关） | 22 路由 | `X-Admin-Key` / `X-Admin-Token` | 代理转发 |
| 17 | `init-db` | 运维（CLI/控制台/网关） | 9 | `idb_forbidden`（管理员或代理密钥） | 建集合/索引/种子 |
| 18 | `zz-seed-orders` | 网关 / 管理员直调 | 11 | `seed_forbidden` | 造数（测试） |
| 19 | `order-timer` | 定时 `0 */30 * * * * *` | 21 扫描任务（无 action） | `ot_forbidden` | `order_main` + 巡检集合 |
| 20 | `zz-warmup` | 定时 `0 */15 7-22 * * * *` | 1（`run`） | 无（保温专用） | 无业务写入 |

> `order-timer` 的 21 = 4 个 `action_*.js` 段落文件导出的 19 个扫描函数 + `index.js` 内联的 `processDemandNotify` / `processUrgeReminder`（[index.js:342,418](../cloudfunctions/order-timer/index.js)）。它不按 `action` 分发，按触发器整轮执行。

## 3. 逐函数契约

### 3.1 `user-login`

- **触发**：小程序端启动/登录链路。
- **入参**：`{ action, ...payload }`；登录类 `action` 走 `wx.login` 换取的上下文身份，业务字段如 `phone`、`sms_code`、`nickname`、`avatar`。
- **出参**：`{ ok, data: { userInfo|… } }`；登录成功返回用户档案与角色。
- **错误码**：`account_*`（重复/非法）、`close_already`（注销态）、`login_locked`（防爆破锁定）等，以 [index.js](../cloudfunctions/user-login/index.js) 为准。
- **幂等**：以 `openid` 为自然键 upsert；重复登录不新建账号。
- **集合**：`user_account`（唯一 `openid`）、`emergency_contact`。
- **待确认**：手机号/实名链路的密钥来源见 `_shared/phone_crypt.js`，本文不写密钥。

### 3.2 `partner-action`

- **触发**：小程序端耍伴中心。
- **分发**：17 个 action（申请、资料、接单配置、考试/学习状态等）。
- **错误码**：`pa_*`（审核/状态类）、`apply_*`（资格类）。
- **幂等**：资料类 upsert；考试提交按 `openid + subject` 留痕。
- **集合**：`partner_profile`、`exam_sessions`、`certificates`。
- **待确认**：`study_records`（学习进度）在 `cloudfunctions/` 中**实测无写入方**，仅声明集合与唯一索引；是否废弃需产品确认。

### 3.3 `partner-apply`

- **触发**：【待后端确认】当前仅 1 个 action `debug_profile`，疑似调试入口。
- **风险**：生产环境是否应存在需产品/后端确认；未确认前不得写进对外接口清单。

### 3.4 `demand-publish`

- **触发**：发布需求、草稿。
- **分发**：10 个 action（发布、草稿保存/删除、详情、取消等）。
- **错误码**：`publish_*`、`cancel_*`、`bad_*`（参数/尺寸）。
- **幂等**：草稿按 `openid` upsert；发布以 `demand` 新文档为准，重复提交需前端防连点。
- **集合**：`demand`、`demand_draft`。

### 3.5 `demand-match`

- **触发**：大厅、接单、广播。
- **分发**：7 个 action（`hall_list`、`apply`、`confirm_apply`、`broadcast` 等）。
- **错误码**：`apply_*`（重复/冲突/未签免责/资格）。
- **幂等**：申请以 `demand_id + partner_openid` 去重；接单结果走订单创建的唯一 `order_no`。
- **集合**：`demand`、`order_main`、`disclaimer_signature`。

### 3.6 `order-create`

- **触发**：接单建单、签署、取单结果查询。
- **分发**：4 个 action：`check_signed`、`check_take_result`、`create_from_take`、`sign_disclaimer`。
- **出参**：建单成功返回 `order_id` / `order_no`（`data`）。
- **错误码**：`order_*`、`check_*`、`apply_*`（场景考试/资格）；见 [action_take.js](../cloudfunctions/order-create/action_take.js)。
- **幂等**：`order_main.order_no` 唯一；`check_take_result` 为只读查询。
- **集合**：`order_main`、`order_confirmations`、`order_status_log`、`disclaimer_signature`。
- **已知缺陷**：`create_from_take` 成功路径存在 `try` 块内 `const` 越界引用（[ab_equivalence.js:516-519](../cloudfunctions/_shared/ab_equivalence.js) 已登记为「拆分前既有行为」）。【待后端确认】是否已修复。

### 3.7 `order-action`

- **触发**：订单详情/工作台/状态流转（46 个有效 action）。
- **鉴权**：`resolveOpenid` + 订单参与方校验（`user_openid` / `partner_openid`），非参与方返回无权限。
- **入参**：`{ action, order_id|order_no, ... }`；`order_id` 支持 `ORD` 单号兼容。
- **错误码**：`oa_*`（订单域）、`no_show_*`（爽约申诉）。
- **幂等**：CAS 状态迁移（期望态不匹配即失败）+ `order_status_log`；申诉按 `order_id + target_openid` 幂等。
- **集合**：`order_main`、`order_confirmations`、`order_status_log`、`no_show_report`、`complaint`、`safety_report`、`system_notice`、`credit_score_log`。

### 3.8 `payment-mock`

- **触发**：收银台、模拟支付/退款/加时/打赏、提现、AA 记账。
- **分发**：13 个 action。
- **约束**：所有订单与流水打 `is_mock=true`；页面必须提示「模拟支付，不产生真实扣款」。
- **错误码**：`pay_*`、`refund_*`、`aa_*`、提现类前缀（`withdraw_*`）。
- **幂等**：`pay_transaction.pay_no` 唯一（`genPayNo` 前缀区分 pay/refund/tip/eval_reward）；提现用 `withdraw_lock` 防并发。
- **集合**：`pay_transaction`、`withdraw_record`、`withdraw_lock`、`insurance_record`、`order_main`。

### 3.9 `evaluation-submit`

- **触发**：评价页、默认评价。
- **分发**：2 个 action（`submit`、`get_default_star`）。
- **错误码**：`ev_*`（`ev_no_order`、`ev_not_owner`、`ev_auto_evaluated` …）。
- **幂等**：同一 `order_id` 只允许一条有效评价；超时默认 4 星由 `order-timer` 触发。
- **集合**：`evaluation`、`credit_score_log`、`system_notice`、`order_main`（`eval_state`）。

### 3.10 `im-conv`

- **触发**：消息中心、会话详情、客服会话。
- **分发**：5 个 action（`my_convs`、`messages`、`kefu_open`、`kefu_messages` 等）。
- **错误码**：`im_*`（`im_not_participant`、`im_conv_not_found` …）。
- **幂等**：`kefu_open` 用 `order_id = 'kefu_' + openid` 复用唯一索引。
- **集合**：`im_conversation`、`im_message`。

### 3.11 `im-send`

- **触发**：发文本/模板/客服消息。
- **分发**：3 个 action：`send_text`、`send_template`、`send_kefu`。
- **内容安全**：先过微信 `msgSecCheck`，不可用时降级本地违禁词表；四确认前仅允许模板消息（业务红线）。
- **错误码**：`im_*`（`im_empty_text`、`im_bad_template`、`im_chat_closed`、`im_disabled` …）。
- **幂等**：写操作 0 重试（§1.1），前端需自行防连点。
- **集合**：`im_message`、`im_conversation`。

### 3.12 `safety-report`

- **触发**：SOS、静默求助、报平安/签到、举报、自由求助。
- **分发**：11 个 action。
- **错误码**：`sr_*`（`sr_bad_order_id`、`sr_checkin_too_frequent` …）。
- **幂等**：签到/报备按 `order_id + reporter_openid + type` 频控；SOS 解除按状态机流转。
- **集合**：`safety_report`、`platform_event`（P0）、`order_main`（`help_flag` 场景）。

### 3.13 `home-action`

- **触发**：首页、广场、附近、活动详情。
- **分发**：8 个 action（`overview`、`nearby`、`activity_detail`、`home_activity_list` 等）。
- **鉴权**：允许游客（无 openid 走游客视角，不做耍伴级过滤）；【待后端确认】游客可见字段边界。
- **错误码**：`home_*`、`act_*`。
- **集合**：`demand`、`order_main`（只读聚合）。

### 3.14 `blog-action`

- **触发**：服务动态（列表/详情/发布/点赞/评论/作者主页）。
- **分发**：11 个 action。
- **开关**：`admin_config.switch_blog`；关闭时返回 `blog_disabled`。
- **错误码**：`blog_*`、`bad_*`（`bad_post_id`、`bad_comment_id`、`bad_image`）。
- **集合**：`blog_post`、`blog_like`、`blog_comment`。

### 3.15 `admin-action`

- **触发**：**仅**经 `admin-web` 网关转发（客户端直连会被鉴权门拦截）。
- **分发**：**101** 个 action（102 个导出键 − `readImageDims` 纯函数）。判定依据见 §5。
- **免鉴权前置 4 个**：`claim_admin`（白名单为空时首个调用者自助初始化，仅可成功一次）、`config_public`、`admin_login`、`admin_logout`。
- **鉴权**：`OPENID ∈ admin_config.admin_openids`；网关代理须 `_admin_web_proxy_key === admin_web_key`。RBAC 由 `authz.js` 的 `canAccess` 校验，越权返回 `role_forbidden`。
- **分发实现**：`HANDLERS_PRE`（免鉴权）→ 统一鉴权 → `HANDLERS`（`Object.assign` 33 个 `action_*.js`）→ 兜底 `admin_unknown_action`；**无内联 `action ===` 分支**（实测 0 处）。
- **错误码**：`admin_*`（账号/白名单）、`role_forbidden`、领域前缀（`acc_*`、`blog_*`、`legal_*`、`no_show_*`、`question_*` …）。
- **幂等**：写操作普遍「二次确认 + 原因填写 + 防双击」（后台 UI 模式）；配置写有 `config_history` 快照；`claim_admin` 用事务保证只成功一次。
- **集合**：几乎全部业务集合 + `admin_accounts`、`admin_web_sessions`、`config_history`、`legal_doc`、`blog_*`、`questions`。

### 3.16 `admin-web`

- **触发**：HTTP 访问（SPA 静态资源 + JSON 网关）。
- **路由**：22 个（含 `admin_login` / `admin_logout` / `init_db` / `seed_*` / 探活端点）。
- **鉴权优先级**：`X-Admin-Token`（会话，12h）> 登录端点放行 > `X-Admin-Key`（静态 key）。
- **CORS**：`Access-Control-Allow-Headers: Content-Type,X-Admin-Key,X-Admin-Token`；`OPTIONS` 返回 204。
- **超时**：网关硬限 3s，`PROXY_TIMEOUT_MS = 2500ms`；超时返回 `504 { ok:false, code:'gateway_timeout' }`。
- **本地直调**：`admin_login` / `admin_logout` 不转发 `admin-action`（避免双冷启动叠加超 3s），引 `_shared/admin-login.js` 本地副本。
- **代理**：`init_db` 用 `__init_db_action` 携带真实动作；`seed_*` 经 `SEED_MAP` 映射到 `zz-seed-orders`。
- **错误码**：`no_action`、`bad_param`、`gateway_timeout`、`fn_*_error`、`init_db_error`。
- **健康检查**：`GET /health` → `{ ok:true, ts, timeout_ms }`。

### 3.17 `init-db`

- **触发**：运维（CLI、控制台云端测试、网关代理）。
- **分发**：9 个 action（建集合/种子、`quick_check`、`force_set_env`、`generate_admin_web_key` 等）。
- **鉴权**：代理密钥或 `admin_openids`；否则 `idb_forbidden`；种子类另有 `idb_seed_forbidden`。
- **幂等**：重复运行不报错、不覆盖已有数据（种子只补缺失键）。
- **注意**：`COLLECTIONS` 建集合幂等；`INDEXES` **只是设计台账**（SDK 无 `createIndex`），真实索引需控制台/tcb 通道。
- **集合**：建全部 31 个声明集合 + 写 `admin_config` 种子。

### 3.18 `zz-seed-orders`

- **触发**：后台网关 `seed_*` 或管理员直调。
- **分发**：11 个 action（造单/清理/回填）。
- **鉴权**：调用者真实 OPENID ∈ `admin_openids`，或网关共享密钥；否则 `seed_forbidden`。**不再信任 `event.mock_openid` 作为身份**。
- **风险**：测试造数函数，生产环境可调用需产品确认；【待后端确认】是否在下个版本下线。

### 3.19 `order-timer`

- **触发**：定时触发器 `orderTimer`，`0 */30 * * * * *`（每 30 分钟）。
- **鉴权**：SCF 触发分支要求「本次调用无用户 OPENID」+ `TriggerName` 匹配，否则 `ot_forbidden`。
- **执行体**：21 个扫描任务（4 个 `action_*.js` 段落文件导出 19 个 + 2 个内联），覆盖超时关单、自动评价、改期/加时超时、争议升级、爽约提醒、审计清理、错误巡检等。
- **幂等**：每轮按状态 CAS + 标记字段（如 `grab_notify_pending`）推进，重复执行不重复发通知。
- **集合**：`order_main`、`order_status_log`、`system_notice`、`settlement`、`credit_score_log`、`platform_event`、`audit_log`、`im_conversation`。

### 3.20 `zz-warmup`

- **触发**：定时触发器 `warmup-15min`，`0 */15 7-22 * * * *`（7–22 点每 15 分钟）。
- **分发**：1 个 action `run`。
- **作用**：对 `user-login` 等函数做保温调用；云函数互调无 OPENID，入口鉴权会预期内返回，**不以业务 `ok===true` 判定成功**。
- **错误码**：`warm_timeout`、`no_result`、`login_no_openid`。

## 4. `order-action` 状态流转（核心契约）

> 事实源：[order_state.js](../cloudfunctions/order-action/order_state.js)（状态与迁移白名单）+ [action_lifecycle.js](../cloudfunctions/order-action/action_lifecycle.js)（双确认实现）+ [order-timer/action_timeout.js](../cloudfunctions/order-timer/action_timeout.js)（超时与提醒）。

### 4.1 状态集合（16）

| 分组 | 状态 | 含义 |
|---|---|---|
| 主轴 11 态 | `S1` | 待确认（四确认中） |
| | `S0` | 待支付 |
| | `S2` | 已支付待履约 |
| | `S2_6` | 开始履约申请中（耍伴已发起，待需求方确认） |
| | `S2_5` | 改期处理中（非 13 态之一） |
| | `S3` | 履约中 |
| | `S3_6` | 履约完毕确认中（耍伴已发起，待需求方确认） |
| | `S3.5` | 履约中断 |
| | `S4` | 部分完成 |
| | `S5` | 已完成 |
| | `S8` | 已评价 |
| 争议占位 1 | `S10.5` | 争议处理中（读方经 `mapStatus` 映射回 `complaint_from_status`，并置 `dispute_state=open`、`frozen=true`） |
| 终态 3 | `S6` / `S7` / `S10` | 已取消 / 已退款 / 已关闭 |
| 退役 1 | `S9` | 评价超时；`mapStatus` → `S8 + eval_state=auto_done`（仅存量与读兼容） |

定义位置：[order_state.js:74-81](../cloudfunctions/order-action/order_state.js)（`MAIN_AXIS` / `SIDE_STATES` / `TERMINAL_STATES` / `LEGACY_STATES` / `ALL_STATES`）。
`S2_6`、`S3_6` 为 2026-10-14《线下陪伴履约流程规范》新增的两中间态，注释见 [order_state.js:74-76](../cloudfunctions/order-action/order_state.js)。

### 4.2 迁移白名单（28 条实存）

编号 1–30，其中 **no.5（`start_service` 直连 S2→S3）与 no.13（`complete` 直连 S3→S5）已于 2026-11-01 删除**，编号留空不复用，避免历史日志交叉引用错位（[order_state.js:119-121](../cloudfunctions/order-action/order_state.js)）。

| no | event | role | from → to | guard / 备注 | 超时 |
|---|---|---|---|---|---|
| 1 | `confirm_done` | both | S1 → S0 | 8 位确认全满 | 15min→S6（释放 demand） |
| 2 | `pay` | user | S0 → S2 | 支付流水成功 | 30min→S6 |
| 3 | `cancel` | both | S1/S0 → S6 | 已付则原路退 | — |
| 4 | `cancel_request` | both | S2 → 原态 | 挂起不改主轴（`cancel_request` 字段） | 对方 2h 确认，超时转裁决 |
| 6 | `modify` | both | S2/S2_5 → 原态 | 未冻结 | `confirmHours` 可配→自动拒绝 |
| 7 | `interrupt_report` | both | S3 → S3.5 | 原因必填、未冻结 | 24h→S4 |
| 8 | `resume` | both | S3.5 → S3 | — | — |
| 9 | `partial_agree` | both | S3.5 → S4 | — | 裁限期→按证据转裁决 |
| 10 | `milestone` | both | S3 → S3 | 里程碑进度 | 确认窗可配自动确认 |
| 11 | `extend_req` | both | S3 → S3 | 未冻结 | `extend_confirm_min` 未回应→自动拒绝 |
| 12 | `extend_paid` | user | S3 → S3 | 加时补付流水成功 | 未付不加结算基数 |
| 14 | `ratio_agree` | both | S4 → S5 | 双方各确认一次 | 裁限期→平台介入 |
| 15 | `evaluate` | user | S5 → S8 | 无已有评价 | 48h→`auto_done` |
| 16 | `complaint_open` | both | S2/S3/S3.5/S4 → 原态 | 目标态=原态+`frozen`；S5 起关闭投诉入口 | 一审时限→升级 |
| 17 | `complaint_withdraw` | both | * → 原态 | 未受理 | — |
| 18 | `dispute_resolve_refund` | platform | * → 视金额 | 全退→S7；部分退→回主轴 | — |
| 19 | `dispute_resolve_complete` | platform | * → S8/S5 | 有评价→S8；无→S5 | — |
| 20 | `after_sale_expire` | system | S8 → S10 | 售后窗口届满 | — |
| 21 | `no_show_decide` | platform | * → 视裁定 | 受害方获退款通道；本期零赔付 | — |
| 22 | `settle` | system | S8/S9/S10 → 原态 | `settle_state=ready` | — |
| 23 | `start_apply` | partner | S2 → S2_6 | 距离≤200m、定位可信、未冻结、证据先落库 | 15min→S10.5（提醒 2 次） |
| 24 | `start_confirm` | user | S2_6 → S3 | 仅需求方；可带定位留痕 | — |
| 25 | `start_reject` | user | S2_6 → S2 | 仅需求方；冷却 60s 可重发 | 连续 2 次→S10.5 |
| 26 | `start_apply_timeout` | platform | S2_6 → S10.5 | 15min 未响应或连续 2 次拒绝 | 资金冻结待裁定 |
| 27 | `finish_apply` | partner | S3 → S3_6 | 距离/定位/照片校验、里程碑 100% | 30min→S10.5（提醒 2 次） |
| 28 | `finish_confirm` | user | S3_6 → S5 | 仅需求方；查看凭证后确认 | 连续 2 次不确认→S10.5 |
| 29 | `finish_reject` | user | S3_6 → S3 | 仅需求方；冷却 60s | — |
| 30 | `finish_confirm_timeout` | platform | S3_6 → S10.5 | 30min 未响应或连续 2 次不确认 | 资金冻结待裁定 |

**校验方式**：`transitionAllowed(event, expect, to)` **事件驱动**校验，不靠 `from→to` 单独判定（`from=['*']` 的撤回/裁决规则会让任意迁移命中）。无目标状态、目标为 `S9`、未提供 `event` 三种情况放行（[order_state.js:172-181](../cloudfunctions/order-action/order_state.js)）。

### 4.3 履约双确认链路（S2 → S2_6 → S3 → S3_6 → S5）

```
S2 --start_apply(耍伴,证据前置)--> S2_6 --start_confirm(需求方)--> S3
                                       |--start_reject(1次)--> S2 --60s 冷却--> 可重发
                                       |--start_reject(2次)/15min超时--> S10.5
S3 --finish_apply(耍伴,照片+定位+里程碑100%)--> S3_6 --finish_confirm--> S5
                                                   |--finish_reject(1次)--> S3 --60s--> 可重发
                                                   |--finish_reject(2次)/30min超时--> S10.5
```

| action | 角色 | 迁移 | 必填校验（fail-closed） | 主要错误码 | 落库字段 | 通知 |
|---|---|---|---|---|---|---|
| `start_apply` | 耍伴 | S2→S2_6 | 1~3 张现场照片（`start_evidence.photos[].file_id`）；定位可信（精度≤50m）；距离履约地≤200m；未冻结 | `oa_start_apply_perm`、`oa_start_apply_status`、`oa_start_apply_cooldown`、`oa_start_apply_location_required`、`oa_start_apply_accuracy_low`、`oa_start_apply_too_far`、`oa_start_evidence_required`、`oa_order_frozen` | `start_apply_at`、`start_apply_evidence`、`service_start_evidence`（照片+定位+履约地快照，同一 CAS 原子写入） | `start_apply` → 需求方 |
| `start_confirm` | 需求方 | S2_6→S3 | 仅需求方；未冻结；用户定位**可选**（带则写 `user_confirm`） | `oa_start_confirm_perm`、`oa_start_confirm_status`、`oa_order_frozen`、`oa_status_conflict` | `status=S3`、`service_started_at`、`milestone{current:0,confirmed:[false×3]}` | `start_confirm` → 耍伴 |
| `start_reject` | 需求方 | S2_6→S2（第 1 次）/ S10.5（第 2 次） | 仅需求方 | `oa_start_reject_perm`、`oa_start_reject_status`、`oa_status_conflict` | `start_reject_at`、`start_reject_count`；升级时写 `dispute_state=open`、`dispute_type=start_timeout` | `start_reject` / `dispute_open` |
| `start_photo` | 耍伴 | 不迁移（S3 内证据） | S3 且为耍伴；照片 ≥1 张；定位必填 | `oa_start_photo_perm`、`oa_start_photo_status`、`oa_start_photo_required`、`oa_start_photo_location_required`、`oa_order_frozen` | `service_start_evidence` | 站内通知 |
| `finish_apply` | 耍伴 | S3→S3_6 | 里程碑 `current=3`；1~3 张完成照片；定位精度≤50m；距离≤200m；冷却 60s；未冻结 | `oa_finish_apply_milestone`、`oa_finish_apply_photo_required`、`oa_finish_apply_location_required`、`oa_finish_apply_accuracy_low`、`oa_finish_apply_too_far`、`oa_finish_apply_cooldown`、`oa_order_frozen` | `finish_apply_at`、`service_finish_evidence`（照片+定位+履约地快照） | `finish_apply` → 需求方 |
| `finish_confirm` | 需求方 | S3_6→S5 | 仅需求方；未冻结；**不强制**重新定位 | `oa_finish_confirm_perm`、`oa_finish_confirm_status`、`oa_order_frozen`、`oa_status_conflict` | `status=S5`、`service_completed_at` | `finish` → 耍伴 |
| `finish_reject` | 需求方 | S3_6→S3（第 1 次）/ S10.5（第 2 次） | 仅需求方 | `oa_finish_reject_perm`、`oa_finish_reject_status`、`oa_status_conflict` | `finish_reject_at`、`finish_reject_count`；升级时 `dispute_type=finish_timeout` | `finish_reject` / `dispute_open` |
| `server_now` | 任意 | 只读 | 无 `order_id` 预检 | — | 无 | — |
| `user_confirm_start` | 需求方 | 不迁移（S3 内） | 仅需求方；**强制**定位（`oa_user_location_required`）；幂等（`user_confirm.at` 已存在即返回首次结果） | `oa_uc_perm`、`oa_uc_status`、`oa_user_location_required`、`oa_uc_conflict` | `user_confirm{latitude,longitude,accuracy,address,at,by}` | 无 |

**证据先行（存证优先）**：`S2_6` / `S3_6` 的迁移与 `service_start_evidence` / `service_finish_evidence` 在同一次 CAS 中落库，先存证再推消息（[order_state.js:83-89](../cloudfunctions/order-action/order_state.js) 的 `FULFILL_EVIDENCE_FIELDS`）。坐标全链路 GCJ-02，时间一律服务端时间戳。

**硬编码常量**（[action_lifecycle.js:65-68](../cloudfunctions/order-action/action_lifecycle.js)）：距离上限 `200m`、定位精度上限 `50m`、重发冷却 `60s`。三者**未走 `admin_config`**，改配需改代码。

### 4.4 拒绝 / 超时 / 异常分支

| 分支 | 触发条件 | 结果 | 依据 |
|---|---|---|---|
| 开始履约·第 1 次拒绝 | `start_reject`，`start_reject_count < 2` | 回 `S2`，60s 冷却后可重发 | [action_lifecycle.js:440-478](../cloudfunctions/order-action/action_lifecycle.js) |
| 开始履约·第 2 次拒绝 | `start_reject_count ≥ 2` | 直接 `S10.5`（事件记 `start_apply_timeout`），`dispute_type=start_timeout` | 同上 L441-448 |
| 开始履约·超时 | `S2_6` 超 `start_apply_timeout_min`（默认 15） | `S10.5`，资金冻结待裁定 | [action_timeout.js](../cloudfunctions/order-timer/action_timeout.js) |
| 完毕确认·第 1 次不确认 | `finish_reject_count < 2` | 回 `S3`，60s 冷却 | [action_lifecycle.js:723-761](../cloudfunctions/order-action/action_lifecycle.js) |
| 完毕确认·第 2 次不确认 | `finish_reject_count ≥ 2` | 直接 `S10.5`（事件记 `finish_confirm_timeout`），`dispute_type=finish_timeout` | 同上 L724-731 |
| 完毕确认·超时 | `S3_6` 超 `finish_confirm_timeout_min`（默认 30） | `S10.5` | [order-timer/action_timeout.js](../cloudfunctions/order-timer/action_timeout.js) |
| 超时前提醒 | `start_apply_remind1/2_min`（默认 5/10）；`finish_confirm_remind1/2_min`（默认 10/20） | 站内通知，不改状态 | `config_schema.js:37-40` |
| 冻结订单操作 | `frozen=true`（争议/申诉中） | 发起/确认类返回 `oa_order_frozen`；**`start_reject` / `finish_reject` 未做 `isFrozen` 校验**（见 §4.7 待确认） | 各 handler 前置校验 |
| 并发/状态已变 | CAS 失败且状态非幂等目标 | `oa_status_conflict`（提示刷新） | 各 handler |
| 履约地无坐标 | 订单 `location` 缺经纬度（存量/手输地址） | **跳过距离校验**，放行兜底 | [action_lifecycle.js:613-622](../cloudfunctions/order-action/action_lifecycle.js) |
| 里程碑未满 | `milestone.current < 3` 时 `finish_apply` | `oa_finish_apply_milestone` | 同上 L581-585 |
| 停用入口 | `start_service` / `complete` | `oa_legacy_retired`（墓碑守卫） | [order-action/index.js](../cloudfunctions/order-action/index.js) |

### 4.5 幂等与并发

| 机制 | 说明 |
|---|---|
| CAS 迁移 | `casStatus(order_id, expect, patch, event)`，期望态不匹配即失败，不覆盖他人写入 |
| 幂等回放 | CAS 失败后重读：若已是目标态（如 `S2_6`/`S3`/`S5`），返回 `ok + idempotent:true`，不重复发通知 |
| 拒绝计数 | `start_reject_count` / `finish_reject_count` 单调递增，不走回退 |
| 冷却 | 以 `start_reject_at` / `finish_reject_at` 判断 60s 窗口 |
| 证据唯一 | 同一阶段证据一次写入，后续不覆盖（`service_start_evidence` / `service_finish_evidence`） |
| 审计 | 幂等命中同样写 `audit_log`，`detail.idempotent=true` |

### 4.6 读兼容与遗留入口

- `mapStatus()`：`S9→S8+auto_done`；`S8→eval_state=user_done`；`S10.5→complaint_from_status / dispute_from_status` + `dispute_state=open` + `frozen=true`（[order_state.js:190-209](../cloudfunctions/order-action/order_state.js)）。
- `user_confirm_start` 是 B1 遗留的「S3 内确认到场」入口，与 `start_confirm` **并存**：前者不改状态、强制定位；后者走 S2_6→S3。
- `S9` 自动评价仍会写入（见 PRD §4.1 说明），读方按 `S8+auto_done` 消费。

### 4.7 与 PRD / 规则的偏差（登记与处置状态）

| # | 偏差 | 位置 | 性质 |
|---|---|---|---|
| 1 | PRD 写 `confirm_start` / `reject_start` / `reject_finish` / `confirm_finish`，代码实际为 `start_confirm` / `start_reject` / `finish_reject` / `finish_confirm`，且 `index.js` 无别名映射 | PRD/PRD.md:201-205 ↔ [action_lifecycle.js:764](../cloudfunctions/order-action/action_lifecycle.js) | **已订正（2026-11-08）**：PRD 四处 action 名已改为代码实际名；`check-prd-drift.js` 无 action 名校验项，靠人工比对 |
| 2 | 规则附录 A 只列 13 态 + `S2_5`，未收录 `S2_6` / `S3_6` | [.trae/rules/project-rules-core.md:120](../.trae/rules/project-rules-core.md) ↔ [order_state.js:74-81](../cloudfunctions/order-action/order_state.js) | 规则滞后于代码；**本轮只在文档登记，改规则文件另行报批** |
| 3 | PRD 写 `admin-action` 83 action，实测 101 | PRD/PRD.md:789、1253 ↔ 本文 §6 | **已订正（2026-11-08）**：两处改为 101 并附判定口径 |
| 4 | `start_reject` / `finish_reject` 未做 `isFrozen` 校验，冻结单仍可被拒绝（会把 `S2_6`/`S3_6` 拉回主轴） | [action_lifecycle.js:429-438](../cloudfunctions/order-action/action_lifecycle.js)、[:712-720](../cloudfunctions/order-action/action_lifecycle.js) | **代码口径待确认**（是否故意允许） |
| 5 | 状态机 no.7 `interrupt_report`（S3→S3.5）在 `order-action` **无对应 handler**；实际写 S3.5 的唯一入口是 `safety-report` 的 SOS 分支 | [order_state.js:123](../cloudfunctions/order-action/order_state.js) ↔ [safety-report/index.js:416](../cloudfunctions/safety-report/index.js) | 状态机声明与入口不对称（状态机把中断动作挂在 order-action，实际由 safety-report 落库） |
| 6 | 状态机 no.16 `complaint_open` from 含 `S5`/`S8`，代码 `COMPLAINT_OPEN_STATUS` 仅 `S2/S3/S3.5/S4` | [action_dispute.js:6](../cloudfunctions/order-action/action_dispute.js) ↔ [order_state.js:131](../cloudfunctions/order-action/order_state.js) | **有意收窄**（源码注释明示，S5 起关闭投诉入口），状态机副本待同步 |

### 4.8 其余动作组总表（action → handler → 落点）

| action | 实现函数 | 文件:行 | 状态写入 |
|---|---|---|---|
| `cancel` | `cancel` | [action_lifecycle.js:4](../cloudfunctions/order-action/action_lifecycle.js) | S1/S0 → S6 |
| `change_apply` / `change_respond` | `change_apply` / `change_respond` | [action_change.js:111](../cloudfunctions/order-action/action_change.js)、[:219](../cloudfunctions/order-action/action_change.js) | S1 内，不改主轴 |
| `s2_change_apply` / `s2_change_respond` | 同名 | [action_change_s2.js:55](../cloudfunctions/order-action/action_change_s2.js)、[:189](../cloudfunctions/order-action/action_change_s2.js) | S2 内，不改主轴 |
| `modify` / `modify_confirm` / `modify_reject` | `modify` / `modify_confirm_or_reject` | [action_modify_extend.js:22](../cloudfunctions/order-action/action_modify_extend.js)、[:102](../cloudfunctions/order-action/action_modify_extend.js) | S2 → S2_5 → S2（或 S3） |
| `extend` / `extend_confirm` / `extend_reject` | `extend` / `extend_confirm_or_reject` | [action_modify_extend.js:189](../cloudfunctions/order-action/action_modify_extend.js)、[:269](../cloudfunctions/order-action/action_modify_extend.js) | S3 内，不改主轴 |
| `resume_service` | `resume_service` | [action_lifecycle.js:282](../cloudfunctions/order-action/action_lifecycle.js) | S3.5 → S3 |
| `partial_confirm` / `ratio_confirm` | 同名 | [action_modify_extend.js:342](../cloudfunctions/order-action/action_modify_extend.js)、[:382](../cloudfunctions/order-action/action_modify_extend.js) | S3.5 → S4 → S5 |
| `milestone_submit` / `milestone_confirm` | 同名 | [action_lifecycle.js:197](../cloudfunctions/order-action/action_lifecycle.js)、[:252](../cloudfunctions/order-action/action_lifecycle.js) | S3 内，不改主轴 |
| `complaint` / `complaint_withdraw` | 同名 | [action_dispute.js:10](../cloudfunctions/order-action/action_dispute.js)、[:82](../cloudfunctions/order-action/action_dispute.js) | S2/S3/S3.5/S4 → S10.5 → 回原态 |
| `no_show_report_submit` / `_defense` / `_withdraw` / `_detail` | 同名 | [action_dispute.js:137](../cloudfunctions/order-action/action_dispute.js) 起 | 不改主轴（只写 `no_show_report`） |

### 4.9 取消 `cancel`

| 项 | 契约 |
|---|---|
| 入参 | `order_id`（必填）、`reason`（可选，审计只记前 30 字） |
| 角色 | 双方均可；**S0 仅下单用户**（`oa_cancel_perm`） |
| 状态门 | 仅 `S1`、`S0`（`oa_cancel_status`） |
| 落库 | `status='S6'`、`cancel_at`、`updated_at`；状态日志事件 `user_cancel` / `partner_cancel` |
| 副作用 | `S1`/`S0` 且有关联 `demand_id` → `demand.status='matched'` 回写为 `matching` 并清 `matched_openid`（2026-11-01 起 S0 也释放，避免订单转 S6 后定时器只扫 S0 导致需求永久悬挂） |
| 幂等 | 已是 `S6` → `ok:true` + `idempotent:true`、`demand_released:false` |
| 通知 | 对方 `system_notice`，`type='cancel'` |
| 错误码 | `oa_no_order` / `oa_not_found` / `oa_not_participant` / `oa_cancel_status` / `oa_cancel_perm` / `oa_status_conflict` |

### 4.10 四确认阶段变更 `change_apply` / `change_respond`（仅 S1）

- 可变更字段：`time` / `location` / `content` / `fee` / `other`；其余值 → `oa_bad_item`。
- 次数上限为**硬编码常量**（非配置）：整单 4 次 `CHANGE_MAX_TOTAL`、单项 2 次 `CHANGE_MAX_PER_FIELD`（[action_change.js:12-13](../cloudfunctions/order-action/action_change.js)）→ `oa_change_limit`。
- 同刻只允许一条在途：`pending_change` 存在即 `oa_change_pending`；四确认窗口临近结束时 `oa_change_window_closed`（提示直接确认或取消）。
- 提交前校验：`time` 未来时间（`oa_time_future`）；`location` 必含完整字段（`oa_location_invalid`）；`content` 结构（`oa_content_invalid`）；`fee` 必须整数分（`oa_fee_invalid`）、区间内（`oa_fee_out_of_range`）、18–22 岁单笔 ≤200 元（`oa_youth_limit`）；`other` 字数上限（`oa_other_invalid`）；与现值相同 → `oa_change_same`。
- 并发：以 `pending_change.token` 做条件更新，抢不到 → `oa_conflict`。
- **接受（`change_respond` decision=accept）**：写回字段 → 清 `pending_change` → `order_confirmations` 的 `items.{time,location,content,fee}.user_ok/partner_ok` 全部置 `false`、`version+1`（8 位全重置，规则附录 A 第 4 条）。
- 拒绝：清 `pending_change` + `change_last_rejected_at`；超时由定时器 `change_auto_reject` 收口。
- 错误码：`oa_bad_item` / `oa_not_editable` / `oa_frozen` / `oa_change_pending` / `oa_change_limit` / `oa_change_window_closed` / `oa_change_same` / `oa_content_blocked` / `oa_update_fail` / `oa_conflict` / `oa_bad_decision` / `oa_no_pending` / `oa_change_self` / `oa_change_stale` / `oa_change_expired` / `oa_no_confirm_doc`。

### 4.11 已支付阶段变更 `s2_change_apply` / `s2_change_respond`（仅 S2）

与 §4.10 的区别：**只允许 `location` / `content`**（`oa_s2c_field`），费用与时间不走此通道（时间走 `modify`，费用走 `extend`）。

- 功能开关：`s2_change_*` 配置未开 → `oa_s2c_off`。
- 互斥：有在途 `pending_change`（本人或对方）或 `pending_modify`/`pending_extend` → `oa_s2c_busy`。
- 临近履约时间拦截 → `oa_s2c_blocked`（审计事件 `order_s2_change_block_near`），提示按原信息履约或申请取消。
- 次数上限、原因长度（≥10 字，`oa_s2c_reason`）、窗口关闭（`oa_s2c_window_closed`）均为配置驱动。
- `pending_change` 带 `stage='S2'`；响应侧若 `stage!=='S2'` → `oa_s2c_none`；token 失配 → `oa_s2c_stale`；超时 → `oa_s2c_expired`。
- 接受后同样重置四项确认（`items.*.user_ok/partner_ok=false`、`version+1`）。
- 错误码：`oa_s2c_location_invalid` / `oa_s2c_content_invalid` / `oa_s2c_field` / `oa_s2c_status` / `oa_frozen` / `oa_s2c_off` / `oa_s2c_busy` / `oa_s2c_blocked` / `oa_s2c_limit` / `oa_s2c_same` / `oa_s2c_reason` / `oa_s2c_window_closed` / `oa_s2c_none` / `oa_s2c_self` / `oa_s2c_stale` / `oa_s2c_expired` / `oa_conflict` / `oa_update_fail`。

### 4.12 改期 `modify` / `modify_confirm` / `modify_reject`

申请（`modify`）：

| 校验顺序 | 规则 | 错误码 |
|---|---|---|
| 1 | `new_start_time` 必须是将来时间 | `oa_modify_time_invalid` |
| 2 | 订单状态必须 `S2` | `oa_modify_status` |
| 3 | 未冻结 | `oa_order_frozen` |
| 4 | 与现服务时间相同即拒绝（2026-11-05 新增，避免生成空转 S2_5） | `oa_modify_same` |
| 5 | 改期次数 < `maxTimes`（`resolveModify`） | `oa_modify_exhausted` |
| 6 | 距新时间 ≥ `minLeadHours` | `oa_modify_lead` |
| 7 | 新时间落在运营时段 `time_redline_open_min`~`time_redline_close_min`（北京时间） | `oa_modify_redline` |
| 8 | 与原时间跨度 ≤ `maxSpanH` | `oa_modify_span` |
| 9 | 原因过内容安全 | `oa_text_unsafe` |

- 落库：`status='S2_5'`、`pending_modify={from_status,new_start_time,reason,by_openid,by_role,created_at,expire_at=confirmHours}`、`modify_at`。
- 幂等：已是 `S2_5` 且 `pending_modify.by_openid` 为本人 → `ok:true` + `idempotent:true`。
- 通知：对方 `type='modify'`，`action_key='jump_accept_modify'`（**await 落库**，防云函数冻结丢通知）。

确认/拒绝（`modify_confirm` / `modify_reject`，共用 `modify_confirm_or_reject`）：

- 无在途申请且状态为 `S2`/`S3` → `ok:true` + `idempotent:true`；否则 `oa_modify_status`。
- 发起人不能自己确认 → `oa_modify_self`。
- 回退目标 `toStatus = pending.from_status === 'S3' ? 'S3' : 'S2'`（**S3 仅存量兼容**，新申请只允许 S2 发起）。
- `modify_confirm`：再校验新时间未过期（`oa_modify_expired`）与运营时段（`oa_modify_redline`）→ 写 `start_time`、`modify_count+1`、清 `pending_modify` → **重置四项确认** → 通知 `type='modify_confirm'`。
- `modify_reject`：清 `pending_modify` → `modify_rejected_at/by` → 通知 `type='modify_reject'`。
- 超时：`order-timer` 的 `modify_auto_reject` 回 `from_status`。

### 4.13 加时 `extend` / `extend_confirm` / `extend_reject`

| 项 | 契约 |
|---|---|
| 状态门 | 仅 `S3`（`oa_extend_status`） |
| 入参 | `add_hours` 必须 1–12 整数（`oa_extend_hours`）、`reason`（可选，`reasonMaxLen` 截断） |
| 互斥 | 已有 `pending_extend` → `oa_extend_exist` |
| 计价 | `pricing_type==='fixed'` → `add_amount_fen=0`；否则 `Math.round(total_fen / duration_h * add_hours)`，≤0 → `oa_extend_price` |
| 确认窗口 | `extend_confirm_min`（分钟，默认 20）；配置为 0 时回退 `resolveModify().confirmHours*60`；`expire_at` 在申请时算死 |
| 落库 | `pending_extend={add_hours,add_amount_fen,reason,by_openid,by_role,created_at,expire_at}`、`extend_count+1`、`pending_extend_token=now` |
| 幂等 | 同 `pending_extend.by_openid` → `ok:true` + `idempotent:true` |
| 确认 | `duration_h+add_hours`、`total_fen+add_amount_fen`；非一口价按 `splitOrderAmount` 重算 `fee_fen`/`partner_income_fen`（一口价保持不变）；清 `pending_extend` 且 `pending_extend_token=0` |
| 拒绝 | 清 `pending_extend`、`token=0`、写 `extend_rejected_at/by`；状态不变 |
| 超时 | `order-timer` 的 `extend_auto_reject` 依据 `pending_extend_token` 精确收口 |
| 错误码 | `oa_extend_hours` / `oa_extend_status` / `oa_extend_exist` / `oa_extend_price` / `oa_text_unsafe` / `oa_extend_no_pending` / `oa_extend_self` / `oa_status_conflict` |

> 加时不改主轴状态（`S3 → S3`），只增时长与金额；`logStatus` 仍写一条 `user_extend` / `partner_extend` 事件用于时间线。

### 4.14 中断 / 恢复 / 部分完成 / 比例

| action | 状态流转 | 落库字段 | 入口 |
|---|---|---|---|
| （无 action） | `S3 → S3.5` | `interrupted_at`、`interrupted_by`、`order_status_log(from S3 to S3.5)` | **仅 `safety-report` 的 SOS 分支**（[index.js:416](../cloudfunctions/safety-report/index.js)）；`order-action` 无 `interrupt_report` handler |
| `resume_service` | `S3.5 → S3` | `resumed_at`、`resumed_by` | 双方均可；幂等（已是 S3 → `idempotent`）；错误码 `oa_resume_status` / `oa_status_conflict` |
| `partial_confirm` | `S3.5 → S4` | `partial_confirmed_at/by` | 双方均可；`casStatus('S3.5', …, 'partial_agree')`；错误码 `oa_partial_status` |
| `ratio_confirm` | `S4 → S5` | `ratio_fen`（0–100 整数，缺省 100）、`ratio_confirmed_at/by` | 双方均可；`oa_ratio_status` / `oa_ratio_invalid` |
| （定时器） | `S3.5 → S4` | — | `interrupt_timeout_h`（默认 24h）到期，锚点 `interrupted_at || updated_at`，事件 `timeout_interrupt_partial`，通知 `type='interrupt_partial'` |

### 4.15 里程碑 `milestone_submit` / `milestone_confirm`

- 状态：仅 `S3`；`milestone={current:0..3, confirmed:[false,false,false], evidence:[]}`。
- 提交（**仅耍伴**，`oa_ms_perm`）：`current+1`，档位标签固定 `1→30% / 2→60% / 3→100%`；已到 3 → `oa_ms_done`；`note` 过内容安全（`oa_text_unsafe`）。
- 证据追加：`{milestone,label,note,location,submitted_by,submitted_at}`。
- CAS 条件：`_id + status='S3' + milestone.current=旧值` 同时成立才更新，失败 → `oa_ms_conflict`。
- 确认（**仅需求方**，`oa_ms_confirm_perm`）：`milestone ∈ {1,2,3}`（`oa_ms_invalid`），未提交 → `oa_ms_not_submitted`，重复确认 → `oa_ms_already_confirmed`；写 `milestone.confirmed.{idx}=true`。
- 通知：提交时给需求方 `type='milestone'`。
- 超时：`order-timer` 的 `milestone_auto_confirm` 自动确认未处理进度。

### 4.16 投诉与爽约申诉

**`complaint`（发起争议）**

| 项 | 契约 |
|---|---|
| 可发起状态 | `S2` / `S3` / `S3.5` / `S4`（`COMPLAINT_OPEN_STATUS`，**有意窄于状态机 no.16**：S5 起关闭投诉入口） |
| 前置 | 订单未冻结（`oa_order_frozen`，谁先发起谁冻结） |
| 落库 | `status='S10.5'`、`help_flag=true`、`complaint_at/by/reason/from_status`、`dispute_state='open'`、`dispute_type='complaint'`、`frozen=true` |
| 旁路集合 | `complaint` 新增一条 `{order_id, initiator_openid/role, target_openid, reason, status:'pending'}`（写失败仅记日志，不回滚订单） |
| 错误码 | `oa_complaint_status` / `oa_order_frozen` / `oa_text_unsafe` / `oa_status_conflict` |

**`complaint_withdraw`（自助撤回）**

- 仅投诉发起人可撤；`complaint_by` 为空（争议由系统升级而来）时双方均可撤；否则 `oa_not_complaint_owner`。
- 回退目标：`complaint_from_status`，缺失时从 `order_status_log` 最近一条 `to_status='S10.5'` 反查 `from_status`；白名单 `S2/S3/S3.5/S4/S5/S8/S9/S2_6/S3_6`，不在内 → `oa_complaint_no_restore`。
- 落库：`status=restore`、`complaint_withdrawn_at/by`、`dispute_state='resolved'`、`frozen=false`；`complaint` 记录改 `status='withdrawn'`。
- 平台已受理（状态已离开 `S10.5`）→ `oa_complaint_handled`。

**爽约申诉 `no_show_report_*`**

| action | 说明 |
|---|---|
| `no_show_report_submit` | 仅 `S2`/`S3.5`（`no_show_bad_status`）且已过约定开始时间（`no_show_not_started`）、在 `no_show_report_window_h`（默认 48h）窗口内（`no_show_window_closed`）；原因 ≥ `no_show_reason_min_len`（10 字）、证据 ≤ `no_show_evidence_max`（3）；写 `no_show_report` 集合，状态 `received`，附 `evidence_deadline` |
| `no_show_report_defense` | 仅 `received`/`defense` 可举证；写 `defense_at`、`defense_overdue`；已裁定 → 拒绝 |
| `no_show_report_withdraw` | 仅申诉人、裁定前可撤；撤回计入 N6 配额 |
| `no_show_report_detail` | 双方可读申诉详情 |
| 裁定 | 不在本函数：`admin-action.no_show_decide`（`VERDICTS` 见 `no_show_rules.js`） |

配置 9 键（全部后台可配，默认值见 `no_show_rules.js:27-35`）：`no_show_report_window_h`(48) / `no_show_defense_window_h`(48) / `no_show_score_deduct`(20) / `no_show_suspend_threshold`(3) / `no_show_suspend_days`(7) / `no_show_count_window_days`(180) / `no_show_evidence_max`(3) / `no_show_reason_min_len`(10) / `no_show_max_per_order`(1)。

> 申诉**不改变订单主轴状态**，只写 `no_show_report` 并在订单上置冻结位；裁定结果由后台写入信用分与处置。

### 4.17 只读与辅助 action

`detail` / `my_orders` / `my_counts` / `notice_list` / `notice_poll` / `notice_read` / `timeline` / `get_confirmation` / `chat_poll` / `nudge_partner`：均不改状态，只做鉴权 + 查询/催办。`nudge_partner` 受 `urge_rules.canManualUrge` 频控。字段级返回结构待 `payment-mock` 段一并核对（下一段）。

### 4.18 其余函数待详写组（下一段）

| 函数 | 待详写 action 组 |
|---|---|
| `payment-mock` | 支付/退款/加时结算/打赏/提现/AA 记账 |
| `admin-action` | 用户治理、订单干预、配置读写、审核、财务、法律文档 |
| `safety-report` | SOS / 静默求助 / 签到 / 举报 |
| `im-send` | 文本/模板/客服消息与频控 |

## 5. `payment-mock` 资金契约（详表）

> 结论先行：**本期无真实资金通道**。`index.js:2` 明示「MVP 无真实微信支付，一律 `is_mock=true`」；支付/退款/打赏/保险/提现全部只写本地流水与余额位，不发生任何外部扣款或打款。

### 5.1 真实通道开关与门控（决定 prod 能否调用）

| 层 | 规则 | 位置 |
|---|---|---|
| 身份 | `resolveOpenid` 取 openid，取不到 → `pay_no_openid` | [index.js:139-140](../cloudfunctions/payment-mock/index.js) |
| mock 门控 | `MOCK_ONLY_ACTIONS = [mock_pay, mock_refund, mock_tip, mock_ins, withdraw, fast_withdraw]`；**dev 放行**，**prod 需 `admin_config.mock_payment_enabled === true`** 才放行 → 否则 `pay_mock_disabled` 并写 `audit(security, mock_pay_blocked)` | [index.js:153-163](../cloudfunctions/payment-mock/index.js) |
| 默认值 | `mock_payment_enabled` 未配置即视为 **false（fail-closed）** | 同上 |
| 订单 ID 预检 | `cashier_info`/`mock_pay`/`mock_refund`/`mock_tip`/`mock_ins`/`aa_record` 要求 32 位十六进制 `_id`，否则 `pay_bad_order_id` | [index.js:166-168](../cloudfunctions/payment-mock/index.js) |
| 未知 action | `pay_unknown_action` | [index.js:184](../cloudfunctions/payment-mock/index.js) |

> 上线前必须把 `mock_payment_enabled` 置回 false；置 false 后 prod 的支付、退款、打赏、保险、提现**全部入口关闭**（前端仍可用收银台只读摘要与钱包查询）。

### 5.2 action 清单（实存 **13**；原 14 含已删除的 `migrate_tip_partner`；文件头注释「9 个」为旧口径）

| action | handler | 文件:行 | 主作用 |
|---|---|---|---|
| `cashier_info` | `cashierInfoAction` | [action_pay.js:17](../cloudfunctions/payment-mock/action_pay.js) | 收银台摘要（只读） |
| `mock_pay` | `mockPayAction` | [action_pay.js:59](../cloudfunctions/payment-mock/action_pay.js) | 模拟支付 S0→S2 |
| `mock_refund` | `mockRefundAction` | [action_pay.js:175](../cloudfunctions/payment-mock/action_pay.js) | 模拟全额退款 S2/S3→S7 |
| `mock_tip` | `mockTipAction` | [action_pay.js:284](../cloudfunctions/payment-mock/action_pay.js) | 打赏（不改状态） |
| `tip_list` | `tipListAction` | [action_tip.js:4](../cloudfunctions/payment-mock/action_tip.js) | 单笔订单打赏明细 |
| `mock_ins` | `mockInsAction` | [action_tip.js:27](../cloudfunctions/payment-mock/action_tip.js) | 模拟投保 |
| `aa_record` | `aaRecordAction` | [action_tip.js:75](../cloudfunctions/payment-mock/action_tip.js) | W2 AA 记账 |
| `balance_info` | `balanceInfoAction` | [action_account.js:4](../cloudfunctions/payment-mock/action_account.js) | 钱包汇总 |
| `income_list` | `incomeListAction` | [action_account.js:69](../cloudfunctions/payment-mock/action_account.js) | 接单收入明细 |
| `tip_income_list` | `tipIncomeListAction` | [action_account.js:109](../cloudfunctions/payment-mock/action_account.js) | 打赏收入明细 |
| ~~`migrate_tip_partner`~~ | ~~`migrateTipPartnerAction`~~ | **2026-11-08 已删除**（见 §5.13） | 历史打赏流水补 `partner_openid` 快照（一次性任务已完成） |
| `withdraw` | `withdrawAction` | [action_withdraw.js:5](../cloudfunctions/payment-mock/action_withdraw.js) | 普通提现 T+1 |
| `fast_withdraw` | `withdrawAction`（同一实现，`isFast` 由 action 名区分） | 同上 | 极速提现 T+0 |
| `withdraw_list` | `withdrawListAction` | [action_withdraw.js:86](../cloudfunctions/payment-mock/action_withdraw.js) | 提现记录 |

### 5.3 `mock_pay`（唯一把订单推进到 S2 的入口）

| 步骤 | 行为 | 错误码 |
|---|---|---|
| 1 | 缺 `order_id` | `pay_no_order` |
| 2 | 订单不存在 | `pay_not_found` |
| 3 | 非下单人（`order.user_openid !== openid`） | `pay_not_owner` |
| 4 | **幂等前置**：`pay_transaction` 已有 `type='pay', status='success'` → 直接 `ok:true` + `idempotent:true`（返回订单当前状态） | — |
| 5 | 状态必须 `S0` | `pay_status` |
| 6 | `pay_expire_at < now`（默认 30 分钟，由 `order-create` 写入） | `pay_expired` |
| 7 | `aa_tier` 非 `0-50`/`0-50元` 且未传 `aa_promise_checked=true` | `pay_aa_promise` |
| 8 | **CAS**：`{_id, status:'S0'} → S2`，同时写 `fund={paid_fen: total_fen, refunded_fen:0, settle_state:'pending', settled_at:0}`；未抢到先查成功流水判幂等，再区分 `S6 → pay_closed` / 其余 `pay_status_conflict` | `pay_db_fail` / `pay_closed` / `pay_status_conflict` |
| 9 | **事务**：`pay_transaction`（`pay_no=PAY+YYYYMMDD+16hex`、`channel='mock'`、`is_mock=true`、`status='success'`）+ `order_status_log(S0→S2, mock_pay)` 同成同败 | `pay_db_fail` |
| 10 | 事务失败补偿：订单回 `S0` 且**资金位清零**（`paid_fen:0`）；补偿再失败写 `platform_event(P0, pay_compile_fail…)` | — |
| 11 | 通知耍伴 `system_notice(type='paid')`（await 落库）；写审计 `business/mock_pay` | — |

> 资金红线：CAS 只允许一方从 `S0` 抢到 `S2`；重复点击落在第 4 步或第 8 步幂等分支。

### 5.4 `mock_refund`（全额自助退款）

- 仅下单人（`refund_not_owner`）；状态白名单 **`S2`/`S3`**（`refund_status`）。
- 幂等：已有 `type='refund', status='success'` → `ok:true` + `idempotent:true`，返回**订单真实状态**（不硬编码 S7）。
- CAS：`status ∈ [S2,S3] → S7`，写 `refunded_at`、`fund={paid_fen:total, refunded_fen:total}`。
- 事务：`pay_transaction(type='refund', pay_no=REF…)` + `order_status_log(from→S7)`。
- 补偿：失败回原状态并把 `fund.refunded_fen` 清零（用点路径更新）。
- 已知口径：退款**不改 demand 状态**（保持 `matched`），与「取消释放需求」不同路径。
- 错误码：`refund_no_order` / `refund_not_found` / `refund_not_owner` / `refund_status` / `refund_db_fail` / `refund_status_conflict`。

### 5.5 `mock_tip`（打赏，可多次，不改订单状态）

- 仅下单人（`tip_not_owner`）；状态白名单 `S5`/`S8`/`S9`/`S10`（`tip_status`）。
- 金额 `1–500 元`整数分（`money_rules.js:41-42`，`TIP_MIN_FEN=100`/`TIP_MAX_FEN=50000`）→ `tip_amount`。
- 事务内：插入 `pay_transaction(type='tip')`（含 `partner_openid`/`scene` 快照、`note` 截 60 字）+ `order_main.tip_total_fen = _.inc(amount)`（`TIP+YYYYMMDD+16hex`）。
- 通知耍伴 `type='tip'`；审计 `business/mock_tip`；失败 `tip_db_fail`。
- 返回 `{tip_no, amount_fen, tip_total_fen, is_mock:true}`。

### 5.6 `mock_ins`（模拟投保）

- 仅下单人（`ins_forbidden`）；状态白名单 `S0/S1/S2/S3/S3.5`（`ins_status`）；**幂等**：`insurance_record` 已存在 → 原样返回 + `idempotent:true`。
- 落库字段：`policy_no=INS+时间戳+6位`、`status='active'`、`coverage_accident_fen`（`insurance_coverage_accident_fen`，缺省 50,000,000 分 = 50 万元）、`coverage_property_fen`（缺省 5,000,000 分 = 5 万元）、`premium_fen=0`（平台承担）、`is_mock=true`。
- 错误码：`ins_no_order` / `ins_not_found` / `ins_forbidden` / `ins_status` / `ins_db_fail`。**无真实保单、无外部承保。**

### 5.7 `aa_record`（W2 AA 记账，平台不代收）

| 校验 | 规则 | 错误码 |
|---|---|---|
| 场景 | 仅 `order.scene === 'W2'` | `aa_scene_not_supported` |
| 承诺 | 必须 `order.aa_promise_signed` | `aa_no_promise` |
| 金额 | 正整数分 | `aa_amount` |
| 参与方 | 用户或耍伴 | `aa_not_participant` |
| 单笔上限 | `aa_record_max_fen`（缺省 100,000 分 = 1000 元） | `aa_over_record_limit` |
| 条数上限 | `aa_ledger_max_records`（缺省 50） | `aa_over_records_limit` |
| 累计上限 | `aa_ledger_max_fen`（缺省 300,000 分 = 3000 元） | `aa_over_ledger_limit` |

- 事务内复核条数/累计后再 `aa_ledger.records` push + `aa_ledger.total_fen` inc（防并发冲破上限）。
- 记录字段：`record_id=AA+日期+随机`、`amount_fen`、`note`（≤200 字）、`evidence_url`、`paid_by`、`paid_openid`。
- **只记账不动钱**：不产生 `pay_transaction`，不改 `fund`。

### 5.8 钱包与收益口径（`balance_info` / `income_list` / `tip_income_list`）

- 已结算口径 = `order_main.status ∈ [S8,S9,S10]` 的 `partner_income_fen + tip_total_fen`。
- 在途待结算 `splitting_fen` = `S2/S3/S5` 的 `partner_income_fen + tip_total_fen`（**S6 不计入**，2026-11-03 裁定）。
- 可提现 `withdrawable_fen = 已结算 − (processing + success 提现额)`，与 `withdraw` 共用 `computeBalance`（`_shared/money_rules.js`）。
- 时间口径：北京时间，日/周/月界固定 `+8h` 偏移计算，不依赖运行时 TZ（`action_account.js:11-18`）。
- 返回另含 `today_pending`（今日待履约，`S2/S3/S3.5` 且 `start_time` 落在今日）、`total_completed`、`week_income_fen`、`month_income_fen`、`credit_level`（909/800/700 分档）、`credit_score`（取 `partner_profile.score`，无档案为 `null`）。

### 5.9 提现（`withdraw` T+1 / `fast_withdraw` T+0）

| 项 | 普通 `withdraw` | 极速 `fast_withdraw` |
|---|---|---|
| 最低额 | 10 元（`wd_too_small`，`WD_MIN_FEN=1000`） | 同 |
| 单笔上限 | 无 | `fast_withdraw_per_order_max_fen`（缺省 20,000 分 = 200 元）→ `wd_fast_cap` |
| 当日累计 | 无 | `fast_withdraw_per_day_max_fen`（缺省 200,000 分 = 2000 元），北京时间日切 → `wd_fast_daily` |
| 余额 | `wd_insufficient` | 同 |
| 并发 | `withdraw_lock` 每 openid 一把（TTL 30s）→ `wd_busy` | 同 |
| 落库 | `withdraw_record{status:'processing', expect_arrive_at: now+24h}` | `{status:'success', arrived_at: now}` |
| 到账 | **惰性回写**：`balance_info`/`withdraw_list` 入口触发 `settleDueWithdrawals`，到期 `processing→success` | 即时 |
| 错误码 | `wd_amount` / `wd_too_small` / `wd_insufficient` / `wd_busy` / `wd_db_fail` | 另加 `wd_fast_cap` / `wd_fast_daily` |

- **无真实打款**：`withdraw_record` 只是本地记录，`is_mock=true`；不存在微信商家转账调用。
- 提现在 prod 也受 §5.1 mock 门控约束（`MOCK_ONLY_ACTIONS` 含两者）。

### 5.10 与 `order-action` 的调用关系

| 场景 | 调用方 | 关系 |
|---|---|---|
| 四确认完成 → 待支付 | `order-create` 建单时写 `pay_expire_at` | 支付前状态 `S0` 由 `order-create` 产生，`payment-mock.mock_pay` 负责 `S0→S2` |
| 取消待支付单 | `order-action.cancel` | 直接 `S0→S6`，**不经 payment-mock**（未支付无退款流水） |
| 已支付后退款 | `payment-mock.mock_refund` | `S2/S3→S7`，写 `fund.refunded_fen`；`order-action` 无独立退款 action |
| 加时差价 | `order-action.extend_confirm` | **不产生真实收款**，只改 `total_fen`/`fee_fen`；`fund.paid_fen` 不随之增加（**已知口径差**，见 §5.11） |
| 结算与提现 | 耍伴钱包页 | 读 `order_main` 已结算态 + `withdraw_record` |

### 5.11 偏差与待确认（只登记）

| # | 现象 | 依据 | 性质 |
|---|---|---|---|
| 1 | 文件头注释写「9 个 action」，实际分发 **13** 个（含 `tip_list`/`tip_income_list`/`withdraw_list`；原 14，`migrate_tip_partner` 已于 2026-11-08 删除） | [index.js:3-6](../cloudfunctions/payment-mock/index.js) ↔ `module.exports`（4 个 action_*.js） | 注释陈旧，非行为问题 |
| 2 | 加时确认后 `total_fen` 增加但 `fund.paid_fen` 不变 | `action_modify_extend.js` 加时分支 ↔ `mock_pay` 写 `fund` | **隐患**：详见 §5.12；接真实支付前必修 |
| 3 | `mock_ins` 已在 `MOCK_ONLY_ACTIONS`，但 prod 关闭 mock 支付后「保险」一并不可用 | [index.js:153](../cloudfunctions/payment-mock/index.js) | 待定（耦合设计，不单独立项） |
| 4 | `migrate_tip_partner` 为历史数据修复型 action，未做二次鉴权（任意登录用户可触发） | [action_account.js:139](../cloudfunctions/payment-mock/action_account.js) | **已处置：2026-11-08 按方案 A 删除**（见 §5.13） |

### 5.12 资金位口径专章：加时只改 `total_fen`、不动 `fund.paid_fen`

**先给事实：`fund.paid_fen` 不是流水累加值，而是「派生快照」**——每次走到资金节点，都用**当时的 `order.total_fen` 整体覆盖**：

| 写入点 | 写的值 | 位置 |
|---|---|---|
| 支付成功 | `paid_fen = total_fen` | [action_pay.js:102](../cloudfunctions/payment-mock/action_pay.js) |
| 支付事务失败补偿 | 全字段清零 | [action_pay.js:152](../cloudfunctions/payment-mock/action_pay.js) |
| 自助退款 | `paid_fen = total_fen`、`refunded_fen = total_fen` | [action_pay.js:213](../cloudfunctions/payment-mock/action_pay.js) |
| 争议裁决退款 | `paid_fen = total_fen`、`refunded_fen = 已退 + 本次` | [action_dispute_handle.js:65](../cloudfunctions/admin-action/action_dispute_handle.js) |
| 评价达成（用户） | `paid_fen = total_fen`、`settle_state='ready'` | [evaluation-submit/index.js:234](../cloudfunctions/evaluation-submit/index.js) |
| 评价达成（定时器/自动） | 同上 | [order-timer/action_lifecycle.js:78](../cloudfunctions/order-timer/action_lifecycle.js)、[:88](../cloudfunctions/order-timer/action_lifecycle.js) |
| 结算完成 | `paid_fen = total_fen`、`settle_state='done'` | [order-timer/action_lifecycle.js:153](../cloudfunctions/order-timer/action_lifecycle.js) |

**加时的行为**：`extend_confirm` 只改 `duration_h` / `total_fen` / `fee_fen` / `partner_income_fen`，**不写 `fund`、不写 `pay_transaction`**。因此从「加时确认」到「下一个资金节点」之间，`paid_fen` 与 `total_fen` 不等。

**三个口径各自按哪个数走**：

| 口径 | 实际取数 | 位置 | 加时后的结果 |
|---|---|---|---|
| 退款 | `order.total_fen`（**不是 `paid_fen`**），按 `total_fen − 已退` 封顶 | [action_pay.js:213](../cloudfunctions/payment-mock/action_pay.js)；[action_dispute_handle.js:35-42](../cloudfunctions/admin-action/action_dispute_handle.js) | 退的是**含加时差额**的全额 |
| 结算/收入 | `partner_income_fen`（加时确认时已重算）与 `total_fen` | [order-timer/action_lifecycle.js:153](../cloudfunctions/order-timer/action_lifecycle.js) | 按加时后金额结算；`paid_fen` 被顺带覆盖为 `total_fen`（不一致**自愈**） |
| 对账/流水 | `pay_transaction` 汇总（`type=pay` 只有一笔，加时不补） | [order-action/action_query.js:136-138](../cloudfunctions/order-action/action_query.js) 读 `fund`；实际流水在 `pay_transaction` | **流水合计 ≠ `paid_fen` ≠ `total_fen`** |

**结论：是隐患，不是有意设计**，但当前不产生实际资损——

1. 现在只有 mock 支付：没有真实收款，`paid_fen` 写多少都不对应银行流水，差额无资金后果。
2. 一旦接真实支付：加时差额**从未实收**，却会被退款按 `total_fen` 全额退出（平台垫付差额），结算也按 `total_fen` 计入收入——**直接产生资损**。所以接真实通道前必须先修。
3. **处置口径（2026-11-08 定：不是「待定」，是硬前置）**：`paid_fen` 不能既当快照又当流水。**接真实支付通道前必须整体落地下述二选一**，否则禁止上线：

| 方案 | 要改的文件（逐处） | 影响面 | 代价 |
|---|---|---|---|
| **(a) `paid_fen` 改累加式 + 补加时差额流水** | ①`payment-mock/action_pay.js:102/152/213` 三处 `=`→`+=` 并补幂等键；②`admin-action/action_dispute_handle.js:65`、`evaluation-submit/index.js:234`、`order-timer/action_lifecycle.js:78/88/153` 六处「覆盖为 `total_fen`」改「不重写/按流水重算」；③`order-action/action_modify_extend.js:307-320` 加时确认补 `fund.paid_fen += add_amount_fen` + 同事务写 `pay_transaction(type='pay', source='extend')`；④新增「补差价」收银台与支付入口（小程序 + `payment-mock` 新 action） | 钱包 `balance_info`/`income_list`、退款封顶、结算、后台 `finance_list`/`finance_stats`、`action_query` 读 `fund`；**存量单需一次性回填**（现语义为快照，改累加后历史值不等价） | 高：写侧 10 处 + 存量迁移 + 新支付入口 |
| **(b) `pay_transaction` 为唯一真值，`paid_fen` 仅冗余** | ①退款封顶改读流水汇总（`action_pay.js:213`、`action_dispute_handle.js:35-42`）；②结算改读流水净额（`order-timer/action_lifecycle.js:153`）；③对账与后台财务改读 `pay_transaction` 聚合（`order-action/action_query.js:136-138`、`admin-action` 的 `finance_list`/`finance_stats`）；④同上六处 `paid_fen` 覆盖写改「不写」或「写=流水汇总」并注释声明非真值 | 读侧全部改口径；写侧减少；仍需新增「补差价」收款流水 | 中高：读侧面广，语义单一、无存量迁移 |

> 共同点：**两条路都必须新增「加时差额真实收款」这一笔业务流水与收银台入口**，否则无法自证「实收 = 应退」。落地前 mock 阶段不产生资损（第 1、2 点）。阻断项登记见 `docs/HANDOFF-20261108.md` T-9.12。

### 5.13 安全项（**已处置 2026-11-08**）：`migrate_tip_partner` 无二次鉴权 → 已删除

| 项 | 事实 |
|---|---|
| 处置 | 按**方案 A 删除**：`cloudfunctions/payment-mock/action_account.js` 移除 `migrateTipPartnerAction` 与导出键，原位置留 5 行说明注释；`_shared/ab_equivalence.js` 将 `pm_migrate_tip` 加入 `KNOWN_EVOLUTION`（基线仍有该 action → 当前 `pay_unknown_action`，属预期演进） |
| 执行前前提（均已实证） | ①`miniprogram/`／`admin-web-frontend/`／`scripts/` 检索 `migrate_tip_partner|migrateTipPartner` **0 命中**；②云端只读 `count`：`pay_transaction(type='tip',status='success')` 共 **47** 笔，缺 `partner_openid` 的 **0** 笔（回填已完成）；③`mock_tip` 自 2026-10 起在事务内即写 `partner_openid`/`scene` 快照（[action_pay.js:316-317](../cloudfunctions/payment-mock/action_pay.js)），不会产生新的缺失行 |
| 影响面 | 调用方返回 `pay_unknown_action`（无前端调用方）；**运维回填能力未丢失**——[admin-web/index.js:387](../cloudfunctions/admin-web/index.js) 的 `fn_migrate_tip_partner` 是独立实现（X-Admin-Key 保护、直查 DB），不依赖 payment-mock |
| 门禁 | `npm test` EXIT=0（A/B **455**：237 explicit + 218 auto / 80 known）；`check-doc-links` OK；`check-shared-sync` **SHARED SYNC ALL OK**；`check-handlers` 146 actions 零抛错；`verify:offline` EXIT=0 |
| 历史风险（已消除） | 原风险：**任何已登录用户**均可调用（不在 `MOCK_ONLY_ACTIONS`、无角色/无白名单/无 `confirm`），单次改写最多 100 条打赏流水的 `partner_openid`/`scene` 且**无 `audit`/`platform_event` 留痕** → 财务归属可被篡改且不可追溯 |

**为何选 A 而非 B/C**：一次性回填已完成（实测残留 0/47），新写入的流水在 `mock_tip` 事务里已带快照，保留 = 留下一个可批量改写财务字段的后门；B（迁 `admin-action` 限 R1 + 审计）与 C（原地加白名单 + `confirm` + 留痕）都会继续保留「直接改写历史财务归属」的能力，而运维侧已有 `admin-web` 的 `fn_migrate_tip_partner` 承担回填职责。

## 6. `admin-action` 高频 action 详表

### 6.1 action 数核准（唯一口径）

**核准结果：101 个 action。**

判定依据（可复现）：

1. **注册方式**：`admin-action/index.js` 用 `Object.assign` 组装两张分发表 —— `HANDLERS_PRE`（免鉴权，2 个模块）与 `HANDLERS`（鉴权后，31 个模块），合计 33 个 `action_*.js`；**无循环注册、无动态键、无 handler 映射表**，`index.js` 内 `action === '…'` 内联分支实测 **0 处**。
2. **导出键合计 102**：逐文件解析 `module.exports = { … }`（支持单行、多行、`键: 别名` 形式），33 个模块合计 102 个键，跨模块无重名。
3. **扣除非 action 键 1 个**：`action_misc.js` 的 `readImageDims(buf)` 是纯函数（PNG/JPEG 头解析，供 `upload_image` 调用与单测），不是 `(ctx)` handler。
4. **交叉验证**：`_shared/ab_equivalence.js` 的 `enumerateActions('admin-action')` 以「`action_*.js` 的 `Object.keys` 且值为函数」枚举，结果为 102（同样包含 `readImageDims`）；扣除非 action 后与本节 101 一致。

补充说明（不改变上述数字）：

- 102 个键中有 4 个是**退役保活**：`exam_subject_create` / `exam_subject_update` / `exam_subject_delete` / `exam_bank_seed`（统一指向 `exam_write_retired`，保留分发以避免旧后台页面报「未知动作」）。
- 历史文档的 **83 / 86** 与本次实测的差异，属**文档漂移**（不是解析漏项）：83 对应 2026-10-13 的 181 例等价验证时点，此后新增 `blog_*`、`home_activity_*`、`question_*`、`content_*`、`legal_doc_*`、`audit_*`、`no_show_*` 等模块。**2026-11-08 已获批准**把 PRD 两处 83 订正为 101（PRD/PRD.md:789、1253）。

### 6.2 鉴权三段链（所有 action 共用）

| 段 | 规则 | 位置 |
|---|---|---|
| ① 前置段 `HANDLERS_PRE` | 4 个 action **跳过**管理员白名单：`config_public`（小程序读公开配置）、`claim_admin`（白名单为空时首个调用者自助初始化，仅可成功一次）、`admin_login` / `admin_logout` | [index.js:294-333](../cloudfunctions/admin-action/index.js) |
| ② 身份段 | `getWXContext().OPENID` 必须在 `admin_config.admin_openids` 内；admin-web 走 HTTP 网关时校验 `_admin_web_proxy_key === admin_web_key` 后采用网关声明 openid（代理密钥 5 分钟缓存、失败仅缓存 10 秒、fail-closed） | [index.js:60-90](../cloudfunctions/admin-action/index.js) |
| ③ 角色段 | `canAccess(action, role)`：R1 全放行；**未在 `ROLE_GRANTS` 声明的 action 默认仅 R1**（敏感：`export_*`、`config_set`、账号管理、force 类）；拒绝时写 `platform_event(P1, role_forbidden)` 并返回 `role_forbidden` + `forbiddenMsg` | [authz.js:9-61](../cloudfunctions/admin-action/authz.js)、[index.js:397-402](../cloudfunctions/admin-action/index.js) |

> 三个角色：R1 超管 / R2 审核 / R3 运营。会话角色**以账号当前角色为准**（不是登录时快照），改角色即时生效。
> 4 个退役保活 action（`exam_subject_create`/`exam_subject_update`/`exam_subject_delete`/`exam_bank_seed`）仍占 action 名额，计入 101。

### 6.3 用户与配置（最高频写操作）

**用户处置**

| action | 角色 | 入参 | 落库 | 留痕 | 错误码 |
|---|---|---|---|---|---|
| `user_ban` / `user_unban` | **R1** | `target_openid`、`reason`（封禁必填） | `user_account.status='banned'/'normal'` + `banned_reason/at/by`；封禁同时把 `partner_profile.accept_switch=false` | `platform_event(P2, user_banned/user_unbanned)` | `ban_bad_openid` / `ban_user_not_found` / `ban_no_reason` |
| `user_freeze` / `user_unfreeze` | **R1** | `target_openid`、`reason` | `status='frozen'/'normal'` + `frozen_reason/at/by` | `platform_event(P2)` | `freeze_bad_openid` / `user_not_found` |
| `penalty` | R2/R3 | `target_openid`、`level ∈ {warning, suspend_7d, ban}`、`reason`（必填） | `warning` → `last_warning`；`suspend_7d` → `status='suspended'` + `suspend_until=+7d`；`ban` → `status='banned'` | `platform_event(P1, penalty_{level})` | `pen_bad_openid` / `pen_bad_level` / `pen_no_reason` / `pen_user_not_found` |
| `admin_account_list` / `admin_account_create` / `admin_account_set_status` | **R1** | 账号、角色、状态 | `admin_accounts` | `platform_event(P2)` | 见实现 |

> 注意：`user_ban` 与 `user_freeze` **不在** `ROLE_GRANTS` 中 → 实际**仅 R1 可用**；`penalty` 才放开给 R2/R3。这是当前设计，不是遗漏。

**配置读写**

| action | 角色 | 要点 |
|---|---|---|
| `config_get` / `config_log_list` | R3 | 读 `admin_config.global` 并按 `CONFIG_SCHEMA` 补默认值 |
| `config_history_list` | **R1** | 读 `config_history` 快照，分页 |
| `config_set` | **R1** | 见下 |

`config_set` 契约（[action_config_set.js](../cloudfunctions/admin-action/action_config_set.js)）：

- 校验按 `CONFIG_SCHEMA`（`config_schema.js`，105 字段 SSOT）逐字段做类型/枚举/区间校验，失败统一 `config_bad_<字段名>`；无变更 → `config_no_change`。
- **高危特例**：切 `env='dev'` 必须 `confirm='SWITCH_DEV'`（否则 `config_need_confirm`）并带 `dev_hours`（1–24）或 `dev_bypass=true`（`config_bad_dev_hours`）；轮换 `admin_web_key` 必须 `AWK-` + 64 位小写 hex（`config_bad_key`）且必填 `reason`（`config_need_reason`）。
- 场景运营：`scene_list` 增删改/排序/可见性/服务项（名称 1–10 字、单场景 ≤8 个、内置场景不可删）；错误码 `config_scene_not_found` / `config_scene_exists` / `config_scene_builtin` / `config_scene_has_options` / `config_too_many_options` / `config_option_not_found` / `config_reorder_noop` / `config_bad_direction`。
- 落库：事务更新 `admin_config.global` + 写 `config_history` 快照；历史**只保留最近 100 条**（超出按 `created_at` 升序物理删除）。
- 写后必须让前端刷新生效：`config_public` 有 5 分钟级缓存，改完需等缓存或由后台触发刷新。

### 6.4 内容审核

| action | 角色 | 要点 |
|---|---|---|
| `blog_list` | R2/R3 | 动态列表分页 |
| `blog_offline` / `blog_restore` / `blog_delete` | R2 | `delete` 软删（`is_deleted=true` + `delete_note` 必填）；全部写 `platform_event(P2)` |
| `blog_comment_list` | R2 | 按 `post_id` 分页 |
| `blog_comment_delete` | R2 | 软删 + `blog_post.comment_count` 递减；`blog_note_required` / `blog_comment_gone` |
| `partner_profile_pending_list` / `partner_profile_review` / `review` | R2 | 耍伴认证审核 |
| `question_list` / `question_detail` / `question_upsert` / `question_delete` / `question_bulk_status` / `question_import_markdown` | R3 | 题库写入口（S4 起取代旧 `exam_*` 写接口） |
| `exam_subject_overview` / `exam_subject_meta_update` / `exam_subject_list` / `exam_subject_detail` | R3 | 考试科目与通过规则 |
| `legal_doc_list` / `legal_doc_get` | R3 | 法律文档只读 |
| `legal_doc_publish` / `legal_doc_rollback` / `legal_doc_retire` / `legal_doc_seed` | **R1** | 版本库写操作（未在 `ROLE_GRANTS` 声明） |
| `home_activity_list` / `home_activity_create` / `home_activity_update` / `home_activity_delete` | R3 | 首页活动 |
| `upload_image` | R3 | 后台图片上传；含 1:1 强制校验（`up_not_square`）与 JPEG 填充字节跳过 |
| `notice_send` | R3 | 站内通知群发 |
| `kefu_conv_list` / `kefu_conv_reply` | R3 | 客服会话 |
| `content_list` / `content_detail` | R3 | 学习内容只读预览 |

### 6.5 审计与导出（敏感）

| action | 角色 | 要点 |
|---|---|---|
| `audit_init` | R2 | 初始化审计哈希链（`prev_hash`/`chain_hash`） |
| `audit_query` | R2 | 分页查询，返回 `prev_hash`/`chain_hash`/`doc_hash` |
| `audit_verify` | R2 | 逐条重算 `sha256(prev_hash|openid|action|target_id|at)` 比对；产出 `noise[]`，两类异常 `chain_hash_mismatch`（内容被改）与 `prev_hash_link_break`（链断裂） |
| `export_collection` | **R1** | 必须 `confirm:true`（`export_need_confirm`）；集合必须在 `EXPORT_COLLECTIONS` 白名单（`export_bad_collection`）；导出前逐条 `maskDocDeep` 脱敏；单次上限 10000 行 |
| `export_admin_config` | **R1** | 必须 `confirm:true`；配置整体脱敏后导出 |
| `import_collection` / `config_restore` | **R1** | 反向导入/恢复 |

> 审计链只做「防篡改检测」，不阻止写；`audit_verify` 的 `noise` 非空即视为需要人工复盘。

### 6.6 订单干预与财务

| action | 角色 | 状态约束 | 落库与留痕 |
|---|---|---|---|
| `order_force_cancel` | **R1** | **仅 `S0`/`S1`**（`cancel_bad_status`）；`note` 必填（`cancel_no_note`） | `order_main → S6` + `admin_note`/`cancel_by`/`cancel_at`；CAS 失败 `cancel_conflict`；`S1` 时把 `demand` 从 `matched` 释放回 `matching`；写 `order_status_log(actor='admin', action='admin_force_cancel')` + `platform_event(P2)` |
| `demand_offline` | R2/R3 | 仅 `matching`（`demand_bad_status`）；`note` 必填 | `demand → cancelled` + `admin_note`/`offline_by`/`offline_at` |
| `dispute_handle` | R2 | `decision ∈ {open, refund, complete}`；`note` 必填 | `open`：`S10 → S10.5`；`refund`：`S10.5 → S7`，**支持部分退款**（默认全额，上限 `total_fen − 已退`，`dispute_amount_exceed`），写 mock 退款流水 + `fund.refunded_fen`；`complete`：`S10.5 → S5`（已评价过则回 `S8`）；CAS 失败 `dispute_conflict`；`complaint` 置 `resolved` |
| `dispute_detail` / `dispute_list` | R2/R3 | 只读 |
| `no_show_report_list` / `no_show_decide` | R2/R3 | 爽约申诉列表/裁定（`VERDICTS` 见 `_shared/no_show_rules.js`） |
| `finance_stats` / `finance_list` / `withdraw_list` / `settlement_list` / `credit_log_list` | R3 | 只读 |

> `dispute_handle` 的 `refund` 分支是**目前唯一能对已支付订单做部分退款**的入口；`payment-mock.mock_refund` 只能全额。

### 6.7 只读 action 清单（列名不展开）

`dashboard`、`user_list`、`user_detail`、`partner_list`、`partner_detail`、`order_list`、`order_query`、`order_detail`、`demand_list`、`report_list`、`safety_log_list`、`insurance_list`、`im_degraded_list`、`im_message_admin_list`、`evidence_query`、`admin_list`、`realname_reset_simulated`。均只读，不改订单/资金状态。

## 7. 待人工确认清单

1. `partner-apply` 的 `debug_profile` 是否为生产可用入口。
2. `zz-seed-orders` 在生产环境的调用策略（保留/加白/下线）。
3. `order-create.create_from_take` 的既有缺陷是否已修复。
4. **【已处置 2026-11-08】** `migrate_tip_partner` 已按方案 A 删除（见 §5.13）；**待提交、待部署**——payment-mock 云端仍是含该 action 的旧代码，下次部署该函数时生效。
5. **【真实支付上线前阻断项·非普通待办】** 加时差额不进 `fund.paid_fen` / `pay_transaction`，退款与结算按 `total_fen` 走 → 见 §5.12；**必须在「累加式」与「`pay_transaction` 唯一真值」之间二选一并整体落地后才允许接真实支付通道**。
6. `admin-web` 的 `fn_*` / `*_probe` 探活端点是否长期保留（涉及攻击面）。
7. 各函数错误码为稳定契约，但**未做逐码登记**；如需「错误码总表」，应单独立项从源码生成，避免手工抄写漂移。
8. `study_records` 集合在 `cloudfunctions/` 中无写入方，是否需要保留。
