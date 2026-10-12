# Ch10 · 运维手册

> 事实来源：代码与既有运维 SOP 实测（2026-10）。既有 Runbook 汇编见 [docs/runbooks/](file:///c:/zhaoren/docs/runbooks)（本章为**自含**版本）。
> **脱敏**：本章不写环境 ID / AppID / admin key / 测试 openid 明文；仅写「存放位置与读取机制」。

## 10.1 运行环境与身份（脱敏）

| 项 | 存放位置 | 读取机制 |
|---|---|---|
| 云环境 ID（envId） | [cloudbaserc.json](file:///c:/zhaoren/cloudbaserc.json) | SDK `cloud.DYNAMIC_CURRENT_ENV`；勿外传 |
| 小程序 AppID | [project.config.json](file:///c:/zhaoren/project.config.json) | 开发者工具读取；勿外传 |
| 后台网关密钥 | `admin_config.global.admin_web_key`（云端）/ `%AWK_KEY%`（本机环境变量） | 脚本统一读 `$env:AWK_KEY`（兼容旧名 `ADMIN_WEB_KEY`）；`config_get`/`export` 均**不透出明文** |
| 加密密钥（手机号/身份证） | 见 [_shared/phone_crypt.js](file:///c:/zhaoren/cloudfunctions/_shared/phone_crypt.js) | 手册不写值；`phone_hash` 随密钥同步重算 |
| 部署 CLI | 微信开发者工具 `cli.bat`（本机路径） | 云函数**必须串行**部署，部署后等 90–120s |

- **鉴权优先级**（后台网关）：`X-Admin-Token`（`admin_web_sessions` 12h）> `admin_login` 免 key > `X-Admin-Key` 兜底。
- **身份解析**：prod 强制真实 `wxCtx.OPENID`；`mock_openid` 全失效；dev 旁路需 `dev_until` 未来时间戳，过期自动回 prod。

## 10.2 日常巡检清单

| 频率 | 项 | 命令/入口 | 期望 |
|---|---|---|---|
| 每次交付前 | 全量门禁 7 步 | `powershell -File scripts/gate.ps1` | exit 0 → `ALL PASS` |
| 每天（建议） | order-timer 心跳 | `powershell -File scripts/check-heartbeat.ps1`（需 `AWK_KEY`） | `OK: last beat N min ago`；心跳 0 / 超 30min → **FAIL 阻塞门禁** |
| 每天 03:00 后 | auditPrune 产物 | `powershell -File scripts/check-audit-prune.ps1` | `PASS (dry_run=true, matched=0)`；结果写 `C:\zhaoren-bak\audit-prune-check.log` |
| 改配置后 | 配置版本史 | 网关 `{"action":"config_history_list","page":1}` | 出现本次快照（敏感键掩码 `***`） |
| 重要节点 | 三重备份 | 见 §10.3 | 全部记入 `C:\zhaoren-bak\CHECKSUMS.txt` |

**巡检自观测入口**：`config_get` 透出 `error_scan_last_at` / `error_scan_heartbeat_at`（>0 即巡检在跑）；`admin_openids` **不透出**（设计如此）。
**系统级自动化**需管理员权限注册 Windows 计划任务（未提升时 `schtasks`/`Register-ScheduledTask` 报 `Access is denied`）；未注册时按上表手动跑。

## 10.3 备份与恢复（三重备份）

> **硬约束**：所有备份产物落 `C:\zhaoren-bak`。三重缺一不可：**git bundle**（代码层）+ **robocopy 热备**（代码层）+ **云端 DB 导出**（数据层）。

### 10.3.1 代码层

```powershell
# git bundle（含历史）+ 立即 verify + 记录 SHA256
git -C c:\zhaoren bundle create "C:\zhaoren-bak\zhaoren-<ts>.bundle" --all
git -C c:\zhaoren bundle verify "C:\zhaoren-bak\zhaoren-<ts>.bundle"
# robocopy 热备（排除 IDE/依赖目录）
robocopy c:\zhaoren "C:\zhaoren-bak\zhaoren_files_<ts>" /MIR /XD .git node_modules .trae .tmp-cloud-runner
```

- push 因 443/TLS 波动失败**不阻塞本地开发**：先 bundle 兜底，网络恢复后补推。
- 完整性核查重点：核心目录 `miniprogram/` + `cloudfunctions/`（IDE 运行时文件会在 robocopy 后新增到备份目录外，属正常）。

### 10.3.2 云端 DB 导出

```powershell
& 'c:\zhaoren\.predeploy\manual-backup.ps1' -AdminKey "<key>"   # 或用 $env:AWK_KEY
```

- 用 **`manual-backup.ps1`**（数据层正脚本，含 `confirm:true`）；旧 `backup.ps1` 的 L2/L3 未带 `confirm` → 直接跑返回 `export_need_confirm`，**勿作数据备份入口**。
- 产出：`C:\zhaoren-bak\zhaoren_backup_<ts>\`（`admin_config/` + `db/` + `manifest.json`）+ `meta\functions_code\<fn>\`（已部署云函数代码）+ `meta\index_ledger.json`（索引台账，设计级）。
- 坑：`-BackupDir` 解析为空会报 `New-Item Path 为空` → 显式传路径。

### 10.3.3 异地备份（飞书云空间，可选推荐）

铁律：**先 `lark-cli drive +status`（精确 SHA）→ `+push` → 再 `+status` 复核**，三者齐备才算成功。`+push` 默认 `--if-exists=skip`，CHECKSUMS 等追加文件须 `--if-exists overwrite`。

### 10.3.4 恢复演练

```powershell
# dry-run：仅校验 SHA256
powershell -ExecutionPolicy Bypass -File c:\zhaoren\.predeploy\restore.ps1 -BackupDir 'C:\zhaoren-bak\zhaoren_backup_<ts>'
# 真恢复：仅恢复 admin_config（输入 YES 确认）
powershell -ExecutionPolicy Bypass -File c:\zhaoren\.predeploy\restore.ps1 -BackupDir '...' -Force
```

- **DB 数据恢复未实现**（`restore.ps1` 仅恢复 admin_config）；如需全量恢复需新增 admin-action `import_collection`。
- `export_collection` 单表硬限 10000 条（超限 `truncated=true`）；导出成功须 `confirm:true`。

## 10.4 环境切换 dev/prod

| 操作 | 确认门 | 备注 |
|---|---|---|
| 切 `env=dev` | `confirm:'SWITCH_DEV'` + `dev_hours`(1-24) 或 `dev_bypass=true` | admin-web Config 弹窗；负向测试返回 `config_need_confirm` |
| 切回 `env=prod` | 免确认 | 清 `dev_until`/`dev_bypass` |
| 兜底 | — | dev **4 小时后自动回 prod** |

- `init-db force_set_env`：需 `confirm:true` + `reason`，写 `platform_event` 留痕；有 5 分钟进程内 env 缓存，动作内须 `invalidateEnvCache()`。
- mock 通道（`simulate_realname`/`submit_realname`）仅 dev 可用；读不到 env 按 prod 兜底。
- 提审演示/截图期间可临时切 dev，**完成后立即切回 prod**。

## 10.5 配置变更与一致性同步

- **唯一入口** `config_set`（后台 Config 页或网关直调）：`CONFIG_SCHEMA` 校验 + 事务写 + `config_history` 快照 + `platform_event(P2)` 审计。
- **生效时延**：`scene_list` 缓存 5 分钟 / `scene_groups` 60 秒；后台成功统一提示「约 5 分钟内生效」。
- **场景中文映射全仓同步**（改场景名必须全改）：`SCENE_CN`/`SCENE_NAME`/`SCENE_NAMES_LEGACY`/`SCENE_NAMES` 散落在 order-action / admin-action / demand-publish / im-conv / im-send / home-action / payment-mock。新增/改场景须全仓 Grep 一处改处处查。
- **共享模块四件套同步**：改 `_shared/` 规范源后**必须**跑对应 `sync-*.ps1`（`sync-take-rules` / `sync-money-rules` / `sync-test-data` / `sync-partner-audit` …），`scripts/check-shared-sync.js` 会做 SHA 拦截。
- **零副作用验证手法**：`config_set` 传某 int 键的**当前值**（值不变但 patch 非空）→ 成功写入并产生快照，不改变线上行为。

## 10.6 密钥轮换（`admin_web_key`）

新钥格式强校验 `^AWK-[a-f0-9]{64}$`。**正常轮换走 `config_set`，不走 init-db `generate`**（后者是首建/失钥恢复路径）。

1. 生成：`node -e "console.log('AWK-' + require('crypto').randomBytes(32).toString('hex'))"`。
2. **只存仓库外**：落 `C:\zhaoren-bak\admin-key-<ts>.txt`；**永不入 git**（仓库 public，入仓即视为泄露）。
3. 设环境变量：`setx AWK_KEY "<new>"`（用户级）+ 当前会话 `$env:AWK_KEY`。
4. 干跑：`.predeploy\smoke-check.ps1` → exit 0 证明新钥走通全链路。
5. 正式轮换：用**旧钥**发 `config_set`（提交后旧钥立即作废），`reason` 用下划线无空格串。
6. **双向验证**：旧钥 → 期望 401 作废；新钥 → 期望 200 `{ok:true}`。
7. admin-web 重新登录：`localStorage.clear(); location.reload()`。

- **失钥恢复**：新机器登录管理员微信号 → 云端测试面板调 init-db `generate_admin_web_key`（`reason` 必填；身份走 `admin_openids` 白名单），返回新钥仅一次明文，立即落盘。
- 坑：网关层与函数层判定不同 —— **POST 不带 key → 400 空 body**（网关拦截）；**错误 key → 200 + `{ok:false,code:'bad_key'}`**（函数已跑）。

## 10.7 部署后核查

1. 串行部署云函数，等 90–120s，`functions info` 读回确认。
2. `deploy` **只上传代码，不应用** `config.json` 的 timeout/triggers → 触发器须另经 miniprogram-ci（受 IP 白名单）或控制台。
3. 跑 `quick_check`：核对 `scene_count` vs seed、`mock_gate{env, mock_payment_enabled, status}`。
4. 上线冻结自检：prod 且 `mock_payment_enabled=true` 时 `quick_check` 返回 `mock_gate.status=BLOCK`。
5. 部署详情与历史见 [docs/deploy-log.md](file:///c:/zhaoren/docs/deploy-log.md)。

## 10.8 故障排查速查

| 症状 | 根因 | 处置 |
|---|---|---|
| `git push` 卡死/连接重置 | 死代理（127.0.0.1:7890）或 GitHub 数据面单 IP 阻断 | `git -c http.proxy= -c https.proxy= push`；仍失败逐 IP 探测后 `-c http.curloptResolve="github.com:443:<可达IP>"` |
| 网关 2.5s 超时 / 504 | 网关 3s 硬限 + 冷启动；**不代表函数失败** | 先查实际数据；慢任务须幂等 + 可重试 |
| 图片直传 413 | 网关请求体约 100KiB 上限 | admin-web 前端 canvas 压缩到 ≤90KB，或走云存储粘贴 `cloud://` |
| admin-web 静态 404 | CLI 部署**拍平** `public\` 目录 | `serveStatic` 用启动期 `STATIC_MAP` 兼容扁平布局 |
| 云接入字段取不到 | 查询参数字段是 `queryStringParameters`；集成响应用 `statusCode` | 勿用 `req.query.key`/`status` |
| 云函数 `Cannot find module wx-server-sdk` | 未远程安装依赖 | 部署时**远程 npm install**（见 Ch7） |
| 定时器「没生效」误判 | 入口未被调用 vs 通过鉴权失败，是两件事 | 先埋探针证「有没有被调用」，再查鉴权（`isTimer` 须兼容 SCF 事件格式） |
| `orderTimer` 心跳 0 | `isTimer` 只认 `context.TRIGGER_NAME`，而 SCF 定时信息在 `event` | 已改为兼容 SCF 事件格式（并要求本次调用无用户 OPENID） |
| 巡检 P0 噪声 | 机器调用/自身兜底事件 | 配 `error_scan_exempt_types`；内置豁免 `admin_probe:no_openid` / `s4_stale_escalate` |
| PowerShell 无 heredoc / JSON 值含空格 | PS 参数截断 | commit 用单行 `-m`；JSON 值改用下划线无空格串 |
| `purge_test_data` 漏删 | 软删收缩导致 skip 漂移 | 重复执行直到 count=0 |

## 10.9 事件响应（`platform_event` 分级）

| 级别 | 含义 | 典型类型 |
|---|---|---|
| P0 | 紧急 | `safety_sos`（真实用户） |
| P1 | 安全/越权 | `admin_login_fail`、`gateway_bad_key`、`s4_stale_escalate` |
| P2 | 运营写操作 | `config_change`、`config_rotate_web_key`、`scene_migrate_builtin` |
| P3 | 业务异常 | 一般业务错误 |

- **巡检 `error_scan`**（order-timer 每轮）：聚合窗口内 P0/P1 事件 + `audit_log` fail + 卡死提现(>48h) + 网关鉴权失败突增（窗口 ≥3 次）→ 推管理员 `system_notice`。
- **注错演练**：管理员 `order-timer {action:'run', drill:true}` 写一条 P1 演练事件，验证巡检链路（prod 下需临时切 dev，因 `mock_openid` 被忽略返回 `ot_forbidden`）。
- **审计留存**：每日 UTC 19 点删 90 天前 `audit_log`，默认 dry-run（`audit_prune_dry_run`）；结果落 `admin_config.audit_prune_last`（`{at,dry_run,matched,pruned,cutoff,days}`）；哈希链删除最早连续段不产生断链告警。

> 相关：部署流程见 [07-deploy-release.md](file:///c:/zhaoren/docs/dev-manual/07-deploy-release.md)；硬约束见 [05-redlines.md](file:///c:/zhaoren/docs/dev-manual/05-redlines.md)；既有 SOP 汇编见 [docs/runbooks/](file:///c:/zhaoren/docs/runbooks)。
