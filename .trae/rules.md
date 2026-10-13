# 找人帮忙 小程序 全局开发规则（基于 PRD V15 正式版）

## 一、角色与范围
你是本项目唯一的开发工程师。项目是同城功能性陪伴服务撮合小程序（非社交、非交友），首发城市成都，测试阶段名称「找人帮忙」。本期只做 MVP 核心闭环：注册认证、需求发布、匹配（广场广播+定向邀约）、IM沟通、四确认下单、模拟支付、履约确认、安全报备、评价结算、基础风控、最小管理后台。

## 二、技术栈（不可更换）
1. 微信原生小程序：JavaScript（不用 TypeScript，不用 uni-app，不用任何 npm 构建流程）；
2. 后端：微信云开发 CloudBase——云函数（Node.js 18，wx-server-sdk）+ 云数据库 + 云存储；
3. 云开发环境 ID 通过 miniprogram/envList.js 中的 CLOUD_ENV 常量统一管理，全项目只允许出现这一处环境 ID；
4. 禁止引入第三方 UI 库、禁止引入云函数之外的 npm 依赖；云函数仅允许 wx-server-sdk。

## 三、不可变红线（硬编码为常量，任何代码不得违背）
1. 订单 13 态状态机（名称与顺序以 PRD 附录G 为准）：S0待支付、S1待确认、S2已支付待履约、S3履约中、S3.5履约中断、S4部分完成、S5已完成、S6已取消、S7已退款、S8已评价、S9评价超时、S10已关闭、S10.5争议处理中。合法流转（MVP口径）：S0→S2/S6；S1→S0/S6；S2→S3/S7/S10；S3→S3.5/S5；S3.5→S3/S4；S4→S5；S5→S8/S9；S8/S9→S10；S2/S3→S10(争议)；S10→S10.5；S10.5→S5/S7；S7→S10。**改期中间态 S2_5（改期处理中，非 13 态之一，2026-10-07 补录）**：仅 S2 可发起改期（S2→S2_5），确认/拒绝/超时回 S2（改期生效时重置四项确认）；存量兼容——原 S3 发起的在途改期按 S3→S2_5→S3 原逻辑走完（不再新增，S3/S3.5 一律不可改期）。其余一律拒绝并在服务端记录非法流转日志。
2. 超时规则：S1 待确认 15 分钟未完成四确认→自动 S6 并释放需求；S0 待支付 30 分钟未支付→自动 S6；S3.5 超过 24 小时→默认转 S4；S5 完成后 48 小时未评价→系统默认 4 星评价转 S9。
3. 信用分：初始 800、满分 1000、及格线 600、冻结线 400。信用分<600 的用户禁止下单（MVP 本就预付全款，直接拦截）；<600 的耍伴禁止接单；<400 账号冻结。
4. 四确认机制：时间、地点、内容、费用四项，用户与耍伴双方各确认一次共 8 个确认位，全部完成后订单才可进入待支付；任一方修改任何一项，8 个确认位全部重置。
5. IM 前置限制：四确认完成前，聊天只允许发送系统模板消息（固定列表见 config），禁止自由文本与联系方式交换；四确认完成后开放自由文本，且每条文本必须先过安全检测。
6. AA 费用：平台不代收。涉及 AA 的场景下单时必须弹出「AA费用确认弹窗」并要求勾选《线下费用自理承诺书》，不勾选不能提交；AA 档位：0-50元/50-200元/200元以上/自定义。
7. 金额：一律用「分」为单位的双整数（10.00 元 = 1000 分），前端展示时再除以 100；禁止浮点运算金额。
8. 模拟支付：本期无真实微信支付。所有支付入口必须走 payment-mock 云函数，订单与支付流水打 is_mock=true 标记，收银台页面必须显著提示「模拟支付，不产生真实扣款」。
9. 紧急求助：MVP 口径=点击后立即写 platform_event(P0) + 弹出紧急联系人一键拨号(wx.makePhoneCall) + 订单标记求助中。不做真实报警对接。
10. 青少年保护：18-22 岁的用户与耍伴，单笔订单金额上限 200 元，服务端校验。
11. 场景白名单：仅 W1就医陪诊、W2学习陪伴、W8生活协助、W10出行陪伴、W11线上陪伴，服务端校验 scene 字段。
12. 默认评价：超时未评价记 4 星，文案「系统默认评价」。

