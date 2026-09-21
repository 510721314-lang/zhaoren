---
name: zhaoren-ops
description: 找人帮忙小程序运维与提审前补丁. Use when the user asks for 云函数部署、openid 映射、身份双角色（user+partner）适配、支付确认页权限、system_notice 通知补全、order_id 支持 ORD 单号、init-db quick_check/lookup、待支付/待履约按钮按 role 过滤、身份粘性存储、控制台云端测试 mock_openid、cloudbase aggregate 链式坑、init-db seed/env 隔离. Do not use for 真实微信支付接入 / SMS SDK / 订阅消息（需资质）.
---

# 找人小程序运维 & 提审前补丁

冻结根 `<workspaceFolder>`. env `cloud1-d9gkefwcp5c777088`. AppID `wxbc4a4afacdf234f5`.

## 核心身份

- A（发单人主测）：`oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`
- B（耍伴测试）：`test_partner_001` → 对应 openid 用 init-db lookup 查
- init-db lookup 脚本：`{"action":"lookup","nicknames":["昵称1","昵称2"]}`

## 可执行脚本

### deploy.ps1 — 部署云函数
```powershell
& "c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat" cloud functions deploy `
  --env cloud1-d9gkefwcp5c777088 --names <fn1,fn2,...> `
  --project c:\Users\DC\Desktop\zhaoren --remote-npm-install
```

### syntax-check.ps1 — 全量语法校验
```powershell
$files = Get-ChildItem -Recurse cloudfunctions -Filter "index.js"
foreach ($f in $files) { node --check $f.FullName }
```

### git-push.ps1 — 带重试 push
```powershell
for ($i=0; $i -lt 5; $i++) {
  git push origin master 2>$null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 5
}
```

## 后端坑位（必记）

| # | 坑 | 根因 | 修 |
|---|---|---|---|
| 1 | CloudBase 不支持 `.where(cond).aggregate()` | SDK 链式调用返回 null | 改 `.aggregate().match(cond)` |
| 2 | openid.js 不进函数 zip | 函数独立打包，_shared 不打包 | 复制进每个函数目录 + `require('./openid')` |
| 3 | admin 后门 prod 下失效 | `config.env===prod` 时强制忽略 mock_openid | 加条件 `!!mock_openid \|\| config.env!=='prod'` |
| 4 | system_notice 通知需对双方都写 | 通知只写发起人一侧 | 支付/退款写双方；评价只写 B；催促只写 partner |
| 5 | ORDER_ID_ACTIONS 需同步加 | 新 action 没进列表会被正则拦截 | 加 action 时同步更新列表 |
| 6 | order_id 格式校验 | 云函数只认 32 位 hex，用户易贴 ORD 单号 | 统一 resolveOrderId：先验 hex，否则查 order_no 反查 |
| 7 | init-db seed 幂等 | 重复跑会覆盖 | seed 加 `env:"dev"` 过滤只补不覆盖 |

## 前端坑位（必记）

| # | 坑 | 根因 | 修 |
|---|---|---|---|
| 1 | identity 被 fetchUser 重置 | fetchUser 没读 storage 缓存 | `wx.getStorageSync('current_identity')` 优先 |
| 2 | "去支付"按钮全显 | S0/S2/S3/S5 操作区没按 role 过滤 | wxml 加 `wx:if="{{role === 'user'}}"` / `wx:if="{{role === 'partner'}}"` |
| 3 | 概览卡片跳错页 | item_type 没区分 order / demand | item_type 路由：order→order-detail，demand→demand-detail |
| 4 | 已终态订单进概览 | 没过滤 S6/S7/S10.5 | 概览只保留活跃状态（S0/S1/S2/S2_5/S3/S3.5/S4/S5） |
| 5 | bottom-sheet 已替换 wx.showModal | 但还有其他弹窗残留 | 全局搜 `showModal` + 4 字符 confirmText 兜底 |

## system_notice 通知覆盖（14 个状态转移点）

| # | 触发 | 写 cloud function | → 谁 |
|---|------|-------------------|------|
| 1 | 抢单 accept | order-create | → A（用户） |
| 2 | 支付成功 S0→S2 | payment-mock | → B |
| 3 | 开始履约 S2→S3 | order-action | → A |
| 4 | 提交里程碑 | order-action | → A |
| 5 | 履约完成 S3→S5 | order-action | → A |
| 6 | 部分确认 S3.5→S4 | order-action | → 对方 |
| 7 | 比例确认 S4→S5 | order-action | → 对方 |
| 8 | 发起改期 | order-action | → 对方 |
| 9 | 确认改期 | order-action | → 发起人 |
| 10 | 拒绝改期 | order-action | → 发起人 |
| 11 | 恢复履约 S3.5→S3 | order-action | → 对方 |
| 12 | 取消订单 | order-action | → 对方 |
| 13 | 退款 | payment-mock | → 双方 |
| 14 | 评价 S5→S8 | evaluation-submit | → B |
| 15 | 催促 nudge_partner | order-action | → B（10min 频控） |
| 16 | 定时器超时改期拒绝 | order-timer | → 双方（还没加） |

## order-id 兼容 ORD 单号

统一 `resolveOrderId`：
```js
async function resolveOrderId(rawId) {
  if (/^[0-9a-f]{32}$/.test(rawId)) return rawId;
  if (/^ORD\d+$/.test(rawId)) {
    const r = await col('order_main').where({ order_no: rawId }).limit(1).get();
    return r.data[0]?._id || null;
  }
  return null;
}
```

## init-db 运维查询

```json
{"action":"lookup","nicknames":["昵称"]}
{"action":"quick_check"}
{"action":"check_pp","openid":"xxx"}
{"action":""}   // 空事件 = 创建集合 + 索引 + seed
```

## 遗留（下一阶段）

1. order-timer 改期 2h 超时自动拒绝需通知双方
2. pause_service（S3→S3.5）中断需通知对方
3. 真实微信支付接入
4. SMS SDK 替换 user-login mock
5. 订阅消息（需微信资质）
6. privacy checkin（app.json __usePrivacyCheck__ + requiredPrivateInfos）
7. console.log 全量清理（prod 用 logger 门控）
8. admin_openids 确认真实 openid 已配置
9. 6 低频函数超时调 8s
10. 法律文档页面（用户协议/隐私政策）

## 真机验证路径

用户机（A）：发单 → 四确认 → 支付 → 改期/取消/评价
耍伴机（B）：抢单 → 开始履约 → 里程碑 → 履约完成 → 被评价
双方身份切换：进"我的"顶部身份卡，storage 粘住
消息中心：进"我的" → 🔔 消息通知；任何状态转移触发 toast + 红点
