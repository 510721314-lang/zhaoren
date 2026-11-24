---
name: mp-reason-input-fullchain
description: 为找人帮忙小程序任意业务动作补齐原因/理由/备注输入框全链路——前端 editable 采集→后端独立字段点路径落库→detail 投影回传→时间线展示→单测断言不覆盖。Use when 用户要求给某操作加原因输入、理由填写、备注说明，或反馈原因没展示/被覆盖/丢了。Do not use for 纯文案修改或已有字段的展示样式调整。
---

# 原因输入框全链路贯通（zhaoren 项目专用）

把「给某个业务动作加一个原因/理由/备注输入框」这件事标准化为一条**端到端数据链**，避免只改一端导致断链（后端收了前端没传 / 落库了投影没回传 / 回传了时间线不展示）。

首个实证锚点：W3 取消链路（发起 `reason` / 拒绝 `reject_reason` / 撤回 `withdraw_reason`），2026-11-24 落地，体验版 v1.6.26/v1.6.27。

## 触发场景

- 用户说「给 XX 操作加个原因输入框 / 理由填写 / 备注」
- 用户反馈「我填的原因对方看不到 / 原因丢了 / 被覆盖了」
- 新增需要用户填写文本说明的业务动作（取消、投诉、改期、申诉、举报等）

## 核心铁律（先记牢再动手）

1. **每个业务概念独立字段，固定写入者，禁止复用覆盖**（经验 100034919）。发起原因、拒绝原因、撤回原因必须是三个不同字段，不能都塞进 `reason`。否则后写覆盖先写，双方看到的内容错位。
2. **点路径写入，禁止整对象覆盖**。用 `'cancel_request.withdraw_reason': value`，不要 `cancel_request: {...}` 整体替换——会清掉同对象下其他字段。
3. **统一截断上限**：文本类原因 ≤50 字（`REASON_MAX`），后端落库和前端采集都要截，防止超长。
4. **reason 选填**：用户不填时 `''` 兜底（`String(x || '').trim().slice(0, 50)`），不得因空值报错。
5. **复用原生能力，零新建组件**：`wx.showModal` 原生支持 `editable:true` + `placeholderText`，输入在 `res.content`。项目 `page._modal(opts)` → `utils/order-modal.js` 是对 `wx.showModal` 的薄包装，opts 原样透传。不要为了一个输入框新建自定义组件。

## 标准 6 步流程（顺序执行，每步都要实证）

### 第 1 步：调研现状，列「已做 / 未做」表

动手前先 grep，搞清楚哪几环已经通了，避免重复改或漏改。四个环节都要查：

```
# 1. 后端 handler 是否收 event.reason？是否已落库？
Grep "event.reason" path=cloudfunctions/order-action/action_xxx.js
Grep "cancel_request\." path=cloudfunctions/order-action/action_xxx.js   # 看点路径写了哪些字段

# 2. detail 投影是否回传该字段？
Grep "reason" path=cloudfunctions/order-action/action_query.js

# 3. 时间线是否展示该字段？
Grep "reason|detail" path=cloudfunctions/order-action/action_timeline.js

# 4. 前端调用方是否传 reason？弹窗是否加了 editable？
Grep "cancel_request|onNewCancel" path=miniprogram/utils/order-submit.js
```

列一张表（以取消链路为例）：

| 动作 | 后端收 reason | 落库字段 | 前端传 reason | 投影回传 | 时间线展示 |
|---|---|---|---|---|---|
| 发起 | ✅ 已收 | `reason` | ❌ 漏传 | ✅ | ✅ |
| 撤回 | ❌ 没收 | ❌ 无 | ❌ 漏传 | ❌ | ❌ detail 写死空串 |

**只改标 ❌ 的格子**，标 ✅ 的不动（最小改动）。

### 第 2 步：后端落库（独立字段 + 点路径）

在对应 handler 里收 reason 并点路径写入独立字段：

```js
// 常量（若文件已有 REASON_MAX 直接复用，否则与 money/credit 规则同档取 50）
const REASON_MAX = 50;

// handler 内：收参 + 截断 + 兜底
const reason = String((event && event.reason) || '').trim().slice(0, REASON_MAX);

// update 时点路径写入（关键：不整对象覆盖）
await col('order_main').where({ ... }).update({ data: {
  'cancel_request.status': 'withdrawn',
  'cancel_request.withdraw_reason': reason,   // 独立字段
  // 不要写 cancel_request: { status, withdraw_reason } —— 会清掉 reason/reject_reason
}});

// 审计 detail 补 reason（截断到 20 字，审计日志别存全文）
await writeAudit(db, log, { ..., detail: { ..., reason: reason.slice(0, 20) }, ... });
```

参照锚点：[action_cancel.js](../cloudfunctions/order-action/action_cancel.js) 的 `cancel_withdraw`（收 reason 落 `withdraw_reason`）与 `cancel_request`（L70，原已收 reason 落 `reason`）。

### 第 3 步：detail 投影回传

`action_query.js` 的 detail 投影对象里补该字段，否则前端拿不到：

```js
cancel_request: order.cancel_request ? {
  status: ...,
  reason: String(order.cancel_request.reason || '').slice(0, 50),
  reject_reason: String(order.cancel_request.reject_reason || '').slice(0, 50),
  withdraw_reason: String(order.cancel_request.withdraw_reason || '').slice(0, 50)  // 新增
} : null,
```

参照锚点：[action_query.js](../cloudfunctions/order-action/action_query.js) detail 投影的 `cancel_request` 块。

