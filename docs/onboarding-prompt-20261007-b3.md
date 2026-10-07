# 找人帮忙小程序 · 新任务投喂提示词（接续版 · 2026-10-07，做第三批）

> **用法**：新建 TRAE 任务，首条消息直接粘贴下方「提示词正文（从这里复制）」整段。
> **本版定位**：接续 `onboarding-prompt-20261007-full.md` 的进度。**第一、二批已完成并部署验收**，本任务只做**第三批（爽约处罚）**，其余为知悉项。
> **进度依据**：`docs\deploy-log.md`；**爽约实施以 `docs\design-20261007-pricing-noshow-flows.md`（实施级权威稿）为准**，`-modify.md` 仅作口径背景。

---

## 提示词正文（从这里复制）

你是「找个人帮忙」微信小程序（原生 + 微信云开发 CloudBase，本地开发；同城功能性陪伴服务撮合平台，**非社交**，首发成都）的开发助理。用户是零基础小程序开发学习者、PRD 负责人。全程中文、简明、信息密集；**新会话先只读核对，不得直接改任何东西**。

【当前进度（已完成，勿重做、勿回退）】
- **第一批「履约中禁止改期」**：已落地并部署验收——改期允许态由 `['S2','S3']` 收窄为 `['S2']`；存量 S2_5（原 from_status='S3'）保留回退分支走完；改期生效后重置四项确认；`S2_5` 已补入 `.trae\rules.md` 状态机红线。
- **第二批「一口价与时薪价并存」**：已落地、7 云函数串行部署成功、gate 7/7 全绿、线上 3 项实测通过（square 透出 pricing_type ✓ / config_set 交叉校验被拒且无落库 ✓ / 3 键未配置不透出 ✓）。`pricing_type='hourly'|'fixed'`（缺省 hourly）+ `fixed_price_fen`；`total_fen` 仍唯一结算口径；耍伴筛选新增客单价区间（未配置不限制）；公益归一口价（`welfare_fixed_price_fen`，未配置 fail-closed `publish_welfare_not_open`）；一口价加时总价不变；后台 3 新配置键经 CONFIG_SCHEMA 三端同源（均不设默认，留空=不钳制）。flows 稿**断链①**（公益单云侧恒为 `commercial`）已随第二批修复。⚠️ 已知尾巴：公益单的小程序端发布完整链路尚未人工走查，**不阻塞本批**。
- 第一批代码已在 origin；**仅第二批领先 origin 2 个提交未推送**（`26628ee` + `5c1e60d`，HEAD `5c1e60d`）。

【本次任务（核心）】做**第三批：爽约处罚**——「用户举证界面 + 管理端裁定」链路。**以 `docs\design-20261007-pricing-noshow-flows.md` 为实施权威，逐条对照其 2.2–2.11；未经我确认不得扩范围**。核心要点（勿漏）：
- **不新增云函数**：用户侧 action 挂 `order-action`（`no_show_report_submit` / `no_show_report_defense` / `no_show_report_detail`），管理端挂 `admin-action`（`no_show_report_list` / `no_show_decide`）。
- **新建集合 `no_show_report`**（状态 S0 受理 / S1 举证 / S2 已裁定），**必须同步纳入两处**（否则不可观测、不可备份，`config_history` 踩过此坑）：①`admin-action` 的 `EXPORT_COLLECTIONS`；②`.predeploy\manual-backup.ps1` 的 `$COLLECTIONS`。
- **⚠️ 断链②必须配套修复**：现有 `penalty(suspend_7d)` 写 `status='suspended'`，但**全仓无任何入口拦截 `suspended`、也无到期自动解除**——"累计 3 次停用 7 天"当前是空话。须按 flows 稿 2.4 改造各入口拦截（新发单 / 接单 / 耍伴申请 + 广场）+ user-login 登录惰性恢复，否则处罚不生效。
- **处罚口径**：用 `penalty(suspend_7d)`（写 `status='suspended'`），**勿用 `user_freeze`**（它写 `status='frozen'`，语义不同）；信用分 `credit_score_log` 新增 `type:'no_show'` 扣 20。⚠️ 现有 `penalty` 把 7 天**硬编码**（admin-action:2874），而 flows 稿 N10 锁定"爽约数值全部后台可配"（`no_show_suspend_days` 等新 CONFIG_SCHEMA 键）——勿盲目复用写死版。
- **实施锚点（勿漏）**：①4 个新索引经 init-db 增量补建，其中 `credit_score_log(openid+type+created_at)` 是聚合核心；②`config_public` 是**手写映射**（resolveOperations 泛化不覆盖），需手动补 `no_show` 数值组；③幂等键 `order_id + target_openid`；④举证内容走 msgSecCheck。
- 已知事实（减少重复调研）：`credit_score_log` 现有 type 仅 `init`/`evaluation`/`admin_adjust` 三种；`NO_SHOW` 常量在 `miniprogram/config/index.js:63`，**将降级为前端兜底默认值，勿删**。
- MVP 为 mock 支付，**不做真实资金赔付**。

