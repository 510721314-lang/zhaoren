# init-db / env / 数据打标 / 巡检运维 SOP

> 适用场景：云开发初始化、环境 dev/prod 切换、测试数据标记与清理、管理员身份查询、order-timer 巡检与注错演练。

## 前置条件

- 云环境 `cloud1-d9gkefwcp5c777088`，AppID `wxbc4a4afacdf234f5`
- 身份：发单人主测 A=`oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`；耍伴测试 B=`test_partner_001`
- 云函数取身份统一 `const openid = wxCtx.OPENID || event.mock_openid`（测试面板无独立 OPENID 输入框，必须带 `mock_openid`）
- 调用通道：微信开发者工具**云端测试面板**直调目标函数（CLI 不能远程调用云函数）；走网关代理发到 init-db 时注意 action 字段名冲突（见「坑」）

## 步骤

### 1. init-db 运维 actions

| action | 说明 |
|---|---|
| `{}`（空事件） | 幂等初始化集合/索引/种子 + 差异检测迁移 |
| `bootstrap` | **事务 CAS 机制，仅首次调用成功**（首作自动成为管理员） |
| `quick_check` | 查最近 5 条 demand + admin_config 关键项 + scene_count vs seed 差异 + `mock_gate{env, mock_payment_enabled, status, hint}` |
| `lookup` | `{"action":"lookup","nicknames":["昵称1","昵称2"]}` 按昵称反查 openid |

```json
{"action":"quick_check"}
{"action":"lookup","nicknames":["昵称"]}
```

- 上线冻结自检：prod 且 `mock_payment_enabled=true` 时 `quick_check` 返回 `mock_gate.status=BLOCK`（上线动作前跑一次 self check；`/debug` 端点已删除，排障由 quick_check 覆盖）

### 2. 环境切换 dev/prod

| 操作 | 确认门 | 备注 |
|---|---|---|
| 切 env=dev | `confirm:'SWITCH_DEV'` | admin-action config_set 门 + admin-web Config.vue 弹窗；负向测试返回 `config_need_confirm` |
| 切回 env=prod | 免确认 | — |
| 兜底 | — | dev 环境 **4 小时后自动回 prod** |

- init-db 的 `force_set_env` 需 `confirm:true` + `reason`，写 `platform_event` 留痕；`set_env` 有管理员白名单、prod 禁切 dev、非管理员一律拒绝

```json
{"action":"force_set_env","env":"dev","confirm":true,"reason":"xxx"}
```

### 3. 测试数据打标与清理

- 打标：`admin_config.test_openids` 白名单命中者建需求/建单自动 `is_test=true`，经 admin-action `config_set` 维护：
  ```json
  {"action":"config_set","test_openids_add":["<openid>"]}
  {"action":"config_set","test_openids_remove":["<openid>"]}
  ```
- 清理：init-db `purge_test_data`（管理员）——默认 **dry-run 只统计**；真删须 `confirm:'PURGE'`；仅删 `is_test=true`；**级联 7 张子表**；**单次上限 500**
  ```json
  {"action":"purge_test_data","confirm":"PURGE"}
  ```

### 4. order-timer error_scan 巡检与 drill 注错演练

- error_scan 每轮定时扫描 P0/P1 事件 / audit_log fail / 卡死提现(>48h) → 推管理员 system_notice；游标 `admin_config.error_scan_last_at`，**心跳 `error_scan_heartbeat_at`（2026-10-06 补）**
- 演练：管理员 `{action:'run', drill:true}`

## 验证

- 巡检闭环：`config_get` 看 `error_scan_last_at > 0` 即巡检在跑；**心跳自观测**：`powershell -File scripts/check-heartbeat.ps1`（需 `$env:AWK_KEY`）——心跳为 0 或超 30 分钟未刷新输出 WARN，即 orderTimer 触发器异常（config_get 已透出 `test_openids`/`error_scan_last_at`/`error_scan_heartbeat_at`；`admin_openids` 不透出，属设计）
- 危险操作每步改后用 `config_get` / `quick_check` 复核实际值

## 坑

- admin-web → admin-action（proxy）→ init-db 时**上下游都用 `action` 字段路由**：直传 `{"action":"init_db"}` 会 fallback 到默认逻辑 → proxying 时用 `__init_db_action` 存真实 action、`action:"init_db"` 走路由
- proxy 层必须**完整传 `mock_openid` 等下游关键字段**，不能假设自动映射
- prod 环境控制台手动 run 传 `mock_openid` 会被忽略 → `ot_forbidden`，drill 演练需临时切 dev（现有 SWITCH_DEV 确认门）
- 部署后 `error_scan_last_at` 仍为 0（约 5 个周期未触发）→ 需在控制台核实 `orderTimer` 触发器是否被暂停/失效（config.json triggers CLI 部署不生效）
- mock 通道：`simulate_realname`/`submit_realname` 仅 env=dev 可用；读不到 env 按 prod 兜底（fail-closed）
- `purge_test_data` 类批量软删会因集合收缩导致 skip 偏移漏删 → 必须重复执行直到 count=0