### 第 4 步：时间线展示

`action_timeline.js` 里对应事件的 `detail` 改读该字段，原因才会出现在「订单动态」：

```js
events.push({
  at: ..., type: 'cancel', label: '...', actor_role: ...,
  detail: String(cr.withdraw_reason || '').slice(0, 100)  // 原先是 ''
});
```

前端时间线渲染已统一读 `e.detail`（order-detail.js 把 `event.detail` 喂给 timeline-card 组件），**前端展示代码不用改**——原因经此路径自动展示。

参照锚点：[action_timeline.js](../cloudfunctions/order-action/action_timeline.js) 取消事件链。

### 第 5 步：前端采集（editable 输入框）

找到调用该 action 的前端函数（通常在 `utils/order-submit.js` 或页面 js），给弹窗加 `editable` 并采集：

```js
page._modal({
  title: '申请取消',
  content: '...可在下方填写取消原因（选填，最多50字）',
  editable: true,
  placeholderText: '请填写取消原因（选填，最多50字）',
  success: (res) => {
    if (!res.confirm) return;
    const reason = String(res.content || '').slice(0, 50);   // 采集 + 截断
    wx.showLoading({ title: '提交中', mask: true });
    return callCloud('order-action', { action: 'cancel_request', order_id: ..., reason })  // 别忘了传
      .then(...);
  }
});
```

参照锚点：[order-submit.js](../miniprogram/utils/order-submit.js) 的 `onNewCancelRespond`（拒绝，波2 范式）、`onNewCancelRequest` / `onNewCancelWithdraw`。

### 第 6 步：单测（断言落库 + 截断 + 不覆盖）

在对应的 `_shared/*.test.js` 补 1 例，**必须断言「不覆盖」**——检查 `w.data` 里没有被覆盖字段的键，而不是检查值（点路径写入根本不会写那个键）：

```js
test('cancel_withdraw: 撤回原因落独立字段 withdraw_reason, 不覆盖发起原因 reason + 截断 50 字', async () => {
  const sdk = makeSdk({ openid: USER, store: store({ order: { cancel_request: { status: 'pending', by: 'user', by_openid: USER, reason: '发起时填的原因' } } }), docUpdateWritesBack: true });
  const r = await loadOrderAction(sdk).main({ action: 'cancel_withdraw', order_id: OID, mock_openid: USER, reason: 'a'.repeat(60) }, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const w = (sdk.writes.order_main || [])[0];
  assert.equal(w.data['cancel_request.withdraw_reason'], 'a'.repeat(50), '截断到上限');
  assert.equal(w.data['cancel_request.reason'], undefined, '点路径写入不得覆盖发起原因');
  assert.equal(w.data['cancel_request.status'], 'withdrawn');
});
```

补完单测**必须登记 manifest**，否则 `verify:offline` 报 `TEST-UNREGISTERED`：

```powershell
node scripts/check-test-manifest.js --update
```

确认 diff 只 +1 用例（无意外删除），再复跑 verify。

参照锚点：[order_action_cancel.test.js](../cloudfunctions/_shared/order_action_cancel.test.js) 新增的 withdraw_reason 用例。

## 验证门禁（每一步都不能跳）

1. `npm run verify:offline` 必须 **EXIT=0**：含单测通过、A/B 等价、test-manifest 登记、doc-links 可达。失败即停。
2. 改了云函数 → DevTools CLI 部署 + `tcb fn code download` 回读 **SHA 逐文件 MATCH** + grep 标记串实证（如 `withdraw_reason` 出现在云端 action_cancel.js）。仅凭「部署 success」不算数。
3. 改了前端 → 上传体验版（新版本号），真机才生效。
4. push 后按 §44 用 `git ls-remote origin master`（带与 push 相同的代理覆盖）直连核对远端 SHA == HEAD，不能仅凭 exit code。

## 常见陷阱（踩过的坑）

| 陷阱 | 后果 | 对策 |
|---|---|---|
| 复用已有 `reason` 字段承载新语义 | 后写覆盖先写，双方看到错位内容 | 新语义开新独立字段，哪怕名字长 |
| 整对象 `cancel_request: {...}` 覆盖 | 清掉同对象其他字段（reason/reject_reason 丢失） | 永远点路径 `'cancel_request.xxx'` |
| 后端收了 reason 但前端没传（或反之） | 数据断链，原因恒空 | 第 1 步调研表四列都要查，改完再核对一遍 |
| 投影补了但时间线没改（或反之） | 前端某处看不到原因 | 投影和时间线是两个独立出口，都要补 |
| 单测只断言值正确，没断言不覆盖 | 覆盖 bug 漏网 | 断言 `w.data['被覆盖字段'] === undefined` |
| 补了单测忘了 `--update` manifest | verify 报 TEST-UNREGISTERED 失败 | 补单测后必跑 `check-test-manifest.js --update` |
| 为输入框新建自定义组件 | 过度工程，增加回归面 | 复用 `wx.showModal` 原生 `editable` |

## 与项目规则的关系

- 本技能是「原因输入框」这一垂直场景的执行细则，服从 `.trae/rules/project-rules-core.md`（最小改动 §1、先说后做 §3、改完必交回归清单 §6）。
- 字段独立设计依据经验 100034919（同一字段复用语义不同 → 覆盖与展示错位）。
- 部署 / SHA 回读 / push 判据分别服从 `wx-cloud-deploy`、`tcb-readback-verify`、`zhaoren-frequent-flows`（流程4 §44）技能，本技能不重复其命令细节。
