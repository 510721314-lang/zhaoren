# Ch9 · 业务域实现

> 事实来源：代码实测（2026-10）。状态机口径取自 [_shared/order_state.js](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js)；规则口径取自 `_shared/*.js` 纯函数库；写操作取自各云函数。
> 本章**自含**：订单状态、履约流程、资金口径均在此完整定义，不指向任何外部文档。

## 9.1 订单状态机（全图）

### 9.1.1 状态集合（14 个合法 S 码）

定义见 [order_state.js L73-L80](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L73-L80)：

| 组 | 状态 | 语义 |
|---|---|---|
| 主轴 9 态 | `S1` | 待确认（四确认未满，未下单） |
| | `S0` | 待支付 |
| | `S2` | 已支付、待开始 |
| | `S2_5` | 改期确认中 |
| | `S3` | 服务中 |
| | `S3.5` | 履约中断（原因必填） |
| | `S4` | 部分完成 / 裁定期 |
| | `S5` | 已完成、待评价 |
| | `S8` | 已评价 / 结算就绪 |
| 争议占位 | `S10.5` | 争议占位（**读兼容遗留**，目标态由 `dispute_state` 正交位表达） |
| 终态 | `S6` | 已取消 |
| | `S7` | 已退款 |
| | `S10` | 已关闭（售后窗口届满归档） |
| 退役态 | `S9` | 退役（超时默认评价，`mapStatus` 归一为 `S8 + eval_state=auto_done`） |

- **结算资格组** `SETTLE_ELIGIBLE = ['S8','S9','S10']`（显式 SSOT）。
- 状态常量导出：`MAIN_AXIS / SIDE_STATES / TERMINAL_STATES / LEGACY_STATES / ALL_STATES / SETTLE_ELIGIBLE`。

### 9.1.2 正交位（不挤占 status）

履约进度之外的维度用**正交位字段**表达（默认值由 `orthoDefaults()` 生成，[L91-L99](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L91-L99)）：

| 正交位 | 取值 | 语义 |
|---|---|---|
| `eval_state` | `pending` / `user_done` / `auto_done` | 评价态 |
| `dispute_state` | `none` / `open` / `resolved` | 争议态 |
| `dispute_type` | `complaint` / `no_show` / `refund` / `''` | 争议类型 |
| `frozen` | bool | 争议/申诉期间冻结操作位 |
| `fund` | `{paid_fen, refunded_fen, settle_state, settled_at}` | 资金正交位（分）；`settle_state: pending/ready/done` |

### 9.1.3 迁移表（22 条，`TRANSITIONS`）

`from × event → to` 白名单，[L103-L126](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L103-L126)。`to=null` 表示目标由业务上下文决定（回原状态 / 平台裁决出口）。

| # | event | role | from | to | 超时/兜底 |
|---|---|---|---|---|---|
| 1 | confirm_done | both | S1 | S0 | 15min→S6(释放 demand) |
| 2 | pay | user | S0 | S2 | 30min→S6(释放 demand) |
| 3 | cancel | both | S1,S0 | S6 | 已付原路退 |
| 4 | cancel_request | both | S2 | null | 挂起；对方 2h 确认，超时转裁决 |
| 5 | start_service | partner | S2 | S3 | start_time+Xh 未开始→提醒走申诉/取消 |
| 6 | modify | both | S2,S2_5 | null | confirmHours→自动拒绝 |
| 7 | interrupt_report | both | S3 | S3.5 | 24h→S4 |
| 8 | resume | both | S3.5 | S3 | — |
| 9 | partial_agree | both | S3.5 | S4 | 裁限期→按证据转裁决 |
| 10 | milestone | both | S3 | S3 | 确认窗自动确认 |
| 11 | extend_req | both | S3 | S3 | extend_confirm_h→自动拒绝 |
| 12 | extend_paid | user | S3 | S3 | 未付不加结算基数 |
| 13 | complete | partner | S3 | S5 | 里程碑 100% 或双方豁免 |
| 14 | ratio_agree | both | S4 | S5 | 双方各确认一次；裁限期→平台介入 |
| 15 | evaluate | user | S5 | S8 | 48h→auto_done；信用分± |
| 16 | complaint_open | both | S2,S3,S3.5,S4,S5,S8 | null | 目标态=原状态+frozen（不改主轴） |
| 17 | complaint_withdraw | both | `*` | null | 未受理回 `from_status` |
| 18 | dispute_resolve_refund | platform | `*` | null | 全退→S7 / 部分退→回主轴 |
| 19 | dispute_resolve_complete | platform | `*` | null | 已有评价→S8；无评价→S5 |
| 20 | after_sale_expire | system | S8 | S10 | 售后窗口届满 |
| 21 | no_show_decide | platform | `*` | null | 一期零赔付，仅扣信用分/停用 |
| 22 | settle | system | S8,S9,S10 | null | 余额=Σ基数−已提现 |

