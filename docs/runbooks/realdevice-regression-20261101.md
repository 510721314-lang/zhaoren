# 真机验证积压清单 · 测试指引（10 项）

- 生成日期：2026-11-01
- 适用基线：远端 HEAD `5e56ee8`（批 1 `pay_transaction.uk_pay_no`、批 2 `no_show_guide` 到点提醒 + 窗口下界、批 3 评价低分客服入口均已入库）
- 云函数现状：`evaluation-submit` / `order-timer` / `admin-action` 已部署并 SHA 回读 MATCH（详见 `docs/deploy-log.md` L287-290）
- 回填位置：判定通过后回填 `docs/FUNCTION-REGISTRY.md` 对应条目（#123/#124/#125）并把状态改「已验证 + 日期」

## 0. 通用准备（每轮开工先做，缺一步判定作废）

| 步骤 | 操作 | 判定 |
|---|---|---|
| 0.1 | 上传/确认体验版：批 3 需**新体验版**（v1.6.70 不含）；批 1/批 2 只需云函数已部署 | IDE 版本号与 `docs/deploy-log.md` 末行一致 |
| 0.2 | `npm run verify:offline` | EXIT=0（基线 tests 712 / A/B 457 / LEDGER 47） |
| 0.3 | tcb 通道自检：`node scripts/tcb-exec.js .tmp-tcb/cmd-cfg-get-grace.json` | 返回 `no_show_grace_min = 30`；若报「无有效身份信息」→ 先 `tcb login --flow device --json` 授权（本机平时不授权） |
| 0.4 | 记录本轮 3 个 openid：用户号、耍伴号、管理员号（管理员须在 `admin_config.admin_openids` 内） | 管理员号能通过 `order-timer` 鉴权门（否则回 `ot_forbidden`） |

> 造数与判定统一走 `node scripts/tcb-exec.js <命令.json>`：把下表 JSON 存到 `.tmp-tcb/xxx.json` 再执行（Git 忽略目录，不入库）。**`_id` 一律用 `$in`（规则 §24）**。

**命令模板**

查订单（A 组 / B 组共用）：
```json
[{"TableName":"order_main","CommandType":"COMMAND","Command":"{\"find\":\"order_main\",\"filter\":{\"_id\":{\"$in\":[\"<ORDER_ID>\"]}},\"projection\":{\"_id\":1,\"order_no\":1,\"status\":1,\"start_time\":1,\"no_show_guide_at\":1,\"frozen\":1,\"demand_id\":1,\"user_openid\":1,\"partner_openid\":1},\"limit\":1}"}]
```

查站内信（A 组）：
```json
[{"TableName":"system_notice","CommandType":"COMMAND","Command":"{\"find\":\"system_notice\",\"filter\":{\"order_id\":{\"$in\":[\"<ORDER_ID>\"]},\"type\":\"no_show_guide\"},\"limit\":10}"}]
```

查支付流水（B 组）：
```json
[{"TableName":"pay_transaction","CommandType":"COMMAND","Command":"{\"find\":\"pay_transaction\",\"filter\":{\"order_id\":{\"$in\":[\"<ORDER_ID>\"]}},\"limit\":20}"}]
```

查需求释放（C4）：
```json
[{"TableName":"demand","CommandType":"COMMAND","Command":"{\"find\":\"demand\",\"filter\":{\"_id\":{\"$in\":[\"<DEMAND_ID>\"]}},\"projection\":{\"_id\":1,\"status\":1,\"matched_openid\":1},\"limit\":1}"}]
```

改字段（造数用，只改单个订单单个字段）：
```json
[{"TableName":"order_main","CommandType":"COMMAND","Command":"{\"update\":\"order_main\",\"updates\":[{\"q\":{\"_id\":{\"$in\":[\"<ORDER_ID>\"]}},\"u\":{\"$set\":{\"<FIELD>\":<VALUE_MS>}}}],\"ordered\":true}"}]
```

