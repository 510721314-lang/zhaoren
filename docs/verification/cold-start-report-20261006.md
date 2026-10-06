# 冷启动验证报告 20261006

> 验证者：第二人接管验证（零项目记忆，唯一信息源 = c:\zhaoren 仓库内文件）
> 规则：只读验证 + 写报告；每条命令真实执行；不改代码/配置/文档。

## 执行记录（每条命令 + 真实输出摘录 + 通过/卡点）

| 命令 | 真实输出摘录 | 结论 |
|---|---|---|
| `node --version` | `v24.20.0` | 通过（README 要求 Node ≥ 18 满足） |
| `git -C c:\zhaoren status -sb` | `## master...origin/master`；`M scripts/check-heartbeat.ps1`；`?? docs/verification/cold-start-protocol.md` | 通过（有 1 个未提交改动 + 1 个未跟踪文件） |
| `node scripts/check-nightmask.js` | `总挂载点: 17  完整(bind:reserve): 17  缺失: 0` → `✅ 所有 night-mask 挂载点都有 bind:reserve` | 通过（exit 0） |
| `node scripts/check-ssot.js` | `config/index.js 总行数: 162  可疑硬编码: 0` → `✅ 无新增硬编码` | 通过（exit 0） |
| `node scripts/check-syntax.js` | `SYNTAX ALL OK (98 files)` | 通过（exit 0） |
| `node scripts/check-shared-sync.js` | 13 条 `[OK] ...` → `SHARED SYNC ALL OK` | 通过（exit 0） |
| `npm test` | `ℹ tests 108  ℹ pass 108  ℹ fail 0`（node:test 零依赖） | 通过（exit 0） |
| `powershell -File .predeploy/smoke-check.ps1` | `[FATAL] AWK_KEY env not set`（exit 2） | 卡点（预期：缺密钥，**报错点名了 `AWK_KEY`**） |
| `powershell -File scripts/check-heartbeat.ps1` | `[heartbeat] FATAL: AWK_KEY not set`（exit 2） | 卡点（预期：缺密钥，报错同理点名 `AWK_KEY`） |
| `powershell -File scripts/gate.ps1` | 前 5 步全绿 → `[gate] 6/7 smoke-check ... [FATAL] AWK_KEY env not set` → `[gate] FAIL: 6/7 smoke-check (exit 2)`，`gate_exit=2` | 符合 README「一键门禁」语义（第 6 步因缺钥 FAIL，不阻塞前 5 步） |

### 第 3/4 步专项：报错是否足以找到钥匙 + 换机取证

- 报错信息 `AWK_KEY env not set` **明确点名环境变量名**，且 key-rotation.md line 10 直接写「统一读 `$env:AWK_KEY`」，能定位到钥匙名。→ 报错足以引导。
- 本机密钥真实落点核实：
  - User 级环境变量已配置：`[Environment]::GetEnvironmentVariable('AWK_KEY','User')` = `AWK-3c632bc0...fa64a0d3`（64 位 hex，符合 `^AWK-[a-f0-9]{64}$`）；但**本验证会话 `$env:AWK_KEY` 为空**（未继承 setx）。
  - `C:\zhaoren-bak\admin-key-20261006.txt`（207 B）真实存在，README 账号恢复矩阵「admin-key-*.txt」指向正确。
- **换机适用性**：README 与 key-rotation.md 都把密钥唯一明文落点放在 `C:\zhaoren-bak`（本机目录）与 User 环境变量。**换到全新机器后这两者都不存在**，key-rotation.md 只有「生成新钥 + 用旧钥 config_set 覆盖」的轮换主路径，**没有「新机如何取得现有 key」的取证路径**；唯一兜底是 init-db `generate_admin_web_key` bootstrap（需真实 OPENID/管理员，鸡生蛋）。→ 见卡点 #1。

## 卡点清单