### 9.1.4 CAS 乐观锁与强制拦截

- **`casTransition(col, _, orderId, expect, patch, opts)`**（[L203-L225](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L203-L225)）：仅当订单 `status ∈ expect` 时 `update`，以 `stats.updated === 1` 判定「抢到」；异常一律返回 `false`（不抛）。
- **强制拦截**（`transitionAllowed`，[L155-L160](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L155-L160)）：`patch.status` 存在且不在白名单内 → **直接拒绝、不写库**。放行例外：无目标状态 / 退役态 `S9` / 未提供 `event` / `opts.skipGuard`。
- **影子校验**：命中且 `opts.event` 时回调 `onShadow` 供观测（正常流程已由强制拦截挡下）。
- **白名单 `*` 的结构性说明**：规则 17/18/19/21 的 `from=['*']`，故**仅凭 (from→to) 无法约束**，强制校验必须**事件驱动**（见源码注释 [L151-L154](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L151-L154)）。
- **读兼容 `mapStatus(order)`**（[L169-L188](file:///c:/zhaoren/cloudfunctions/_shared/order_state.js#L169-L188)）：旧 S 码归一化 —— `S9`→`S8 + auto_done`；`S8`→补 `user_done`；`S10.5`→回 `complaint_from_status/dispute_from_status` + `dispute_state=open` + `frozen=true`；缺省补 `pending/none`。
- **双写过渡**：状态机重构期间先**同时写旧 status 与新正交位**，存量迁移完成后再全仓切换读方（避免读写空窗，见 Ch5 §5.3）。

### 9.1.5 S2 协商取消链（`cancel_request` 挂起字段）

不新增独立状态，用挂起字段实现（详见 Ch5 §5.3）：

- 字段 `cancel_request{by, reason, pre_amount_fen, expire_at}`；挂起期间冻结 `start/modify`。
- **金额以发起时点为准**；超时转裁决按**裁决时点梯度重核**。
- 角色不对称梯度退款：用户取消按距开始时间全额/80%/50%；耍伴取消任意时间全额 + 平台赔付 20% + 扣 20 信用分。
- 与爽约申诉并存时**申诉优先**，自动撤回取消申请。
- 转裁决为**专用双出口**：同意 → 按裁决时点梯度退款 → S7；驳回 → 清挂起回 S2。
- 同方被拒后不可重发，每单双方合计发起上限 2 次。

## 9.2 履约域

### 9.2.1 四确认（下单前）

- 确认项（时间/地点/内容/费用）存 `order_confirmations`，用户 8 位确认全满 → `confirm_done`（S1→S0，`confirm_all`）；15 分钟未满 → S6 释放 demand。
- 四确认前 IM 仅允许系统模板消息（`system_templates`，见 §9.6）。

### 9.2.2 里程碑与部分完成

- `milestone_submit` / `milestone_confirm`：服务中（S3）按里程碑推进；提交超 `milestone_confirm_min`（默认 15min）未确认 → 自动全部确认。
- 完成需里程碑 100% 或双方豁免 → S5。
- 部分完成（S4）：双方各确认一次（`partial_confirm` / `ratio_confirm`）→ S5，按 PRD 口径分段结算；`partial_judge_days` 届满 → 平台介入工单（`s4_stale_escalate`）。

### 9.2.3 改期 / 加时 / 中断恢复

- **改期** `modify`：S2/S2_5 发起，`modify_config{minLeadHours,maxTimes,maxSpanH,confirmHours}` 约束；对方确认 `modify_confirm` → 回 S2；驳回或超 `confirmHours` → 自动拒绝（`S2.5` 超时回原状态）。
- **加时** `extend`：S3 发起，对方 `extend_confirm`/`extend_reject`；超 `extend_confirm_h`（0=跟随改期窗口）→ 自动拒绝；用 `pending_extend_token` 乐观锁防竞态。加时补付（`extend_paid`）未付不加结算基数。
- **中断恢复** `interrupt_report`（S3→S3.5，原因必填）→ `resume_service` 回 S3；24h 未恢复 → S4。

### 9.2.4 履约催办三段式（`urge_rules.js`）

规则见 [urge_rules.js](file:///c:/zhaoren/cloudfunctions/_shared/urge_rules.js)，消费者 `order-timer`（自动）+ `order-action`（手动 `nudge_partner`）：

- 仅 S2；未到开始时间不催办；`cancel_request.pending` 或 `frozen=true` 时**互斥不催办**。
- **自动三段**（`dueStages`）：T0 到点提醒耍伴 → T+`remind_after_h`（默认 1h）用户通知 + 催办入口亮起 → T+`escalate_after_h`（默认 4h）引导爽约申诉。用订单标记位 `urge_t0_at/urge_t1_at/urge_t2_at` 幂等防重复轰炸。
- **手动催办**（`canManualUrge`）：每单上限 `urge_max_count`（默认 2 次），满额置灰（`oa_urge_limit`）。

## 9.3 资金与结算域（`money_rules.js`）

### 9.3.1 分账公式

`splitOrderAmount(totalFen, feeRateFen)`（[money_rules.js L57-L65](file:///c:/zhaoren/cloudfunctions/_shared/money_rules.js#L57-L65)）：

- `feeFen = round(totalFen × rate / 10000)`；`partnerIncomeFen = totalFen − feeFen`。
- `rate` = 平台费率万分比；**显式 0 是合法免佣**，仅 `null/undefined/''` 才回退默认 `1000`（10%）。
- ⚠️ 语言坑：`Number(null)===0`，故必须先判 `null/undefined` 再转数值，否则缺省被误判为免佣。

### 9.3.2 退款规则

- 退款上限 = 订单总额 − 已成功退款合计（**不含打赏**）；超额/零额/非整数一律拦截。
- 退款失败 → **自动补偿回滚**订单状态；成功 → 向双方推站内通知（含金额，可跳详情）。
- **部分退款仅冲减结算基数**，不进入全额退款终态 S7。

### 9.3.3 结算与余额

- 结算基数支持双方各确认一次；部分完成确认后自动生成剩余金额退款工单。
- 分段结算口径：完成比例 ≥50% 按比例；<50% 按 10-20% 到场补偿（可配置）。
- **可提现余额** `computeBalance({settledAgg, withdrawGroups})`（[L135-L149](file:///c:/zhaoren/cloudfunctions/_shared/money_rules.js#L135-L149)）：
  - `settledFen` = 服务收入 + 打赏；`usedFen` = 处理中(`processing`) + 已成功(`success`)；`availableFen = max(0, settledFen − usedFen)`。
  - `.balance_info` 与 `withdraw` **共用同一口径**防漂移。

### 9.3.4 打赏 / 提现 / AA

- **打赏**（`tip`）：金额校验 1–500 元整数（`isValidTipAmount`，常量 `TIP_MIN_FEN/TIP_MAX_FEN`）。**生产环境 `tip_enabled` 自动关闭**（`mock_tip` 恒随 env 关闭）。
- **提现**：单次最低 10 元（`WD_MIN_FEN`）；基础段校验 `validateWithdrawBasic`（格式/最低额/极速单笔上限），余额段 `validateWithdrawBalance`（余额充足/极速当日累计）；极速提现单笔上限 200 元、当日 2000 元（可被 `fast_withdraw_per_*_max_fen` 覆盖）。并发用 `withdraw_lock` 串行锁。
- **AA 记账**：线下台账**仅记账不代收**，上限 `aa_record_max_fen` / `aa_ledger_max_fen` / `aa_ledger_max_records` 防刷。

## 9.4 争议与申诉域

### 9.4.1 投诉（`complaint`）

- `complaint` 发起：售后/履约窗口内，目标态 = 原状态 + `frozen=true`（不改主轴）；`complaint_withdraw` 未受理时回 `from_status`。
- 冻结期间禁止 start/modify/complete/evaluate，且隐藏「发起投诉」按钮。
- 争议裁决（`no_show_decide` / `dispute_handle`）：
  - `dispute_resolve_refund`：金额 ≤ 可退上限；全退→S7，部分退→回主轴。
  - `dispute_resolve_complete`：已有评价→S8（**保留原评价上下文**）；无评价→S5。

### 9.4.2 爽约申诉（`no_show_rules.js`）

规则见 [no_show_rules.js](file:///c:/zhaoren/cloudfunctions/_shared/no_show_rules.js)：

- **可申诉资格**（`canSubmitReport`，2026-10-12 定稿）：状态为 `S2` 或 `S3.5`，且 `约定开始时间 ≤ now ≤ 约定开始时间 + no_show_report_window_h`（下界恢复，未到开始时间返回 `no_show_not_started`）。
- **举证**（`defenseDeadlineOf`）：截止 = 受理时间 + `no_show_defense_window_h`；逾期**不自动关闭**，管理员可径行裁定（逾期举证标记 `overdue`）。
- **裁定成立**（`verdictOutcome`）：`times` = 滚动窗口内既有次数 + 1；扣分 `no_show_score_deduct`（0=仅计次不扣分）；`times ≥ no_show_suspend_threshold` → 停用 `no_show_suspend_days` 天（写 `suspend_until`）。
- **撤回**（`canWithdrawReport`，N8 变更）：仅申诉人本人、裁定前（`received`/`defense`）可撤；撤回占用配额（不写 `is_deleted`），撤回后同单同人不可再提交。
- 状态枚举 `REPORT_STATUS = {received, defense, decided, withdrawn}`；裁定 `VERDICTS = ['upheld','rejected']`。
- 一期**零赔付**（10% 赔付本期不做，仅扣信用分/停用，已拍板）。
- 配置读取 `noShowCfg`：服务端一律读实配值，未配置回退默认，并按 schema `min/max` 钳制（防脏配置放大处罚）。

## 9.5 供需发布与匹配域

### 9.5.1 需求发布（`demand-publish`）

- 发布 `publish`：`scene / start_time / duration_h / location / publish_location / content_options / remark / rate_fen / budget_fen / match_mode` 等写入 `demand`；草稿 `save_draft`/`list_drafts`/`delete_draft` 存 `demand_draft`。
- **时间窗冲突**：`status≠cancelled` 的需求参与冲突判定。
- **代发需求**：被代发人联系方式必填；校验手机（11 位 `1[3-9]` 开头）与座机（区号+连字符+7-8 位）；关系从预设列表选，「其他」需 20 字内说明。
- **场景白名单**：从 `admin_config.scene_list` 动态读取；隐藏仅控制前端入口，存量需求仍可见。隐藏过滤**统一在 `home-action.scene_groups` 出口**执行；`scene_list`/`nearby`/`demand-publish` 白名单**不做过滤**。
- **距离校验**：`publish_distance_max_km`（发布位置↔履约地）、`take_distance_max_km`（接单位置↔履约地），球面距离 `haversineKm`（[take_rules.js](file:///c:/zhaoren/cloudfunctions/_shared/take_rules.js#L133-L141)）。
- **时间红线**：`isServiceTimeAllowed`（默认拦 00:00-06:00，`close_min=0` 全天开放），与前端 redline.js 同口径防绕过。

### 9.5.2 接单门槛（`take_rules.js`）

- **时薪区间** `readRateRange`：读 `partner_profile.accept_rate_min_fen/max_fen`，钳制到平台边界 `rate_min_fen/rate_max_fen`；**缺字段=不限，0 是合法下限**（禁 `||` 兜底）。
- **客单价区间** `readTotalRange`：一口价 `fixed` 单，无平台钳制（宁松勿错）。
- **每周接单时段** `slotCovers`/`parseSlot`/`rangeInSlot`：按东八区自然日切片判定（跨午夜需次日槽覆盖）；未配置=不限制。
- **停用拦截** `suspendLeftDays`：仅拦「新行为入口」（发单/接单/接单申请/发布更新），登录与在途订单操作不拦。

### 9.5.3 匹配（`demand-match`）

- 动作：`hall_list`（大厅）、`top5`、`invite`（邀请）、`broadcast`（广播）、`apply`（申请）、`confirm_apply`、`status`。
- 发布成功后：立即推发布者站内通知 + 向符合条件耍伴推抢单通知（全程 fail-closed）。

## 9.6 IM 与通知域

- **会话**（`im-conv`）：`open`/`messages`/`my_convs`/`kefu_open`/`kefu_messages`。`im_conversation.uk_order_id` 唯一 → 客服会话固定 `order_id: ''`，全局一条。
- **消息**（`im-send`）：`send_text`/`send_template`/`send_kefu`；私信频控 `im_rate_window_min`/`im_rate_max_count` 服务端计数拦截；四确认前仅允系统模板。
- **站内通知**（`system_notice`）：`notice_list`/`notice_poll`/`notice_read`；字段含 `to_openid/order_id/type/title/body/action_key/action_payload/read`，可按 `action_key` 跳详情。
- **订阅消息**：**云调用（cloud.openapi）仅在小程序端触发的云函数中经微信自动鉴权成功**；定时器/HTTP 网关/控制台/CLI 触发必报 `-501001`。HTTPS 订阅走 opt-in（`sub_msg_https` 配置后启用，8s 超时）；发送结果写 `demand.sub_msg_send_logs`（含通道标注）。模板仅选 `thing`/`time` 字段。

## 9.7 评价与信用域

### 9.7.1 评价（`evaluation-submit`）

- `get_default_star` / `submit`：写 `evaluation` + 更新 `user_account` 信用 + 写 `credit_score_log` + `order_status_log`。
- 评价 `evaluate`：S5→S8；48h 未评价 → 默认 4 星 `auto_done`（S9→归一 S8）。
- 好评星级阈值 `order_good_review_min_stars` 决定自动勾选口碑标签的分界。

### 9.7.2 信用分（`credit_rules.js`）

星级 → 信用分增量（[credit_rules.js](file:///c:/zhaoren/cloudfunctions/_shared/credit_rules.js#L15-L22)）：5星 `+2` / 4星 `+1` / 3星 `0` / 2星 `-2` / 其余（含1星）`-5`。

- 门槛：`min_credit_take_order` / `min_credit_place_order`（默认 600）；`credit_freeze_line`（默认 400）。
- 信用流水 `credit_score_log` 是裁定聚合核心：`idx_openid_type_created`（滚动窗口内「第 N 次爽约」）。

## 9.8 耍伴入驻与资料审核域

### 9.8.1 入驻（`partner-apply` / `partner-action`）

- 申请写 `partner_profile{openid, nickname, accept_scenes, scene_rates, exam_scores, city, accept_switch, status}`；`review` 审核；`auto_approve_partner`（默认 false）。
- 考试：`get_exam_questions`/`submit_exam`/`exam_subjects`（题库 `exam_bank`）。

### 9.8.2 资料审核（`partner_audit.js`）

逻辑见 [partner_audit.js](file:///c:/zhaoren/cloudfunctions/_shared/partner_audit.js)：

- `items = [{field, pass, reason}]`，`field ∈ {bio, skills, highlights, qualifications, honors}`（白名单）。
- 通过 → 该栏目 `*_pending` 并入 `profile_audited_snapshot` 并清 pending；驳回 → 清 pending 保留 `reason`。
- 全部处理完（无剩余 pending）→ `profile_audit_status='approved'` 解锁；有驳回/未清 → 保持 pending 锁。
- **展示只读 `profile_audited_snapshot`**，未过审内容一律不上线（fail-closed 双缓冲）。
- 资料维护与入驻审核解耦：`update_partner_profile` 门槛 `status !== 'rejected'`（`pending_review` 可维护）；驳回时写 `profile_submit_at: 0` 清除 30min 限频。

## 9.9 安全域（`safety-report`）

- 动作：`report_user`（举报）、`sos` / `silent_sos` / `cancel_silent_sos` / `resolve_sos`、`resolve`、`checkin`（签到报仇）、`status`。
- 写 `safety_report{order_id, reporter_openid, type, status, payload}`，索引 `idx_order_type_status_created` / `idx_order_reporter_type_created`（签到频控）。
- **地图共享双向对称**：`allow_map_share=true` 且定位 15 分钟内有效，对方才能在地图看到你；`report_map_gps` 仅在开启时写坐标，关闭时**自动清除**已上报坐标。
- 巡检告警仅对真实用户 P0/`safety_sos` 事件；豁免 `admin_probe`（无身份机器调用）与 `order-timer` 自身兜底事件。

## 9.10 定时域（`order-timer`）

`exports.main` 无 action 分发，直接执行扫描链（触发器 `0 */5 * * * * *`，每 5 分钟；timeout 60s）。**所有扫描统一分页循环** `scanAll`（单轮硬上限 500 笔），避免单页 `limit` 导致积压 >BATCH 的滞留。

执行顺序（[order-timer/index.js](file:///c:/zhaoren/cloudfunctions/order-timer/index.js)）：

0. dev 到期自动回写 prod；`admin_web_sessions` 过期清理；注错演练（管理员）。
1. **S1 待确认超时** → S6 + 释放 demand。
2. **S0 待支付超时** → S6 + 释放 demand。
3. **S3.5 中断超期** → S4。
3.6 **S2.5 改期确认超时** → 自动拒绝回原状态。
3.7 **S3 加时申请到期** → 自动拒绝。
3.8 **账号停用到期恢复**（`suspend_until` 缺失视为已到期）。
3.5 **里程碑自动确认**（提交超 15min 未确认 → 全部确认）。
4. **S5 完成超 48h 未评价** → 默认 4 星 → S9（归一 S8）。
4.5 **S8 售后窗口届满** → S10 归档（唯一合法生产方）。
4.6 **S4 裁定期届满** → 平台介入工单（P1 `s4_stale_escalate`）。
4.7 **S2 履约催办三段式**（见 §9.2.4）。
5. **error_scan 巡检**：聚合窗口内异常 → 推管理员 `system_notice`；豁免 `DEFAULT_SCAN_EXEMPT = ['admin_probe:no_openid','s4_stale_escalate']`。
6. **audit_log 留存清理**：每日 UTC 19 点（≈北京 03:00）删 90 天前，默认 dry-run（`audit_prune_dry_run`）；删最早连续段不产生断链告警。
7. **站内抢单通知**：`demand.grab_notify_pending` → 范围内耍伴 `system_notice` + 订阅消息（静默降级）。

## 9.11 身份与鉴权域

- **身份解析** `openid.js`：prod 强制真实 `wxCtx.OPENID`；`mock_openid` 全失效，dev 旁路需 `dev_until` 未来时间戳。
- **登录** `user-login`：`login` / `peek_login` / 手机号密码登录注册 / 实名（`submit_realname` / `simulate_realname`）/ 地图共享。
- **后台鉴权**：网关优先级 `X-Admin-Token`（`admin_web_sessions` 12h）> `admin_login` 免 key > `X-Admin-Key` 兜底；`admin_login_fail` 写 P1 事件供巡检。
- **审计哈希链**：`audit.js` 写 `audit_log`（`prev_hash`→`chain_hash`），`audit_verify` 全量校验。

> 跨域约束与红线细节见 [05-redlines.md](file:///c:/zhaoren/docs/dev-manual/05-redlines.md)；资金/状态的并发保护统一为 CAS 乐观锁 + 挂起字段 + 幂等标记位。
