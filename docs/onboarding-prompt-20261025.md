# 找人帮忙小程序 · 工作衔接提示词（2026-10-25 · 学习考试中心立项版 V2）

> ⚠️ **已被 `docs/HANDOFF-20261026.md` 取代（2026-10-26）**：工具路径、版本号、门禁计数、待办状态一律以新文件为准；本文件仅作历史参考，**禁止再投喂**。

> **用途**：新任务首条消息整段投喂，使无上下文的新 Agent 零偏差接手。
> **生成依据**：技能 `.trae/skills/zhaoren-handoff-prompt`（实测取证 → 双专家评审 → 修正 → 落盘）。
> **版本**：V2「学习考试中心立项版」（2026-10-25 晚）。V1「admin-web 登录收尾版」同日早间（git 历史可溯）；V2 增量 = 用户战略决策（**暂缓提审**）+ **学习考试中心立项**，git 基线全部重测。**V2.1（同日深夜）**= 纯值刷新（HEAD/origin=`4eaf157`、`??` 6 项）+ T-8.1 完成回填 + T-0.3.1 直连 reset 探活重试经验，结构零改动。**V2.2（同日深夜）**= 双专家复检后状态回填（T-7.9 ✅、§2 两处、T-8.2 时态、T-7.2 消漂移源、C-4.8 MCP 现状），仍为纯值刷新。
> **取证时点**：2026-10-25 晚。文中所有可核查值均当场命令实测；评审修正见文末「验证者修正」。
> **清点边界**：`T-*` / `C-*` / `E-*` 为**清点项**，必须逐条回执；**§1 / §2 / §5 / §8 为参考用，非清点项**。

---

## §0 开场回执校验（先回执，再等派活）

**T-0.1**（硬指标）工作目录唯一可信 = `C:\zhaoren`。所有 git 命令一律写 `git -C C:\zhaoren ...`，不依赖当前 cwd。
**T-0.2**（硬指标·V2.1 重测）`git -C C:\zhaoren rev-parse --short HEAD` → 本更新实测 = **`4eaf157`**；应为 `4eaf157` 或其后的仅含 docs 类提交。请用 `git log --oneline -6` 核对提交性质。
**T-0.3**（硬指标·V2.1 重测）`origin/master` 应与 HEAD **一致**、`rev-list --count origin/master..HEAD` = **`0`**（本更新实测 `4eaf157` = origin，ahead=0）。若 ahead≠0，先按 T-7.2 补推；`docs/exam-center-plan-20261025.md` **已入库（`63280a2`）**，若它再出现 `??` 或 `M` 属异常。
**T-0.3.1**（硬指标·修正）推送失败**不是 GitHub 不可达**：实测 `github.com:443` TCP 可连，`git -c http.proxy= -c https.proxy= ls-remote --heads origin` 成功；故障在**本机默认代理 `127.0.0.1:7890` 的 TLS 链路**（`schannel: server closed abruptly`）。→ 一律绕代理推送。**绕代理直连也可能间歇 `Connection was reset`**（2026-10-25 深夜实证：push 连续 2 次 reset，`ls-remote` 探活通过后第 3 次重试即成功）→ 失败时先 `ls-remote` 探活，通则立即重试，勿改配置勿猜因。
**T-0.4**（硬指标·V2.1 重测）`git -C C:\zhaoren status --short` 应为 **0 个 `M` + 6 项 `??`**：
- 6 份**用户文档**（C-3.5 永不入库）：`docs/` 下 `线上陪伴SOP与岗前考试题库_合订本.md`、`线上陪伴上岗培训考试题库.md`、`线上陪伴业务标准作业流程（SOP）.docx`、`线下户外陪伴SOP与岗前考试题库_合订本.md`、`陪诊SOP与岗前考试题库_合订本20261020.md`、`陪诊业务标准作业流程（SOP）.docx`（以 `git status --short` 实际输出为准）
- ~~1 份项目文档~~：`docs/exam-center-plan-20261025.md`（学习考试中心实施方案）**已随 `63280a2` 入库**——若再出现 `??` 或 `M` 属异常
- **除本衔接文件自身外，任何 `M` 都是异常**（T-7.1 已收尾）：本文件 V2.1 值刷新待入库期间其 `M` 属预期；入库后应回到 **0 个 M**

