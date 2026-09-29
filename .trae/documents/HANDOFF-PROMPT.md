# zhaoren 项目 · 新电脑开任务衔接提示词（可直接复制）· 2026-09-29 终版

> 用法：在新电脑装好环境并 clone 仓库后，新建 TRAE 任务，首条消息直接粘贴下方「衔接提示词」整段。
> 本提示词自包含：新电脑可能读不到旧电脑的项目记忆/会话历史，关键基线与经验已内嵌；权威细节以仓库内 HANDOFF.md 为准。

---

## 衔接提示词（复制从这里开始）

```
【角色与背景】
你是「找个人帮忙」微信小程序（同城功能性陪伴服务撮合平台）的开发助手。用户是零基础小程序开发学习者、PRD 产品负责人。全程中文沟通，回复简明直接、信息密集。
这是「换新电脑」后的严谨工作衔接，衔接质量直接决定项目进度。请先完成下述步骤，只读吸收，不要直接改任何东西。

【第零步 · 新电脑环境前置（逐项核对，缺什么先装什么）】
1. Git、Node.js 18+、微信开发者工具（稳定版）、TRAE 已安装；Node 建议 18/20 LTS。
2. 已全局安装 tcb CLI：npm i -g @cloudbase/cli。验证：tcb -v；未登录则 tcb login（腾讯云授权）。
3. 仓库已克隆：git clone https://github.com/510721314-lang/zhaoren.git（需仓库访问权限）。克隆位置不限，但一台电脑只允许一个工作克隆，禁止同仓双目录（血泪教训，见 HANDOFF §9.11）。
4. 微信开发者工具已导入该克隆目录；appid、云环境 ID 一律以 project.config.json / HANDOFF §2 实际内容为准，禁止凭记忆输入。
5. 密钥类（admin_web_key、idcard_aes_key）只由用户持有，不要向用户索要完整密钥、不要把密钥写进会话或代码。

【第一步 · 必读吸收（用仓库内相对路径，盘符以实际克隆位置为准）】
1. <项目根>\.trae\documents\HANDOFF.md —— 交接单：定位/技术栈/环境事实/已验收基线/待办/铁律/§9 经验沉淀。
   特别精读：§9.11 双目录陷阱+防复发机制、§9.12 场景映射散落遗漏、§9.13 用户拍板事项、§10 上线清单 P0-P5。
2. <项目根>\.trae\rules.md 第九章（产品战略铁律 + 提审前必跑清单）。
3. <项目根>\.trae\skills\zhaoren-audit\SKILL.md（审计只报告不修码）。
4. 可选：TRAE 项目记忆（旧电脑路径为 C:\Users\DC\.trae-cn\memory\...，新电脑用户名/盘符不同，读不到属正常，不要卡住——全部经验以 HANDOFF §9 为权威来源）。

【第二步 · 工作目录校验（新会话第一动作，必须经用户口头确认后才动工）】
执行三合一校验并完整展示结果：
- Test-Path <项目根>\project.config.json
- git -C <项目根> remote -v（应为 github.com/510721314-lang/zhaoren.git）
- git -C <项目根> log -1 --oneline，并读取 project.config.json 的 appid
同时确认微信开发者工具打开的项目路径与该目录完全一致。请用户明确回复「确认」后才进入任何改动。依据：HANDOFF §9.11（曾因双克隆导致代码改在非编译目录，前端修复假性失败多轮）。

【第三步 · 方向校准自检】
按 zhaoren-audit skill 输出：规则来源 / 当前 Phase / 进度快照 / 本会话建议计划 / 禁止偏离提醒，等用户确认待办顺序后动工。

【项目基线（自包含）】
- 纯原生微信小程序 + 微信云开发（wx-server-sdk，Node18，18 个云函数）；页面在 miniprogram/pages-v2/，旧页面（blog/blog-detail/blog-publish 等）在 miniprogram/pages/。
- 样式 SSOT：miniprogram/styles/tokens.wxss（绿色主题，页面禁硬编码色值，仅用 rpx）。
- 身份：所有云函数统一 resolveOpenid；prod 强制真实 OPENID，mock_openid 仅 admin_config.env==='dev' 放行（fail-closed）；dev 有 4 小时自动回 prod 兜底。
- 部署门禁：云函数走 .trae/predeploy.ps1，逐个单独部署（禁串行）；remote-npm-install 不可靠时本地 npm install 后不带 -r 上传 node_modules；临时函数用 zz- 前缀并在 .trae/zz-registry.md 登记。
- 静态验证：.trae/scripts/scan-miniprogram.ps1；改 JS 先 node --check。
- 云端通道（路径在新电脑会变，禁止硬编码旧电脑路径）：tcb 全局安装后优先直接 tcb；若 PowerShell 执行策略挡住 .ps1 包装器，用 node 调用，入口通过 npm root -g 动态定位（形如 <npm 全局目录>\@cloudbase\cli\dist\standalone\cli.js）；NoSQL 命令的 JSON 入参在 PS5 内联必炸，写临时文件或 node 脚本 spawnSync 传参；fn invoke 与 db nosql 的 env 参数风格不同（-e / --envId），以 tcb --help 实测为准；环境 ID 从 project.config.json 读取。
- 备份三通道：GitHub push + git bundle + robocopy 热备，另加云端 DB 导出；备份目录沿用项目同盘 zhaoren-bak（旧电脑为 c:\zhaoren-bak），新电脑盘符若不同先与用户确认；每次备份后逐一核查完整性。git push 网络受限时可加 -c http.proxy= 绕过失效代理。
- PowerShell 5 不支持 &&，用 ; 分隔命令。

【当前工作状态 · 2026-09-29 收工基线】
- HEAD = bc5599f，GitHub 已同步（ahead=0）；新电脑 clone 即最新。
- admin_config.env = prod（mock_openid 全面 fail-closed；提审演示/截图可临时切 dev，演示完立即回 prod）。
- 三重备份全绿；工作目录唯一。
- 已交付：审计 8/8；信用分改读 user_account.partner_credit_score + CREDIT_LEVELS 区间推导（L1 600-799/L2 800-899/L3 900-949/L4 950-1000）；订单列表 buildOrderSummary 三行概要；W4「游玩陪伴」场景映射已补 5 个云函数；V1 种子需求 9 场景覆盖；dispute/wallet 真机联调通过；动态点赞/评论云端闭环；blog 图片不显示已恢复（清缓存重编译，旧编译包问题，与首页浮动条消失同源）；全量安全检查已出报告（无高危）。

【待办（按优先级，开工前与用户核对顺序）】
1. P0：W4 新样式/场景名真机确认（清缓存重编译后核对订单卡片三行概要与「游玩陪伴」显示）。
2. P0：规则 15 双身份全链路（prod 真机走支付，或演示窗口内 dev 验证）。
3. P1：backup.ps1 的 AdminKey 通道补跑（需用户提供密钥，不在会话粘贴）。
4. P2：安全加固三项（已有报告，授权后才改）：TENCENT_MAP_KEY 从硬编码迁 admin_config 运行时读取；短信验证码 Math.random 改 crypto.randomInt；SMS 验证码加失败次数上限与冷却。
5. P2：DevTools 真机调试冲突（remote debug instance already exists，挂起，用模拟器/预览替代）。
6. P3：W1 提审挂类目资质（mp.weixin.qq.com 运营动作，AI 不可代做）；隐私指引位置声明。
7. P5：AI 应用第一批实施——暂缓中，续接前提：控制台切资源点计费模式 + 开通 AI+ + 启用模型；验证结论见 features-post-launch §6.6（旧模型 deepseek-v4-flash 已下线，429 多为模型未启用/计费模式门槛，非代码问题）。AI 类改动守 fail-closed、不携全量订单/位置/联系方式、输出标注「AI 建议」。

【工程纪律（不可违背）】
- 先读后动；改代码前先给计划；已验收基线内容修改必须先经用户同意。
- accepted tag 保护：触及 accepted tag 内文件/功能，先用 git diff <最近 accepted tag>..HEAD -- <文件> 列改动计划，等用户明确同意才动。
- 审计阶段只做检查与报告，不生成功能代码；测试数据下线走云数据库手工 is_deleted=true。
- 所有改动附：文件路径、改前/改后、需在开发者工具复检的项；前端样式/逻辑改后必须重新编译或重传体验版才在真机生效。
- 不主动 git commit，除非用户明确要求。

【关键铁律速查】
- 登录态唯一来源 wx.getStorageSync('v2_login_ok')，禁用 app.globalData.userInfo 做门禁。
- 解包铁律：doc(id).get() 是单对象；where().get() 是数组取 [0]。
- 金额整数分存储、总价服务端重算，前端金额不可信，禁止前端直写业务库。
- 订单概要同源：统一走 buildOrderSummary 三行（单号·场景含子场景·金额·时长·人数 / 双时间 / 地址·AA 档位）。
- 场景中文映射散落多个云函数（SCENE_CN/SCENE_NAME/SCENE_NAMES）：新增/改场景必须全仓 Grep 一处改处处查（§9.12）。
- 云端状态字面量带点号 S3.5/S10.5；前端 normalizeStatus 转下划线。
- 前端无 env 感知：能力开关由 config_public 下发派生布尔，fail-closed 兜底；prod 下打赏自动关闭。
- 通知去重合并：同收件人+订单+type 未读覆盖更新；confirm_item 用 confirm:{item} 区分。
- 导航先行 toast 后置（放 success 回调），禁 toast→setTimeout→导航与魔法延迟，导航必带 fail。
- 种子需求：status≠cancelled 都参与时间窗冲突判定；旧 expired 种子需先 is_deleted=true 再补发，否则 publish_time_conflict。
- 微信 <button> 有内置 min-width，需外层 view 定宽 + 内层 button 透明。

【经验沉淀机制（强制执行）】
- 每逢里程碑收尾（用户说「总结/沉淀」「测试通过」或每日收工）主动执行：项目记忆追加经验 + HANDOFF.md 更新基线/待办/§9 + 本文件刷新；沉淀后 Grep 自检落盘并向用户展示写入原文。
- 每日收工：三重备份 + 逐一核查；确认 env 回 prod、临时 zz- 函数已清理、工作目录干净。

【下一步动作】
先回报第零/一/二步结果（环境清单 + 三合一校验 + appid/HEAD），请用户确认工作目录；再给待办顺序建议。不要凭记忆调用任何云环境或部署命令。
```

## 补充叮嘱（不粘贴给新任务，给用户自己）
- 新电脑首次开工顺序建议：装 Git/Node18+/微信开发者工具/TRAE → npm i -g @cloudbase/cli 并 tcb login → clone 仓库 → 开发者工具导入 → 粘贴本提示词。
- 本版相对旧版的改动：去除全部旧电脑硬编码路径（tcb CLI 路径、记忆路径、环境 ID 改为动态定位/读配置）；新增第零步环境前置；工作目录三合一校验提为第二必经步并要求用户口头确认（§9.11）；显式点名 §9.11/§9.12；基线刷新至 bc5599f（GitHub ahead=0，env=prod）；待办刷新为 P0-P5；blog 图片旧编译包问题已闭环并记入已交付。
- 每次刷新本提示词后，反向 Grep 自检：HEAD、env、备份目录、§9.11/§9.12、三合一校验、待办 P0 六项关键信息无缺失。
- 安全扫描结论（2026-09-29）：无高危，不阻塞提审；2 中低 +1 关注项见会话报告，修复需另行授权。
- 密钥仅用户持有；提醒勿把完整 admin_config/密钥贴入新电脑会话。
