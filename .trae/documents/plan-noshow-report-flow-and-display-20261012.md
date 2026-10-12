# 爽约上报：业务流程设计 + 详情页按钮场景 + 落实「付款后信息全量展示」

## Context（为什么做）

三件事凑在一起做：

1. **爽约上报的业务流程需要一份明确规格**。链路其实**已经实现**（`no_show_report` 集合 + `no_show_*` 9 个后台配置 + 上报/举证/撤回/裁定四个 action + 前端上报页与详情页按钮），但设计口径在 2026-10-10 被改过一次（去掉「开始时间未到不可报」），导致**代码、页面文案、设计文档三处不一致**。
2. **按钮显示场景需要定义清楚**：现按钮条件散落在 `order-detail.js` 的 `canNoShowReport`（S2/S3.5 + 48h 窗口 + 本人配额），缺少「时间下界」这一条，且没有完整矩阵说明。
3. **落实「付款后订单任何相关信息均在订单详情显示」**（该约定的规范出处：`docs/订单详情-投诉爽约入口-业务逻辑与流程.md` §9「所有订单相关事件在详情展示」+ §7 原则「付款后（S2）即有入口，关单后只读回看」；代码落地注释见 `cloudfunctions/order-action/action_timeline.js:1-8`）。盘点后发现资金（`fund`）、退款（非投诉路径的 S7）、争议正交位、费用明细、爽约证据图片都还没展示 —— 这条约定目前是**部分满足**。

**用户已拍板**：①按钮改为「约定开始时间过后才出现」；②展示补齐「爽约 + 资金与争议」；③后端三处实现不符一并修。

---

## 一、业务流程规格（本次定稿）

### 1.1 角色与前置

| 项 | 规则 |
|---|---|
| 谁可上报 | 订单参与方**任一方**（发单人 / 耍伴），**完全对称**，谁先发起谁置 `frozen` |
| 可报状态 | **S2**（已支付未开始）、**S3.5**（履约中断）。服务中出问题先走「履约中断」→ S3.5 再上报；S4/S5 之后走投诉（S10.5） |
| 时间窗 | **`start_time ≤ now ≤ start_time + no_show_report_window_h(48h)`** ← 本次新增下界 |
| 配额 | 同一订单同一人 ≤ `no_show_max_per_order(1)`；双方合计最多 2 条；**撤回占配额不释放** |
| 必填 | `reason_type` 四选一（未出现/迟到超30分钟/中途离开/其他）+ `reason` ≥ `no_show_reason_min_len(10)` 字 + 内容安全；证据图片选填 ≤ `no_show_evidence_max(3)` |

### 1.2 主流程（received → defense → decided，旁路 withdrawn）

1. **上报**（`no_show_report_submit`）：校验参与方 → 状态/时间窗/配额 → 理由与内容安全 → **原子抢占冻结位**（写 `frozen:true` + `dispute_state:'open'` + `dispute_type:'no_show'` + `dispute_opened_at`）→ 写 `no_show_report`（`status=received`，`evidence_deadline = now + defenseWindowH`）→ 通知被诉方（`no_show_report`）→ 审计。冻结期间订单**禁止 start / complete / evaluate 等推进**（`order-timer` 多处已按 `frozen` 跳过）。
2. **举证**（`no_show_report_defense`）：仅被诉方本人；`decided` 后拒；CAS `received|defense → defense`；超 `evidence_deadline` 提交仍接受但标 `defense_overdue`（**N2：逾期不自动关闭**）；通知申诉方（`no_show_defense`）。
3. **裁定**（`admin-action no_show_decide`，R2/R3）：CAS → `decided`，写 `verdict ∈ {upheld,rejected}` + `decided_reason` + **`dispute_state:'resolved'` + `dispute_handled_at`**。`upheld` → 同单同被诉方去重后按 `target_role` 扣信用分 `no_show_score_deduct(20)`（写 `credit_score_log type='no_show'`），滚动窗口 `no_show_count_window_days(180)` 内累计达 `no_show_suspend_threshold(3)` → 停用 `no_show_suspend_days(7)`（写 `status='suspended'` + `suspend_until` + 关接单开关）；`rejected` 仅记录。**一期零资金赔付**（不做退款救济；未来口径见 `order_state.js` no.21 赔付 10%）。通知双方（`no_show_decided`）、停用通知被诉方（`account_suspended`）。
4. **撤回**（`no_show_report_withdraw`）：仅申诉人、`decided` 前；CAS → `withdrawn`；**仅当不存在其他在途争议时**解冻 + 写 `dispute_state:'resolved'`；通知被诉方。
5. **超时策略**：举证逾期/裁定积压**都不自动关闭**（N2/N9），仅靠运营手动裁定；`evidence_deadline` 仅用于展示与逾期标记。

