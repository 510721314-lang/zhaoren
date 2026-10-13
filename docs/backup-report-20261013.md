# 节点备份报告（2026-10-13）

> **触发**：节点备份（环境配置 / 数据库及索引 / 云函数 / 项目文件 / 沉淀资产）
> **执行**：AI 会话（工作目录 `c:\zhaoren`），本地三通道 + 飞书异地托管
> **窗口**：2026-10-13 约 14:41 – 15:40（Asia/Shanghai）
> **代码基线**：`f18d2d0`（备份期间含当日全部提交：留存负债闭环 `0b2d061`、deploy-log `f608d15`、备份链脚本修复 `f18d2d0`）

---

## 一、结论摘要

**全部完成，完整性核验零异常**（含恢复演练 dry-run 39 OK / 0 BAD）。本次为「节点级全量备份」：代码层双保险（bundle + 热备）+ 数据层（配置快照 + 37 集合 + 云函数代码 + 索引台账）+ 沉淀资产副本 + 飞书异地托管，全部落 `C:\zhaoren-bak` 并登记 `CHECKSUMS.txt`。

| # | 类别 | 产物 | 大小 |
|---|---|---|---|
| 1 | 项目文件·代码层 | `zhaoren-full-20261013-144705.bundle`（`--all` 全 refs/tags） | 15.6 MB |
| 2 | 项目文件·文件级 | `zhaoren_files_20261013-144903\`（robocopy 热备） | 11.1 MB / 915 文件 |
| 3 | 环境配置 | `zhaoren_backup_20261013-1441\admin_config\`（快照） | — |
| 4 | 数据库 | `zhaoren_backup_20261013-1441\db\`（37 集合，各含 `.sha256`） | 7.2 MB |
| 5 | 云函数 | `zhaoren_backup_20261013-1441\meta\functions_code\`（20/20 云端下载） | 464.6 MB |
| 6 | 索引 | `meta\index_ledger.json`（设计 33 条）+ 云端实测扫描 33/33 | — |
| 7 | 沉淀资产 | `zhaoren_assets_20261013-145007\` | 79 文件 |
| 8 | 异地·飞书 | zhaoren-backup 云空间：bundle + `zhaoren_backup_20261013-1441.zip` + CHECKSUMS.txt | 16.3 MB + 0.9 MB |

另：**前置修复 3 项**（备份链脚本 BOM 丢失事故、L6 CLI 路径过时、6 个存量脚本 BOM 补齐），详见 §五 —— 不修则本次备份的脚本部分整体不可用（详见）。

---

## 二、备份范围与明细

### 1. 环境配置（L2，admin_config 快照）

- 产物：`zhaoren_backup_20261013-1441\admin_config\20261013-1441.json`（+`.sha256`）
- 核验：SHA256 比对 **OK**；关键值对照 **`env=prod`**（mock 门控关闭，fail-closed 口径正确）；快照内含 `git_head=f18d2d0`
- 说明：该快照为**未脱敏**版本，供 `restore.ps1 → config_restore` 恢复使用

### 2. 数据库（L3，37 集合全量）

- 导出通道：admin-web 网关 → `admin-action.export_collection`（`confirm:true`，page_size=100 分页）
- 覆盖：37/37 集合**零跳过**；每集合含 `total/truncated/list` 与独立 `.sha256`
- 核验：37/37 SHA256 比对 OK、JSON 全可解析、`total == list.Count` 零不一致
- 数据量级（非空集合）：`audit_log` 4777 / `platform_event` 4361 / `order_status_log` 949 / `system_notice` 983 / `demand` 823 / `im_message` 626 / `disclaimer_signature` 329 / `order_main` 222 / `order_confirmations` 220 / `im_conversation` 139 / `demand_draft` 92 / `safety_report` 77 / `credit_score_log` 76 / `evaluation` 67 / `config_history` 33 / `user_account` 29 / `blog_post` 15 / `withdraw_record` 15 / `emergency_contact` 11 / `blog_comment` 10 / `blog_like` 9 / `partner_profile` 5 / `no_show_report` 5 / `exam_bank` 3 / `admin_config` 3
- 空集合（正常，幽灵集合/无数据）：`admin_web_sessions`、`user_profile`、`partner_exam`、`partner_apply`、`dispute`、`withdraw_request`、`credit_log`、`insurance_record`、`report`、`sms_log`、`device_bind`、`complaint`
- ⚠️ 特性提醒：DB 集合导出为**展示级脱敏产物**（回灌为脱敏值）；密钥类字段恢复须用未脱敏的 admin_config 快照走 `config_restore`

### 3. 索引

- 设计台账（L7）：`meta\index_ledger.json` **33 条**（`dump-index-ledger.js` 从 init-db `INDEXES` 提取），SHA256 比对 OK
- 云端实测（tcb 直连通道）：`tcb-scan-indexes.js` 全量扫描 + `tcb-diff-indexes.js` 对比 → **设计 33 / 已建 33 / 缺失 0**
- 结论：设计=实际，零缺口（`create-missing.json` 生成 0 条）

### 4. 云函数（L6，云端下载实际部署版本）

- 产物：`meta\functions_code\<fn>\`（含 node_modules，逐函数独立目录）
- 覆盖：**20/20**（= 本地 `cloudfunctions` 含 `index.js` 的函数目录数），每个函数均含 `index.js`，0 缺失
- 本次为**首度无需人工补齐**的一次 L6：CLI 路径修复后自动命中主用安装（详见 §五）

### 5. 项目文件（代码层与文件级双备份）

- **git bundle**：`zhaoren-full-20261013-144705.bundle`（`git bundle create --all`，含全部 branches/tags/历史）
  - `git bundle verify` → **"is okay" + "complete history"**，bundle 内 HEAD = `f18d2d0`（与本地一致）
  - SHA256：`975864142BB8CE58465E9F9D3EA485EC652AA7A2B21109538B99DF7E85568377`
- **robocopy 热备**：`zhaoren_files_20261013-144903\`（`/MIR`，排除 `.git / node_modules / .trae / .tmp-cloud-runner`）
  - 复制统计：文件 915/915、失败 0；目录 138（132 复制 + 6 已存在）
  - **逐文件 SHA256 源↔备比对：已比对 915，缺失 0，内容不一致 0**

### 6. 沉淀资产（`zhaoren_assets_20261013-145007\`）

- `memory\`：项目记忆树（`projects\-c-zhaoren--p2-…`，20260929→20261013 各日 session 记忆 + `project_memory.md`）+ `user_profile.md`，共 22 文件
- `trae\`：22 个 skills 目录 + `rules.md`（robocopy `/E`，排除 cache）
- `SHA256SUMS.txt`：资产文件级 SHA256 清单（79 文件全部纳入）
- 说明：`.trae` 被 robocopy 排除且记忆目录在仓库之外，故单独落盘归档（skills 同时在 git bundle 内双保险）

### 7. 异地托管（飞书 zhaoren-backup）

- 通道：lark-cli（用户身份 `--as user`），三步闭环：`status`（比对）→ `push --if-exists overwrite` → `status`（复核）
- 上传 3 件（`folder_token=RCsff3kGUlKhpud1KVFckJOhnGc`）：
  - `zhaoren-full-20261013-144705.bundle` → uploaded（16,323,903 B）
  - `zhaoren_backup_20261013-1441.zip`（DB 导出 zip：db 37 集合 + admin_config + meta 台账 + manifest）→ uploaded（948,470 B）
  - `CHECKSUMS.txt` → overwritten（5,661 B）
- 复核：再次 `+status` → **全部 unchanged、new_local=0、modified=0**（远程另有 5 个历史包：10-07/10-09 期，保留不回删）

---

## 三、完整性核验总表（三通道 + 演练）

| 核验项 | 方法 | 结果 |
|---|---|---|
| git bundle | `git bundle verify` + HEAD 比对 | ✅ is okay / complete history / HEAD=f18d2d0 |
| robocopy 热备 | 源↔备逐文件 SHA256 | ✅ 915/915，缺失 0 / 不一致 0 |
| DB 导出 | 每集合 SHA256 + JSON 解析 + total/count | ✅ 37/37，0 异常 |
| 配置快照 | SHA256 + env 对照 | ✅ OK / env=prod |
| 云函数代码 | 数量与 `index.js` 存在性 | ✅ 20/20，0 缺失 |
| 索引 | 台账 SHA + 云端全量扫描 diff | ✅ 33/33，缺失 0 |
| 沉淀资产 | 结构核对 + SHA256SUMS 清单 | ✅ 79 文件 |
| **恢复演练** | `restore.ps1` dry-run（不写云端） | ✅ **39 OK / 0 BAD** |
| 异地 | lark status 复核 | ✅ unchanged |

---

## 四、恢复指引（如需）

1. **代码层**：`git clone C:\zhaoren-bak\zhaoren-full-20261013-144705.bundle`（或 `git bundle verify` 后从本地仓库恢复）；文件级可用 `robocopy <热备目录> <目标> /MIR` 还原
2. **配置恢复**：`.predeploy\restore.ps1 -BackupDir C:\zhaoren-bak\zhaoren_backup_20261013-1441`（默认 dry-run；`-Force` 真恢复，仅 admin_config + 按需 import_collection 回灌）
3. **云函数**：`meta\functions_code\` 为云端实际部署版本快照，可直接对目录重新部署
4. **异地取回**：飞书「zhaoren-backup」云空间目录（bundle / DB zip / CHECKSUMS 三件）

---

## 五、前置修复（风险处置，均为 10-13 早间改动引入的存量隐患）

### 1. PS5.1 BOM 丢失事故（关键）

- **发现**：`manual-backup.ps1` 与 `restore.ps1` 的 UTF-8 BOM 丢失 → PS5.1 按 GBK 解析中文 → **整脚本 ParserError 不可执行**（备份链整体失效；两者于 10-13 早间的改动中丢失 BOM，10-10 曾修复过一次，属复发）
- **连带**：`manual-backup.ps1` 的 L6 CLI 探测仍为旧桌面路径（主用安装已改为 `C:\Program Files (x86)\Tencent\微信web开发者工具`，桌面旧拷版已移入 `Desktop\工具\`）→ 即使脚本能跑，云函数代码备份也会**静默 SKIP**
- **修复**：两者补回 BOM（前 3 字节 `EF BB BF`）+ L6 补 3 条候选路径（含主用安装），`ParseFile` 全 0 错 → 提交 `f18d2d0`
- **全仓扫描**：另有 6 个「含中文且无 BOM」脚本（`.trae/predeploy.ps1`、`.trae/scripts/scan-miniprogram.ps1`、`_shared/sync-openid.ps1`、`_shared/sync-security-policy.ps1`、`scripts/build-admin-web.ps1`、`tests/ui-consistency.test.ps1`）—— 当前可解析（仅文案乱码风险），本次一并补齐 BOM（`ParseFile` 0 错 + `check-shared-sync` 全绿）→ 提交 `aa51d43`
- **沉淀**：skill `powershell-windows-traps` 补二次实证注记（**改写中文 .ps1 后必须复检前 3 字节**）；runbook `backup-restore.md` §4 按实测修正（`--as user`、staging 必须位于 cwd 内、首次配置流程）→ 提交 `fd965c7`

### 2. 本次即刻验证修复有效

- L6 首次全自动 20/20（无需人工补齐；对比 10-09 记录 "20/20(L6 手动补齐)"）
- `restore.ps1` dry-run 正常执行并 39 OK/0 BAD（修复前该脚本无法启动）

---

## 六、记录与登记

- **CHECKSUMS.txt**（`C:\zhaoren-bak\`）：新增 1 条 bundle 行（SHA256 + git-head） + 3 条 DIR 行（backup / files / assets）
- **项目记忆**：节点备份完成记录 + BOM 事故实证 + 飞书通道打通常识（含 `--as user`、staging 约束、folder_token）
- **git 提交**（已推 origin，`rev-list 0 0`）：`f18d2d0`（备份链脚本修复）→ `aa51d43`（6 脚本 BOM + skill 注记）→ `fd965c7`（runbook 修正）
- **staging 保留**：`c:\zhaoren\.backup-lark\`（与飞书目录对应的本地镜像，已被 `.backup-*/` gitignore 覆盖，不影响仓库卫生）

---

## 七、已知边界（如实登记）

1. `functions_code`（464.6 MB，含各函数 node_modules）**未上传异地**：云端本身持有所部署代码、git bundle 已覆盖源码、node_modules 可再生；如需异地冗余后续可单独打包"去 node_modules"版本
2. DB 集合导出为展示级脱敏产物（回灌含脱敏值）；密钥类字段需以未脱敏 admin_config 快照恢复
3. 飞书目录保留 5 个历史包（10-07/10-09 期），本次未清理（保留策略待定）
4. `emergency_contact.phone` / `demand.contact_phone` 仍为明文（既有拍板口径，见 P0-3 残留登记）

---

*报告生成：2026-10-13 · 事实来源：本次会话各步骤实测输出（路径、SHA、计数均为现场实测值）*