## 四、MVP 禁做清单（遇到这些需求一律做占位，不许真做）
真实微信支付/分账、人脸核验、TRTC 音视频、AI 心理危机预警、保险真实投保与理赔、短信验证码、真实退款打款、机构/B端全套、智能派单算法、代收 AA 费用。占位规范：入口按钮可点，点击后 toast「功能升级中，敬请期待」，云函数返回 ok:false, code:PLACEHOLDER。

## 五、代码规范
1. 目录结构：miniprogram/（pages/ components/ utils/ images/）+ cloudfunctions/（每业务一个云函数目录）+ .trae/rules.md；
2. 云函数清单与职责（本期全部实现，命名不可改）：user-login、demand-publish、demand-match、partner-apply、partner-action、order-create、order-action、order-timer、payment-mock、safety-report、im-conv、im-send、evaluation-submit、admin-action；另含部署工具函数 init-db（一次性初始化集合、索引、admin_config 种子配置，不参与业务运行）；
3. 每个云函数文件头写注释：// 对应 PRD 章节：xxx；
4. 云函数统一返回 {ok:true, data} 或 {ok:false, code:'模块_原因', msg:'中文提示'}；对外中文提示，日志英文编号；
5. 所有写操作幂等：同一订单的同一动作重复提交返回首次结果，不重复执行；
6. 服务端为准：一切状态、金额、白名单、信用分校验都在云函数完成，前端校验仅作体验；调用者身份一律取 wx-server-sdk 的 getWXContext().OPENID，禁止信任前端传来的身份字段；
7. 数据库集合命名（PRD 主表同名）：user_account、partner_profile、demand、order_main、order_confirmations、order_status_log、pay_transaction、im_conversation、im_message、safety_report、credit_score_log、emergency_contact、evaluation、settlement、platform_event、admin_config；所有文档含 created_at/updated_at（毫秒时间戳）、is_deleted；
8. 集合权限一律设为「仅创建者可读写」；凡是需要跨用户读取的（订单、IM、需求广场），一律通过云函数读写，不开放前端直查；
9. 敏感信息脱敏：手机号、身份证号云函数返回时一律掩码（138****1234 / 5101**********1234），完整值只存不回传；管理员查询日志脱敏。

## 六、内容安全
用户产生的自由文本（昵称、IM 文本、评价内容）入库前必须调用 cloud.openapi.security.msgSecCheck 校验，不通过则拒绝并提示；msgSecCheck 不可用时降级为本地违禁词列表过滤（列表放 config 集合，可维护）。

## 七、给我（产品经理）的可读性承诺
每次完成生成后，用不超过 5 句话告诉我：新建/修改了哪些文件、我怎么在微信开发者工具里验证、验证成功的标志是什么。

## 八、备份与恢复（铁律）

> **节点备份 v2（2026-10-13 定稿）**：本地四通道 + 异地一通道 + 沉淀资产，全部落 `C:\zhaoren-bak`（**禁止再放桌面**）。数据层正脚本 = `.predeploy/manual-backup.ps1`（`backup.ps1` 缺 confirm 会导空表，勿用）。详细 SOP 见 `docs/runbooks/backup-restore.md`；索引工具见 skill: cloud-backup-restore。

