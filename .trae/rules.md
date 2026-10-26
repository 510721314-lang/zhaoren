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
21. 提审冻结期（C-3.22）：业务代码零改动；缺陷修复须新立项 + 用户批准 + 递增版本号；docs 改动留 T-7.27 统一提交
22. **HANDOFF 一律补丁格式禁止整体重写**（2026-10-24 实证新增）：v8 draft1 全文覆写把 v7 的 C-3.11~3.28（18 条约束）、C-4.14~4.26（13 条工具链）、E-6.1~28（33 条经验）全部丢失，被 Expert B 第一轮评审抓出。下次更新 HANDOFF 必须先建「上一版全编号逐项状态映射表」（present/作废/转移），present 项留在上一版正文、新稿只追加增量。详见 §十二

## 十、CloudBase 与 CLI 实战坑（多轮会话沉淀，逐条曾真实踩坑）

### tcb CLI 传 JSON 参数
1. **PowerShell 直接跑 `tcb db nosql execute -c 'JSON'` → 引号转义丢双引号 → InvalidParam**。**唯一正确姿势**：node `spawnSync('node', [tcbBin, 'db','nosql','execute','-c', '原始JSON字符串', '-e', envId, '--json'])`，args 数组直接放 JSON 字符串，完全绕开 PS 转义。tcbBin 路径 = `C:\Users\DC\AppData\Roaming\npm\node_modules\@cloudbase\cli\bin\tcb`
2. **listIndexes 命令名坑**：`{"indexes":"xxx"}` → CommandNotFound；正确是 `{"listIndexes":"xxx"}`。aggregate 必须带 `"cursor":{}` 子句，否则 CloudBase 不报数据
3. **wx-server-sdk 无 createIndex API**：`init-db/index.js` 里声明的 `{unique:true}` 只是**设计意图**，不代表线上已建。**唯一可信的索引验证**：tcb CLI `listIndexes` 引擎回执（看 `results[0].map(i => i.name + ' unique=' + i.unique)`）。unique 索引缺失时，MongoDB 不会抛 E11000，应用层 dup-key 重试成死代码

### 数据查询口径
4. **aggregate + $group count>1 查重**：`[{"$group":{"_id":"$order_no","c":{"$sum":1}}},{"$match":{"c":{"$gt":1}}},{"$limit":1}]` → 空结果 = 全唯一。用于验证唯一索引是否有"立功机会"
5. **admin_config.global 关键字段**：mock_payment_enabled / env / auto_approve_partner / realname_face_mode 用 projection 查询可能未返回（应为未显式设置）。读不到时用 find（不带 projection）全量读取
6. **admin_openids 为空数组 = bootstrap 开放**：任意首个调用者自动成为管理员 → 提审前必须确认非空

### PowerShell 编码连环坑
7. **curl.exe stdout 捕获按 [Console]::OutputEncoding 解码**：中文机 GB2312/936 解码 UTF-8 JSON → 乱码吞闭合引号 → ConvertFrom-Json 报 `(239)` / null → 所有 6 项判据全 false。修复 = `curl -o 临时文件` + `Get-Content -Raw -Encoding UTF8`
8. **中文 .ps1 被编辑后可能丢 UTF-8 BOM** → 整脚本 ParserError。跑前必须复检前 3 字节 `EF BB BF`（备份链曾因此整体失效）

### 前端导航
9. **navigateTo 失败兜底覆盖率**：所有 `wx.navigateTo/redirectTo/reLaunch/switchTab` 调用必须含 `fail: () => wx.showToast(...)`；动态 url（运营位配置）必须补 fail 兜底，指向已注册路由（index/publish/login 等 app.json 注册页）时 wx 几乎不会失败，但动态运营位可能配旧版遗留路径
10. **退出登录类清理必须双通道**：`wx.removeStorageSync('userInfo')` 后必须补 `getApp().clearLoginUser()` 同步 globalData，否则 `bootstrap.isLoggedIn()` 短暂仍返回 true → 重进"我的"页显旧用户态

