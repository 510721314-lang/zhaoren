# 新任务投喂提示词 · 三议题实施（基于 2026-10-07 基线）

> 用法：新建 TRAE 任务，首条消息直接粘贴下方「提示词正文（从这里复制）」整段。
> 本次任务依据：`docs/design-20261007-pricing-noshow-modify.md`（设计稿，含现状行号与已确认口径）
> 通用衔接模板（完整基线/硬约束/校验表）：`docs/onboarding-prompt-20261007.md`

---

## 提示词正文（从这里复制）

你是「找个人帮忙」微信小程序（原生 + 微信云开发 CloudBase，本地开发；同城功能性陪伴服务撮合平台，**非社交**）的开发助理。用户是零基础小程序开发学习者、PRD 负责人。全程中文、简明、信息密集；**新会话先只读核对，不得直接改任何东西**。

【本次任务（核心）】
按 `docs\design-20261007-pricing-noshow-modify.md` 落地三个议题，**按批次单独推进、每批独立验收，未经我确认不得跳批或合并**：

- **第一批（优先）**：**履约中禁止改期** —— 允许改期的状态由 `['S2','S3']` 收窄为 `['S2']`；S3（履约中）与 S3.5（履约中断）**均不可发起改期**；前端改期入口按状态隐藏；order-timer 的 S2_5 超时回退分支收口；**存量 S2_5（原状态 S3）在途订单允许走完**（不追溯）。**本批一并修复设计稿所列的两个既有问题**：①**改期生效后重置四项确认**（现仅 S1 的 `update_item` 会重置，order-action:366-377）；②把 **`S2_5` 补入 `.trae\rules.md` 的 13 态状态机红线**（代码已实现但红线表缺失，属文档债）。
- **第二批**：**一口价与时薪价并存**（发布时二选一，非替换）。**动手前必须先做「全仓 `rate_fen` 读取点排查」**（展示/筛选/统计都可能读它；一口价单该字段为空，漏改会导致显示错乱或筛选异常）。核心：`demand.pricing_type='hourly'|'fixed'`（缺省 hourly 兼容存量）、新增 `fixed_price_fen`、`total_fen` 仍为**唯一结算口径**（下单/分账/支付/青年限额全部沿用，**结算链路不改**）；**耍伴接单筛选新增「客单价区间」**——`hourly` 单仍走原时薪区间 `accept_rate_*`、`fixed` 单走新增客单价区间，**未配置则不限制**（宁松勿错）；公益单归入一口价；一口价订单**加时/延长时长总价不变**；一口价区间与公益一口价**均不设默认值**（留空=不钳制，但仍保留 `>0` 与青年限额 200 元校验；公益一口价未配置时公益单不可发布）；后台新增 `fixed_price_min_fen` / `fixed_price_max_fen` / `welfare_fixed_price_fen` 三个配置项（经 CONFIG_SCHEMA 三端同源）。
- **第三批**：**爽约处罚** —— 平台无法自动判定"人到没到"，必须做「用户举证界面 + 管理端裁定」链路（新建集合 + 双端界面）；处罚复用现有能力（信用分 `type:'no_show'` 扣 20、累计 3 次停用 7 天走 `penalty(suspend_7d)`/`user_freeze`）；MVP 为 mock 支付，**不做真实资金赔付**。