跑定时巡检（无 CLI 通道，走控制台）：
1. 微信开发者工具 → 云开发控制台 → 云函数 → `order-timer` → **云端测试**；
2. 「用户 openid」填管理员号（0.4）；
3. 参数填 `{"action":"run"}` → 运行；
4. 看返回 `data.counts.*` 与 `data.thresholds.*`。

---

## 0.5 四个入口怎么走（每项都用到，先熟悉）

**入口 1｜小程序找订单 / 触发业务**
- 订单详情：首页或「消息」里的订单卡片 → 订单详情（`/pages-v2/order-detail/order-detail?orderId=<id>`）；
- 支付：订单详情 S0 → 「去支付」→ 支付页（`nav-bar` 标题「支付确认」）→ 按钮 **「微信支付 ¥<金额>」**；
- 评价：订单详情 S5、且身份为用户 → 按钮 **「去评价」**；耍伴侧显示「⏳ 等待用户评价」；
- 消息中心：底部 tab **「消息」** → 页内固定入口「系统消息」（`onSystemTap`）→ 通知列表页；
- 客服：批 3 入口进入，或直接 URL `/pages-v2/pkg-low/kefu/kefu`。

**入口 2｜云端测试面板（跑 `order-timer`）**
IDE 左侧「云开发」→ 云函数 → 选中 `order-timer` → 「云端测试」页签 → 「用户 openid」填管理员号 → 参数 `{"action":"run"}` → 「运行」→ 读返回 JSON。
> 判定看 `data.counts`、`data.no_show_guide`（单号数组）、`data.thresholds`。返回 `ot_forbidden` = openid 不在 `admin_openids`。

**入口 3｜tcb（查/改数据）**
`node scripts/tcb-exec.js <命令.json>`；报「无有效身份信息」→ 先 `tcb login --flow device --json` 走设备码授权（详见本轮会话记录）。

**入口 4｜后台 admin-web**
- 地址用**静态托管域**：`https://cloud1-d9gkefwcp5c777088-1482004365.tcloudbaseapp.com/`（网关域走 CDN 会看到旧构建）；
- 菜单**「运营配置」**（`views/Operations.vue`）→ 分组「爽约处罚」；
- 参数变更留痕页：菜单「参数变更日志」（`ConfigLog.vue`）。

---

## A 组 · 批 2：到点未履约提醒（`no_show_guide`，4 项）

### A1 触发与收件人（`FUNCTION-REGISTRY` #124）

**前置**：一条真实链路产出的 S2 订单（真机下单 → 耍伴接单 → 用户支付完成），或种子订单（`zz-seed-orders` 只造未来时段单，**不会**触发本项）。

**步骤**
1. 查该单：`status` 应为 `S2`，`start_time` 为未来时间，`no_show_guide_at` 不存在；
2. 用「改字段」模板把 `start_time` 改为 `Date.now() - 60 分钟`（毫秒）；
3. 云端测试跑 `order-timer {"action":"run"}`。

**判定（四条全中才算通过）**
- 返回 `data.counts.no_show_guide = 1`，`data.no_show_guide` 含该单 `order_no`；
- `system_notice` 该单 `type='no_show_guide'` **恰好 2 条**，`to_openid` 分别为 `user_openid` 与 `partner_openid`；
- 站内信 `title='已过约定开始时间'`、`action_key='jump_order'`、`body` 含「可在申诉时限内提交爽约申诉」；
- 订单**未被改动状态之外的东西**：`status` 仍 `S2`、`frozen` 未变、`no_show_guide_at` 已写入。

**真机观感**：用户号与耍伴号各自进「消息」页，各自看到 1 条中性文案（不指名谁爽约）。

### A2 幂等（二次运行不重复）

**步骤**：A1 通过后，**不改数据**再跑一次 `{"action":"run"}`。

**判定**：`data.counts.no_show_guide = 0`；`system_notice` 该单仍为 2 条（不新增）；`no_show_guide_at` 值不变（说明被条件更新挡住，而非被覆盖）。