### nosql execute / dump 进阶（2026-10-24 实证追加）
11. **nosql dump 返回 NDJSON**：每行一个 JSON 对象 → 必须按 `\n` split 后每行 parse（`lines.map(l => JSON.parse(l))`）；直接 `JSON.parse(content)` 必炸 `Unexpected non-whitespace character after JSON at position X`
12. **nosql execute 最稳姿势（2026-10-26 实测修正）**：**在 `.cjs` 脚本里 `spawnSync(cliFullPath, argsArray, {shell:true})`**，args 数组直接放 JSON 字符串（不是拼 shell 命令）。cliFullPath = `C:\Users\DC\AppData\Roaming\npm\cloudbase.cmd`（Test-Path=True；`Administrator` 旧路径已不存在）。**实测：`shell:false` 对 `.cmd` 直接抛 EINVAL，`shell:true` 才可执行（CLI 3.8.3）**。PowerShell 引号吞 stdin 必炸，`.cjs` + args array 是唯一正确姿势
13. **nosql UPDATE 是全量文档匹配**：`update: admin_config` + `q: {}` 匹配集合中所有文档；admin_config 集合只有 1 条 `_id: "global"` → 安全。集合有多条时必须指定具体 q，禁止 `q: {}` 全量更新
14. **cloudbase CLI 3.8.x 用 `--env-id`（带连字符，本机实测 3.8.3）**：旧 `--envId` 打 warning 但还能跑；统一用 `--env-id`
15. **wx-server-sdk 本地装后无凭据**：`cloud.init()` 后 `db.collection().get()` 抛 `missing secretId or secretKey`；**CLI 自带已登录凭据**，用 dump/nosql execute 绕开，不需要 tcb login 再调 sdk
16. **用量治理与业务有效性门（2026-10-26）**：触发器可能「标准 + 微信云开发」双份并存（`config.json` 置空不删线上）、轮询应「聚合 + 增量 + 省写」、文件完整性校验不等于签名有效性 → **详见 `project_rules-20261013.md` §30（单一事实源，本节不重复）**

## 十一、前端大文件拆分铁律（2026-10-24 评估实证）

> 背景：order-detail.js 1379 行 + publish.js 1122 行 + chat.js 847 行，评估后发现：纯函数抽取已完成 90%（4 个 utils 模块），剩余 62% 业务编排强耦合 this.data → 硬抽反增复杂度

### 约束与正确动作
1. **Page() 对象不支持 mixin**：方法必须定义在 Page 字面量上，不能 import 外部函数再挂进去。"纯函数抽离"仅限**完全不依赖 this.data / this.setData / callCloud** 的纯逻辑
2. **不可抽的 62% 业务编排主链**：26 个事件处理方法同时依赖 `this.data` 2–12 字段 + `this.setData` 1–3 次 + `callCloud` 1–4 次 → 强耦合，硬抽后参数包反而更难读
3. **唯一值得抽的通用组件**（跨 6+ 页复用）：`_modal`（页级操作互斥锁）→ `utils/unlock-modal.js`；`_showCallSheet`（紧急联系人卡片组装）→ `utils/sos.js`；其余 2-8 行跳转/占位方法抽出去反增 import 成本
4. **提审前只做分区注释**：零语法风险，可读性翻倍。模板：`// ── §N 分组标题 (包含的方法列表) ──`

### 已外移模块（order-detail 拆分里程碑 1-4 全部完成）
- `utils/geo-wx.js`：定位判定 evalFulfillGeo / 采集 collectStartLocation / 逆地理 addrOf
- `utils/order-evidence.js`：证据采集 collectStartEvidence / 上传 uploadStartPhotos + uploadEvidenceOne
- `utils/order-poll.js`：clearTimers / startTipPoll / stopTipPoll / onTipNoticeTap / startCountdown / fetchTipList
- `utils/order-view.js`：computeNextStep / pad / buildModifyTs / buildPrepCountdown / buildOrderView / fmtNoticeTime

### 提审后续作（独立立项）
- A10 发布表单快照（已完成 commit 7dd136c，25 行）
- A11/B13 发布/入驻继续横幅（已完成 commit 见 CHANGELOG）
- P3-1 空 catch 窄类（约 20 处，补 log.d）
- P3-12 order-timer 扫描索引（platform_event / audit_log / order_main 建 idx_status_id）
- _modal + _showCallSheet 抽到 utils

## 十二、HANDOFF 防丢条目铁律（2026-10-24 实证 · 常驻机制）

> 背景：v8 draft1 因擅自「全文覆写」丢失 v7 共 **64 条**（C-3.11~3.28 18 + C-4.14~4.26 13 + E-6.1~28 33）；Expert B 第一轮评审才抓出；draft2 改为补丁格式后才通过。

