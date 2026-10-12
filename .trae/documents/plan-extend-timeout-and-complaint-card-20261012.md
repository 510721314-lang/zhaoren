# 加时超时自动拒绝 + 投诉详情在订单详情展示 — 实施方案

## Context（为什么做）

两个「已承诺但没落地 / 已存数据但看不到」的缺口：

1. **加时超时自动拒绝**：UI 与状态机都已承诺 —— [order-detail.wxml:200](file:///c:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.wxml#L200) 写着「…超时自动拒绝」、[order-detail.js:491](file:///c:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.js#L491) 弹窗同文案、`_shared/order_state.js:114` TRANSITIONS no.11 的 timeout 列写「对方 2h 未回应→自动拒绝」，但 `cloudfunctions/order-timer/index.js` 里 **grep `extend` 零命中** ⇒ `pending_extend` 到期后永久滞留，双方都收不到任何通知。
   *注：手动 `extend_reject` 的通知链路本身是完整的*（[action_modify_extend.js:287-292](file:///c:/zhaoren/cloudfunctions/order-action/action_modify_extend.js#L287-L292) 写 `system_notice`，[order-detail.js:554-568](file:///c:/zhaoren/miniprogram/pages-v2/order-detail/order-detail.js#L554-L568) 8s 轮询命中后震动+弹窗），本次**不动**。
2. **投诉详情**：`order_main` 上已有 `complaint_reason / complaint_at / complaint_by / complaint_withdrawn_at / dispute_state` 与后台回写的 `admin_note / dispute_handled_at / refund_fen`，但 `order-action` 的 `detail()` 只回传 `can_withdraw_complaint` 与 `frozen`（[action_query.js:133-135](file:///c:/zhaoren/cloudfunctions/order-action/action_query.js#L133-L135)），页面只有一行「争议处理中」+ 时间线一句 ⇒ 用户看不到投诉原因全文、发起方、处理结论。

## 已拍板范围（用户确认）

- A：只补「超时自动拒绝」（含通知），不改手动拒绝。
- B：投诉**只做展示** —— 不改写入链路、不改 `complaint` 集合结构、不做证据图片。

## 改动清单

### A. 加时超时自动拒绝

**1. `cloudfunctions/order-timer/index.js`**
在既有「3.6 S2_5 改期确认超时」段落（`:474-523`）之后新增「3.7 S3 加时申请超时 → 自动拒绝」，结构严格对齐 3.6：

- 扫描：`col('order_main').where({ status: 'S3' }).limit(BATCH)` + `trackBacklog('S3_extend', list)`（复用文件内既有常量与告警位）。
- 过滤：`o.pending_extend` 存在、且 `deadline < now`、且 `!o.frozen`。
  `deadline = pe.expire_at || ((pe.created_at || o.updated_at || 0) + modifyConfirmH * 3600000)`；`modifyConfirmH` 复用 `:377` 已由 `admin_config.modify_config.confirmHours` 派生的值（与 `action_modify_extend.js:216` 同源，**不新增配置键**）。取不到 deadline → 跳过。
- **竞态防护（本方案关键点）**：加时的确认/拒绝**不改 status**（仍 S3），所以仅靠 status 无法区分「刚被对方处理」与「超时」。用 `updated_at` 做乐观锁：

  ```js
  const r = await col('order_main')
    .where({ _id: o._id, status: 'S3', updated_at: o.updated_at })
    .update({ data: { pending_extend: _.remove(), extend_auto_rejected_at: now, updated_at: now } });
  if (!r.stats || r.stats.updated !== 1) { /* 对方刚处理过 → 本轮跳过 */ }
  ```
  先例：`cloudfunctions/admin-action/action_dispute_handle.js:67-70`（同一「条件更新 + `stats.updated` 断言」写法）。
  **不走 `casStatus`/`casTransition`**：`_shared/order_state.js:214` 的 where 硬编码 `{ _id, status }`，无法附加 `updated_at` 条件；而本处是 S3→S3 不改主轴，迁移白名单（no.11）本就不拦它。这样可**完全不改 `_shared`**，避免三副本同步（`scripts/check-shared-sync.js`）与 A/B 基线风险。
- 成功后：`logStatus(o._id, 'S3', 'S3', 'timeout_extend_auto_reject', 'system')` —— `action_timeline.js:36` **已有**该 action 的中文映射「加时超时自动拒绝」，时间线自动正确显示。
- 通知：给**发起人** `pe.by_openid` 写一条 `system_notice`：
  `{ to_openid, order_id, type: 'extend_reject', title: '加时申请已超时自动拒绝', body: '你的加时申请因对方超时未确认，已自动拒绝，服务时长不变', action_key: 'jump_order', action_payload: { order_id } }`
  **`type` 必须是 `extend_reject`** —— 这样订单详情页既有的 `RESPOND_ALERT`（`order-detail.js:554-559`）会自动震动 + 弹窗，**前端零改动**。
- 统计：新增 `out.extend_auto_reject`（对齐 `out.modify_auto_reject`），并在返回体/`counts` 里带上该计数（对齐 `:701-719`）。

### B. 投诉详情展示

**2. `cloudfunctions/order-action/action_query.js`** —— `detail()` 白名单（`:131` 附近）新增 `complaint`：

```
complaint: null | {
  mine,          // complaint_by === openid
  by_role,       // complaint_by === order.user_openid ? 'user' : 'partner'
  reason,        // complaint_reason 全文
  at,            // complaint_at
  status,        // 'withdrawn' | 'resolved' | 'open'
  withdrawn_at,  // complaint_withdrawn_at
  handled_at,    // dispute_handled_at
  result_note,   // admin_note（仅 resolved 时返回，限长 ~200 字）
  refund_fen     // refund_fen（有则返回）
}
```

- 触发条件：`complaint_at || complaint_reason` 任一存在，否则 `null`。
- `status` 派生顺序：`complaint_withdrawn_at > 0` → `'withdrawn'`（撤回也会把 `dispute_state` 置 resolved，必须先判）；否则 `dispute_state === 'resolved'` → `'resolved'`；否则 `'open'`。
- **不外泄** `dispute_handled_by`（管理员 openid，与 `action_timeline.js` 「不外显 openid」口径一致）。

**3. `miniprogram/pages-v2/order-detail/order-detail.js`** —— 在既有 `order` 映射处组装 `order.complaint`（时间用页面已有的 `__fmtNoticeTime`，全程 null 安全）。

**4. `miniprogram/pages-v2/order-detail/order-detail.wxml`** —— 新增「投诉详情」卡，落点放在安全中心卡之后（`:94` 附近），复用同页既有的 `.od__card` / `.od__row` / `.od__label` / `.od__val` 与爽约申诉卡（`:104-117`）的状态标签写法，尽量零新增 WXSS。展示：
- 状态标签：处理中 / 已撤回 / 已处理
- 发起方：我 / 对方 + 发单人 / 耍伴；发起时间
- 投诉原因全文（不截断，与时间线的 100 字截断区分开）
- 平台处理结论（`resolved` 时显示 `result_note`）与处理时间
- 退款金额（`refund_fen > 0` 时，转元显示）
- 同时把 S10.5 区块（`:277-282`）里重复的一行文案收敛为只留「撤回投诉」按钮。

## 验证

1. **门禁**：`node scripts/check-syntax.js`（期望 `SYNTAX ALL OK (167 files)`）→ `node scripts/check-ssot.js` → `npm test`（期望 tests 240 / pass 240）。
2. **加时超时（云端测试面板）**：造一笔 S3 单，手改 `pending_extend = { add_hours: 1, add_amount_fen: 100, by_openid: <发起方 openid>, by_role: 'user', created_at: now-2h, expire_at: now-60s }` → 调 `order-timer`，入参 `{"action":"run"}` → 断言：
   - `counts.extend_auto_reject === 1`
   - `order_main.pending_extend` 已消失、`extend_auto_rejected_at` 已写
   - `order_status_log` 新增 action `timeout_extend_auto_reject`
   - `system_notice` 给发起人一条 `type='extend_reject'`
   反向用例：`expire_at` 未到期 → 0；无 `pending_extend` → 0；故意把 `updated_at` 改成不匹配（模拟「刚被对方同意」）→ 0 且不改库。
3. **前端（模拟器）**：用发起人身份停在该单详情页 ≤8s，应震动 + 弹窗「❌ 对方已拒绝加时」；消息 tab 出现系统通知。
4. **投诉卡**：分别造 ①`S10.5` 处理中 ②手改 `complaint_withdrawn_at` 已撤回 ③调 `admin-action dispute_handle`（`decision=complete` 与 `decision=refund`）看「已处理 + 结论 + 退款金额」；发起方与对方两个身份都确认可见。
5. **部署**：`order-action`、`order-timer` 串行部署（DevTools CLI 桌面路径，`--remote-npm-install`），部署后等 90-120s；小程序端改动随下次上传生效。

## 风险清单

1. **扫描批量**：`where({status:'S3'}).limit(BATCH=50)` 在 S3 单量超限时可能漏扫（既有 3.5/3.6 段同样有此限制），靠 `trackBacklog` 告警。升级方案：改用嵌套条件 `'pending_extend.expire_at': _.lte(now)`（需补复合索引；且本地 mock SDK 只做顶层字段匹配，会破坏入口测试，故本期不采用）。
2. **口径不一致（需知悉，本期不改）**：状态机 no.11 注释写「2h 未回应→自动拒绝」，实际 `expire_at` 由 `admin_config.modify_config.confirmHours`（缺省 24h）决定，UI 文案也按它展示。本期**以存储的 `expire_at` 为准**（与用户当下看到的一致）。
3. `admin_note` 可能含内部措辞，双方可见属产品取舍 → 本期仅 `resolved` 时返回并限长。
4. 小程序端必须对 `complaint` 缺失做 null 兜底；云端与前端需同批上线，避免旧前端读到新字段异常。
5. `order-timer` 整段是「读一批 + 并行更新」，必须沿用 `Promise.allSettled` 且控制批量，避免免费版 3s 硬超时（见项目 `wx-cloud-deploy` skill 实测结论）。
6. 未响应一方本次**不通知**（与手动拒绝「只通知发起人」保持一致）；如产品需要知会，另发 `type:'custom'` 仅进横幅不弹窗。

## 不在本次范围

- 投诉证据图片采集与展示、`complaint` 集合状态回写（后台 `dispute_handle` 仍只写 `order_main`）。
- 手动 `extend_reject` 行为与文案。