### A3 通知页点击跳订单详情

**步骤**：真机进「消息」页，点 A1 产生的那条。

**判定**：进入订单详情页且 `orderId` = 该单 `_id`（`notices.js:138` `jump_order` → `order-detail`）；返回后该条变已读（`read=true`，可用查站内信模板复核）。

### A4 后台可配「到点提醒延迟」

**步骤**
1. admin-web 登录 → 参数/系统配置页（`Operations.vue` 按 `CONFIG_SCHEMA` 动态渲染）→ 分组**「爽约处罚」**；
2. 找到「到点提醒延迟(约定开始后)」：单位 分钟，当前值 `30`，区间 5–180；
3. 改为 `45` → 保存 → 回读 `admin_config.no_show_grace_min = 45`，并确认 `config_history` 有留痕；
4. 改回 `30`。

**判定**：字段可见、可改、留痕；改值后下一次 `order-timer` 返回 `data.thresholds.no_show_grace_min` 跟随变化（说明配置真正生效，非写死）。

---

## B 组 · 批 1：支付流水单号唯一（2 项）

### B1 评价奖励流水带 `pay_no`（`FUNCTION-REGISTRY` #123）

**步骤**：真机完成一单履约 → 进评价页 → 选星级（建议 5 星，奖励必发）→ 提交成功。

**判定**
- 查支付流水：出现 1 条 `type='eval_reward'`，`pay_no` 形如 `REW` + 13 位毫秒 + 16 位 hex（长度 32+，全局唯一前缀 REW）；
- 后台财务/流水页能看到该条；
- 若未出现：先查该单是否已评价/是否奖励条件不满足（`grantOne` 失败被 try/catch 静默，需看云函数日志）。

### B2 连点支付仍只 1 条流水

**步骤**：真机进支付页 → 快速连点「确认支付」2–3 次（间隔 <0.5s）。

**判定**
- 查支付流水：`type='pay'` **仅 1 条**（`pay_no` 前缀 `PAY`），无重复；
- 订单状态只推进一次（`S0 → S2`），`order_status_log` 无重复 S0→S2 记录；
- 后续点击给出状态已变更提示（不产生第二笔）。

**补测（同批）**：退款走 `REF` 前缀、打赏走 `TIP` 前缀，各只 1 条。

---

## C 组 · 阶段 B 遗留 4 项

### C1 ISS-004 并发抢单（同一需求两人同时接）

**前置**：1 条 `broadcast` 抢单需求；两个**已过门禁**（实名 + 入驻通过 + 场景考试通过 + 信用分 ≥ 600）的耍伴账号，各一台手机（**推荐真机，不要用控制台 mock**：`create_from_take` 有资质/距离/精度多重门禁，mock 容易撞门禁误判）。

**步骤**：两人在 3 秒内同时点「接单」→ 各看结果。

**判定**
- 只有 1 人成功建单：`order_main` 中同 `demand_id` **仅 1 条**（未软删）；
- `demand.matched_openid` 仅为成功者；`demand.status='matched'`；
- 落败方得到明确失败提示（「无法接单 + 服务端 msg」），不出现「两人都建单」；
- 可选证据：失败侧审计日志出现抢锁失败记录（`take_lock_busy`），订单状态日志仅 1 条创建记录。

### C2 ISS-005 接单定位精度

**步骤（正例 + 反例各一次）**
1. **反例（室内/电梯/地下车库）**：点「接单」→ 客户端 `getLocationSafe` 8s 未拿到可信定位 → 应 toast **「定位失败,请到开阔处重试」**（`take-order.js:270`），**不建单**；
2. **反例（精度超限）**：若拿到定位但 `accuracy > 50m` 或缺失 → 服务端拒绝，弹「无法接单 / **定位精度不足,请到开阔处重试**」（`order-create/action_take.js:207`），**不建单**；
3. **正例（室外开阔）**：`accuracy ≤ 50m` → 正常建单进 `S1`。

