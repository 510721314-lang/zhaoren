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

## 第一步：三段取证（2026-11-22 双案实证，禁跳步）

用户报「对方没收到提示」时，先按顺序回读三张表，再谈修复：

| 顺序 | 集合 | 看什么 | 结论方向 |
|---|---|---|---|
| 1 | `im_message`（`order_id`） | 消息是否存在 | 有 → 排除发送失败/内容安全拦截 |
| 2 | `im_conversation`（`order_id`） | `user_unread`/`partner_unread`、`last_msg_at` | +1 → 排除未读计数问题 |
| 3 | `system_notice`（`order_id`） | 是否生成、`read`、`read_at` 与 `created_at` 间隔 | 无 → 查 `writeNotice` 调用点；`read=true` 且 `read_at` 仅差数十秒 → 对方已点过（前端无自动标读）；有通知但用户说没提示 → 转查提示渠道醒目度 |

第 4 步才看配额/日志：`tcb logs search` 按 `status_code` 过滤（202 是中间态要排除）。
**`tcb fn log` 显示「无调用日志」不可作为未调用证据**（2026-11-22 实测：DB 已有当日写入，日志仍为空）。

## 第二条必查：`writeNotice` 是多副本，改一处必须全同步

当前 4 份独立实现：`order-action/index.js`、`im-send/index.js`、`partner-action/index.js`、`admin-action/action_im_kefu.js`（内联同构）。
2026-10-30 只在 order-action 修了「覆盖合并顺延 `created_at`」，另两份未同步 → 消息通知链上该修复失效近一个月（§45 R2）。
**任何去重键/覆盖字段/action_key 变更，必须 `grep -n "function writeNotice" cloudfunctions` 逐份核对并同批部署。**

正确覆盖写法（三处必须一致）：
```js
await col('system_notice').doc(exist.data[0]._id).update({
  data: Object.assign({}, data, { created_at: data.updated_at })
});
```

## 第三条：真人提示层（震动/提示音）

数据与通知都正常、用户仍说「没感觉」时，是提示渠道不够醒目（订单详情页 `im_text` 通知默认只进横幅、不弹 toast）。
统一入口 `miniprogram/utils/alert-feedback.js` 的 `notify(kind)`：`urgent`（改期/沟通待处理）/ `order`（一般动态）/ `nearby`（附近新单）。
口径：包内本地 wav + 单例 `InnerAudioContext`（`obeyMuteSwitch=true`）、同类 2s 节流、开关落 Storage `settings:alert`、新文件 `catch` 不得为空（`[NEW-SILENT-CATCH]` 门禁）。
边界：切后台/锁屏定时器停止，本机制不触达（仅订阅消息可穿透）；模拟器无震动/音效；前端改动必须重传体验版。

## 第四条：强制弹窗显隐真值必须与消息已读 `read` 解耦（2026-11-25 B+ 实证，经验 1529186）

一次性 / 强制弹窗（如「你被选定了」「待处理」强提醒）的**显隐真值必须用云端独立 ack 字段驱动，严禁复用 `system_notice.read`**。

**反面教材（B 方案漏弹根因）**：弹窗是否显示 = 云端是否存在本人 `read:false` 的 select_confirmed 通知 → 消息通知页「点单条通知」/「全部标记已读」会写 `read=true` → **永久吃掉弹窗机会**，用户只要去看过消息，就再也弹不出来。`read` 的语义是「消息已读」，与「弹窗是否需要强制提示」是两个独立维度，复用必冲突。

**正确模式（B+，真机通过）**：
1. 通知文档新增独立字段 `<事件>_alert_acked`（bool）+ `<事件>_alert_acked_at`（时间）。
2. poll 查 `acked != true`：`where({to_openid: openid, type: '<事件>', select_alert_acked: _.neq(true)})`——**缺失字段也命中**（MongoDB `$ne` 对 undefined 为真；mock SDK `_mock_sdk.js` 同语义），老通知无需 backfill 即可弹。
3. 点弹窗「确定」调独立 action 写 ack：`update({<事件>_alert_acked: true, <事件>_alert_acked_at: now, read: true, read_at: now})`——ack 控制弹窗显隐，**同步**把 read 标已读（让消息页不再显示未读），但 `read` 绝不反向控制弹窗。
4. 鉴权：poll / ack 都带 `to_openid: openid` 守卫，无越权。

**触发点纪律**：不要只挂 `app.onShow`（用户前台停留时被触发的事件不会回调 onShow）；在用户高频进入的页面（广场 / 我的）`onShow` 顶部（任何 early-return 之前）也查一次。仍不做定时轮询，省云函数用量。

**判别口诀**：凡是「强制弹窗 / 一次性提醒」，先问——显隐字段是否会被别的入口（消息已读、清理缓存）误写？会 → 必须拆独立 ack 字段，不能复用 read / 本地缓存。

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
