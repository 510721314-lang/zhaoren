# 3B 爽约申诉 · 新增「允许撤销申诉」实现方案

## Context（为什么做）

「3B 爽约申诉」链路（提交申诉 → 被诉方举证 → 平台裁定）已于 2026-10-08 上线并通过验收。设计文档 [design-20261007-pricing-noshow-flows.md](file:///C:/zhaoren/docs/design-20261007-pricing-noshow-flows.md) 明确 `撤回：一期不做（N8=A）`——即「撤销申诉」是**被有意排除的一期项**，不是漏做。

现用户要求把「允许撤销申诉」纳入一期（N8 由 A 变更为「做」），且要求在提审前落地。目标是：申诉人可在裁定前撤回自己的申诉，避免无效裁决与对方无谓举证；同时保持既有链路与配额口径不变。

## 决策默认值（未答项按此默认，批准时可逐条改）

| # | 项 | 默认取值 | 理由 |
|---|---|---|---|
| D1 | 撤销窗口 | **裁定前均可撤**（status ∈ {received, defense}）；decided 后锁定 | 给申诉人纠错机会；decided 有处罚后果不可撤 |
| D2 | 配额 | **占用配额、不释放**（撤销后同单同人不可再提，N6 上限照常生效） | 零改动（计数查询只排除 `is_deleted`，withdrawn 自然占位）；防反复申诉骚扰 |
| D3 | 通知 | 向被诉方发通知，**不需填写撤回理由**，仅前端二次确认 | 减少改动面；msgSecCheck 不适用（无用户文本） |
| D4 | 通知 type | **复用 `no_show_report`**，覆盖正文为「对方已撤回爽约申诉，无需举证」 | `writeNotice` 去重键含 type，复用即天然单条、不新增枚举与通知中心 label 映射（若改用独立 type `no_show_withdrawn`，必须额外把旧未读通知置已读，否则被诉方看到两条未读） |
| D5 | 落地节奏 | **提审前做** | 用户明确要求 |

## 改动清单

### 1. 后端 · order-action（[index.js](file:///C:/zhaoren/cloudfunctions/order-action/index.js)）

新增 action **`no_show_report_withdraw`**（不叫 `cancel`：`cancel` 在本仓已被订单生命周期占用，L626-683 含梯度退款，复用会语义撞车）。插在 `defense` 之后（L1870 后）：

- **不进 `ORDER_ID_ACTIONS`**（L240）：按 `report_id` 定位，同 defense；`order_id` 仅透传通知/审计
- 校验序：① `report_id` + `isValidDocId` → `no_show_bad_report` ② 读 doc（try/catch）→ `!report || is_deleted` → `no_show_report_missing` ③ `report.reporter_openid !== openid` → `no_show_not_reporter` ④ 幂等前置：已 `withdrawn` → `{ok:true,idempotent:true}` ⑤ 已 `decided` → `no_show_already_decided` ⑥ 无配置读取 / 无时间窗 / 不调 checkText
- **CAS**（仿 L1843-1855）：`where({_id, status: _.in(['received','defense'])}).update({status:'withdrawn', withdrawn_at, withdrawn_by, updated_at})`；`updated<1` 时回查判 decided / withdrawn(幂等 ok) / 否则 `no_show_withdraw_conflict`
- 写库仅上述 4 字段；**严禁写 `is_deleted`**（否则释放配额、破坏 D2）；reason/evidence 原值保留
- 通知：`writeNotice({to_openid: report.target_openid, order_id, type:'no_show_report', ...正文改为已撤回})`，整段 try-catch 吞（fail-closed）
- 审计：`writeAudit({category:'business', action:'no_show_report_withdraw', target_type:'no_show_report', target_id: report_id, detail:{order_no, prev_status}})`（参照 L1812）
- 返回 `{ok:true, data:{status:'withdrawn', withdrawn_at}}`
- **`no_show_report_detail`（L1872-1903）加字段**：`can_withdraw`（= 我是申诉人 且 status ∈ {received, defense}）、`withdrawn_at`、`status_text` 补「已撤回」；与 `can_defense` 按身份天然互斥

### 2. 共享规则（规范源 + 同步）

- [_shared/no_show_rules.js](file:///C:/zhaoren/cloudfunctions/_shared/no_show_rules.js)：`REPORT_STATUS`（L77）加 `WITHDRAWN:'withdrawn'`；新增纯函数 `canWithdrawReport(status, isReporter)` 并导出（门禁只跑 `_shared` 测试，内联逻辑测不到）
- 改完必须跑 `cloudfunctions/_shared/sync-no-show-rules.ps1` 同步 order-action/、admin-action/ 两副本（脚本内含 SHA256 断言）
- [no_show_rules.test.js](file:///C:/zhaoren/cloudfunctions/_shared/no_show_rules.test.js) L117 深比对锁定值需纳入 `WITHDRAWN`
- 正向副作用：`no_show_decide` 的 CAS（admin-action L2895）三值不含 withdrawn → 已撤回记录天然不可裁定

### 3. 小程序 · order-detail（[.wxml](file:///C:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.wxml) / [.js](file:///C:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.js)）

- wxml L114 举证按钮后加 `<button wx:if="{{item.can_withdraw}}" ... bindtap="onNoShowWithdraw">撤回申诉</button>`，复用 `od__btn od__btn--ghost` + `hover-class="btn-press"`，颜色走 CSS 变量（勿硬编码，深色模式陷阱）
- wxml L110 状态类补 `is-withdrawn`（灰）；**L113 举证截止行条件补 `&& item.status !== 'withdrawn'`**（否则已撤回仍显示"举证截止"）
- js L245-253 状态映射补 `withdrawn → 已撤回`（三元嵌套建议改 switch）
- 新增 handler `onNoShowWithdraw`：仿 `onNoShowDefense`（L272-279）+ `onCancel` 二次确认（L1187-1218）；`showModal` 文案 `title:'撤回申诉'`、`content:'撤回后不可恢复，该订单不可再次申诉'`、**`confirmText:'确认撤回'`（≤4 字）**、`confirmColor:'#fa5151'`；成功 toast + `reload()`
- no-show-report 页无需改动（撤销不跳页）

### 4. 管理端 · admin-action + NoShow.vue

- [admin-action/index.js](file:///C:/zhaoren/cloudfunctions/admin-action/index.js) `no_show_report_list`：status 白名单（L2850）加 `'withdrawn'`；counts 加 `cntP('withdrawn')` 并随响应返回（L2873）；列表映射补 `withdrawn_at`
- [NoShow.vue](file:///C:/zhaoren/admin-web-frontend/src/views/NoShow.vue)：筛选按钮（L8-13）加「已撤回」；`statusLabel`（L140）/`statusType`（L145）各加一支；counts 初值（L131/L159/L160 totalAll）同步；**裁定按钮（L57）与裁定区（L96）条件收紧为 `status!=='decided' && status!=='withdrawn'`**（后端 CAS 兜底为冲突）

### 5. 单测

自包含、无顺序依赖（沿用文件既有 `NOW` 常量风格）：
- 改 L117 深比对纳入 `WITHDRAWN`
- 新增「撤销资格：仅申诉人 × received/defense 可撤，decided/withdrawn 一律 false」矩阵用例（走 `canWithdrawReport`）

## 执行顺序

1. 改 `_shared/no_show_rules.js` → 跑 `sync-no-show-rules.ps1` → 改 `no_show_rules.test.js`
2. 改 order-action（action + detail 字段）
3. 改 admin-action + NoShow.vue
4. 改小程序 order-detail（wxml/js；如需样式则 wxss）
5. `powershell -ExecutionPolicy Bypass -File scripts/gate.ps1` 全绿（需 `$env:AWK_KEY`）
6. bundle 归档 `C:\zhaoren-bak` + 记 CHECKSUMS → commit `type(scope): description`
7. 部署：**串行逐个** `cli.bat cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <单个名> --project C:\zhaoren --remote-npm-install`，顺序 order-action → admin-action → admin-web；每次等 success，部署后 90-120s 再验证
8. 管理端：先 `$env:PATH="C:\Program Files\nodejs;"+$env:PATH` → `admin-web-frontend` `npm run build` → 清空重拷 `dist/*` 到 `cloudfunctions/admin-web/public/` → 再部署 admin-web
9. 小程序：重传体验版 `cli.bat upload --project C:\zhaoren -v v1.6.1 -d "<描述>"`
10. `docs/deploy-log.md` 追加部署行；`zz-registry`/基线文档无需改

## 验证

**自动化**：gate 8 步全绿（含 shared-sync SHA 比对、npm test、index-ledger、smoke）。

**端到端（走查③全链路，含新增撤销）**：云端测试需 `admin_config.global.env='dev'` 才认 `mock_openid`（openid.js 在 prod 强制真实 OPENID）——**演练完立即切回 prod**（dev 有 4h 自动回 prod 兜底）。
1. 真实账号对 S2/S3.5 单 `no_show_report_submit` → status=received
2. 被诉方（mock）`no_show_report_defense` → status=defense
3. 申诉人（mock）`no_show_report_withdraw` → status=withdrawn、`withdrawn_at` 落库
4. 重放同一请求 → 返回 `idempotent:true`（幂等）
5. 管理员对该条 `no_show_decide` → 返回冲突（不可裁定）
6. 管理端列表/筛选/徽标显示「已撤回」；小程序卡片显示「已撤回」且无举证/撤回按钮
7. 被诉方系统通知仅一条（内容为已撤回，无重复未读）

## 风险与坑

1. **通知双条**（最大坑）：去重键含 type，若改用独立 type 而不折叠旧未读，被诉方会看到两条未读 → 默认复用 type 规避
2. **counts/tab 漏数**：后端不返回 withdrawn 维度，前端 totalAll 与「全部」对不上
3. **后端白名单静默忽略**：不改 status 白名单时筛选 withdrawn 会返回全部，易误判为前端 bug
4. **误写 `is_deleted`** 会释放配额（破坏 D2）
5. **detail 举证截止行**未排除 withdrawn → 语义错
6. **证据可见性**：本次保留（被诉方在已撤回记录中仍可见理由/证据）；若需隐藏属额外口径，另议
7. **备份缺口**：`.predeploy/backup.ps1` 的 `$COLLECTIONS` 未含 `no_show_report`（既有缺口）→ 写操作前用 `.predeploy/manual-backup.ps1` 手工补该集合
8. **索引无需新增**：init-db INDEXES 已含 `order_id` / `status+created_at` / `target_openid+created_at`，withdrawn 走 status 前缀
9. JSON 文件须 UTF-8 无 BOM；PS5.1 含中文 .ps1 须 UTF-8 BOM

## 不在范围

- 撤销理由填写（D3 默认不需要）
- 被诉方撤回举证 / 撤销后重新申诉（D2 默认不允许）
- 管理端复核通道（N8 的「复核」部分仍不做）
- `.predeploy/backup.ps1` 集合白名单补全（既有缺口，另行处理）
