# 三重备份与恢复演练 SOP

> 适用场景：定期/交付前做完整备份；代码层 + 云端配置 + 云端 DB 数据兜底；从备份恢复（含演练）；核对备份完整性。

## 前置条件

- 三重备份：**git bundle**（代码层）+ **robocopy 热备**（代码层）+ **云端 DB 导出**（数据层），缺一不可
- 所有备份产物一律落 **`C:\zhaoren-bak`**（硬约束）
- 备份脚本密钥：`-AdminKey` 参数或环境变量；云端 DB 导出走 admin-action `export_admin_config` / `export_collection`（需 X-Admin-Key）
- 相关脚本（磁盘真实存在）：
  - `c:\zhaoren\.predeploy\manual-backup.ps1`（L2+L3，等价 backup.ps1 的数据层，2026-10-01 修复两处过时：export 需 confirm 二次确认、cli 探测旧机器路径）
  - `c:\zhaoren\.predeploy\backup.ps1`（L2+L3+L5 全量）
  - `c:\zhaoren\.predeploy\restore.ps1`（先 dry-run 校验 SHA256，仅恢复 admin_config）

## 步骤

### 1. 代码层备份（git bundle + robocopy 热备）

```powershell
# git bundle（含历史），备份后立即记录 SHA256 + verify
git -C c:\zhaoren bundle create "C:\zhaoren-bak\zhaoren-$(Get-Date -Format 'yyyyMMdd-HHmmss').bundle" --all
git -C c:\zhaoren bundle verify "C:\zhaoren-bak\zhaoren-<ts>.bundle"
Get-FileHash "C:\zhaoren-bak\zhaoren-<ts>.bundle" -Algorithm SHA256 | ForEach-Object { $_.Hash } |
  Add-Content "C:\zhaoren-bak\CHECKSUMS.txt"
```

- robocopy 热备（精确命令来自 `.trae/rules.md` L51 铁律）：

```powershell
robocopy c:\zhaoren "C:\zhaoren-bak\zhaoren_files_$(Get-Date -Format 'yyyyMMdd-HHmmss')" /MIR /XD .git node_modules .trae .tmp-cloud-runner
# 恢复（rules.md L79）: robocopy <热备份目录> <恢复目录> /MIR
```

  - 坑（rules.md L83）：IDE 运行时文件会在 robocopy 后新增到备份目录外，完整性核查重点是核心目录 **miniprogram/ + cloudfunctions/**
- push 到 GitHub 因 443/TLS 波动失败时**不阻塞本地开发**：先 bundle 兜底，网络恢复后 `git -c http.proxy= -c https.proxy= push origin master` 补推

### 2. 云端 DB 导出（manual-backup.ps1）

```powershell
& 'c:\zhaoren\.predeploy\manual-backup.ps1' -AdminKey "<key>"
```

- 产物：`C:\zhaoren-bak\zhaoren_backup_<yyyyMMdd-HHmm>\`（`admin_config/` + `db/` + `manifest.json`）
- 33 个集合导出（`platform_event`/`audit_log`/`order_main`/`im_message` 等，空集合也导出为 0/0）

### 3. 恢复演练（restore.ps1，默认 dry-run）

```powershell
# dry-run：只校验 SHA256 完整性，不写云端
powershell -ExecutionPolicy Bypass -File c:\zhaoren\.predeploy\restore.ps1 -BackupDir 'C:\zhaoren-bak\zhaoren_backup_<ts>'
# 真恢复：输入 YES 确认，仅恢复 admin_config
powershell -ExecutionPolicy Bypass -File c:\zhaoren\.predeploy\restore.ps1 -BackupDir 'C:\zhaoren-bak\zhaoren_backup_<ts>' -Force
```

## 验证

- **SHA256 校验收口**：每份 `.json` 重算 SHA256 比对同名 `.sha256`；`CHECKSUMS.txt` 记 bundle 哈希
- **DB 完整性**：每集合 JSON 可解析 + `total == list.Count` + `manifest.total_tables` 与实际导出集合数一致
- **admin_config 快照对照**：与线上 `config_get` 关键值（env / mock 开关）核对
- **git bundle**：`git bundle verify` 确认 HEAD 与本地一致

## 坑

- `export_admin_config` / `export_collection` **需 `confirm:true` 二次确认**，否则返回 `export_need_confirm`
- 网关**间歇 504**（3s 硬限 + 冷启动，同一请求上次成功下次超时）→ 调用必须带**重试循环**（5 次 × 间隔 1s，通常第 2 次成功）；失败集合补拉后手动更新 `manifest.total_tables`
- `backup.ps1`（旧版）的 CLI 探测仍写 `C:\Users\DC\Desktop`，且 L2/L3 不带 `confirm:true` → 数据层备份优先用 `manual-backup.ps1`
- DB **恢复未实现**：`restore.ps1` 当前仅恢复 admin_config，DB 数据恢复需 admin-action 新增 `import_collection` action
- `export_collection` 单表硬限 10000 条（超限 `truncated=true`）；敏感字段脱敏是展示级，真恢复用未脱敏 admin_config
- PS5 下 `& $cli 2>&1` 会把 cli.bat 的 stderr 包成 NativeCommandError 中断脚本 → L5 用 `Start-Process` 重定向 stdout/stderr（backup.ps1 已如此处理）