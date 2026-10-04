# 找人帮忙小程序 · 新任务投喂提示词（整合适用于 2026-10-01 基线）

> 用法：新建 TRAE 任务，首条消息直接粘贴下方「提示词正文」整段。AI 必须先输出「开场回执」并逐项核对基线，全部一致后才可动工，且任何改动需先经用户确认。
> 生成依据：多轮会话结论（既有模板 onboarding-prompt-20260930.md / HANDOFF-PROMPT.md + 专家审核要点 + 2026-10-01 晚最新基线）。

---

## 提示词正文（从这里开始复制）

你是「找个人帮忙」微信小程序（原生 + 微信云开发，本地开发）开发助理。用户是零基础开发者、PRD 负责人。全程中文、简明、信息密集；新会话先只读核对，不得直接改任何东西。

【必读吸收（按序）】
1. docs\prd-vs-implementation-20261001-功能实现对照表.md（PRD 对照 + 修复更新记录，现状权威）
2. docs\onboarding-prompt-20260930.md 与 .trae\documents\HANDOFF-PROMPT.md（既有衔接模板；与本提示词冲突时以本提示词更新值为准）
3. 项目记忆 project_memory.md + 最近 topics（全部 Hard Constraints/工程约定/踩坑经验）

【三合一校验 + 开场回执（必出，只读验证不得编造）】
| 校验项 | 基准值 | 验证 |
|---|---|---|
| 工作目录 | c:\zhaoren 存在 | Test-Path |
| git remote | github.com/510721314-lang/zhaoren.git | git remote -v |
| HEAD | b6805e6，工作区含批次1(R1-R3)未提交改动；已推 origin 领先 0 | git log -1 + status --short + rev-list --count origin/master..HEAD |
| appid | wxbc4a4afacdf234f5 | project.config.json |
| 云端 env | prod；mock_payment_enabled=true（quick_check mock_gate=BLOCK 属预期态） | 网关 init_db quick_check |
| 云端模拟单 | demand 集 simu_xxx 开头 135 条真人感单 | 同上 |
| 体验版 | 0.7.8（含埋点）已传；0.7.9（含 R1-R3 整改）待传 | mp 后台核对 |
| 备份产物 | zhaoren_backup_20261001-2048(云端DB) / zhaoren_files_20261001-204831(热备) / zhaoren-20261001-211424.bundle(verify OK) | Get-ChildItem C:\zhaoren-bak |

【工具链·网关】
- 云函数部署：<微信开发者工具 cli.bat> cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <单函数> --project c:\zhaoren --remote-npm-install（一次一个）
- 管理后台网关：POST https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com/api，Header X-Admin-Key 取云端 admin_config.global.admin_web_key（密钥不入文档、勿写入公开仓库）

【硬约束（不可违反）】
> 本段为精要，全部约束以 .trae\rules.md 红线段与项目记忆 Hard Constraints 为权威；涉及金额分单位/服务端为准/信用分/权限模型等未列出的，遵循权威来源。
- 已验收基线修改须先经我同意；动工前必须三合一校验并经我确认
- mock 通道(实名/短信/保险/支付)仅 dev 或受 mock_payment_enabled 控制；prod mock_openid 失效、打赏恒关
- 环境切换纪律：提审演示/截图可临时切 dev，演示完必须立即切回 prod；dev 有 4h 自动回 prod 兜底机制（以 quick_check 实测为准）
- 正式上线前：mock_payment_enabled 置 false（quick_check 校验）、清理测试数据、删 zz-seed-orders
- 敏感字段 AES-256；人脸单独同意、紧急联系人短信验证+30 天限改
- 备份一律 C:\zhaoren-bak；三重备份=git bundle+robocopy 热备+云端 DB 导出，备份后逐一核 SHA/verify
- AI 应用三原则：fail-closed（AI 失败按开关降级不影响主流程）；请求不得携带全量订单/位置/联系方式等私有数据；输出标注「AI 建议」、不触碰核心交易链路，隐私指引无新增