**T-0.5**（硬指标）云环境 `cloud1-d9gkefwcp5c777088`；AppID `wxbc4a4afacdf234f5`。
**T-0.6**（硬指标）工具路径：密钥文件 `C:\zhaoren-bak\admin-key-20261009.txt`（True）；云开发 CLI `C:\Users\DC\AppData\Roaming\npm\cloudbase.cmd`（True）。
**T-0.6.1**（硬指标·2026-10-26 实测修正）IDE CLI 仅一个可用路径：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（Test-Path=True）；桌面 `C:\Users\DC\Desktop\微信WEB开发者工具` 与 `C:\Users\Administrator\Desktop\微信WEB开发者工具` 均**不存在**（旧备份在 `C:\Users\DC\Desktop\工具\微信WEB开发者工具`，勿调用）。
**T-0.7**（硬指标）线上 admin-web 构建 = **`index-BxlCgeAe.js`**（实测托管域 HTML 引用；主 bundle 引 `admin-DaH-EOZU.js` 52393 B）。该构建**已含**「剔除不可见字符」**与**「64→68 补前缀」双加固（`e6e5a52`，2026-10-25 部署）。
**T-0.8**（硬指标·V2 修订）当前体验版 = **v1.6.39**（`docs/deploy-log.md` **第 210 行**；现文件 216 行即倒数第 7 行，评审实测）。恢复提审时选 1.6.39（现为已上传快照，暂缓不影响其有效性）。
**T-0.9**（硬指标）**开工前必读顺序**：`.trae/rules.md` → 项目记忆 `project_memory.md` → `docs/exam-center-plan-20261025.md`（**当前主线方案**）→ `docs/runbooks/pre-release-filing-checklist.md`（恢复提审时）→ 本文件。`rules.md` 为 alwaysApply 级约束，优先级高于本文件。
**T-0.10**（约束红线）**禁止破坏性 git 命令**：`git clean -fd`、`git reset --hard`、`git checkout -- .`、`git stash drop` 一律禁止（会同时抹掉 6 份用户文档与 T-7.1 的唯一修复副本）。
**T-0.11**（约束红线）**禁止 `git add -A` / `git add .` / `git add docs/`**：必须按文件名精确 `git add`。
**T-0.12**（接收清点契约 RIC）首次回复先产出清点表，逐条覆盖 `T-* ∪ C-* ∪ E-*` 集合（含嵌套叶子编号），差集必须为空：

```text
| 编号 | 原文要点(≤20字) | 我的理解/落点 | 状态(接收/存疑/不符/缺失) |
|------|----------------|--------------|------------------------|
| T-0.2 | HEAD=4eaf157 | 实测 … | 接收 |
```

**T-0.13**（硬指标）清点通过后再等用户派活；当前主线 = **学习考试中心**（T-8.x：方案待用户审核 + D1–D6 待拍板，拍板后才开工 S2）；提审线 T-7.3~T-7.7 **全部暂缓**，勿自行开工。

---

## §1 项目身份（参考用，非清点项）

- 技术栈：微信原生小程序 + 云开发（CloudBase）；后台 = Vue3 + Vite SPA（`admin-web-frontend/`）+ 网关云函数 `admin-action`。
- 仓库：`https://github.com/510721314-lang/zhaoren.git`，分支 `master`。
- 云函数实测 **20** 个（不含 `_shared`）：user-login / demand-publish / demand-match / partner-apply / partner-action / order-create / order-action / order-timer / payment-mock / safety-report / im-conv / im-send / evaluation-submit / admin-action / init-db / home-action / blog-action / admin-web / zz-seed-orders / zz-warmup。**`zz-*` 为临时自测，勿动勿部署。**
- **后台双域名职责不同**：SPA 使用/测试 = `https://cloud1-d9gkefwcp5c777088-1482004365.tcloudbaseapp.com/`；云函数网关 `/api` = `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api`。网关域 `/` 也返回 SPA HTML 但走 CDN 旧缓存 → 「页面没更新」先判域名。
- 测试标识（**非凭据**）：发布者 openid `oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`；耍伴 `test_partner_001`。

---

## §2 本会话基线（参考用，非清点项）

