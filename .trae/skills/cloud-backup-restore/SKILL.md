# 云端全量备份与恢复（zhaoren 专用）

## 触发词

| 触发 | 动作 |
|------|------|
| "请执行云端全量备份到本地 [路径]" | 跑 `.predeploy/backup.ps1 -BackupDir [路径]` |
| "请备份 admin_config 到本地" | 只跑 L2：调 admin-action `export_admin_config` |
| "请从 [路径] 恢复到云端" | 跑 `.predeploy/restore.ps1 -BackupDir [路径] -Force`（先 dry-run 校验 SHA256） |
| "请用 [路径] 的云函数重新部署" | 逐函数 `cli cloud functions deploy` |

## 前置常量（每次必带）

- CloudBase env: `cloud1-d9gkefwcp5c777088`
- AppID: `wxbc4a4afacdf234f5`
- admin_web_key: `<不入库, 向管理员索取或 init-db generate_admin_web_key 生成; 脚本通过 -AdminKey 参数或环境变量 ADMIN_WEB_KEY 传入>`
- HTTP 网关: `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api`
- CLI: 动态发现 `Get-ChildItem -Path 'C:\Users\DC','C:\' -Filter 'cli.bat' -Recurse | Where { $_.FullName -match 'wechat' } | Select-Object -First 1`
- HEAD: `git log --oneline -1` 先确认版本

## 备份范围（四层，缺一不可）

### L1 代码三层（已有）
GitHub push → git bundle → robocopy hot backup（`.predeploy.ps1` + `.predeploy/backup.ps1` 独立于代码三层）

### L2 admin_config 快照（每次必做）
- 调 admin-action `export_admin_config`：POST 网关, X-Admin-Key, body=`{"action":"export_admin_config"}`
- 返回：`{ok:true, data:{config:{...}, exported_at, git_head, git_short}}`
- 脱敏：idcard_aes_key/admin_web_key 只返回存在性布尔 set 字段，不返回值
- 存：`backup/admin_config/YYYYMMDD-HH.json` + `.sha256`
- 完整性：SHA256 文件内容

### L3 DB 全量导出（20+ collection）
- 调 admin-action `export_collection`：`POST 网关 {"action":"export_collection","collection":"xxx","page":1,"page_size":100}`
- 白名单 25 表：admin_config, admin_web_sessions, user_profile, partner_profile, partner_exam, order, order_status_log, order_deposit, order_payment, order_settlement, demand_publish, demand_match, blog, blog_comment, blog_like, safety_report, safety_checkin, system_notice, credit_log, withdraw_request, insurance_record, report, dispute, sms_log, device_bind
- 分页：返回 `{has_more:boolean, page, page_size, total, truncated}`，page 递增直到 has_more=false
- 敏感脱敏：phone(138****1234), idcard_no(1101********1234), real_name(张*三), address(前6字***), openid(前4****后6), password/secret/token(***REDACTED***)
- 单表上限 10000 条（超限 truncated=true）
- 存：`backup/db/<collection>.json` + `.sha256`
- 失败静默跳过（返回 `{ok:false, code:'export_bad_collection'}` 或网关 400）

### L4 云存储清单（仅元数据）
- CloudBase HTTP API 列 /storage/ 全部文件
- 仅存：fileID + URL + size + sha256
- 恢复时手动核对关键图片/证件是否存在

### L5 函数元数据
- `cli cloud functions info --env cloud1-d9gkefwcp5c777088 --project c:\Users\DC\Desktop\zhaoren`
- 存：`backup/meta/functions_info.txt`
- 网关路由：CloudBase 控制台手工记录 path → function → auth

## 完整备份脚本

```powershell
# 快速全量备份（自动生成目录）
powershell -ExecutionPolicy Bypass -File .predeploy\backup.ps1

# 指定目录
powershell -ExecutionPolicy Bypass -File .predeploy\backup.ps1 -BackupDir 'C:\zhaoren_backup_20260921'

# 恢复先 dry-run 校验
powershell -ExecutionPolicy Bypass -File .predeploy\restore.ps1 -BackupDir 'C:\zhaoren_backup_20260921'

# 确认恢复（输入 YES）
powershell -ExecutionPolicy Bypass -File .predeploy\restore.ps1 -BackupDir 'C:\zhaoren_backup_20260921' -Force
```

## 完整性校验标准

