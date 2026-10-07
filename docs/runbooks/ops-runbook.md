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

- error_scan 每轮定时扫描 P0/P1 事件 / audit_log fail / 卡死提现(>48h) / **网关鉴权失败突增(窗口内 ≥3 次才报, 2026-10-07 补 ④)** → 推管理员 system_notice；游标 `admin_config.error_scan_last_at`，**心跳 `error_scan_heartbeat_at`（2026-10-06 补）**
- 网关告警数据源：admin-web 对 bad_key/missing_key 拒绝时 **await** 写 `platform_event(P2, type=gateway_bad_key)`（2026-10-07 补；await 保证响应前事件落库，防运行时回收截断；内部吞异常不影响 401 响应；密钥本身不入 payload）
- **auditPrune 审计留存（2026-10-07 补）**：order-timer 每日 UTC 19 点(≈北京 03:00)删除 90 天前 `audit_log`；默认 **dry-run 只统计**（开关 `admin_config.audit_prune_dry_run`，后台「通用开关-审计日志清理」可配）；真删同一天只执行一次（`audit_prune_last_day` 幂等）；**结果落库** `admin_config.audit_prune_last`（`{at,dry_run,matched,pruned,cutoff,days}`，config_get 可直接读，dry-run 也记录 → 「先看统计再置 false」流程可执行）
- **前置条件核查结论（2026-10-07）**：①触发器正常（心跳闭环）；②当前 `matched=0`（audit_log 全部在 2026-09-23 之后，90 天前为 0 条）→ 即便立刻置 false 也不会删任何数据，真正开始删约在 **2026-12-22**；③**哈希链安全**：`audit_verify` 只重算每条内容哈希 + 校验 `i>0` 的 `prev_hash` 链接（**起点 i=0 豁免**），删除「最早的连续时间段」不会产生断链告警，verdict 仍为 `ok`；④backup 已就绪可取证
- **config_history（2026-10-07 补）**：admin-action `config_set` 成功后自动追加快照（before/after/keys/reason/operator），敏感键掩码 `***`，保留最近 100 版；集合与 admin_accounts 等同批 ensureAdminColls 幂等创建；**已纳入 EXPORT_COLLECTIONS**，查看方式：`{"action":"export_collection","collection":"config_history","confirm":true,"page":1,"page_size":20}`
- **零副作用验证手法**（改配置前想试通道时用）：`config_set` 传某 int 键的**当前值**（值不变但 patch 非空）→ 会成功写入并产生 config_history 快照，不改变任何线上行为
- 演练：管理员 `{action:'run', drill:true}`

## 验证

- 巡检闭环：`config_get` 看 `error_scan_last_at > 0` 即巡检在跑；**心跳自观测**：`powershell -File scripts/check-heartbeat.ps1`（需 `$env:AWK_KEY`）——心跳为 0 或超 30 分钟未刷新输出 **FAIL 并阻塞门禁**（2026-10-07 起，此前为 WARN）；实测 2026-10-07 10:40 心跳恢复、gate 输出 `OK: last beat 1.3 min ago`（config_get 已透出 `test_openids`/`error_scan_last_at`/`error_scan_heartbeat_at`；`admin_openids` 不透出，属设计）
- 危险操作每步改后用 `config_get` / `quick_check` 复核实际值

## 定期巡检清单（2026-10-07 补）

| 频率 | 项 | 命令 | 期望 |
|---|---|---|---|
| 每次交付前 | 全量门禁 7 步 | `powershell -File scripts/gate.ps1` | exit 0 → `ALL PASS` |
| 每天（建议） | order-timer 心跳 | `powershell -File scripts/check-heartbeat.ps1` | `OK: last beat N min ago`（心跳 0 / 超 30min → FAIL 阻塞门禁） |
| 每天 03:00 后 | auditPrune 产物 | `powershell -File scripts/check-audit-prune.ps1` | `PASS (dry_run=true, matched=0)`；结果同时写 `C:\zhaoren-bak\audit-prune-check.log` |
| 改配置后 | 配置版本史 | 网关 `{"action":"config_history_list","page":1}` | 出现本次变更快照（敏感键已掩码为 `***`） |
| 重要节点 | 三重备份 | git bundle + robocopy + `.predeploy/manual-backup.ps1` | 全部记入 `C:\zhaoren-bak\CHECKSUMS.txt`（备份脚本已含 config_history） |

> 系统级自动定时（Windows 计划任务）**需管理员权限注册**：本机 PowerShell 未提升时 `schtasks /create` 与 `Register-ScheduledTask` 均报 `Access is denied`。未注册时按上表手动跑；需自动化请以管理员身份注册任务或让 AI 会话内守候（后者依赖进程存活）。

## 坑

- admin-web → admin-action（proxy）→ init-db 时**上下游都用 `action` 字段路由**：直传 `{"action":"init_db"}` 会 fallback 到默认逻辑 → proxying 时用 `__init_db_action` 存真实 action、`action:"init_db"` 走路由
- proxy 层必须**完整传 `mock_openid` 等下游关键字段**，不能假设自动映射
- prod 环境控制台手动 run 传 `mock_openid` 会被忽略 → `ot_forbidden`，drill 演练需临时切 dev（现有 SWITCH_DEV 确认门）
- ~~部署后 `error_scan_last_at` 仍为 0（约 5 个周期未触发）~~ → **2026-10-07 已闭环**。真实根因不是触发器停摆：`orderTimer` 每 5 分钟确实在调用函数，但 order-timer 的 `isTimer` 判定只认 `context.TRIGGER_NAME`，而**腾讯云 SCF 标准定时触发器把信息放在 `event` 里**（`{Type:'Timer',TriggerName:'orderTimer',Time,Message}`）→ 每轮被 `ot_forbidden` 拦截。已改为兼容 SCF 事件格式（并要求本次调用无用户 OPENID，防伪造绕过）。**方法论教训**：判断"定时器没生效"必须分两层——先证「有没有被调用」（入口埋探针写时间戳），再证「有没有通过鉴权」；两件事的修法完全不同，只看心跳=0 会误判成"触发器被暂停"
- mock 通道：`simulate_realname`/`submit_realname` 仅 env=dev 可用；读不到 env 按 prod 兜底（fail-closed）
- `purge_test_data` 类批量软删会因集合收缩导致 skip 偏移漏删 → 必须重复执行直到 count=0