【必读吸收（按序，只读）】
1. `docs\onboarding-prompt-20261007-full.md` ← 通用约束 / 硬红线 / 完成链路 / 回执机制的权威出处，先读它。
2. `docs\design-20261007-pricing-noshow-flows.md` ← **爽约实施级权威稿**（N1–N10 锁定口径、断链②修复、9 个 CONFIG_SCHEMA 新键、索引、通知矩阵、action 命名），**本批以它为准**。
3. `docs\design-20261007-pricing-noshow-modify.md` ← 决策口径背景（含现状行号）。
4. `.trae\rules.md`（红线）＋ `docs\runbooks\`＋ `scripts\gate.ps1` ＋ `docs\deploy-log.md`。

【本批关键经验（内联 · 必读，project_memory 在 git 外不保证加载）】
1. **新增字段「未配置不透出」≠ 旧代码**：JSON 缺键是 undefined 被丢弃的正常结果；**判定部署生效必须走行为测试（如 config_set 传非法值期待拒绝码），不能看「键在不在返回」**。
2. **零副作用验证线上代码**：`config_set` 传会被新校验拒绝的非法值→期待失败码、无落库（纯探测）；或传当前同值→成功落 config_history 不改变行为（取证）。
3. **CloudBase `_.or(...)` 不能经 `Object.assign` 传递**（会被拍平破坏查询）；多条件组合必须用 `_.and([base, priceWhere])`。
4. **跨文件 / 跨批次改动前重新 grep 锚定行号**，勿盲信旧行号。
5. 另继承 full 模板内联的 6 条：SCF 定时触发器信息在 `event`（`context` 无 `TRIGGER_NAME`）/ `config_get` 键值在 `data.operations.<键>` / 云函数内 fire-and-forget 必须改 `await` / 新集合须纳入 `EXPORT_COLLECTIONS`+备份脚本 / 观测脚本自身会静默失效须用真实响应复测 / 密钥不落文档。

【三合一校验 + 开场回执（投喂后第一步，未通过前不得动工）】
1. 先输出完整「开场回执」：下表逐行核对，每项附**只读命令真实输出**（Test-Path / git log -1 / status --short / rev-list 双向 / 网关 config_get / Get-ChildItem `C:\zhaoren-bak`），**禁止只复述基准值文字、禁止编造**。

| 校验项 | 基准值（2026-10-07 实测） | 验证方式 |
|---|---|---|
| 工作目录 | `c:\zhaoren` 存在 | Test-Path |
| git remote | `github.com/510721314-lang/zhaoren.git` | git remote -v |
| HEAD/工作区 | `5c1e60d`，工作区除本提示词文件外干净（`?? docs/onboarding-prompt-20261007-b3.md` 属预期），**领先 origin 2 / 落后 0** | git log -1 + status --short + rev-list 双向 |
| appid | `wxbc4a4afacdf234f5` | project.config.json |
| 云端 env | `prod`；`mock_payment_enabled=true`（quick_check 会 BLOCK，上线前必须置回 false） | 网关 config_get 读 `data.operations.*` |
| 心跳/巡检 | `error_scan_heartbeat_at > 0`（触发器已闭环）；`audit_prune_dry_run=true` | 网关 config_get |
| 双计价在线证据 | `data.config_schema` 含 `fixed_price_min_fen`/`fixed_price_max_fen`/`welfare_fixed_price_fen`（无 def=留空不钳制，**缺键=未配置属预期**；已设值则看 `data.operations.<键>`） | 网关 config_get |
| 备份 | 本地 `C:\zhaoren-bak`（bundle + 热备 + 云端 DB 35 集合）；**已异地**：飞书云空间 `zhaoren-backup` | CHECKSUMS.txt ＋ 飞书目录 |

> 若回执实测与基准不符（例如上一会话已推送/已推进 HEAD），**以实测为准并明示差异**，经我确认后再继续，不得硬套基准值。

2. 随后回答 5 问（答案须基于回执事实）：
   ① 当前 HEAD 与 GitHub 同步状态？领先的 2 个提交是什么？
   ② 云端 env 与 `mock_payment_enabled` 实测值及其上线含义？
   ③ 心跳是否闭环（`error_scan_heartbeat_at`）、`audit_prune_dry_run` 当前值？
   ④ 断链②是什么、为何「停用 7 天」当前不生效？新建集合必须同步纳入哪两处？
   ⑤ 现在能否直接改代码/部署？（答：否，先回执 + 待办清单 + 等我确认）
3. 通过后列出「本批待办 + 行动边界」，**等待我确认**；未经确认不得提交 git、切环境、部署云函数或上传体验版。

【执行规范（工具链 + 完成链路）】
- **云函数部署**：`C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat` → `cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <单函数> --project c:\zhaoren --remote-npm-install`。**串行、一次一个**（并发会 Updating 死锁）；部署后等 90–120 秒再验证。
- **部署前必须先归档**：`git bundle create C:\zhaoren-bak\zhaoren-deploy-<ts>.bundle master --tags`，并在 `docs\deploy-log.md` 记一行（日期/函数/前后 commit/回滚点）。
- **管理后台网关**：POST `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api`，Header `X-Admin-Key` 取 `$env:AWK_KEY`（密钥不入任何 git 内文件）。
- **git 推送被 GitHub 阻断时**：逐 IP 探测（`curl --resolve github.com:443:<ip>`），再
  `git -C c:\zhaoren -c http.proxy= -c https.proxy= -c http.version=HTTP/2 -c http.curloptResolve="github.com:443:<可达IP>" push origin master`
  （多 IP × {HTTP/2, HTTP/1.1} 遍历重试；仍不通则 bundle 兜底并记 CHECKSUMS）。
- **每批完成链路（固定动作，不得省略）**：改 → `node --check` → `npm test` → **串行部署** → `powershell -File scripts/gate.ps1`（7 步全绿；心跳 FAIL 会阻塞）→ 云端/真机验证 → 更新 `docs\deploy-log.md` → **commit + push**（顺带把领先的 2 个提交一起推）→ 必要时沉淀 project_memory。
- 实施后的**功能验证照常做**（含部署后云端验证与必要的真机走查），**不属于**「暂缓测试」范围——暂缓仅指 B5 真人接管演练那类验收性演练。

【边界（知悉即可，勿擅自动手）】
- 先把领先 origin 的 2 个提交推上去（push 受阻按上面绕过法 / bundle 兜底）。
- `audit_prune_dry_run` 真删前置 false —— 先看 `audit_prune_last`（网关 config_get 或 `scripts\check-audit-prune.ps1`；期望 `dry_run=true, matched=0`）。
- order-timer runtime 由 `Nodejs16.13` 升 18（控制台手工改）。
- B4/B6/B7 用户侧项（B7 首批已完成：飞书云空间 `zhaoren-backup`）。
- 公益单小程序端发布链路的人工走查可择机补做，不阻塞本批。

【收尾】
- 完成后向我回报：改了哪些文件、我怎么在微信开发者工具里验证、验证成功的标志是什么（**不超过 5 句**）。
- 不主动 git commit，除非我明确要求，或按上文「完成链路」执行。

---

## 附：版本说明（不粘贴给新任务，供用户自查）

- **本版性质**：接续版（最终版），已经两轮核对整合：①遗漏/偏离自查（补公益尾巴、收紧推送表述）；②专家审查 11 条全部落实（补 `flows.md` 为实施权威、内联断链②与实施锚点、内联 4 条新经验、修正 config_get 路径与「工作区干净」表述、区分 penalty/user_freeze）。
- `onboarding-prompt-20261007-full.md` 仍是通用规则/经验的 SSOT；本文件只承载「进度 + 第三批任务 + 刷新基线」。
- **基线 2026-10-07 实测（最终版复核未变）**：HEAD `5c1e60d`、工作区除本文件外干净、领先 origin 2、env=prod、mock=true、心跳新鲜、双计价 3 配置键已在 config_schema。
- **本文件提交后 HEAD 会前进** → 新会话实测值会更新，正文已含「以实测为准」兜底。