| 层 | 校验 | 通过 |
|----|------|------|
| L2 | admin_config JSON 可解析 + 密钥字段只返回布尔 | ✅ |
| L3 | 每表 SHA256 文件匹配 + total > 0 时 list 非空 | ✅ 25 表全导出 |
| L5 | functions_info.txt 存在且含函数名 | ⚠️ CLI 可能找不到 → skip |
| 全局 | manifest.json git_head 与 `git rev-parse HEAD` 一致 | ✅ |

## 实测记录（2026-09-21）

- admin-action 新增 export_admin_config + export_collection，部署成功 32.7 KB
- 脚本跑通：25 table 全导出，26 SHA256 全过
- L5 CLI 未找到（当前 PowerShell 会话未发现 cli.bat），但脚本正确 skip
- 恢复脚本当前支持 SHA256 校验 + admin_config 恢复，DB restore 待 admin-action 新增 import_collection action

## 实测记录（2026-10-09 补充）

- **正确脚本 = `manual-backup.ps1`**（带 `confirm$true`）。`backup.ps1` 的 L2/L3 未带 confirm → 全部返回 `export_need_confirm`，表现为每表 `[SKIP] ... 0/0`（看似成功实为空）。数据库备份入口统一用 manual-backup.ps1。
- **备份范围已扩（2026-10-09）**：manual-backup.ps1 现含 L6（`cli cloud functions download` 逐个下载 20 个已部署云函数代码到 `meta/functions_code/<fn>/`）+ L7（`scripts/dump-index-ledger.js` 提取 init-db 的 INDEXES → `meta/index_ledger.json`）。manifest 新增 `has_functions_code` / `has_index_ledger` 布尔标记。
- **关键限制**：wx-server-sdk **无 listIndexes API**（createIndex 也没有，见批次3），备份的索引只是设计级台账 **不是云端实际索引**。历史手工增量索引（如 `demand.grab_notify_pending` 复合索引）不在 init-db INDEXES 内，恢复/核对时要人工按台账在控制台补。
- **L7 的坑**：①脚本顶部 `$ErrorActionPreference='Stop'` 会把 node 命令的 stderr 转成终止错误 → 调 node 前临时置 `Continue`；②dump-index-ledger.js 成功时只写 stdout 不写 stderr（成功信息走 `process.stdout.write`），否则 Stop 模式下就算文件已生成也会被 catch 误判 FAIL。
- **admin_web_key 若遇网关 401（HTTP 401 空响应体）＝密钥失配**（期间被轮换）。处置：不能靠原 key 重试；①浏览器 admin-web F12 → `localStorage.getItem('admin_web_key')` 取当前有效 key，或 ②init-db 云端测试 `{"action":"generate_admin_web_key","reason":"..."}` 重新生成（注意：需要管理员身份 OPENID 在白名单，且回滚后旧 key 全部失效）。生成返回形如 `AWK-<64hex>`，写库后 `admin_config.admin_web_key_set=true`。
- **36 集合全量**（2026-10-09 实导，含 exam_bank/config_history/no_show_report）：demand 780 / order_main 210 / order_status_log 843 / audit_log 3053 / platform_event 2845 等；三级校验（SHA256 回读 + JSON 可解析 + total==list.Count）异常 0。
- **异地备份（飞书 lark-cli）**：目标 folder_token=`RCsff3kGUlKhpud1KVFckJOhnGc`。`--local-dir` 只能放 cwd/temp/home/files（cwd=c:\zhaoren 用 `C:\zhaoren\.lark-stage`）。流程：`+status` 精确比对 → `+push`（已有文件需 `--if-exists overwrite`，否则 CHECKSUMS 等被反复追加的文件被 skip）→ 再 `+status` 复核全部 unchanged。

## 已知限制

1. **DB 恢复需 import_collection**：restore.ps1 当前只恢复 admin_config，DB 数据恢复需要 admin-action 新增 `import_collection`（逐 collection 清旧数据 + 批量插入）
2. **云存储清单 L4 未实现**：CloudBase HTTP API 列 storage 需要额外鉴权 token，暂未接入
3. **单表 10000 条上限**：export_collection 硬限制，超限 truncated=true，恢复时需手工分页
4. **敏感字段脱敏是展示级**：原数据仍在 CloudBase DB，备份是脱敏后的；真恢复时用未脱敏 admin_config 覆盖
