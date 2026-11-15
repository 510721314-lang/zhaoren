# 跨设备接机投喂提示词（2026-11-15 · 新电脑首次接机用）

> 用途：在新电脑新建会话时，把本文件 §正文 整段作为首条消息投喂，使无上下文的 Agent 零偏差接手。
> 生成方式：`zhaoren-handoff-prompt` 技能流程（实测取证 → 双专家评审 → 修正）。专家 A 事实核验 38 项（34 属实 / 5 不符已改）；专家 B 完整性评审 27 项（必修 5 项已全部吸收）。
> 生成时点（旧机实测）：HEAD=`b70406e4`，`origin/master..HEAD`=3，工作区干净；门禁 `verify:offline` EXIT=0（992/992、A/B 455 + 92 known-evolution）。
> 使用前提：旧机先将 3 笔（`6b155f7c`/`6d5b1a7b`/`b70406e4`）push 完毕，并人工拷贝 KEY 目录与 `.env`/`.mcp.json`——机器本地资产不随 git。

---

# 投喂提示词 · 找人帮忙（跨设备接机版 · 2026-11-15 双专家评审后终稿）

> 你是接手「找人帮忙」微信小程序项目的 Agent，本机无上下文。本稿用于**新电脑首次接机**：§1 旧机前置 → §2 新机环境 → §3 接机校验 → §4 基线比对 → §5 资产继承 → §6 待办 → §7 回执。
> 全程中文，格式按 core §8。文中数字为生成时点实测（复核命令见 §4 末），接机后以本机实测为准。

## §1 旧机前置（M-0.x，必须先做，否则继承不到）

