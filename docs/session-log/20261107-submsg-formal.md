# 2026-11-07 · 三订阅模板 `miniprogram_state` 提前置 formal（含变更后观测）

> 性质：配置变更 + 只读核查（零代码改动）。配套提交：`031a163`（台账四文件）。

## 1. 目标

按用户裁定「系统的完善不要受体验版约束，必要时体验版可以重新上传」，把原定「正式发布同一轮」的
`admin_config._id="global"` → `sub_msg_templates` 三模板 `miniprogram_state` 由 `trial` 提前改为 `formal`，
并在变更后核查订阅消息发送是否出现跳转版本类错误（`41030`）。

## 2. 结论

- 三模板已全部为 `formal`：`demand_grab` / `demand_urge` / `confirm_comm`。
- 结构零误伤：`tmpl_id`、`fields`、`page` 与变更前逐字一致；`nModified=1`。
- 变更后核查：未出现 `41030`；历史 `cloud/fail` 全为 `43101`（用户未授权），时间均早于本次变更。
- 变更后**尚无真实发送样本**，`formal` 的正向生效证据待补（见「未决项」）。
- 回滚成本：同命令改回 `trial`，约 1 分钟。

## 3. 证据（命令与实测值）

写入（`tcb db nosql execute`，`scripts/tcb-exec.js` 封装，单文档三路径 `$set`，不整对象覆盖）：

```json
{"update":"admin_config","updates":[{"q":{"_id":"global"},"u":{"$set":{
  "sub_msg_templates.demand_grab.miniprogram_state":"formal",
  "sub_msg_templates.demand_urge.miniprogram_state":"formal",
  "sub_msg_templates.confirm_comm.miniprogram_state":"formal"}},"multi":false}]}
```

回读（`find admin_config {_id:'global'}`，projection `sub_msg_templates`）：

| 模板 | `miniprogram_state` | `tmpl_id` | `page` | `fields` |
|---|---|---|---|---|
| `demand_grab` | **formal** | `x1TfKgMB…Dx3Q`（MATCH） | `pages-v2/demand-detail/demand-detail`（MATCH） | PRESENT（`thing2`/`time22`） |
| `demand_urge` | **formal** | `-JfmHqHs…1hmg`（MATCH） | `pages-v2/order-detail/order-detail`（MATCH） | PRESENT（`thing4`/`time3`） |
| `confirm_comm` | **formal** | `9j-D9hF_…n6o`（MATCH） | 未设置（MATCH） | PRESENT（`date3`/`thing6`/`thing7`） |

变更后发送日志扫描（`find order_main {sub_msg_send_logs:{$exists:true,$ne:[]}}` limit 300 → 命中 24 单）：

| 分类 | 条数 | 最早/最晚（CST） | 判定 |
|---|---|---|---|
| `cloud` + `ok` | 17 | — | 正常 |
| `cloud` + `fail` + `43101` | 7 | 均 ≤ 2026-10-30 11:25 | `user refuse to accept the msg`，未授权/用尽，与 `miniprogram_state` 无关 |
| `local` + `fail` + `NO_QUOTA` | 15 | — | 本地授权额度守卫 `skipped_by_local`，设计内行为 |
| `41030` | **0** | — | 未出现跳转版本类错误 |

近 24h 仅 3 条，最后一条 `2026-11-06T11:08 CST`，**早于本次变更**（变更发生于 2026-11-07）。
样本来源几乎全部为同一测试 `openid`，代表性有限。

## 4. 改动与提交

| 内容 | 位置 | 提交 |
|---|---|---|
| 运行时配置：三模板 `miniprogram_state` → `formal` | 云端 `admin_config`（无代码、无部署） | 不入库（运行时数据） |
| runbook §4.1 打勾 + 回读证据 + 回滚方式 | [release-zero-checklist.md](../runbooks/release-zero-checklist.md) | `031a163` |
| 选型红线口径变更（原「提审前设 trial」） | [05-redlines.md](../dev-manual/05-redlines.md) | `031a163` |
| 技术债 §0 该行转 ✅ | [tech-debt-inventory-20261105.md](../tech-debt-inventory-20261105.md) | `031a163` |
| CHANGELOG 2026-11-07 chore(config) 一行 | [CHANGELOG.md](../CHANGELOG.md) | `031a163` |

## 5. 未决项

- **缺变更后正向样本**：需一次真实发送（小程序点「催办」，或 `order-timer` 定时发送）后回读 `sub_msg_send_logs`，
  确认 `channel=cloud / status=ok`，并确认点击消息能落到对应页面。
- 过渡期风险：当前无正式版，体验版用户点消息可能跳转异常；按裁定可重传体验版或回滚 `trial`。
- 代码默认值已是 `formal`（`action_config_public.js` / `order-timer/index.js` / `order-action/index.js`），
  本次仅对齐运行时值与代码默认值，未产生新的双源差异。

## 6. 下次入口

1. 取到一次变更后发送样本后，执行只读核查：
   `find order_main { sub_msg_send_logs: { $exists: true } }` → 过滤 `at > 2026-11-07` 的条目，核对 `status`/`errCode`。
2. 若出现 `41030` 或真机点击跳转异常 → 回滚：
   同 `$set` 命令把三个 `formal` 换回 `trial`（约 1 分钟），并同步四份台账。
3. 隐私声明 2 条文案（手机号 / 设备信息）已在会话中给出，待后台人工填写（AI 不代点）。
