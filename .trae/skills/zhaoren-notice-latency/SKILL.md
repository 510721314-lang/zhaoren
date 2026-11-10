---
name: zhaoren-notice-latency
description: 通知/提示时效排查与修复（提示滞后、第二次同类事件不提示、消息中心看不到最新）。Use when 用户反馈"系统提示信息滞后/看不到对方动态/同类型第二次不提示/消息中心没更新"，或需要为轮询周期、通知去重键、notice_poll 契约立项。Do not use for 单条文案错字或纯 UI 美化。
---

# 通知/提示时效排查与修复（zhaoren 专用）

## 触发信号

- 「系统提示信息普遍滞后」「对方操作后我要很久才知道」
- 「第二次改期/第二次变更没有提示」（同类型事件只提示一次）
- 「消息中心角标涨了但列表里看不到最新一条」
- 「进了页面也不刷新，要退出重进」
- 需要决定「轮询周期要不要调」「要不要上 db.watch / 订阅消息」

## 第一原则

**先分层定位，再按成本顺序修。** 提示滞后从来不是单点问题，通常同时叠加三层：
服务端事件产生粒度 → 客户端拉取时机/周期 → 去重键与通知存储语义。
**只调周期（60s→30s）是最常见但收益最低的做法**，且直接吃云函数配额。

## 第一条必查：去重键是否含事件时间

`writeNotice`（`cloudfunctions/order-action/index.js`）对同
`(to_openid, order_id, type, read=false)` **复用同一 `_id` 覆盖合并并刷新 `created_at`**。

⇒ 前端若只按 `n.id` 去重，**第二次同类型事件内容变了但 id 没变**，会被判「已展示」，永久不提示。

正确键：`n.id + '|' + (n.created_at || 0)`，且必须**内存 Map 与 Storage `once:` 两处同步**：

| 位置 | 标记 |
|---|---|
| `miniprogram/utils/order-poll.js` | `page.__shownTipIds` + `once:notice_tip:<oid>` |
| `miniprogram/pages-v2/chat/chat.js` | `once:chat_notice:<oid>` |

只改一处 = 另一半链路仍旧漏提示。

## 七条独立链路（逐页核对，勿漏）

| # | 页面 | 周期 | 停止条件 | 去重 |
|---|---|---|---|---|
| 1 | 订单详情 `utils/order-poll.js` | 15s `notice_poll` | onHide/onUnload | 内存 + Storage |
| 2 | 聊天页 `pages-v2/chat/chat.js` | 15s tick，订单/通知 60s（`__pollTick % 4 === 1`） | onHide | Storage |
| 3 | 消息中心 `pages-v2/pkg-low/notices/notices.js` | 15s + onShow | onHide | 首条 `_id\|created_at` 签名 |
| 4 | 首页角标 `pages-v2/index` | 仅 onShow（30s 节流） | — | 无 |
| 5 | 我的 `pages-v2/profile` | 仅 onShow（30s 防抖） | — | Storage |
| 6 | 消息 tab `pages-v2/message` | 仅 onShow（`onLoad` 已拉首屏，首次 onShow 有意跳过防双拉） | — | 无 |
| 7 | 服务端 `order-timer` | **每 30 分钟**扫一次 | — | 无合并 |

第 6 条是**易误判点**：`__skipNextShow` 不是 bug，是防双拉，勿"修"。

## 根因分类与定位

1. **无触发点**：只在 onShow 拉、无轮询（首页/我的/消息 tab）。
2. **周期过长**：聊天 60s；`order-timer` 30 分钟（超时取消/自动拒绝最长延迟 30 分钟）。
3. **onHide 全停**：回页不立即拉，要等首个 tick 15s。
4. **幂等误吞**：见第一节（最高频、最像"系统坏了"）。
5. **覆盖合并**：同 `type` 跨语义撞车（如「四确认项被改」与「发起改期」同为 `modify`）。
6. **仅快照无游标**：`notice_poll` 只给 `read:false` 的 20 条，无 `server_now`/`since`。
7. **分页后不刷新**：消息中心已翻页时只同步未读，新通知永不入列。

## 修复优先级（按成本/收益）

| 层 | 内容 | 成本 |
|---|---|---|
| **L0 零成本** | 去重键含 `created_at`；聊天页回前台立即 `pollOrderChat()`（首次 onShow 用标记跳过防双拉）；消息中心首条变化即重置回第一页 | 纯前端、不增调用量 |
| **L1 配额敏感** | 聊天订单/通知 60s→30s（300→360 次/时）；`order-timer` 30min→5min（288 次/日→约 6,900 次/日） | 必须单独立项 + 先核余量 |
| **L2 契约根治** | `notice_poll`/`notice_list` 加 `server_now` + `since_ts`；`writeNotice` 加 `event_seq`（同 `_id` 累加） | 前后端同批，纯新增字段 |
| **L3 实时通道** | `db.collection().watch()` 或补订阅消息模板 | 需评估基础库/连接数/后台即断 |

**纪律**：L0 与 L1 禁止混批；L1 不得夹带在 bug 修复提交里。

## 假方案黑名单（出现即驳回）

- 调大 `setTimeout` 或给轮询加延时掩盖时序
- 纯客户端时钟校准（无 `server_now` 时改了也是错的）
- 把 15s 一律改 5s（聊天 300→900 次/时，配额与耗电双爆）
- 加大 `limit`、把 `wx:if` 改 `hidden`、只改文案写"稍后刷新"
- 以为「进页刷新」已经够了（部分页面首次 onShow 有意跳过）
- 把 `_id` 覆盖合并当"bug"直接改成追加式而不评估通知表膨胀与 10+ 处直插点

## 验证清单（改完必跑）

1. 同一订单连发两次同类事件 → 对端两次都提示。
2. 切后台 10s 再回聊天页 → 立即见新提示（不等 15s）。
3. 首次进聊天页 Network 只有 1 次 `chat_poll`（无修复会变 2 次）。
4. 消息中心翻到第 2 页后对方触发新通知 → 回到第一页且含新条目、无重复。
5. 反复进出 3 次 → 同一事件只弹一次。
6. `npm run verify:offline` EXIT=0。

## 台账落点

- 规则：`.trae/documents/project-rules-full-20261029.md` §34（U1/U2/U3）
- 功能：`docs/FUNCTION-REGISTRY.md`（提示类须写满「首进/重进/状态已推进」三场景）
- 变更：`docs/CHANGELOG.md`（真机通过后追加回归结论）