- **M-0.1【硬指标】** 在旧机 push 未推的 **3 笔**：`6b155f7c`（docs T-10.5 结案 + T-14.2 转借机）、`6d5b1a7b`（rules §41 新增）、`b70406e4`（docs §41 登记）。实测 `origin/master..HEAD = 3`。不 push 则新机克隆不到。
- **M-0.2【依赖配置】** 拷 `C:\Users\Administrator\Desktop\项目备份文件\zhaoren-bak\KEY\` 整目录（**5 个文件**：`admin-key-20261009.txt`、`backup-enc-key.txt`、`private.wxbc4a4afacdf234f5.key`、`X-Admin-Key 生成机制.txt`、`database_export-…-admin_config-*.json`）。**禁入库、禁写入任何台账或输出**。
- **M-0.3【依赖配置】** 拷回滚 bundle `C:\zhaoren-bak\bundle-20261115-t104.bundle`（`.gitignore` 不入库）；克隆不可用时用它兜底（见 M-1）。
- **M-0.4【依赖配置】** 拷 `.env`（由 `.env.example` 生成，含 `WX_DEVTOOLS_CLI_PATH`）与 `.mcp.json`（由 `.mcp.example.json` 生成）——两者均不入库，缺失时 `check:devtools` 与 weapp-test MCP 静默不可用。
- **M-0.5【依赖配置】** 可选：`.tmp-tcb\_action.cjs`（nosql 只读查询模板，绕 PowerShell 引号，不入库）；不拷则按 C-4.19 自建。

## §2 新机环境（M-1.x）

- **M-1【硬指标】** `Test-Path C:\zhaoren\.git`。无 → `git clone https://github.com/510721314-lang/zhaoren C:\zhaoren`（盘符按我指定，路径同步替换）。克隆失败：①先做 M-2 的 **global** 级固化再重试**一次**；②仍失败且已拷 M-0.3 → `git clone C:\zhaoren-bak\bundle-20261115-t104.bundle C:\zhaoren`。
- **M-2【依赖配置】** git 固化：补救阶段只做 **global**，克隆成功后再补 **repo** 级。三项：`http.proxy http://127.0.0.1:7890`（新机端口以实际监听为准）、`http.sslBackend openssl`、`http.version HTTP/1.1`。push 优先直连绕代理：`git -c http.proxy= -c https.proxy= push origin master`——**仅在我书面授权后使用**；接机阶段 `count>0` 一律只报告，禁自行补推。
- **M-3【依赖配置】** 根目录 `npm install`；`admin-web-frontend/` 另 `npm install` + `npm run build`（产物 `cloudfunctions/admin-web/public/*` 不入库）。含中文的 `.ps1` 必须 UTF-8 带 BOM；`.md` 用 UTF-8 无 BOM。
- **M-4【依赖配置】** 装微信开发者工具并登录，导入 `C:\zhaoren`，AppID `wxbc4a4afacdf234f5`；「设置→安全设置」开启**服务端口**（否则 CLI 全失败）。CLI 路径 `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（`Test-Path` 自证）。**代码上传另受「IP 白名单」限制**（`-10008 invalid ip`），换机需在 MP 后台加白名单，或改走 `tcb fn trigger`。
- **M-5【依赖配置】** CloudBase CLI 不在 devDependencies，需 `npm i -g @cloudbase/cli` 并以 `tcb -v` 自证；然后 `tcb login`（授权 `cloud1-d9gkefwcp5c777088` 账号）。登录态以 `tcb login` 实际状态为准；**禁止读取/打印任何凭据内容**。
- **M-6【硬指标·机器本地资产缺失即标 ⏸ 并报告】** ①KEY 目录（见 M-0.2；**订正**：20261113 §0.5 M-6① 原文写 `C:\zhaoren-bak\admin-key-20261009.txt`，实测真实位置是桌面 `…\zhaoren-bak\KEY\`，非笔误；仓库根 `KEY/` 是另一套口径，`scripts/create-warmup-trigger.js` 硬编码读它，缺失时该脚本会 ENOENT）；②备份介质 `H:\zhaoren_bak_day`——旧机实测 **H: 未挂载**，日备链一律 ⏸；③计划任务——旧机关键字命中 5 个均为 Windows 内置（`MareBackup`/`Backup*`/`RegIdleBackup`），**无项目自建任务**；④GitHub push 凭据（旧机凭据管理器，机器本地）；⑤平台记忆**不迁移**（规则 §9：只作旁证，以 docs + git 为准）。
- **M-7【硬指标】** Node 双口径：本地门禁/测试 **Node ≥18**（生成机 v24.20.0）；云函数运行时 **Node 16.13**（禁 17+ 语法）。
- **M-8【硬指标】** 接机验证：执行 `docs/HANDOFF-20261115.md` §8 自检口令，结果并入回执；任何不符先报告，禁绕过或改门禁。

## §3 接机校验（T-0.x）

1. Read `docs/HANDOFF-20261115.md`（唯一现行交接稿）。**必读顺序以 `docs/AGENTS.md` §1 为准**（core → REGISTRY → CHANGELOG → HANDOFF → `verify:offline`）。
2. **`docs/HANDOFF-20261114.md` §3/§4 是 C-3.x/C-4.x 的原文出处**，必须逐条引用确认后才算 T-0.4 完成（HANDOFF-20261115 明确：未确认前视为必读未完成、禁开工）；`20261113.md` 提供 §0.5 M-1~M-8；E-6.1~E-6.35 按 §6 头部链路分稿查找（20261110/11/12/13/14/15）。
3. 开工必读（缺一即停）：`.trae/rules/project-rules-core.md`（§0–§9 常驻 + §10–§41 摘要 + 附录A 红线）、`.trae/rules/project_rules-20261013.md`（索引 + 5 条常驻要点）、`.trae/rules.md`（已降级为指针）、`.trae/rules/zhaoren-release-freeze.md`、`docs/AGENTS.md`、`docs/FUNCTION-REGISTRY.md`、`docs/CHANGELOG.md`、`docs/runbooks/release-zero-checklist.md`。
4. **真值优先级硬门**：冲突时 **云端回读 > docs 台账 > 记忆/本稿数字**；不一致时先回读再回写台账。
5. **受保护文件禁改**：`miniprogram/app.json`、`miniprogram/app.js`、`miniprogram/app.wxss`、`miniprogram/sitemap.json`、`project.config.json`、`project.private.config.json`；禁建 `ext.json`；`cloudfunctions_baseline/*.js`（11 个）禁删禁改。
6. **受保护代码**：`// @VERIFIED` 逻辑禁改（含 `miniprogram/pages-v2/chat/chat.js` 的 `__loadCommTmpl`/`__requestCommSub`、`payment-mock/action_pay.js`——订阅消息与资金 CAS/事务路径零改动）；确需改须说明理由 + 向后兼容 + 书面批准，改动走 C-3.2。
7. **禁触碰**：`zz-*` 目录与 `zz-seed-orders`/`zz-warmup` 部署（除点名）；`scripts/rules-size-baseline.json` 属显式评审动作，须单独 commit 写理由。
8. **每轮开工**：读 HANDOFF「下一步」→ `npm run verify:offline` 取基线（失败即停）→ 声明改动上限 ≤3 文件/≤30 行，超出先问。
9. **写操作授权**：commit / push / 部署 / 配置写 / DB 写逐项单独授权、单会话、不继承；提审、加购、支付等人工动作不代点。
10. **云端纪律**：云函数改动必须部署才生效（串行 + 回读 SHA256）；改 `_shared` 规范源必须跑 `sync-*.ps1` 并复检 `SHARED SYNC ALL OK`；配额余量不足 1 万禁并行部署/触发器/备份。回复须显式提示「**需我手动部署 / 构建 npm**」，禁以「已修复」收尾。
11. **其他 C-3.x 硬约束**（细节查 20261114 §3）：退出登录双通道（`removeStorageSync` + `clearLoginUser`）、`navigateTo/redirectTo` 必带 `fail` 兜底、禁假修复（try/catch 吞异常、setTimeout 盖时序、注释代码）、配置改动三端同批。
12. **委派纪律**：子代理类型须在当前环境可用枚举内且具备 Shell；要求落盘表格、回复只回路径行数；未命中即改主对话自审，禁换措辞重派。

## §4 基线快照（参考段；复核命令见本段末）

- **Git**：HEAD=`b70406e4`，`origin/master..HEAD`=**3**（push 后应为 **0**；≠0 只报告，禁自推）。
- **门禁**：npm test **992/992**；A/B **455 EQUIVALENT**（237 explicit + 218 auto；**92 known-evolution**）；TEST-MANIFEST **77 文件/992 用例**；GATE-MOUNTS **28**（deploy 9 / verify-only 17 / tool 2）；SILENT-CATCH **250 处/93 文件**；LEDGER **1507 文件**；RULES-SIZE inject **15551B/16384B**（硬顶 30720B，max§ **41**）；RULE-REFS **1032 文件/1357 处**；DOC-LINKS **29 文档/97 链接**。
- **已知预期非失败**：`npm run audit:config` **EXIT=1**（唯一 ERROR＝留痕探针，T-9.14 缺口 + T-12.4「误报按人工确认、禁改脚本」）。
- **已知偏离白名单（按 §8 自检命中以下各项不算不符，在偏差清单确认即可）**：①REGISTRY 实测 **189 行/#176**，HANDOFF L16/L61/L222 写 188/#175；②下一体验版 **1.6.133**（HANDOFF §2 写 1.6.132）；③规则水位实测 **15551B**（HANDOFF §8 注释 16513B、T-15.7 15333B 为历史值）；④`docs/AGENTS.md` L20 仍写「§10–§39」，实际到 §41。
- **云端**：云函数 **21 目录 = 20 函数 + `_shared`**；order-action / demand-match / demand-publish / payment-mock 已部署且 SHA256 MATCH；`cloud.openapi` **`-604101` 环境级失效** → T-14.2/T-14.3 禁验，只登记待恢复（规则 §41-R1）。
- **复核命令**：`git rev-parse --short HEAD`；`git rev-list --count origin/master..HEAD`；`node -v`；`node scripts/check-rules-size.js`；`node scripts/check-rule-refs.js`；`node scripts/check-doc-links.js`；`npm run verify:offline`（结论看 output 末段 tests/pass、A/B EQUIVALENT、TEST-MANIFEST、GATE-MOUNTS、SILENT-CATCH、LEDGER）。

## §5 资产继承清单

| 资产 | 位置 | 继承方式 |
|---|---|---|
| 技能 **29 个** | `.trae/skills/<name>/SKILL.md` | 随 git；IDE 自动发现，未出现则手动 Read |
| 规则三件套 + 归档 §10–§41 + `.trae/rules.md` 指针 | `.trae/rules/`、`.trae/documents/project-rules-full-20261029.md` | 随 git（alwaysApply 注入） |
| 台账/交接/运维/经验 | `docs/`（REGISTRY、CHANGELOG、tech-debt、deploy-log、HANDOFF-2026*、runbooks/、session-log/） | 随 git |
| 门禁与测试 | `scripts/`、`cloudfunctions/_shared/*.test.js`、`scripts/test-manifest.json` | 随 git |
| PRD / 手册 | `PRD/PRD.md`、`docs/dev-manual*`、`docs/verification*` | 随 git |
| 后台前端 | `admin-web-frontend/`（产物 `admin-web/public/*` 不入库） | 随 git + 本机 build |
| 密钥类 | `…\zhaoren-bak\KEY\`（5 文件） | **人工拷贝，禁入库** |
| 本机私有配置 | `.env`、`.mcp.json`、`.tmp-tcb\_action.cjs` | **人工重建/拷贝** |
| 备份介质/计划任务/凭据 | `H:\zhaoren_bak_day`、Windows 凭据管理器 | 人工重建（缺失 ⏸） |
| 平台记忆 | 旧机 `.trae-cn\memory\…` | **不迁移** |

常用技能：`wx-cloud-deploy`、`wechat-cloudfunction-deploy`、`zhaoren-frequent-flows`、`zhaoren-audit`、`zhaoren-tech-review`、`zhaoren-handoff-prompt`、`zhaoren-experience-sedimentation`、`miniprogram-entry-reachability`、`powershell-windows-traps`、`cloud-entry-contract-test`。

## §6 待办概览（详情以 HANDOFF §7 为准）

- **等你决策**：T-12.2（audit_log 明文 secret 轮换）、T-13.6→13.12（备份批次 4）、T-9.17 批 1（admin-web 契约测试第一批；基线「107 导出/缺 86」为生成机会话实测，未入台账，**接机后须本机复测再定范围**；HANDOFF 旧口径为「约 40 个低频 action」）。
- **需外部条件**：T-14.2（iOS 补验）、T-14.3（formal 复验）——均待 openapi 通道恢复；T-7.3（隐私指引 11 项，我本人后台填报）；T-9.14（网关 fn_migrate 幂等空跑 + audit_log 验证，勿重复部署）。
- **其余继承项（勿丢）**：T-7.10、T-7.20（规则复核 2027-01-05）、T-9.10、**T-9.12（★真实支付上线前阻断项）**、**T-9.13（旧机回收站 V15 PRD 快照禁清空——旧机退役前必查）**、T-11.4、T-13.11（iOS+Android 抽验）、T-14.6（@VERIFIED 改动走 C-3.2）。
- **挂账/观察**：T-9.6、T-9.7/T-12.3（提审后）、T-11.3/T-13.13（**未立项禁开工**）、T-12.4、tech-debt P3-44/45/46/47。
- **已关闭禁重开**：T-10.4、T-10.5（选 A 维持现状）、T-15.1~T-15.12、X-1~X-10。

## §7 首次回执（RIC）

回执必须含：①逐条清点 `T-* ∪ C-* ∪ E-* ∪ X-* ∪ M-*` 全集（模板见 HANDOFF-20261115 §2.5，差集为空即闭环）；②与 §4 的偏差清单（含白名单四项确认 + 任何新增偏差）；③M-0/M-6 各机器本地资产到位/⏸ 状态；④等派活。**回执中不得回显 KEY 文件名以外的任何密钥内容**。未回执前禁止改任何文件。