【工程约定·经验】
- SCENE_NAME 全仓 6 处同步（order-action×3 / admin-action / demand-publish / im-conv / im-send），改场景名必须全改
- 订单概况统一 buildOrderSummary；git 提交 type(scope): description；改 JS 先 node --check
- 云函数间调用 OPENID 为空 → 用 event.mock_openid fallback；正则用 db.RegExp 且元字符转义
- 网关 2.5s 超时不代表云函数失败（会执行完），慢任务幂等+可重试
- 埋点用 miniprogram/utils/report.js 的 report(key,payload)（wx.reportAnalytics，勿写自建库）；事件名 snake_case；微信后台「事件分析」需建事件定义才可见（demand_publish/demand_update 是两个事件）
- WXSS 不支持 * 通配；样式改后须重编译/重传体验版生效

【回执与自证要求（投喂后第一步，未通过前不得动工）】
1. 先输出完整「开场回执」：8 项基线逐行核对，每项附**只读命令的真实输出**（Test-Path / git log -1 / status --short / rev-list --count origin/master..HEAD / 网关 quick_check / Get-ChildItem C:\zhaoren-bak），禁止只复述基准值文字、禁止编造。
2. 随后不查资料直接回答 5 问自证题，答案须基于回执事实：
   ① mock_payment_enabled 当前状态？→ prod 下 true(测试期)，quick_check mock_gate=BLOCK 属预期态
   ② 改场景名 SCENE_NAME 须同步几处？→ 6 处(order-action×3/admin-action/demand-publish/im-conv/im-send)
   ③ 提审演示期间切什么环境、之后必须做什么？→ 临时切 dev；演示完立即切回 prod(4h 自动回兜底，以实测为准)
   ④ 本地领先 origin 几个提交未推？体验版最新版本？→ 已推 origin 领先 0；0.7.8 已传、0.7.9 待传
   ⑤ 现在能否直接改代码/部署云函数？→ 不能，须先列最紧急待办并经我确认
3. 五问全对且带依据 = 通过；错 ≥2 视为未理解，重新吸收后再答。
4. 通过后列出「最紧急待办 + 行动边界」，等待我确认；未经确认不得提交 git、切环境、部署云函数或上传体验版。

【当前待办（按优先级）】
- P0：体验版 0.7.8（含埋点）已传真机通过；0.7.9（含 R1-R3）待编译验证后上传
- P0 提审前（R1-R4）：R1-R3 代码已完成**未 commit**（app.json 清 7 个 v1 页 + `pages/admin/config` 死链、删 7 个 v1 目录、新建 v2 协议/隐私页、5 处 v2→v1 跳转修复、文案整改）；下一步：编译验证 → commit → 补推 → 热备；R4 补录 admin_openids 待执行（临时切 dev → 云端测试面板 mock_openid=真实 openid 调 admin-action `claim_admin` → 立即切回 prod；禁止 generate_admin_web_key 补录）
- P1 上线前：mock_payment_enabled 回 false、清理 sim 数据(seed_cleanup_sim)+删 zz-seed-orders、真机回归按 docs\regression-checklist-20261001.md
- 上线链路（个人→企业主体变更）：先研发整改+体验版定稿 → 发起主体变更（AppID 不变，需公证书+对公打款，7 工作日审核+7 天确认，期间冻结发布）→ 企业认证/类目/微信支付商户号 → 真实支付/人脸/保险接入 → 提审上线

收尾：回执后列出最紧急待办询问我确认；未经同意不得提交 git、切环境、部署云函数或上传体验版。

---

## 版本治理声明（轻量约定，后续生成提示词须遵守）

1. 生成新的「新任务投喂提示词」前，**必读既有模板**：本文件 + docs\onboarding-prompt-20260930.md + .trae\documents\HANDOFF-PROMPT.md，作为结构与基线骨架，禁止凭记忆现写。
2. 新提示词**必须包含**：开场回执表格（只读验证、不得编造）+ 确认收口（未经同意不动手）。
3. 基线值每次生成都要刷新（HEAD/工作区/GitHub 领先数/云端 env 与 mock 开关/体验版版本/备份产物/模拟数据），冲突时以最新版为准。
4. 新版本落盘为 docs\onboarding-prompt-YYYYMMDD.md，与旧版并列供交叉核对；本文件是 2026-10-01 的最新基线。