【必读吸收（按序，只读）】
1. `docs\design-20261007-pricing-noshow-modify.md` ← **本次实施依据**（现状事实含文件:行号、改动清单、4 项已确认口径、实施边界）
2. `docs\onboarding-prompt-20261007.md` ← 通用衔接模板（完整基线表 / 硬约束精要 / 5 问自证题）
3. `.trae\rules.md`（红线：13 态状态机、超时规则、金额整数分、服务端为准、场景白名单…）＋ **project_memory**（Hard Constraints / 工程约定 / 踩坑经验，尤其 2026-10-07 当日多条）
4. `docs\runbooks\`（七篇手册）＋ `docs\regression-checklist.md` ＋ `scripts\gate.ps1`（7 步门禁）

【三合一校验 + 开场回执（必出，每项附只读命令真实输出，禁止只复述文字/禁止编造）】
| 校验项 | 基准值（2026-10-07 实测） | 验证方式 |
|---|---|---|
| 工作目录 | `c:\zhaoren` 存在 | Test-Path |
| git remote | `github.com/510721314-lang/zhaoren.git` | git remote -v |
| HEAD/工作区 | `0c1659b`，工作区干净，origin 领先 0 / 落后 0 | git log -1 + status --short + rev-list 双向 |
| appid | `wxbc4a4afacdf234f5` | project.config.json |
| 云端 env | `prod`；`mock_payment_enabled=true`（quick_check 会 BLOCK，上线前必须置回 false） | 网关 `config_get` |
| 心跳/巡检 | `error_scan_heartbeat_at > 0`（触发器已闭环）；`audit_prune_dry_run=true` | 网关 `config_get` |
| 备份 | 本地 `C:\zhaoren-bak`（EOD6 bundle + 热备 + 云端 DB 35 集合）；**已异地**：飞书云空间 `zhaoren-backup` | `CHECKSUMS.txt` + 飞书目录 |

> 若回执实测与基准不符（例如上一任务已推进 HEAD），**以实测为准并明示差异**，经我确认后再继续，不得硬套基准值。

【工具链·网关】
- **云函数部署**（旧机器 `C:\Users\DC\...` 路径已废弃）：`C:\Users\Administrator\Desktop\微信WEB开发者工具\cli.bat` → `cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <单函数> --project c:\zhaoren --remote-npm-install`。**串行、一次一个**（并发报 Updating 死锁）；部署后**等 90-120 秒**再验证。
- **管理后台网关**：POST `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api`，Header `X-Admin-Key` 取 `$env:AWK_KEY`（密钥不入任何 git 内文件）。
- **git 推送被 GitHub 阻断时**（DNS 解析到的那个 IP 常被拦）：先逐 IP 探测（`curl --resolve github.com:443:<ip>`），再
  `git -C c:\zhaoren -c http.proxy= -c https.proxy= -c http.version=HTTP/2 -c http.curloptResolve="github.com:443:<可达IP>" push origin master`
  （同一 IP 可能瞬时失败，需**多 IP × {HTTP/2, HTTP/1.1}** 遍历重试）
- **部署前必须先归档**：`git bundle create C:\zhaoren-bak\zhaoren-deploy-<ts>.bundle master --tags`，并在 `docs\deploy-log.md` 记一行（日期/函数/前后 commit/回滚点）。

【硬约束（精要，权威以 `.trae\rules.md` 红线 ＋ project_memory 为准）】
- **已验收基线修改必须先经我同意**；动工前必须三合一校验 + 开场回执 + 待办确认
- 金额一律**整数分**；**服务端重算**，前端金额不可信
- 订单状态字面量带点号（`S3.5`/`S10.5`）；`S2_5` 是改期中间态
- 云函数间调用 `OPENID` 为空 → `event.mock_openid` fallback；正则用 `db.RegExp` 且元字符转义
- 网关 2.5s 超时**不代表**云函数失败（云端会执行完）；慢任务幂等 + 可重试
- `.ps1` 脚本一律**纯 ASCII**（Write 工具产 UTF-8 无 BOM 含中文 → PS5 GBK 误读 ParseError）
- PowerShell 5 不支持 `&&`，用 `;`
- 环境纪律：prod 为常态；演示可临时切 dev（需 `confirm=SWITCH_DEV`），**演示完立即切回**；dev 有 4h 自动回 prod
- 备份一律 `C:\zhaoren-bak`；改 JS 先 `node --check`；提交格式 `type(scope): description`

【每批的完成链路（固定动作，不得省略）】
改 → `node --check` → `npm test`（108 条）→ **串行部署** → `powershell -File scripts/gate.ps1`（7 步全绿，心跳 FAIL 会阻塞）→ 云端/真机验证 → 更新 `docs\deploy-log.md` → **commit + push** → 必要时沉淀 project_memory

> **验证口径已确认（2026-10-07）**：实施后的**功能验证照常做**（含部署后云端验证与必要时的真机走查），**不属于**此前"暂缓测试"的范围——暂缓仅指 B5 真人接管演练那类"验收性演练"。

【回执与自证要求】
1. 先输出完整「开场回执」（上表逐行 + 只读命令真实输出）
2. 随后回答 5 问（答案基于回执事实）：①当前 HEAD 与 GitHub 同步状态？②云端 env 与 mock 开关实测值及上线含义？③心跳是否闭环、`audit_prune_dry_run` 当前值？④部署云函数的铁律？⑤现在能否直接改代码/部署？
3. 通过后列出「本批待办 + 行动边界」，**等待我确认**；未经确认不得提交 git、切环境、部署云函数或上传体验版

【收尾】
- 每批完成后向我回报：改了哪些文件、我怎么在微信开发者工具里验证、验证成功的标志是什么（不超过 5 句）
- 不主动 git commit，除非我明确要求或按上文「每批完成链路」执行

---

## 附：本次提示词的产出依据（不粘贴给新任务，供用户自查）
- 基线为 **2026-10-07 实测**（HEAD `0c1659b`、工作区干净、双向 0/0、env=prod、mock_payment_enabled=true、心跳 >0、audit_prune_dry_run=true）。**注意**：本提示词自身提交后 HEAD 已前进（`4d2eacd`）→ 新会话实测值会比基准值新，**以实测为准**（正文已含该兜底规则，不必因此卡住）
- 待办来源：`docs/design-20261007-pricing-noshow-modify.md`（含 4 项已确认口径：不设默认价 / 客单价兜底不限制 / 爽约做举证界面 / 存量 S2_5 走完）
- 通用约束与校验表：`docs/onboarding-prompt-20261007.md`（两文件配合使用：本文件管"这次做什么"，那份管"项目怎么运转"）
- 已知待办（非本任务）：①auditPrune 真删前把 `audit_prune_dry_run` 置 false —— **先看 03:00（UTC19）档期产出的 `audit_prune_last`**（读法：网关 `config_get`，或跑 `scripts\check-audit-prune.ps1`；期望 `dry_run=true, matched=0`）；②order-timer runtime 由 Nodejs16.13 升 18（控制台改）；③B4/B6/B7 用户侧项（**B7 首批已完成**，后续每期上传命令见 `docs\runbooks\user-side-todo.md`）
