# 节点备份报告（2026-10-15）

> **触发**：节点备份（环境配置 / 数据库及索引 / 云函数 / 项目文件 / 沉淀资产）+ 跨会话衔接前归档
> **执行**：AI 会话（工作目录 `c:\zhaoren`），本地三通道 + 沉淀资产副本
> **窗口**：2026-10-15 约 12:10 – 12:50（Asia/Shanghai）
> **代码基线**：`76c462e`（履约双确认阶段 A–G + 凭证前置 + 投诉收口 + §12 规则，本地=远端）

---

## 一、结论摘要

**备份六步全部完成，完整性核验零异常**（含恢复演练 dry-run **39 OK / 0 BAD**）。代码层双保险（bundle + 热备）+ 数据层（配置快照 + 37 集合 + 云函数代码 + 索引台账）+ 沉淀资产副本，全部落 `C:\zhaoren-bak` 并登记 `CHECKSUMS.txt`；**飞书异地第⑥步同日闭环**（三件 push 3/3、复核 exact unchanged）。

| # | 类别 | 产物 | 大小 / 计数 |
|---|---|---|---|
| 1 | 项目文件·代码层 | `zhaoren-full-20261015-121023.bundle`（`--all` 全 refs/tags） | 16.02 MB |
| 2 | 项目文件·文件级 | `zhaoren_files_20261015-121023\`（robocopy 热备） | 31.79 MB / 1178 文件 |
| 3 | 环境配置 | `zhaoren_backup_20261015-1211\admin_config\20261015-1211.json`（+`.sha256`） | — |
| 4 | 数据库 | `zhaoren_backup_20261015-1211\db\`（37 集合，各含 `.sha256`） | 7.75 MB |
| 5 | 云函数 | `zhaoren_backup_20261015-1211\meta\functions_code\`（20/20 云端下载） | 465.12 MB |
| 6 | 索引 | `meta\index_ledger.json`（设计 33 条，SHA 匹配） | — |
| 7 | 沉淀资产 | `zhaoren_assets_20261015-124810\`（memory 全树 + .trae 全量） | 2.66 MB / 136 条目 |
| 8 | 异地·飞书 | zhaoren-backup 云空间（folder_token `RCsff3kGUlKhpud1KVFckJOhnGc`）：bundle + `zhaoren_backup_20261015-1211.zip`（37 集合+admin_config+索引台账+manifest，**不含 functions_code**）+ CHECKSUMS.txt | 16.79 MB + 1.02 MB + 7.7 KB |

---

## 二、备份范围与明细

### 1. 环境配置（L2，admin_config 快照）

- 产物：`zhaoren_backup_20261015-1211\admin_config\20261015-1211.json`（+`.sha256`）
- SHA256：`62a5750b5aad2933f1515802a9965e256da558c648fbd058a529b5bf4684f68d`，重算比对 **OK**
- 结构：`{config, git_short, git_head, exported_at}`；关键值 **`config.env=prod`**、`version=V15-MVP`、`git_head=76c462eb58644461b1bc9abb3783fd6a030216a7`
- 说明：未脱敏版本，供 `restore.ps1 → config_restore` 恢复使用

### 2. 数据库（L3，37 集合全量）

- 导出通道：admin-web 网关 → `admin-action.export_collection`（`confirm:true`，page_size=100 分页）
- 覆盖：**37/37 集合零跳过**；manifest 37 项与磁盘 37 个 JSON **双向 Compare-Object 差集为空**
- 逐集合四项核验全过：JSON 可解析、`total == list.Count`、`truncated=False`、`collection == 文件名`；重算 SHA256 与 sidecar **37/37 一致**
- 数据量级（非空 25 个）：`audit_log` 5205 / `platform_event` 4537 / `system_notice` 1224 / `order_status_log` 1038 / `demand` 838 / `im_message` 690 / `disclaimer_signature` 360 / `order_main` 236 / `order_confirmations` 234 / `im_conversation` 153 / `demand_draft` 93 / `credit_score_log` 84 / `evaluation` 75 / `safety_report` 77 / `config_history` 37 / `user_account` 29 / `blog_post` 15 / `withdraw_record` 15 / `emergency_contact` 11 / `blog_comment` 10 / `blog_like` 9 / `partner_profile` 5 / `no_show_report` 5 / `exam_bank` 3 / `admin_config` 3
- 空集合（12 个，正常）：`admin_web_sessions`、`complaint`、`credit_log`、`device_bind`、`dispute`、`insurance_record`、`partner_apply`、`partner_exam`、`report`、`sms_log`、`user_profile`、`withdraw_request`
- ⚠️ 特性提醒：DB 集合导出为展示级脱敏产物（回灌为脱敏值）；密钥类字段恢复须用未脱敏 admin_config 快照走 `config_restore`

### 3. 索引（L7，设计台账）

- `meta\index_ledger.json` **33 条**（`dump-index-ledger.js` 从 init-db `INDEXES` 提取）
- SHA256：`5fe6c74bb7608c1b9512d41151e62f33ccea853110b9f5da86bdb91a4ac1b3b3`，与 sidecar 一致
- 本轮**未做** tcb 云端实测重扫（10-13 已实测设计 33 / 已建 33 / 缺失 0；本轮无索引变更，见 §六 已知边界）

### 4. 云函数（L6，云端下载实际部署版本）

- 产物：`meta\functions_code\<fn>\`（含 node_modules，20 个函数目录）
- **20/20 均含 `index.js`**，0 缺失；总体积 465.12 MB
- **增强核验（本轮新增）**：逐函数与本地仓库 `c:\zhaoren\cloudfunctions\<fn>` 比对（排除 node_modules）：
  - 19/20 函数逐文件 SHA **完全一致**；
  - `payment-mock\index.js` 字节差 186 B，定位为**行尾差异**（云端下载件 186 个 LF，本地 186 个 CRLF），LF 归一化后内容与 SHA **完全相同**——非代码漂移
  - 结论：**云端实际部署代码 == git HEAD `76c462e` 全部 20 函数**
- 运行注记：L6 在日志处约 18 分钟无新增输出（12:13→12:31），疑似卡住，实测为 20 函数（含 node_modules）慢速下载，进程正常退出、20/20 齐全（12:32 DONE）

### 5. 项目文件（代码层与文件级双备份）

- **git bundle**：`zhaoren-full-20261015-121023.bundle`（`--all`，含全部 branches/tags/历史）
  - `git bundle verify` → **is okay / complete history**，bundle 内 HEAD = `76c462e`
  - SHA256：`b10509f713993af707f588824727e3fd06c531933b02fb9e6690e6f86fcb33a6`（已登记 CHECKSUMS.txt，本轮重算一致）
- **robocopy 热备**：`zhaoren_files_20261015-121023\`（`/MIR`，排除 `.git / node_modules / .trae / .tmp-cloud-runner`）
  - 复制统计：**1178/1178 文件、失败 0**、31.79 MB（robocopy exit 1 = 正常"有复制"）
  - **源↔备逐文件 SHA256：比对 1178，缺失 0、不一致 0**
  - 源端另有 59 个 `.trae\` 文件不在热备内——属 `/XD .trae` **设计排除**（由沉淀资产通道覆盖）；`.git` 由 bundle 覆盖、`node_modules` 可再生

### 6. 沉淀资产（`zhaoren_assets_20261015-124810\`）

- `memory\`：记忆全树（77 文件，2.2 MB），含本项目 `projects\-c-zhaoren--p2-…\20260929→20261015` 各日 session 记忆、`project_memory.md`、`user_profile.md`
- `trae\`：**.trae 全量**——23 个 skills 目录、`rules\`（2 文件：`project_rules-20261013.md`、`miniprogram-config-guard.md`）、documents、scripts 及 7 个根文件（`handoff-prompt.md`、`rules.md`、`zz-registry.md` 等）
- `SHA256SUMS.txt`：136 条目（相对路径 + SHA256），**重算 136/136 一致、0 bad**

---

## 三、完整性核验总表

| 核验项 | 方法 | 结果 |
|---|---|---|
| git bundle | `git bundle verify` + HEAD 比对 + SHA 重算 | ✅ is okay / complete history / HEAD=76c462e |
| robocopy 热备 | 源↔备逐文件 SHA256（1178 个） | ✅ 1178/1178，缺失 0 / 不一致 0 |
| DB 导出 | SHA256 + JSON 解析 + total/count + truncated + 名称 | ✅ 37/37，0 异常；manifest 双向一致 |
| 配置快照 | SHA256 + env 对照 | ✅ OK / env=prod / V15-MVP / git_head=76c462e |
| 云函数代码 | index.js 存在性 + 与本地 HEAD 逐文件内容比对 | ✅ 20/20；19 完全一致 + 1 仅行尾差 |
| 索引 | 台账 SHA + 条数 | ✅ 33 条，SHA 匹配（云端重扫本轮未做） |
| 沉淀资产 | SHA256SUMS 重算 | ✅ 136/136，0 bad |
| **恢复演练** | `restore.ps1` dry-run（不写云端） | ✅ **39 OK / 0 BAD** |
| 异地 | lark-cli `--as user` 三步闭环（exact SHA 比对） | ✅ +status 差异 3 → +push uploaded 2/overwritten 1/失败 0 → +status 全 unchanged |

---

## 四、恢复指引（如需）

1. **代码层**：`git clone C:\zhaoren-bak\zhaoren-full-20261015-121023.bundle`；文件级 `robocopy C:\zhaoren-bak\zhaoren_files_20261015-121023 <目标> /MIR`
2. **配置/数据恢复**：`.predeploy\restore.ps1 -BackupDir C:\zhaoren-bak\zhaoren_backup_20261015-1211`（默认 dry-run；`-Force` 真恢复，密钥取 `C:\zhaoren-bak\admin-key-20261009.txt`，整文件即密钥本体需 `.Trim()`）
3. **云函数**：`meta\functions_code\` 为云端实际部署版本快照（与 HEAD 76c462e 内容一致），可直接对目录重新部署
4. **沉淀资产**：`zhaoren_assets_20261015-124810\` 回拷 memory 树与 `.trae`（用 `SHA256SUMS.txt` 校验）
5. **异地取回**：飞书「zhaoren-backup」云空间目录（bundle token `MVg7bL2HJolYocxiaA0cs6znn1b` / DB zip token `XT9Rbe1RZoZUvCxstk0cAxBGnoe` / CHECKSUMS token `F0T8biqZooN0ilx5A7oct3MunCg`）；远程另有 7 个历史包（10-07/10-09/10-13 期，保留未删）

---

## 五、记录与登记

- **CHECKSUMS.txt**（`C:\zhaoren-bak\`）：bundle 1 行（备份时已登记，本轮重算复核）+ 新增 3 条 DIR 行（backup / files / assets）
  - 操作教训：PS5.1 `Add-Content -Encoding ASCII` 会把中文直接写成字面 `?`，已改用 UTF-8 无 BOM 重写修复（与该文件既有编码一致）
- 备份日志：`C:\Users\DC\AppData\Local\Temp\manual_backup_20261015.log`（37 集合 [OK] + L6 20/20 + L7 33 + DONE）

---

## 六、已知边界（如实登记）

1. 索引仅做设计台账核验，未做 tcb 云端实测重扫（10-13 实测 33/33 之后无索引变更）
2. `functions_code`（465 MB 含 node_modules）**不传异地**（异地 zip 已排除）：云端持有部署代码、bundle 覆盖源码、node_modules 可再生
3. DB 集合导出为展示级脱敏产物；密钥类字段需以未脱敏 admin_config 快照恢复
4. L6 下载耗时约 20 分钟属正常（含 node_modules），日志长时静默不代表卡死，判活看 `functions_code\<fn>\` 文件数增长
5. 飞书目录保留 7 个历史包（10-07/10-09/10-13 期），本次未清理（保留策略待定）

---

*报告生成：2026-10-15 · 事实来源：本次会话各步骤实测输出（路径、SHA、计数均为现场实测值）*