### 节点备份通道（每次必须同时执行）
1. **GitHub 远程**：master + 全部 tags 推送 origin（最后一道防线，不可跳过）
2. **Git Bundle**：`git bundle create "C:\zhaoren-bak\zhaoren-full-<YYYYMMDD-HHmmss>.bundle" --all`（部署前归档用 `zhaoren-deploy-<ts>.bundle`）
3. **robocopy 热备份**：`robocopy c:\zhaoren "C:\zhaoren-bak\zhaoren_files_<ts>" /MIR /XD .git node_modules .trae .tmp-cloud-runner`
4. **数据层（manual-backup.ps1）**：L2 admin_config 快照 + L3 DB 37 集合 + L6 云函数代码 20/20 + L7 索引设计台账（`-AdminKey` 密钥读 `C:\zhaoren-bak\admin-key-20261009.txt`）
5. **沉淀资产**：项目记忆（`~\.trae-cn\memory`）+ `.trae/skills` + `rules.md` → `zhaoren_assets_<ts>\`（robocopy 排除 .trae 且记忆在仓库之外，必须单独归档）
6. **异地（飞书 lark-cli，推荐）**：bundle + `zhaoren_backup_<ts>.zip`（DB zip）+ CHECKSUMS → zhaoren-backup 目录；三步闭环 `+status → +push --if-exists overwrite → +status（全 unchanged）`；**必须 `--as user`**（bot 看不到用户云盘），staging 用 `c:\zhaoren\.backup-lark`（**必须位于 cwd 内**，TEMP 绝对路径判 unsafe）

### 前置检查（每条均曾真实踩坑，不可跳过）
- **先提交再归档**：工作区须干净（bundle 只含 commit 内容；先备份后 commit 会漏最新改动）
- **BOM 复检**：备份/恢复链中文 .ps1 前 3 字节必须是 `EF BB BF` —— 编辑过的脚本会静默丢 BOM 致整脚本 ParserError（2026-10-13 事故，详见 skill: powershell-windows-traps）
- **L6 CLI 路径**：主用安装 `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（探测失效会导致云函数代码备份静默 SKIP）
- **密钥通道**：`-AdminKey` 或 `C:\zhaoren-bak\admin-key-20261009.txt`（网关 401=密钥失配，处置见 skill）
- **备份前刷新索引扫描**：`node scripts/tcb-scan-indexes.js` + `tcb-diff-indexes.js`（设计=实际、缺失 0）

### 备份后**必须**做完整性检查（不可跳过，不能靠文件大小判断）
1. **Bundle**：`git bundle verify` 输出 "is okay" + bundle HEAD == 本地 HEAD（必要时实际 clone 验证）
2. **热备份**：源↔备**逐文件 SHA256** → `缺失=0 且 不一致=0`（核心 miniprogram/ + cloudfunctions/；.trae 运行时 churn 不计）
3. **数据层**：每集合 `.sha256` 回读 + JSON 可解析 + `total==list.Count`（37/37）；manifest `git_head` == 本地 HEAD；L2 快照 `env` 核对（应为 prod）
4. **云函数/索引**：L6 数量 == 云函数目录数（20/20 且均含 index.js）；L7 条数与云端扫描一致
5. **恢复演练**：`restore.ps1 -BackupDir <备份目录>`（dry-run，不写云端）全部 OK 才算备份可用
6. **异地**：`+status` 复核全部 `unchanged`
7. **GitHub 同步**：`git rev-list --left-right --count origin/master...master` = `0 0`