| 交付 | commit | 改动面 | 状态 |
|---|---|---|---|
| 法律合规批1a | `9c52603` | `admin-action` 新增 `legal_doc_list/publish/rollback/seed`；`config_public` 补 privacy/disclaimer/versions；Legal.vue 版本化页 | 已部署 |
| 法律合规 U2 | `a5195b4` | `scene_disclaimer` + `scope` + `legal_doc_retire` + map 合并 + R1/R2/R3 | 已部署；9 场景全 v1。**W8 版本号存疑**：本稿原写 v4，deploy-log 该次部署行记「v3(生效)/v1(归档)」→ 以云端 `legal_doc` 实测为准（待确认项） |
| 双评审 P1 修复 | `a9705b9` | `rebuildScenes()` 保留脏值 + `beforeunload` + 非 scoped 查询改 `{doc_type}` | 已部署；行为验证 3/3 |
| 满态 UI 改进 | `d23fadc` | 提示条 + tooltip + `配置数>=场景数` + 删除→停用 | 已部署 |
| P2-11 SOS 闭环 | `c88c5c1` | `workbench.js` +22/−8：`my_orders(partner,doing)` 填 `currentOrderId/todayOrders`；无单 toast；静默 catch 改显式 | 已上传 v1.6.39，**真机未验** |
| 技术债清单刷新 | — | `docs/tech-debt-inventory-20261015.md`：P1 **8** / P2 **13** / P3 **17**（实测行数） | 已入库；头部与 A/B 口径已随 `63280a2` 订正（原 T-7.9 事项已完成） |
| admin-web 登录 401 排查 | `9a789fb`（补部署）、`692622c` + `e6e5a52`（代码）、`5750405`（**仅文档登记**） | 见 E-6.1~E-6.5 | **已上线**（`index-BxlCgeAe.js`；64 裸 body 现已自动补 `AWK-`） |
| 学习考试中心评估 + 实施方案 | `63280a2`（已入库） | `docs/exam-center-plan-20261025.md`：双专家同步评估定稿（地基优先 / 独立 exam 云函数 / cert_status 派生状态机 / 内容灰度）+ S1–S6 路线 + 4 集合 schema + cutover 五步 + D1–D6 决策点 | **待用户审核** |

**门禁实跑（取证时点）**：`npm.cmd test` → **tests 593 / pass 593 / fail 0**；A/B **444 EQUIVALENT**（241 explicit + 203 auto；**43** known-evolution）；`check-syntax` **251 files ALL OK**；`check-ssot` 0；`check-shared-sync` ALL OK（含 2 项 known-drift owed）。
**口径提醒**：deploy-log 里 v1.6.39 那次写的 `581` 是当时值；**以 593 为准，每次 commit 前必须实跑**。技术债台账的 A/B 口径已随 `63280a2` 订正为 43（原「38/41」表述已过时）。
**V2 提示**：593 / 444 / 43 为 17:3x 时点实测；V2 会话（学习考试中心立项）**零代码改动、未重跑门禁**——任何 commit 前仍须实跑（E-6.12）。

---

## §3 约束（C-3.x，红线）

**C-3.1**（约束红线·V2 修订）**提审暂缓**（用户 2026-10-25 决策：不考虑提审时间，冻结期由项目实际情况确定）→ 当前为**解冻工作态**，但仍须「**先方案后动手**」：任何 `miniprogram/` / `cloudfunctions/` 业务改动须有用户审核通过的方案文档先行（先例 `docs/exam-center-plan-20261025.md`）；改 `cloudfunctions/` 需用户明确授权（先例 `docs/legal-compliance-u2-authorization-20261025.md`）。**恢复提审时**按技能 `zhaoren-frequent-flows` 冻结期纪律切换，届时本条回到 V1 口径（业务代码零改动）。
**C-3.2**（约束红线）云函数改动**必须重新部署才生效**；部署前完成备份链（见 C-3.2.1），部署后在 `docs/deploy-log.md` 登记回滚点。
**C-3.2.1**（约束红线）**三重备份**：git bundle + robocopy 热备 + 云端 DB 导出，全部落 `C:\zhaoren-bak`；用 `.predeploy/manual-backup.ps1`（含云函数代码 `meta/functions_code`、索引台账 `meta/index_ledger.json`）；异地同步飞书云空间 `zhaoren-backup`。细节走技能 `cloud-backup-restore`。
**C-3.3**（约束红线）**commit 三类严格隔离**：①业务代码+规则 ②docs/台账 ③测试基础设施；禁止混批。
**C-3.4**（约束红线）**AI 不主动 commit / push**：所有 commit / push 必须**先经用户明确确认**后执行（T-7.1、T-7.2 同样适用）。
**C-3.5**（约束红线）**用户文档永不入库**：`docs/*SOP*.md`、`docs/*SOP*.docx`、`docs/*题库*.md`、`docs/xuexikaoshi/`。命中即停手并告知用户。
**C-3.6**（约束红线）凭据只写**路径**，不写内容；正文引用密钥一律脱敏为 `AWK-****（68 位）`。
**C-3.7**（约束红线）已验收基线内容修改须先经用户同意；涉及金额/状态机改动，先读码再改，禁止臆造字段。
**C-3.8**（约束红线·修正）**恢复提审时生效**的 `admin_config.global` **配置冻结表**（禁改，除用户明确指令；当前解冻态下变更走 C-3.9 口径）：

