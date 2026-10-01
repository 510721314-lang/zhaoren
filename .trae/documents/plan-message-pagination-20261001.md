# 消息页分页加载（每页 15 条 + 「更多」按钮）

## Context（背景）

用户需求：消息 tab 页的会话列表「每次加载 15 条，设置更多按钮」。

**现状**：
- 前端 [message.js](file:///c:/zhaoren/miniprogram/pages-v2/message/message.js)：`fetchData()` 一次全量调 `im-conv my_convs` 后 `buildList` 全量显示，无分页、无加载更多。
- 后端 [im-conv/index.js](file:///c:/zhaoren/cloudfunctions/im-conv/index.js#L238-L288)：`my_convs` 固定 `orderBy('last_msg_at','desc').limit(50)`，不支持 limit/skip 参数，返回 `{ ok, data: { list } }` 无 hasMore。

**目标**：消息列表每次加载 15 条，列表底部显示「更多」按钮，点击追加下一页；无更多/不足一页时隐藏按钮。分页数可后台配置（延续项目 SSOT 惯例）。

## 改动点

### 1. 后端 `cloudfunctions/im-conv/index.js`（my_convs 分页化）
- 支持 `event.limit`（默认 15，上限 5-50 防御）、`event.skip`（默认 0，非负整数）。
- 查询改为：`orderBy('last_msg_at','desc').skip(skip).limit(limit)`。
- 返回增加 `hasMore` 判断：`skip + list 长度 < 总数` 为 true（一次查询排序同键下 skip 语义稳定，会话数据量小可接受；不额外 count 查询）。
- 常量边界：`PAGE_SIZE_FALLBACK = 15`，`limit` 校验 `1 <= limit <= 50`，非法取 15。

### 2. 前端 `miniprogram/pages-v2/message/message.js`
- data 增加：`pageSize: 15`、`pageNo: 0`、`hasMore: false`、`loadingMore: false`。
- `fetchData(reset)` 重构：
  - `reset=true`（首屏/下拉刷新/onShow 刷新）：`pageNo=0`，请求 `{ action:'my_convs', limit, skip:0 }`，替换 `orderList`。
  - `reset=false`（点「更多」）：`skip = orderList.length`，请求后**追加**到 `orderList`。
- `buildList(list)` 保留（装饰逻辑不变），追加模式合并 `this.data.orderList` 后重新 setData。
- 新增 `onLoadMore()`：`if (loadingMore || !hasMore) return;` → 置 loadingMore → `fetchData(false)`。
- 请求入参 `limit: this.data.pageSize`。
- 注意并发保护：首屏 loading 与 loadingMore 互斥。

### 3. 前端 `miniprogram/pages-v2/message/message.wxml`
- 在 `msg__list` 尾部（block 之后）加「更多」按钮：
```xml
<view class="msg__more" wx:if="{{hasMore && orderList.length > 0}}" bindtap="onLoadMore">
  {{loadingMore ? '加载中…' : '更多'}}
</view>
```
- 样式：`msg__more`（message.wxss 新增，居中文字，浅色底，padding 24rpx）。

### 4. 后台配置化（可选，用户未明确要求——先不做，保持常量 15）
- 备注：如后续需要后台可配，走 CONFIG_SCHEMA `g:'消息'` 加 `msg_page_size` 字段，本次不扩（避免超范围）。

## 部署
- 需重部署 `im-conv` 云函数。
- 前端 message.js/wxml 改动需重新上传体验版。

## 验证
1. `node --check cloudfunctions/im-conv/index.js` + `node --check message.js`。
2. 网关直调 `im-conv` 需真机身份（callFunction 无法外部直调）——通过小程序真机验证：会话 >15 条时首屏 15 条 + 更多按钮，点击追加；<15 条隐藏按钮。
3. 若本地会话不足 15 条，可用 `init-db` seed 或已有多订单会话验证（现有 5 条 demand、多订单）。
4. 回归：`_shared/*.test.js` 单测（im-conv 不在其中，不受影响）。