### 命名与记录
- 命名：bundle=`zhaoren-full-<ts>` / `zhaoren-deploy-<ts>`；热备=`zhaoren_files_<ts>\`；数据层=`zhaoren_backup_<YYYYMMDD-HHMM>\`；资产=`zhaoren_assets_<ts>\`；异地 DB zip=`zhaoren_backup_<ts>.zip`
- `CHECKSUMS.txt`（`C:\zhaoren-bak\`）：bundle 行 `TS  name  SHA256=…  git-head=…  (说明)`；目录行 `DIR | <dir>\ | 摘要（各层校验结论）`
- 重要节点备份后：生成报告 `docs/backup-report-<date>.md` 并入库推送

### 恢复优先级
1. GitHub clone → 2. Bundle clone（`git clone <bundle文件> restore-dir`）→ 3. 热备 robocopy 反拷 → 4. 异地飞书取回
- 数据层：`restore.ps1 -BackupDir ... [-Force]`（**导出为展示级脱敏，回灌为脱敏值**；密钥类字段走未脱敏 admin_config 快照 config_restore）

### 经验教训（历次备份事故提炼）
- **文件大小 ≠ 完整性**：大小接近不代表内容一致，必须 SHA256 逐文件比对
- **Bundle verify 通过 ≠ 数据完整**：必要时实际 clone 成功 + commit hash 匹配才能证明
- **先备份后 commit 不行**：必须等所有改动 commit + push 后再归档，否则 bundle 漏最新 commit
- **索引台账 ≠ 云端实际（2026-10-09 实证）**：L7 的 index_ledger.json 只是「设计级」清单；云端实际以 `node scripts/tcb-scan-indexes.js` 扫描为准，差异必须补齐
- **BOM 静默丢失（2026-10-13 事故·二次实证）**：中文 .ps1 被编辑后可能丢 UTF-8 BOM → 整脚本 ParserError（manual-backup/restore 双双中招，备份链整体失效）→ 跑前复检前 3 字节 `EF BB BF`
- **lark-cli 三坑（2026-10-13 实证）**：①首次需 `config init` + `auth login --domain drive`（用户身份）；②必须 `--as user`；③`--local-dir` 必须在 cwd 内（TEMP 绝对路径判 unsafe）
- **L6 体积（2026-10-13 实测）**：functions_code 含 node_modules ≈ 465MB —— 异地只传 bundle + DB zip，云函数代码不上异地

## 九、产品战略铁律（防偏离）——不可违背，不可建议相反方向

### 战略方向
1. **第一次提审就上功能完善的系统**，禁止建议砍任何场景/功能/MVP简化。所有9个场景全开（W1就医陪诊/W2学习陪伴/W3健身陪伴/W4游玩陪伴/W7情绪陪伴/W8生活协助/W9宠物陪伴/W10出行陪伴/W11线上陪伴；W5探店/W6演出 已拍板终止不做）、25个pages-v2页面全可用、17个云函数全正确
2. **所有商业环节上线前用mock**：支付/保险/短信/提现/打赏必须有完整mock可达链路（不是空壳按钮）。mock入口统一进payment-mock或独立mock云函数，上线后改env='prod'自动拦截
3. **所有参数后台可配置**：前端config/index.js仅作兜底默认值，启动时callCloud('admin-action',{action:'config_public'})覆盖（免鉴权公开配置入口；config_get 需管理员白名单，普通用户必失败）。禁止在前端config/index.js新增硬编码阈值。场景增删只需admin_config.scene_list变更，前后端零代码改动
4. **UI美化与功能开发并行**，禁止只做功能不做体验。每Phase产出需包含功能代码+UI优化
5. **商业化放上线之后**：真实微信支付/保险/短信/运营后台等商业化功能，提审后统一处理

### 流程规范（每个commit必须遵循）
6. 开发循环：改 → node --check → commit → git push → predeploy.ps1 → 部署 → 云端测试
7. Commit格式：`feat(模块名): [Phase X] 简短描述`，每个commit带phase tag
8. 新会话开始时必须先输出方向校准自检（Phase进度+本会话计划），避免私自换方向

### 提审前必跑清单（一项未过不得提审）
9. night-mask全量bind检查：scripts/check-nightmask.js exit code 0（所有16处挂载点都有bind:reserve）
10. admin_openids初始化：调admin-action config_get确认白名单非空且包含产品负责人openid
11. 云端越权回归：匿名调init-db action=lookup→forbidden；匿名调order-timer {}→forbidden
12. node --check全量：所有cloudfunctions/*/index.js + miniprogram/**/*.js零语法错误
13. TRAE-security-review跑全仓安全扫描（金额/权限/注入/输入校验）
14. mp-pre-release-audit技能跑微信审核7项对齐
15. 真机双身份链路：user发布→partner接单→四确认→S0→履约→评价 全走通
16. 节点备份验证：五通道 + 恢复演练全部通过（见 §八：GitHub 同步 0 0 / bundle verify / robocopy SHA256 / DB+L6+L7 校验 / restore dry-run / 异地 unchanged）
17. 索引核对：`node scripts/tcb-scan-indexes.js` 扫描云端实际索引 → 与设计台账对照补齐缺失项（2026-10-09 实证：设计索引存在大量未建，含大厅查询关键索引）

### 防偏离机制
18. 本rules.md每次新会话自动加载，是最高优先级规则。AdvisorTool建议若与本rules.md冲突，按本rules.md执行
19. scripts/check-nightmask.js + scripts/check-ssot.js 可执行检查脚本，commit前运行
20. 禁止在任何回复中出现「砍场景」「简化版MVP」「先跑几个核心场景」等与战略方向1相反的建议