**判定**
- 两个反例均**不产生** `order_main` 新记录（查需求或按 openid 查单确认）；
- 正例建单成功且 `partner_location.accuracy` 有值；
- 全程无 `showLoading` 卡死遮罩（8s 必收敛）。

### C3 ISS-006 入驻必须人工审核（prod 禁自动通过）

**步骤**
1. 新微信号（未入驻）→ 「我的」→ 申请成为耍伴 → 完成实名 + 资料 + 场景选择 → 提交；
2. 观察提交后状态与提示；
3. admin-web → 耍伴审核 → 查看待审列表。

**判定**
- `partner_profile.status = 'pending_review'`（不是 `approved`）——prod 强制口径见 `partner-apply/index.js:187`（`auto_approve_partner === true && !isProd`）；
- `admin_config.auto_approve_partner = false`（回读确认，防运营误开）；
- 后台待审列表出现该账号；审核通过后账号方可接单，审核动作在 `audit_log` 留痕；
- 反向检查：后台即使把开关改成 true，prod 下重新提交**仍应** `pending_review`。

### C4 ISS-010 需求释放（两条路径各一次）

**共用前置**：1 条需求（发布 → 耍伴接单成功，`demand.status='matched'`、`matched_openid` 有值）。

**路径①（S1 待确认超时 15 分钟）**
1. 接单后不做四确认，让订单停在 `S1`；
2. 用「改字段」把该单 `created_at` 改为 `now - 20 分钟`（判定基于 `created_at`，见 `action_timeout.js:8`）；
3. 跑 `order-timer {"action":"run"}`。

判定：`data.counts.s1_cancel = 1`；订单 `status='S6'`；`demand.status='matching'`、`matched_openid=null`；**另一账号在广场能看到该需求并可接单**。

**路径②（S0 支付超时 30 分钟）**
1. 另一条需求接单后在支付页**不支付**，停在 `S0`；
2. 用「改字段」把 `pay_expire_at` 改为 `now - 1 分钟`；
3. 跑 `{"action":"run"}`。

判定：`data.counts.s0_close = 1`；订单 `S6`；`demand` 同样回 `matching` + `matched_openid=null`（Wave2 止血项，`action_timeout.js:49-54`）。

**注意**：`matched` 状态的释放带 `status:'matched'` 条件更新，若需求已被别的流程改成其他状态则不会释放——属预期，不在本项缺陷范围。

---

## D 组 · 批 3：评价低分「联系客服复核」入口（5 步，需体验版 **v1.6.71**）

**公共前置（D1-D6 共用，只做一次）**
1. 手机确认版本为 **1.6.71**：微信「最近使用的小程序」→ 右上「···」→「关于/版本」，或 mp 后台「版本管理 → 体验版」重新扫码；
2. 准备一条**已到评价环节**的订单：由用户身份进入订单详情，`S5`（服务已完成）时按钮为 **「去评价」**；
3. 若手上没有 S5 单：用真实链路走到完成（下单 → 接单 → 支付 → 履约 → 完毕确认），或用 `zz-seed-orders` 造数后再改 `status`（属造数，需 tcb 授权）。

### D1 选 1 星 → 出现入口
- **操作**：订单详情点「去评价」→ 评价页 → 点第 **1** 颗星；
- **预期**：星级卡下方出现一行「对本次服务不满意？」+ 可点文字「联系客服复核」（`evaluate.wxml` `wx:if="{{stars > 0 && stars <= 2}}"`）；
- **同时确认**：星级提示文案仍显示「差评」，文字输入框/标签/提交按钮均可正常操作（新块不遮挡）。

### D2 选 2 星 → 入口仍在
- **操作**：改点第 **2** 颗星；
- **预期**：提示行仍存在（边界值 ≤2 含 2）。