### 1.3 与现有实现的差异（本次要改的 4 点）

| # | 差异 | 处置 |
|---|---|---|
| D1 | `canSubmitReport` 缺时间下界（付款后即可报），与「爽约」语义及页面文案矛盾 | 加下界门 `no_show_not_started` |
| D2 | 提交/裁定只写 `frozen`，从不写 `dispute_state/dispute_type/dispute_opened_at/dispute_handled_at` | 按 1.2 补齐正交位 |
| D3 | `submit` 缺 `isFrozen` 前置校验（投诉有，见 `action_dispute.js:20`） | 加 `isFrozen` → `oa_order_frozen` |
| D4 | 防重仅靠 `count` 预检（非原子），并发可双写；冻结点在写单之后且无条件 | 改「原子抢占冻结位 → 写单 → 失败补偿」 |

---

## 二、「报告爽约」按钮显示场景矩阵

现状：按钮在 [order-detail.wxml:182](file:///c:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.wxml#L182)（S2 区）与 `:241`（S3.5 区），条件 `canNoShowReport`，计算在 [order-detail.js:259-264](file:///c:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.js#L259-L264)。

| # | 订单状态 | 角色 | 时间 | 本人已报 | frozen | 按钮 |
|---|---|---|---|---|---|---|
| 1 | S2 / S3.5 | 任一方 | `now < start_time` | 0 | false | **隐藏**（改为显示占位提示「约定开始时间后可报告爽约」） |
| 2 | S2 / S3.5 | 任一方 | `start ≤ now ≤ start+48h` | 0 | false | **显示**「⚠️ 报告爽约」 |
| 3 | S2 / S3.5 | 任一方 | `now > start+48h` | 0 | false | 隐藏（超时；上报页仍会以 `no_show_window_closed` 兜底） |
| 4 | S2 / S3.5 | 任一方 | 窗内 | ≥1 | 任意 | 隐藏（配额已用；撤回后也不恢复） |
| 5 | S2 / S3.5 | 任一方 | 窗内 | 0 | **true** | 隐藏（已有在途争议/申诉；后端 `oa_order_frozen` 兜底） |
| 6 | S3（服务中） | 任一方 | — | — | — | 隐藏（先走「履约中断」到 S3.5）；引导横幅提示该路径 |
| 7 | S0/S1/S4/S5/S8/S9/S10.5 等 | — | — | — | — | 隐藏（S4/S5 之后走「发起投诉」） |

配套：
- [order-detail.js:262](file:///c:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.js#L262) 的 `inWindow` 补下界：`start > 0 && now >= start && now <= start + reportWindowH*3600000`。
- `computeNextStep`（`order-detail.js:17-119`）在 S2/S3.5 且可报时，引导横幅补一句「对方未按约出现可报告爽约」。
- 上报页文案 [no-show-report.wxml:4](file:///c:/zhaoren/miniprogram/pages-v2/pkg-low/no-show-report/no-show-report.wxml#L4) 改为「约定开始时间已过、仍未获得服务且未超时限时可提交」，与按钮时机、后端口径三处对齐。

---

## 三、改动清单

### 3.1 后端规则（三副本，改后必须同步）

**`cloudfunctions/_shared/no_show_rules.js`**（规范源）
- `canSubmitReport`(:42) 在时限判断前插入下界：`if (now < start) return { ok:false, code:'no_show_not_started', msg:'约定开始时间未到,暂不可提交爽约申诉' }`。
- 同步改文件头注释（:8、:39-41）里「付款后即可发起申诉」的旧口径描述。
- 跑 `sync-no-show-rules.ps1` 同步到 `order-action/no_show_rules.js`、`admin-action/no_show_rules.js`，并 `node scripts/check-shared-sync.js` 校验 SHA。
- 同步改单测 `_shared/no_show_rules.test.js`（原「开始时间未到也放行」的断言反转，补 `now === start` 恰好放行的边界用例）。

**`cloudfunctions/order-action/action_dispute.js` — `no_show_report_submit`(:133)**
- 前置加 `isFrozen(order)` 门 → `oa_order_frozen`（对齐本文件 `:20` 投诉的写法）。
- 防重改**原子抢占冻结位**：先 `col('order_main').where({ _id: order_id, frozen: _.neq(true) }).update({ data: { frozen: true, dispute_state: 'open', dispute_type: 'no_show', dispute_opened_at: now, updated_at: now } })`，断言 `stats.updated === 1` 才继续（先例：`admin-action/action_dispute_handle.js:67-70` 的「条件更新 + `stats.updated` 断言」，补偿先例同文件 `:82-84`）；原 `count` 预检降级为友好提示，不再作为唯一闸门。
- 写 `no_show_report` 失败时**补偿解冻**（`frozen:false` + 清 `dispute_state/dispute_type`），避免订单被永久冻结。
- 顺带把原来「写单后无条件 `frozen:true`」的更新(:182-184) 删掉（已被前置原子抢占取代）。
- `no_show_report_withdraw`(:252) 解冻时：**先确认该单没有其他在途 report**，再写 `frozen:false` + `dispute_state:'resolved'` + `dispute_handled_at`。

**`cloudfunctions/admin-action/action_noshow_decide.js`**
- 裁定 CAS(:19-24) 的 patch 追加 `dispute_state:'resolved'` + `dispute_handled_at: now`。
- 解冻(:97-101) 同样加「无其他在途争议」条件；其余（扣分/停用/通知/`credit_score_log`）不动。

### 3.2 详情页展示补齐（`order-action/action_query.js` + 前端）

**`action_query.js` 的 `detail()`** 新增（**一律不外传 openid**，`dispute_handled_by` / `refund_by` 不返回）：
- `fund: { paid_fen, refunded_fen, settle_state, settled_at }`
- `refund: { fen, no, source, at }` —— 让**非投诉路径的 S7 退款**也可见（现在只有投诉卡里藏着一个 `refund_fen`）
- `dispute: { state, type, opened_at }`
- `fees: { total_fen, fee_fen, partner_income_fen, aa_tier }`

**`miniprogram/pages-v2/order-detail/order-detail.js`**
- `refreshOrder` 映射上述四组（时间沿用页面已有的 `fmtTs`/`__fmtNoticeTime`，全部 null 安全）。
- `fetchNoShow` 的 list 映射补 `evidence_file_ids` / `defense_file_ids` / `defense_at` / `decided_at` / `withdrawn_at`，供卡片展示。

**`miniprogram/pages-v2/order-detail/order-detail.wxml`**
- **爽约申诉卡**（`:120-132`）改造：渲染双方证据图片（缩略图 + `wx.previewImage` 预览）、补「举证时间 / 裁定时间 / 撤回时间」、按状态显示待办提示（未举证 / 已举证待裁定 / 已裁定 / 已撤回）。
- 新增**资金明细卡**：实付金额、已退金额、结算状态（`settle_state`）、结算时间；无 `fund` 时不渲染。
- 新增**退款行**：`order.refund.fen > 0` 时显示金额、来源、时间。
- 新增**争议状态行**：`order.dispute.state === 'open'` 时显示「争议处理中（投诉/爽约申诉）」+ 开启时间。
- 图片渲染结论（已核实）：**云存储 fileID 直接 `<image src="{{fileID}}">` 即可，无需 `wx.cloud.getTempFileURL`** —— 项目内零引用该 API，既有先例 `partner-detail.wxml:88`、`blog.wxml:88`、`no-show-report.wxml:39`。

### 3.3 数据与运维

- **零迁移**：`fund` / `refund` / `dispute` 老订单缺失时全部按缺省不渲染；判定**不单依赖** `dispute_state`（老数据没有该字段）。
- 不改 `init-db` 种子、不新增 action、不新增配置键。
- 顺手更新我的项目记忆里那条已过期的「付款后即可申诉」口径记录。

---

## 四、验证

1. **门禁**：`node --test cloudfunctions/_shared/no_show_rules.test.js` → `node scripts/check-shared-sync.js`（三副本 SHA）→ `node scripts/check-syntax.js` → `node scripts/check-ssot.js` → `npm test`（期望 240 pass）。
2. **云端测试面板**（`admin_config.env=dev` 才放行 `mock_openid`）：
   - `order-action / no_show_report_submit`：`start_time = now+1h` → 期望 `no_show_not_started`；`start_time = now-1h` → 成功且 `order_main` 出现 `frozen:true / dispute_state:'open' / dispute_type:'no_show'`；同一人再报 → `no_show_report_limit`。
   - `order-action / no_show_report_defense`、`no_show_report_withdraw`（验证解冻与 `dispute_state` 回落）。
   - `admin-action / no_show_decide`（`upheld` / `rejected` 各一次）→ 断言 `dispute_state:'resolved'`、信用分变化、`no_show_decided` 通知。
3. **模拟器走查**：S2 单在「开始时间前 / 窗内 / 超窗 / 已报 / 已冻结」五种情形下按钮与占位提示；S3.5 单；上报页文案；爽约卡证据图片可点开预览；资金明细卡与退款行（用一笔 S7 退款单验证）。
4. **部署**：`order-action`、`admin-action` 串行部署（DevTools CLI，`--remote-npm-install`），等 90-120s；小程序端随下次上传生效。

---

## 五、风险清单

1. **三副本同步**：`no_show_rules.js` 改动漏同步会让 `check-shared-sync.js` 直接失败；忘了改 `no_show_rules.test.js` 会让 `npm test` 变红。
2. **老数据兼容**：已有 `no_show_report` 无 `dispute_*`；已有 `order_main` 无 `fund`。前端必须全程 null 兜底，`order-timer` 的 `frozen` 跳过逻辑不受影响。
3. **解冻竞态**：双方各可报 1 条，撤回/裁定解冻前必须确认「无其他在途争议」，否则会把仍在争议中的单放开推进。
4. **原子抢占的副作用**：先冻结后写单，写单失败必须补偿解冻，否则订单永久卡死（已有 `dispute_handle` 补偿先例可照抄）。
5. **图片权限**：证据 fileID 需「所有用户可读」，否则对方预览 403；现流程上传于同一云环境，预期可读，走查时需实际点开验证。
6. **口径变更的连带**：D1 会让「付款后立刻上报」这条路走不通，若线上已有用户在用需提前告知；`project_memory` 里的旧口径记录一并更正。

## 不在本次范围

- 爽约的资金赔付/退款救济（`order_state.js` no.21 的「赔付订单额 10%」，提审后 P2 批）。
- 停用到期自动恢复链路核查、里程碑证据图片、保险卡接通、各时间戳渲染。
