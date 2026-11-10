# 节点备份报告 · 2026-11-10（收工）

> 产物根目录：`C:\zhaoren-bak`；备份时 HEAD `bac0f0e`（体验版 v1.6.110 上传后）。

## 摘要
| 通道 | 产物 | 结果 |
|---|---|---|
| ① git 远端 | origin/master | **同步**：备份时领先 0 / 落后 0 |
| ② git bundle | `zhaoren-full-20261110-1833.bundle`（18.92 MB） | `git bundle verify` **OK（complete history）**；SHA256 `A285B872…5FE6AF` |
| ③ 热备文件 | `zhaoren_files_20261110-1834\` | robocopy **1065/1065**（源↔备数量一致；排除 `.git/node_modules/.trae/.tmp-tcb/.backup-lark/.cloudbase-backup/dist/.predeploy` 与 `*.log`） |
| ④ DB 导出 | `zhaoren_backup_20261110-1823\db\` | **38 集合**，逐表 `.sha256` 复核 **0 不一致**；`audit_log` 10000/18372（**TRUNC**，服务端单表上限） |
| ⑤ 云函数代码 | `zhaoren_backup_20261110-1823\meta\functions_code\` | **20/20**（首轮 6 个 90s 超时，已单独补下：admin-web / payment-mock / safety-report / user-login / zz-seed-orders / zz-warmup） |
| ⑥ admin_config + 索引台账 | 同目录 `admin_config\20261110-1823.json(.sha256)`、`meta\index_ledger.json` | 快照存在且带 SHA；索引台账 **49 条** |

## 一致性核验
- `manifest.json`：`git_head=bac0f0e…`，与 `git rev-parse HEAD` **一致**；`total_tables=38`
- `CHECKSUMS.txt`：已追加本 bundle 行（SHA256）与两条 `DIR` 行（备份目录 / 热备目录）
- 文档链接：`verify:offline` **EXIT=0**（tests 874/874、fail 0、A/B 455 EQUIVALENT）

## 已知边界
1. DB 导出为**展示级脱敏**（手机号/证件/姓名等），恢复敏感原值需未脱敏源另行覆盖。
2. `audit_log` 受 `export_collection` 单表 10000 条上限，本次 `TRUNC`（10000/18372）。
3. 云存储清单（L4）未接入；异地（飞书）通道本次未执行。
4. 函数代码含 `node_modules`，体积大，未纳入异地备份（与既有口径一致）。

## 恢复指引
```powershell
# dry-run 校验（不写入云端）
powershell -ExecutionPolicy Bypass -File .predeploy\restore.ps1 -BackupDir 'C:\zhaoren-bak\zhaoren_backup_20261110-1823'
# 确认恢复（输入 YES）
powershell -ExecutionPolicy Bypass -File .predeploy\restore.ps1 -BackupDir 'C:\zhaoren-bak\zhaoren_backup_20261110-1823' -Force
```