| 键（云端扁平键名） | 提审期现值 | 说明 |
|---|---|---|
| `realname_face_mode` | `wx` | 注意是**扁平键**；`config_public` 对外输出才是嵌套 `realname.face_mode` |
| `auto_approve_partner` | `true` | 用户 2026-10-21 批准临时开；提审后回 `false`（T-7.6） |
| `mock_payment_enabled` | `true` | 真实支付未上线；提审期**勿关** |
| `admin_openids` | 2 个管理员 | 勿增删 |

**C-3.9**（约束红线）`admin_config` 变更口径统一：**可改但必须**①用户明确指令 ②走后台 `config_set` 留 `config_history` ③docs 登记。nosql 直改仅限**只读**查询。
**C-3.10**（约束红线）受保护文件禁改/禁删/禁改名：`project.config.json`（**无 version 字段**，上传版本号只走 CLI `-v`）、`project.private.config.json`、`app.json`、`sitemap.json`；禁止新建 `ext.json`；`_orig_baseline.js` 类基线文件禁删。
**C-3.11**（约束红线）未获用户明确指令前，**禁止**改动 `miniprogram/`、`cloudfunctions/`、`admin_config` 生产值。

---

## §4 约定与工具链（C-4.x）

**C-4.1**（依赖配置）门禁：优先整跑 `npm.cmd run verify:offline`（实测含 9 段：check-syntax / check-ssot / check-shared-sync / check-require-scope / check-handlers / check-index-ledger / check-deploy-config --offline / check-manual-links / npm test）。回执必须给出四项硬指标：tests/pass/fail、A/B 例数、SYNTAX 文件数、SSOT 0。

**C-4.2**（依赖配置）admin-web 发布**必须清缓存重建**，且删除后要断言（避免静默失败复用旧 dist）：
```powershell
Remove-Item -Recurse -Force C:\zhaoren\admin-web-frontend\dist, C:\zhaoren\admin-web-frontend\node_modules\.vite -ErrorAction SilentlyContinue
if (Test-Path C:\zhaoren\admin-web-frontend\dist) { throw 'dist 未删除：先释放占用句柄' }
cd C:\zhaoren\admin-web-frontend; npm.cmd run build
& "C:\Users\DC\AppData\Roaming\npm\cloudbase.cmd" hosting deploy "C:\zhaoren\admin-web-frontend\dist" -e cloud1-d9gkefwcp5c777088 --safe
```
**禁用 `--prune`**（会删云端 `__auth/*`、`cloud-admin/index.html`）。

**C-4.3**（依赖配置）云函数部署（串行、单函数）：
```powershell
& "C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat" cloud functions deploy `
  --env cloud1-d9gkefwcp5c777088 --names <单个函数名> --project C:\zhaoren --remote-npm-install
```
**C-4.3.1**（依赖配置）部署后**必须**：①`cloud functions download` 到独立目录逐文件 SHA256 比对；②等 90–120 秒再冒烟；③deploy-log 登记。
**C-4.3.2**（依赖配置）`config.json` 的 `timeout` / `triggers` **CLI 部署不生效**，须控制台手动改，再用 `cloud functions info` 读回核验。

**C-4.4**（依赖配置）nosql 查询/更新：**必须** `.cjs` + `spawnSync(cli, argsArray, { shell: true })`，禁止 PowerShell 直接拼双层 JSON：
```js
const cmd = JSON.stringify([{ TableName: 'admin_config', CommandType: 'QUERY',
  Command: JSON.stringify({ find: 'admin_config', filter: { _id: 'global' }, limit: 1 }) }]);
