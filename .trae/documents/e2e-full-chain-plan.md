# 全链路 e2e 测试脚本固化方案

## Context

上一轮已通过命令行 `node -e` 逐步跑通全链路黄金路径：发布需求 → 接单 → 四确认 → 支付 → 履约（3 里程碑）→ 评价，最终订单 `status=S8`。但步骤散落在命令行，未固化为可重复执行的脚本文件。

本方案将已验证的全链路步骤写入 `tests/e2e/flow-full-chain.js`，与现有 `flow-publish-verify.js` 同模式（DevTools + miniprogram-automator + `mp.evaluate` 调 `wx.cloud.callFunction`），通过 `mock_openid` 切换 user/partner 双身份，env 切 dev 放行 mock 身份。

## 改动清单

**仅 1 个新文件**：`tests/e2e/flow-full-chain.js`（复用 `./devtools-launcher.js`）

## 脚本流程（每步含断言）

| 步 | 动作 | 身份(mock_openid) | 云函数/action | 关键参数 | 断言 |
|---|---|---|---|---|---|
| 0 | 启动 DevTools + connect | - | - | - | waitForReady |
| 1 | 切 dev 环境 | admin | init-db `force_set_env` | env:'dev', reason, confirm:true | ok=true |
| 2 | partner 实名 | test_partner_001 | user-login `simulate_realname` | - | ok=true |
| 3 | partner 签 W8 免责 | test_partner_001 | order-create `sign_disclaimer` | scene:'W8' | ok=true |
| 4 | 发布需求 | admin | demand-publish `publish` | 同 flow-publish-verify 参数 | demand_id 非空 |
| 5 | 接单 | test_partner_001 | order-create `create_from_take` | demand_id, partner_location{lat,lng,accuracy} | order_id 非空, status=S1 |
| 6 | 四确认(partner) | test_partner_001 | order-action `confirm_all` | order_id | ok |
| 7 | 四确认(user) | admin | order-action `confirm_all` | order_id | status=S0 |
| 8 | 模拟支付 | admin | payment-mock `mock_pay` | order_id, aa_promise_checked:true | status=S2 |
| 9 | 开始履约申请 | test_partner_001 | order-action `start_apply` | order_id, start_location, start_evidence{photos:[{file_id}]} | status=S2_6 |
| 10 | 确认开始 | admin | order-action `start_confirm` | order_id | status=S3 |
| 11 | 里程碑×3 | test_partner_001 | order-action `milestone_submit` | order_id (不传 note 绕过 msgSecCheck) | milestone=1/2/3 |
| 12 | 完毕申请 | test_partner_001 | order-action `finish_apply` | order_id, finish_evidence{photos:[{file_id}]} | status=S3_6 |
| 13 | 确认完毕 | admin | order-action `finish_confirm` | order_id | status=S5 |
| 14 | 评价 | admin | evaluation-submit `submit` | order_id, star:5, tags, content | status=S8 |
| 15 | 回读断言 | admin | order-action `detail` | order_id | status=S8, milestone.current=3, paid_fen=3000 |
| 16 | 清理 | admin | init-db `purge_test_data` | scope:'all_istest', confirm:'PURGE', expect_orders:N | removed>0 |
| 17 | 切回 prod | admin | init-db `force_set_env` | env:'prod', reason, confirm:true | ok=true |

## 身份与白名单

- `mock_openid` 身份需在 `admin_config.test_openids` 白名单内才打 `is_test=true`（供 purge 精准清理）
- 现行白名单（摘要）：`['test_partner_001', 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c']`
- user 身份用 admin openid（同时满足 force_set_env 管理员白名单 + test_openids）
- partner 身份用 `test_partner_001`

## 前置条件（test_partner_001 需已具备，脚本不自动设置）

- base 考试通过（`submit_exam` 需正确答案，脚本无法自动答题 → 假设已通过；未通过时接单返 `order_base_exam_required`）
- 紧急联系人已填
- `accept_scenes` 含 W8、`accept_switch=true`
- 若以上缺失，脚本在第 5 步接单失败时打印对应错误码，不静默通过

## env 缓存说明

`force_set_env` 仅清 init-db 自身缓存；其他函数 `openid.js` 模块级缓存 5 分钟。脚本在第 1 步后 `await sleep(30s)` 并在第 4 步发布前再 sleep，让冷启动实例读到 dev。若仍命中 prod 缓存（mock_openid 被忽略），接单会返 `order_own_demand`（真实 OPENID 发的单又自己接）——此时需等待缓存过期后重跑。

## 验证方式

```powershell
node tests/e2e/flow-full-chain.js
```

预期输出：逐步 PASS，最终 `=== ALL PASS: 全链路 e2e 验证成功 ===`，退出码 0。

## 风险

- **低**：纯新增测试文件，不改动业务代码；env 切换 4h 自动回 prod，purge 只删 is_test 数据
- 需用户手动：运行脚本（DevTools 需已打开项目）；若 env 缓存未过期需等待重跑