| # | 级别 | 位置 | 现象 | 建议回写 |
|---|---|---|---|---|
| 1 | 模糊 | key-rotation.md L25-31；README L33 | 换机时 `C:\zhaoren-bak`/User 环境变量均不可用，文档无「新机取得现有 key」路径；唯一兜底 bootstrap 需管理员身份（鸡生蛋） | key-rotation.md 或 README 补「新机取证三选一：① 拷贝 `C:\zhaoren-bak` 里的 `admin-key-*.txt` / 读目标机 User env；② 用真实 OPENID 走 init-db `generate_admin_web_key` bootstrap」 |
| 2 | 模糊 | backup-restore.md L9；backup.ps1 L14；restore.ps1 L19 | 脚本环境变量名不一致：门禁类读 `$env:AWK_KEY`，backup/restore 读 `$env:ADMIN_WEB_KEY`；照 key-rotation 设了 `AWK_KEY` 后直接跑 backup 会 `throw 'Admin key required'` | backup-restore.md 点名 `ADMIN_WEB_KEY`（或统一改用 `-AdminKey` 参数示例） |
| 3 | 瑕疵 | README L32（账号恢复矩阵） | `GitHub 仓库 ⚠ 待填`，但 `git remote -v` 实为 `https://github.com/510721314-lang/zhaoren.git`，换机克隆入口其实已知 | 回填 README 的 GitHub 仓库地址 |
| 4 | 瑕疵 | restore.ps1 L16、L24 | 残留旧机死代码：`$PROJECT_DIR = 'c:\Users\DC\Desktop\zhaoren'`、CLI 探测 `'C:\Users\DC','C:\'`（恢复流程实际未使用，但误导换机阅读） | 删除或改为 `$PSScriptRoot` 派生；backup-restore.md 补充「restore.ps1 亦有旧路径残留」 |
| 5 | 瑕疵 | backup-restore.md L44 | 写「33 个集合导出」，但推荐优先的 manual-backup.ps1 COLLECTIONS 实为 34 项（多 `exam_bank`；旧版 backup.ps1 才 33 项） | 改为「34（含 exam_bank）」或注明二者差异 |
| 6 | 模糊 | key-rotation.md L10；README L10 | 「用户级 setx 已配，新终端自动生效」与本会话不符：User 级有值但注入式 shell 的 `$env:AWK_KEY` 仍为空 → smoke/heartbeat 报 not set | 补一句兜底：`if (-not $env:AWK_KEY) { $env:AWK_KEY = [Environment]::GetEnvironmentVariable('AWK_KEY','User') }` |
| 7 | 瑕疵 | git 工作区（scripts/check-heartbeat.ps1） | 存在未提交改动（新增 2 行 debug 输出），克隆仓库拿不到；与「文档/脚本一致」铁律下的当前工作区不一致 | 提交或回退该改动后以脚本实测为准 |

- 阻塞 0 / 模糊 3（#1 #2 #6）/ 瑕疵 4（#3 #4 #5 #7），合计 7。

## 手册评分表（A/B/C + 理由）

| 手册 | 评分 | 理由 |
|---|---|---|
| README.md | A | 入口清晰、一键门禁实测可跑；仅 GitHub 待填（#3）为瑕疵 |
| deploy.md | A | CLI 全路径 `C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat`、env id、项目根均在磁盘/仓库实测一致；IDE 端口为环境值（离线无法核实，已按前置条件声明） |
| backup-restore.md | B | 三个脚本全在、confirm/dry-run/「仅恢复 admin_config」描述与脚本一致；扣分在 env 变量名未点名（#2）、集合数 33/34（#5）、restore.ps1 旧路径未标注（#4） |
| key-rotation.md | B | 轮换主路径、格式强校验 `^AWK-[a-f0-9]{64}$`、`config_bad_key`、`generate_admin_web_key` 均与 admin-action/init-db 代码一致；扣分在换机取证盲区（#1）与 setx 生效口径（#6） |
| ops-runbook.md | A | `quick_check`/`lookup`/`purge_test_data`(dry-run+confirm:PURGE)/`set_env`/`force_set_env`(4h 自动回 prod)/`bootstrap`(事务 CAS) 均已在 init-db/index.js 逐条核实 |
| audit-checklist.md | A | 4 个门禁脚本 + smoke + `.github/workflows/ci.yml`(node 22) 全在，「npm test 108 条全绿」与本机实测 108 pass 精确一致 |
| config-sync.md | A | `cloudfunctions\_shared\sync-{take-rules,money-rules,test-data,partner-audit}.ps1` 4 个 sync 脚本全在；7 处 SCENE 常量落点文件全在；check-shared-sync/check-ssot 实测通过 |
| troubleshooting.md | A | 纯知识条目 + git/curl 标准用法，与仓库一致，无可证伪点 |

## 总体结论

**可以独立接管**：门禁前 5 步（nightmask/ssot/syntax/shared-sync）+ npm test 108 条全绿、gate.ps1 一键门禁语义真实成立，七篇手册的脚本/路径/常量与实际仓库基本吻合，无阻塞级卡点。

**最痛的三处文档漏洞**：
1. 密钥**换机取证盲区**——文档把唯一明文密钥锁死在本机（`C:\zhaoren-bak` + User 环境变量），新机器无取钥路径（#1）；
2. `AWK_KEY` 与 `ADMIN_WEB_KEY` **环境变量名不一致**——照一篇手册配好变量，跑到备份脚本仍会 `Admin key required`（#2）；
3. README 账号恢复矩阵 **GitHub 仓库仍「待填」**——换机克隆入口明明已存在于 `git remote`，却未回写，是冷启动第一道信息缺口（#3）。