```
批量只读用 `cloudbase.cmd db nosql dump ... --output-dir <dir> --json`（产物 **NDJSON**，按 `\n` 逐行 parse）。

**C-4.5**（依赖配置）push 必绕死代理：`git -C C:\zhaoren -c http.proxy= -c https.proxy= push origin master`；网络类失败重试 1–2 次即停，禁止死循环。

**C-4.6**（依赖配置）读密钥：`Get-Content <keyfile> -First 1` → trim → 正则 `^AWK_KEY\s*=\s*(.+)$` 取捕获组 → 应得 **68 位**（`AWK-` + 64 hex）。

**C-4.7**（依赖配置）云端测试口径：入参必须带 `mock_openid`；订单/需求标识用 **32 位文档 `_id`**（不是 `ORD…` / `DR…` 业务单号）；部分函数有 `isValidDocId` 预检。中文入参**不要**走 PowerShell（见 E-6.6）。

**C-4.8**（依赖配置）MCP 限制：`.trae/mcp.json` 是**受限文件**（Agent 不能写，只能用户 GUI 粘贴）；调用名必须是 **`mcp_weapp-test`**；入口必须 `dist/cli.js`（`dist/index.js` 为空模块会立即退出）。**现状提示（2026-10-25 实测）**：`.trae/mcp.json` 当前仅含 `cloudbase` 一个 server，`weapp-test` 由用户级 MCP（GUI）注册——做 E2E 前先按项目记忆重核配置，勿假设项目内条目仍在。

---

## §5 资产索引（参考用，非清点项）

**规则与提审权威（开工前必读）**
- `.trae/rules.md`（alwaysApply；优先级最高）
- `docs/runbooks/`（实测 **12** 个文件；提审权威 = `pre-release-filing-checklist.md`、审计 = `audit-checklist.md`）
- `docs/CHANGELOG.md`、`docs/FUNCTION-REGISTRY.md`、`.trae/predeploy.ps1`

**台账与文档**
- `docs/deploy-log.md`（最新 3 行为本会话产物）、`docs/tech-debt-inventory-20261015.md`
- `docs/legal-compliance-redesign-20261025.md`、`docs/legal-compliance-u2-authorization-20261025.md`
- `docs/exam-center-plan-20261025.md`（**当前主线**：学习考试中心实施方案，S1–S6 + 4 集合 schema + cutover + D1–D6）；原型蓝本 `C:\tmp\gen_md.py` 在仓库外可能不持久，其取舍已固化进方案 §8
- 项目记忆：`c:\Users\Administrator\.trae-cn\memory\projects\-c-zhaoren--p2-f953b3c8ed7b028eaf39\project_memory.md`

**上一版资产处置**（`docs/onboarding-prompt-20261010.md`）
- **继承**：反代 push、`config.json` 不生效、云调用 `-501001`、备份六步、`mock_openid` + 32 位 `_id`、订阅 `trial` 状态 → 分别落在 C-4.5 / C-4.3.2 / E-6.10 / C-3.2.1 / C-4.7 / §1。
- **修正**：HEAD / 版本 / 技能数 / CLI 路径 / 用户名（`DC` → `Administrator`）全部按本文件实测值。
- **废弃**：`gate.ps1` 8 步口径（现用 `verify:offline`）、`tcb-exec.js` 旧封装说明（现用 C-4.4 模板）。

**技能**（`c:\zhaoren\.trae\skills\`，实测 **25** 个）

| 场景 | 技能 |
|---|---|
| 高频流程（门禁/上传/nosql/push/配置/冻结期/后台发布） | **`zhaoren-frequent-flows`** |
| 云函数部署排障 | `wx-cloud-deploy`、`wechat-cloudfunction-deploy`、`cloud-console-test-driver`、`error-message-tracing` |
| 运维/身份/补丁 | `zhaoren-ops` |
| 备份还原 | `cloud-backup-restore` |
| 提审审计 | `zhaoren-audit`、`miniprogram-audit`、`mp-pre-release-audit`、`mp-privacy-release`、`zhaoren-config-sync` |
| 管理端 | `admin-web-remote-access`、`admin-web-write-ui-pattern` |
| 小程序 UI | `wxapp-ui-polish`、`mini-ui-beautify`、`mini-a11y-perf-check`、`mini-interaction-motion` |
| 沉淀 / 衔接 / 评审 | `zhaoren-experience-sedimentation`、`zhaoren-handoff-prompt`、`zhaoren-tech-review`、`zhaoren-perf-baseline` |
| 拆分 / 契约测试 | `cloud-function-split`、`cloud-entry-contract-test` |
| Windows 坑 | `powershell-windows-traps` |

---

## §6 经验教训（E-6.x，只列不读会犯错的）

**E-6.1**（硬指标）**后台密钥格式定论**：网关只认 `AWK-` + **64 位 hex**（共 68 位）。实测 **64 位裸 body → 401**；补 `AWK-` 后 → **200**。密钥文件首行 `AWK_KEY=AWK-****（68 位）`。
**E-6.2**（硬指标）**401 取证顺序**：先查 `platform_event` 的 `gateway_bad_key`（真实字段在 `payload` 内：`{"reason":"bad_key|missing_key","path":"/api"}`，顶层 `reason/path` 为空）。`bad_key` = 带了值但不对；`missing_key` = 没带。带有效 key 调 `{"action":"event_list","limit":30}` 取时间线，可判定「用户失败是否晚于某次部署」。
**E-6.3**（硬指标）**报错文案不能反证前端版本**：`密钥不正确(401)…` 文案出自 `1e48662`（仅 trim 版），新老构建都有。
**E-6.4**（硬指标）**admin-web 多次部署必须清 `dist` + `node_modules/.vite`**：本会话实测，Legal UI 批部署沿用残留 dist，把已上线的 Login/api chunk 覆盖回旧版 → 登录 401 反复。
**E-6.5**（硬指标）**验证前端改动要看主 bundle 的 import map**：`index.html → index-*.js`，主 bundle 内引用的 chunk 名才决定实际加载哪个 `admin-*.js` / `Login-*.js`；只比对单一 chunk 哈希会漏。
**E-6.6**（硬指标）**编码铁律**：PowerShell 5 传中文 JSON 会被转成 `?` → 云端 HTTP 测试一律 ASCII payload，中文走浏览器 UI；`.ps1` 必须 **UTF-8 BOM**，`config.json` / JSON 必须 **UTF-8 无 BOM**（两者相反）。临时脚本放 `$env:TEMP` 用完即删。
**E-6.7**（硬指标）**MCP weapp-test 连不上时的回退**：用 `nosql dump` 取 `order_main` / `safety_report` 证据验证后端契约，再给用户「可勾选的真机走查清单」；不要反复重启 IDE（本会话已耗 6+ 次无果）。
**E-6.8**（硬指标）**nosql dump 是 NDJSON**：不能整体 `JSON.parse`，必须按行解析。
**E-6.9**（硬指标）**push 默认代理死在 7890**：必须 `-c http.proxy= -c https.proxy=`；`Connection reset` / `schannel: server closed abruptly` 属代理链路问题，重试 1–2 次即停。
**E-6.10**（硬指标）**`cloud.openapi.*` 只在「小程序调用触发的云函数」里可用**：定时器 / HTTP 网关 / 控制台 / CLI 触发必然 `-501001`（历史定论，勿重复立项）。
**E-6.11**（硬指标）**IDE 登录态会过期**：`cli islogin` 可能假阳性；以 `upload` / `deploy` success 为准；过期用 `cli login -f image` 扫码。
**E-6.12**（硬指标）**禁止凭记忆写数字**：门禁 pass 数、commit 数、技能数、台账条数一律当场实测；旧台账数字会漂移（实测 593 ≠ 旧 581；A/B 43 ≠ 台账 38/41）。

---

## §7 待办（T-7.x 提审线 + T-8.x 考试中心线；标注谁做；★ 为时序硬约束）

> **V2 状态**：提审线 T-7.3~T-7.7 **整体暂缓**（用户 2026-10-25 决策不考虑提审，恢复提审时再执行）；当前活跃线 = **T-8.x 学习考试中心**。v1.6.39 体验版为已上传快照，暂缓不影响其有效性。

**T-7.1**（✅ 已完成 2026-10-25，commit `e6e5a52` + 部署 + deploy-log 末行）**64→68 补前缀修复已上线**，以下子项保留作为**回滚/复现手册**：
**T-7.1.1** 补丁留档：`C:\zhaoren-bak\admin-js-20261025.patch`（845 B，已生成）。
**T-7.1.2** admin-web 静态托管**允许带未提交改动部署**（全项目唯一例外；deploy-log 须注明「承载未提交改动」）。
**T-7.1.3** 清缓存 + 断言 + 重建 + 本地产物 grep（须命中 `[^A-Za-z0-9_-]` 与 `[0-9a-fA-F]{64}`）。
**T-7.1.4** `hosting deploy --safe`。
**T-7.1.5** 远端复核（必须带 cache-buster，再取主 bundle 内 chunk 名）：
```powershell
$base='https://cloud1-d9gkefwcp5c777088-1482004365.tcloudbaseapp.com'
$html=(Invoke-WebRequest "$base/?v=$((Get-Random))" -UseBasicParsing).Content
$html -match '/assets/(index-[A-Za-z0-9_\-]+\.js)'
```
**T-7.1.6** 用户浏览器 Ctrl+F5 复测登录（粘贴 64 位裸 body 也应成功）。
**T-7.1.7** 分两批提交：代码与 docs（**均需用户确认**）。
**T-7.1.8** 完成后重跑 T-0.2 / T-0.3 / T-0.4 / T-0.7 并更新本文件（已执行）。

**T-7.2**（待办·AI·**需用户确认**·仅在 ahead≠0 时）**补推 commit**：`git -C C:\zhaoren -c http.proxy= -c https.proxy= push origin master`；成功后 `rev-list --count origin/master..HEAD` 应为 `0`。V1 会话 4 个 commit（`692622c` 代码 / `5750405` 文档 / `e6e5a52` 代码 / `9a08e3e` 文档）**已推送完成**；HEAD 与 origin 一致（哈希以 T-0.2 实测为准）。

**T-7.3**（**暂缓**·用户真机·恢复提审后执行）**验证 v1.6.39 的 P2-11 SOS**：
**T-7.3.1** 有进行中订单 → 「仅上报」→ `safety_report` 新增 `sos` 且 `order_main.help_flag=true`。
**T-7.3.2** 无进行中订单 → toast「当前无进行中订单」且**不落库**（这是**已接受的产品边界**：`safety-report` 要求 `order_id` 存在，**禁止**为它改后端）。
**T-7.3.3** 断网（前置：必须有 doing 单）→ toast「网络异常，请直接拨打110」。

**T-7.4**（**暂缓**·用户手动·恢复提审后执行）**提审前置**：按 `docs/runbooks/pre-release-filing-checklist.md` §6 逐项勾选（F1 隐私指引**状态须为已通过**、F2 位置权限、F3 三个订阅模板 + `miniprogram_state=trial`、F4 合法域名、F5 `admin_openids`、F6 提审说明）。

**T-7.5**（**暂缓**·用户·恢复提审后执行）提审选 **v1.6.39**（`1.6.38` 已被取代）。
**T-7.5.1 ★**（约束红线）**T-7.3 未全绿前不得执行 T-7.5**。若真机失败：二选一 —— ①回退用 `1.6.38` 提审（源码等价，无 SOS 修复）；②取得用户**书面解冻授权**后再改 `miniprogram/` 并递增版本。

**T-7.6**（**暂缓**·提审后·AI）P1-7 + P1-6②：
**T-7.6.1** `auto_approve_partner → false`，必须走后台 `config_set`（留 `config_history`），禁用 nosql 直改。
**T-7.6.2** 清理自动通过档案：先只读 dump `partner_profile` 留底，按 `created_at` 窗口 + 实名/审核字段筛出测试期自动通过者，再批量软删。
**T-7.6.3** `realname_reset_simulated` 清理模拟实名。

**T-7.7**（**暂缓**·提审后·AI）批 1b：user-login 版本下发 + 重签机制 + C 端 agreement/privacy 动态化；**版本号由用户确认**（建议 1.6.40），上传流程走 `zhaoren-frequent-flows` 流程 2。

**T-7.8**（待办·提审后·AI）技术债：P2-12/13（工作台「今日待履约」/「本周收入」口径）、P3-15（legal_doc 并发写 + 列表不带 content + 角色门控）、P3-12（order-timer 三表扫描索引）。

**T-7.9**（✅ 已随 `63280a2` 完成）两份台账口径订正均已入库：①`tech-debt-inventory` 头部已刷新、②A/B 口径已改 43（双评审 diff 实证）。**无需再做。**

**T-7.10**（约束红线）未获用户明确指令前**禁止开工**任何 `miniprogram/` / `cloudfunctions/` / `admin_config` 生产变更（含为 T-7.3.2 而改后端）。

**T-8.1**（✅ 已执行 2026-10-25 深夜）`docs/exam-center-plan-20261025.md` 已按 docs 批次单独提交入库 = **`63280a2`**（含 T-7.9 台账口径订正；提交前实跑门禁 593/593 全绿）。**无需再做。**

**T-8.2**（待办·用户）**审核方案 + 拍板 D1–D6**（方案 §5；推荐值：D1 base 证书永久 / D2 cutover 日回填 365d / D3 S6 验证后才开闸 / D4 study_content 集合 / D5 保持现行为 / D6 本地缓存批量写）。T-8.1 **已入库**，本项拍板即 **S1 收口**。

**T-8.3**（待办·AI·T-8.2 后开工）**S2 后端落地**（方案 §4-S2）：新建 `exam-action` + `exam-admin-action` 两云函数；`_shared/cert_state.js` + `sync-cert-state.ps1` + 单测；4 新集合（questions / exam_sessions / certificates / study_records）+ 索引台账登记；admin_config 3 新键（`cert_gate_enabled` 默认 false / `w1_cert_valid_days` 365 / `base_cert_permanent` true，走 CONFIG_SCHEMA）；多选题判分 + exam_sessions 留痕 + 发证；partner-apply 门禁切换（**开关关闸 = 行为不变**）；partner-action/admin-action 旧考试 action 改薄别名（S6 才移除）。

**T-8.4**（待办·AI·与 T-8.3 并行启动）**S3 内容工程**（方案 §4-S3）：**第一件事 = W1 医疗表述合规审**（不出现指令式「给药/执行医嘱/诊断」措辞，产出合规审记录归档）；base+W1 课程内容入 `study_content`（draft → admin 预览 → published）。

**T-8.5 ★**（约束红线·时序）`cert_gate_enabled` **默认 false**；S6 云端 mock 回归 + 真机验证通过并经用户确认前，**禁止**任何途径开闸（含 nosql 直改——本就违反 C-3.9）。

---

## §8 用户核对要点（参考用，非清点项；约束已并入 C-3.x）

1. 先按 T-0.12 出清点表，差集为空再等派活。
2. admin-web 登录修复**已全部上线**（`e6e5a52`）：68 位完整 key、64 位裸 body、整行 `AWK_KEY=`、含零宽字符均可登录。
3. 任何 commit / push 前必须先问用户（C-3.4）；当前 ahead=0，工作区仅 6 项 `??`（6 用户文档；考试中心方案已入库）。
4. 涉及生产数据、已验收功能、提审状态的动作，先说方案再动手。
5. **本会话主线变更**：提审暂缓（无时间要求）；学习考试中心已立项——方案 `docs/exam-center-plan-20261025.md` 待审核，D1–D6 待拍板，拍板后开工 S2（T-8.3）。
6. `admin_config` 冻结表（C-3.8）在提审暂缓期**不生效**，任何配置变更仍须走 C-3.9 口径 + 用户明确指令。

---

## 验证者修正（双评审留痕）

### V1 时点（2026-10-25 早）
**A 事实核验抓出 6 处不符（已全部修正）**：①GitHub 443 实际可达，故障在本机默认代理 TLS（原稿误写「GitHub 连不通」）；②`??` 实为 7 项非 6 项；③v1.6.39 在倒数第 6 行非第 5 行；④用户 SOP 实为 **6 份**非 5 份；⑤T-7.1 后共 4 个待推非 3 个；⑥当前未推 2 个非 3 个。
**B 完整性审查抓出高危 10 项、中危 18 项、低危 11 项（已并入正文）**，其中影响可执行性的关键项：受保护配置文件缺失、破坏性 git 命令无禁令、提审期配置冻结表缺失、`realname_face_mode` 键路径写错（扁平键）、`verify:offline` 实为 9 段非 4 段、云函数部署命令缺 `--env/--project`、T-7.1 未写「允许带未提交改动部署」例外、嵌套待办未编号。
**保留待确认项**：W8 当前版本号（本稿原记 v4，deploy-log 记 v3）→ 以云端 `legal_doc` 实测为准。

### V2 时点（2026-10-25 晚，增量评审：A 13 项 + B 8 项，均已并入正文）
- **A 事实核验**：11 项属实、2 项修正——①T-0.4「0 个 M」在 V2 未入库窗口自指失效（实测 1 个 M = 本文件）→ 补本文件 M 豁免口径；②T-0.8「倒数第 6 行」因 deploy-log 增至 216 行漂移 → 改「第 210 行 / 倒数第 7 行」。另确认：6 份用户文档文件名逐字节一致（V1「耍伴/线下客户外耍伴」系误记，V2 已纠）、方案文档 §4-S2/§4-S3/§5/§8 与 T-8.2/T-8.3/T-8.4 引用逐项吻合、deploy-log 第 210 行门禁数 581 属实、全文 0 处凭据明文。
- **B 完整性/偏离**：高危 0 / 中危 2（T-7.2 孤儿引用「本会话 4 个 commit」→ 改写为 V1 会话；T-0.4 同 A）/ 低危 6（T-0.12 示例值残留 `5750405`→改 `45941c6`；T-7.6/T-7.7 补暂缓标签；T-0.8 补暂缓语境；本段 V1/V2 分层；§8 增冻结表暂缓期提示；T-8.1/T-8.2 收口口径改「可并行，两者齐备 = S1 收口」）。**B 确认：V1 资产零意外丢失、危险操作防线完整、T-8.x 与方案文档口径一致、自含性合格。**