### 规则（必须全部遵守）
1. **HANDOFF 一律补丁格式，禁止整体重写**。新稿（vN+1）必须叠加在上一版（vN）之上：新稿开头第一行 `用法：先读 vN 全文，再读本补丁；新稿只更新过时基线 + 追加增量 + 标记已完成/作废项；vN 未被标记作废的条目全部继续有效`。绝不能把上一版 C-3.x / C-4.x / E-6.x 正文完整复制进新稿造成膨胀，也绝不能直接重写。
2. **起草前必须先建「上一版全编号逐项状态映射表」**。列头：`上一版编号 / 内容 / 本版状态（present / 已完成 / 作废 / 转移至本版编号 / 顺延独立立项）/ 去向`。映射表必须覆盖上一版所有编号范围：T-0.x、C-3.x、C-4.x、E-6.x、T-7.x。**映射表是起草的前置门禁**——没建映射表就动手写正文 = 阻断交付。
3. **present 项不重写正文**。映射表标 present 的条目，正文只写"继承 vN 原文（编号 xxx）"并在上一版文件中保留；新稿只给过时数字写"替换值"、给新增内容追加新编号。
4. **起草后必须跑 diff-check**：枚举上一版全部编号，逐项在新稿中验证——要么找到"继承"引用、要么映射表标"已完成/作废/转移/顺延"、要么新稿正文出现该编号。**三个选项之外无落点 = 阻断交付**。diff-check 可用可执行脚本 `node scripts/check-handoff-coverage.js <上一版路径> <新稿路径>`（2026-10-24 落地，自动识别补丁格式、枚举编号、分类落点，exit 0=全绿，exit 1=阻断）。
5. **双专家评审必须包含 diff-check**：Expert B 的"完整性/偏离"维度必须显式跑 diff-check——以上一版全编号清单为核对基准，新稿中无 present/作废/转移/顺延四种落点之一的编号即列为严重缺陷。评审前把映射表和上一版全编号清单一同发给 Expert B 作为核对基准。

### 快速参考：编号体系
- `T-0.x` 开场回执校验（硬指标）
- `C-3.x` 业务约束/红线
- `C-4.x` 工具链约定
- `E-6.x` 经验教训
- `T-7.x` 待办/任务
- **新增编号** 只在当前 HANDOFF 内递增，不跨会话延续；跨会话映射必须用 vN→vN+1 显式转移

### 交付前 Checklist
- [ ] 映射表已建立且覆盖上一版所有编号范围
- [ ] diff-check 全绿（每项都有 present/作废/转移/顺延 四种落点之一）
- [ ] 新稿开头第一句声明"先读上一版全文"
- [ ] Expert B 评审包含 diff-check 且全绿
- [ ] 映射表写入新稿正文（§1）
- [ ] 上一版文件完整保留不删除

## 十三、MCP / miniapp / Trae MCP 实战坑（2026-10-24 首轮 E2E 实证）

> 背景：首次接入 `@creatoria/miniapp-mcp`（miniprogram-automator MCP 封装）连踩 8 个坑，从"配置了 MCP server 但进程秒退、Connection closed"到 "6 核心页 navigate 全通"历时 3 小时

### miniapp-mcp 包本身
1. **入口文件选错必炸**：包用 ESM（`"type": "module"`），`dist/index.js` 是**纯导出模块** `export { startServer }`，直接 `node dist/index.js` → 什么都不做 → 立即 exit → Trae 报 `Connection closed`。**真正 bin 入口是 `dist/cli.js`**（内部调 `startServer()` 启动 stdio 监听）。这个坑让 agent 连续两次判"MCP server 没注册"，实际只是入口文件写错
2. **miniprogram_screenshot filename 不能含路径分隔符**：`"home.png"` ✅，`"C:\zhaoren\home.png"` ❌（报 `Filename must not contain path separators`）。截图文件存 server 默认目录（`.mcp-artifacts/session-xxx/`）
3. **miniprogram_launch vs connect 在 Windows 的选择**：`launch({cliPath, projectPath})` 内部调 cli.bat 的路径解析有坑（EINVAL）→ 进程秒退。**两步走方案**：先手动 `cli.bat auto --project <path> --auto-port 9420` 起 IDE → 再 `miniprogram_connect({port: 9420})`。automator.connect 不需要 launch，有完整的 navigateTo/switchTab/reLaunch/assert
4. **E2E tabBar 路由方法不同**：tabBar 页（index/square/message/profile）用 `switchTab`；非 tabBar 页（publish/workbench/order-detail）必须 `navigateTo`。workbench 误判用 switchTab 报 `Uncaught [object Object]`

### Trae MCP 平台规则
5. **Trae MCP 自动加 mcp_ 前缀**：GUI 里注册 `"weapp-test"` → `run_mcp` 实际可用名 = `"mcp_weapp-test"`。server_name 参数必须写 **`mcp_weapp-test`** 而不是 `weapp-test`
6. **Trae `.trae/mcp.json` 是受限文件**：Agent 不能 Write/Edit 写入 `.trae/mcp.json`。**唯一办法**：用户在 Trae GUI（设置 → MCP → 手动添加）里粘贴 JSON 配置。之前以为能直接改文件 → 写了 2 次全失败
7. **Trae MCP command 字段不能含空格**：`"node"` ✅，`"C:\Program Files\nodejs\node.exe"` ❌（空格导致命令解析错误、进程秒退）。同理 `"npx"` 比完整路径稳定