### D3 非低分 → 不出现
- **操作**：依次点第 3 颗星、第 4 颗星、第 5 颗星，并回退到未选星（重进页面）；
- **预期**：3 星（「中评」）该行**消失**；4/5 星（「好评」）不出现；未选星（「请选择」）不出现。

### D4 跳客服
- **操作**：回到 1 星状态 → 点「联系客服复核」；
- **预期**：进入客服会话页（`/pages-v2/pkg-low/kefu/kefu`），可发送消息；后台 `admin-web` 客服工作台能看到该会话；
- **反向**：不应出现「客服打开失败」toast（该 toast 只在 `navigateTo` 失败时出现）。

### D5 提交不回归（关键，确认新块未阻断写链路）
- **操作**：保持 1 星（可填一句文字）→ 直接点「提交评价」；
- **预期**：与批 3 前完全一致——成功 toast（批 3 前实测为「评价成功！1元优惠券已到账」）→ 自动回订单详情；订单进入已评价状态；恭喜你拿到的优惠券/奖励链路不受影响；
- **DB 复核**（可选）：`evaluation` 集合该单新增 1 条、`star=1`；若满足奖励条件，`pay_transaction` 增 1 条 `type='eval_reward'`（顺带覆盖 B1）。

### D6 兜底（可选，低网/异常时）
- **操作**：断网或快速连点入口；
- **预期**：出现 toast「客服打开失败」，页面不白屏、不卡死。

---

## E 组 · 版本与基础可用性（1 分钟）

| 操作 | 预期 |
|---|---|
| 手机确认版本 `1.6.71` | 与 `docs/deploy-log.md` 末行一致（782,944 B / 764.6 KB） |
| 冷启动进首页 | 正常渲染，无白屏；「广场」有需求列表 |
| 「消息」「我的」两个 tab | 正常进入，无报错弹窗 |
| 开发者工具 Console | 无 `navigateTo:fail` / 未定义方法报错 |

---

## 判定记录模板（回填用）

| 编号 | 项目 | 结论（通过/未通过/阻塞） | 实测值 | 证据（截图/返回码/DB 字段） | 日期 | 验证人 |
|---|---|---|---|---|---|---|
| A1 | no_show_guide 触发 | | counts.no_show_guide= | | | |
| A2 | 幂等 | | 第二次 counts=0 | | | |
| A3 | 通知跳详情 | | 落地页 orderId= | | | |
| A4 | 后台配置项 | | 回读值 | | | |
| B1 | eval_reward pay_no | | pay_no 前缀 | | | |
| B2 | 连点支付 | | pay 流水条数 | | | |
| C1 | 并发抢单 | | order_main 条数 | | | |
| C2 | 定位精度 | | 拒绝码 / msg | | | |
| C3 | 入驻人工审核 | | partner_profile.status | | | |
| C4 | 需求释放 | | demand.status / matched_openid | | | |
| D1 | 1 星出现入口 | | 截图 | | | |
| D2 | 2 星仍出现 | | 截图 | | | |
| D3 | 3–5 星不出现 | | 截图 | | | |
| D4 | 跳客服可用 | | 会话页截图 | | | |
| D5 | 提交不回归 | | toast 文案 + 订单状态 | | | |
| D6 | 兜底 toast | | 截图 | | | |
| E | 版本/首页/三 tab | | 版本号 + 截图 | | | |

**已知注意点（避免误判为缺陷）**
1. `no_show_guide` 只覆盖「`start_time` 落在 `now-30min` 与 `now-48h`（申诉窗口）之间」的 S2 单；超出 48h 的历史单**故意不发**（批 2 上线后修补，commit `608be89`，实测 due=22 → 0）。
2. 提醒一生仅 1 次（幂等位 `no_show_guide_at`），不随定时器重复。
3. `grantOne` 奖励发放失败被 `try/catch` 静默，B1 未出现流水时先看 `evaluation-submit` 云函数日志再判定。
4. 云端测试的「用户 openid」必须是 `admin_openids` 成员，否则 `order-timer` 直接 `ot_forbidden`。