### 并行工具链
8. **Jest + miniprogram-simulate vs miniprogram-automator 两条线独立**：Jest + simulate（组件/逻辑单测，`npm run test` 521 条）和 automator（E2E，本轮新增）互不依赖。单测不阻塞 E2E 开发；E2E 跑不起来不代表单测有问题

## 十四、commit 三类隔离 + 提审冻结期 admin_config（2026-10-24 实操提炼）

### commit 三类严格隔离
> 背景：本轮 test infra commit 独立于业务代码 commit，避免 "一次性提交 9800 行但无法定位业务变更" 的混乱

1. **commit 分三类，禁止混批**：
   - **①业务代码 + 规则改动**：miniprogram/ / cloudfunctions/ 代码 + `.trae/rules.md` / project_rules 等规则文件。如 order-detail 分区注释、realname_face_mode 兜底值
   - **②docs / 台账**：CHANGELOG / REGISTRY / deploy-log / tech-debt / HANDOFF / runbook。纯文档，禁含任何代码文件
   - **③测试基础设施**：MCP/Jest/e2e 框架、mock 文件、环境变量模板。禁混业务代码
2. **跨会话累积的 docs 变更批量提交**：HANDOFF 是增量补丁制，同一轮会话产生的补丁 + 台账更新 → 一次 docs-only commit 提交

### 用户 SOP 永不入库
3. **5 份用户 SOP 文档永久 untracked**：`docs/用户SOP_小程序提审前合规扫描_完整版.docx` / `docs/用户测试流程SOP_完整版.docx` / `docs/用户SOP_提审前合规扫描清单.md` / `docs/用户测试流程SOP.md` / 及后续任何 `*SOP*docx/md` 文件。**永远禁 git add / commit / delete**——这是用户私有测试经验，不属于仓库资产

### 提审冻结期 admin_config 可动
4. **提审冻结期（§3）仅约束代码文件**：miniprogram/ + cloudfunctions/ 代码冻结 ≠ 云端 admin_config 冻结。admin_config 是**运营配置**（环境开关 / 功能标志），不属于业务代码范围
5. **实测例子**：本轮 AI 通过 cloudbase nosql UPDATE 把 `realname_face_mode` 从 `mock` 改成 `wx` —— 提审前切换真实人脸是必要动作，不走业务冻结期审批流程

## 十五、Git 推送代理 + 门禁基线 + 网络恢复（2026-10-24 实证）

### Git push 必须绕代理
1. **本机默认代理死在 7890**：`git push` 会走这个死端口 → 超时 20s + Failed to connect。**每次 push 必须显式绕开**：
   ```powershell
   git -C C:\zhaoren -c http.proxy= -c https.proxy= push origin master
   ```
   这不是"这次碰巧需要绕"——是**每次都要绕**，把它当默认命令

### 门禁基线取实跑结果
2. **HANDOFF 里的 44 pass 是子集**：v8 写 `npm run test → 44 pass` 是单独跑 _shared 目录子集；本轮 `npm run test`（全量跑 `cloudfunctions/_shared/*.test.js` 全套件）实测是 **521 tests / 0 fail**。**门禁基线一律取实跑结果，不取 HANDOFF 里的旧数字**
3. **三个静态门禁 commit 前必跑**：`node scripts/check-syntax.js`（250 文件）+ `node scripts/check-ssot.js`（硬编码 0）+ `node scripts/check-shared-sync.js`（场景一致）。三项全绿才能 commit

### GitHub 网络层断连
4. **push 失败先测连通性**：`try { (Invoke-WebRequest -Uri https://github.com -UseBasicParsing -TimeoutSec 10).StatusCode } catch { Write-Host "NET_FAIL: $_" }`。返回 NET_FAIL = 网络层问题（不是代理/凭据）→ 等网络恢复再 push，不要反复重试

### 与既有规则关系
- §十三 承接 §十（tcb CLI 坑）与 §12（结论须带实证）——所有条目都是"真实踩过、实测修了"
- §十四 承接 §9（流程规范每个 commit 必须遵循）与 §3（提审冻结期代码零改动）——补充"三类隔离"和"冻结期 admin_config 例外"两条实战修正
- §十五 承接 §13（PowerShell 编码连环坑）与 §28-L1（批准项落地前红线复核）——补充 Git push 绕代理的"每次必做"动作和门禁基线的"实跑优先"
