# zhaoren 项目 · 跨账号/跨任务衔接提示词（可直接复制）· 2026-09-29 版

> 用法：换账号登录 TRAE 后，新建任务首条消息直接粘贴本文件「衔接提示词」节。
> 若新账号读不到本文件，请人工把该节内容粘给新任务。

---

## 衔接提示词（复制从这里开始）

```
【角色与背景】
你是「找个人帮忙」微信小程序的开发助手。用户是零基础小程序开发学习者、PRD 产品负责人。全程中文沟通，回复简明直接。
这是跨账号/跨任务的严谨工作衔接，衔接质量直接决定项目进度，请先完整只读吸收以下材料后再回应，不要直接改任何东西。

【第一步 · 必读吸收】
1. C:\zhaoren\.trae\documents\HANDOFF.md —— 交接单：项目定位/技术栈/环境事实/已验收基线/待办/铁律/审计进度快照/经验沉淀。**特别阅读 §9 多轮任务经验沉淀（§9.9 2026-09-28 经验；§9.10 2026-09-29 经验；§9.11 双目录陷阱+防复发机制[重要]；§9.12 场景映射散落遗漏经验）——即使读不到项目记忆，也能从此节获取全部经验**。本机项目唯一工作目录 = `C:\zhaoren`（用户 2026-09-29 拍板；旧 `c:\Users\DC\Desktop\zhaoren` 为废弃副本勿操作；**新会话首条命令先做工作目录校验：Test-Path + git remote -v + project.config.json appid 三合一，见 §9.11**）
2. C:\zhaoren\.trae\rules.md 第九章（产品战略铁律 + 提审前必跑清单）
3. C:\zhaoren\.trae\skills\zhaoren-audit\SKILL.md（审计只报告不修码）
4. 【可选】项目记忆：c:\Users\DC\.trae-cn\memory\projects\-c-Users-DC-Desktop-zhaoren--p2-a4956b0653f77d53625f\project_memory.md（含 2026-09-28/29 全量经验/能力基线；含「衔接提示词完整性检查清单」章节）

【第二步】按 zhaoren-audit skill 输出「方向校准自检」：**先做第 0 步工作目录验证（见 §9.11）并展示校验结果（目录/git remote/HEAD/appid）请求用户明确确认，确认后才动工**，再输出规则来源/当前 Phase/进度/本会话计划/禁止偏离提醒。等用户确认后再动工。

【环境配置】
- 项目根目录：**C:\zhaoren**（唯一工作目录）；纯原生微信小程序 + 微信云开发（云函数 wx-server-sdk）
- 页面：miniprogram/pages-v2/（index、square、demand-detail、chat、pay、order-detail、evaluate、profile、partner-apply、notices、message）
- 云函数：cloudfunctions/（im-conv、im-send、order-action、order-timer、payment-mock、demand、blog-action、admin-action 等 18 个）
- 配置：miniprogram/config/index.js、enums.js；样式 SSOT：miniprogram/styles/tokens.wxss（绿色主题，页面禁硬编码色值）
- 部署门禁：云函数必须走 .trae/predeploy.ps1，逐个单独部署（禁串行）；新建临时函数需 package.json + zz- 注册 + 白名单临时加入；**新建函数的 remote-npm-install 不可靠时，本地 npm install 后不带 -r 上传 node_modules**
- 静态验证：.trae/scripts/scan-miniprogram.ps1；改代码先 node --check
- 备份三通道：GitHub push（git -c http.proxy= 绕过失效代理）+ git bundle + robocopy；**所有备份文件统一存 c:\zhaoren-bak\（用户拍板；backup.ps1 默认目标已改）**
- **云端读写（已打通）**：tcb CLI 已登录 cloud1 直读直写 —— 调用方式必须 `node "C:\Users\DC\AppData\Roaming\npm\node_modules\@cloudbase\cli\bin\tcb" <cmd>`（.ps1 包装器被 PS 执行策略挡，勿直接 `tcb`）；NoSQL 命令 JSON 用 node 脚本 execSync 传参（PS5 内联必炸）；cloud1 环境 ID `cloud1-d9gkefwcp5c777088`；腾讯云 SCF 官网控制台是其他环境（st_forbidden），勿用；**`fn invoke` 用 `-e`，`db nosql execute`/`db nosql dump` 用 `--envId`（参数风格不同）；`db nosql dump` 产物为 NDJSON 行格式（文件名带时间戳前缀）**

【当前工作状态】
- **提审就绪度高水位（2026-09-29 全会话）**：审计 8/8；信用分修复/订单三行概况/W4 场景映射/env=prod 均已部署；V1 种子需求 9 场景 matching 全覆盖；测试动态已发（点赞/评论链路云端 6/6 闭环验证）
- **最新 HEAD：本地=`a5b9c34`→`fb6317c`**（GitHub 已同步至业务 `8a693be`，**待补推 `fb6317c`：网络恢复后 `git -c http.proxy= push origin master` 以 `git log origin/master..HEAD` 实际为准**）；工作目录 = C:\zhaoren（Desktop 副本废弃勿操作）
- 环境事实：**`admin_config.env === 'prod'`（已切，mock_openid 全面 fail-closed）**；真实管理员/发单 openid = `oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`(Vl)；tcb CLI 打通 cloud1 直读直写（node 直调 bin/tcb）
- 13 个 accepted tag 全在；W9 已真机发布验收通过；admin-web 公网可访问（serveStatic 版）
- 密钥已轮换（admin_web_key/idcard_aes_key 新值仅用户持有，勿再粘贴会话）；git push 网络时通时断
- **上线前 P0-P1 清单见 HANDOFF §10（含规则 9-16 复检项）**

【待办（按优先级，非阻塞长尾）】
1. **补推文档 commit 到 GitHub**（网络恢复后 `git -c http.proxy= push origin master`，数量以 `git log origin/master..HEAD` 为准；本地/备份已安全）
2. [长尾] backup.ps1 AdminKey 通道补跑（`.\backup.ps1 -AdminKey <key>`；云端备份已用 tcb CLI 通道替代完成）
3. [长尾] W1 提审挂类目资质（mp.weixin.qq.com 运营动作，AI 不可代做）
4. [长尾] 种子需求演示数据核对（CLI 可查；现 6 条 matching 可能够演示）
5. [长尾] admin-action dispute 真机联调（complaint→S10.5→人工处理）
6. [长尾] wallet 极速提现刷新（拉新后是否未刷新，待核查）
7. [核查项] 提审前 `admin_config.env` 切 `prod`（届时 mock_openid/打赏入口自动 fail-closed；切前需用户确认）
8. [复检项] 本会话新功能真机回归：打赏入口/多打赏列表/订单分页/工作台/订单三行概要/耍伴动态入口（微信开发者工具双身份走一遍）
9. 【2026-09-28 产品拍板·公益冻结基线】公益整体暂缓：后台默认关闭(welfare_switch=false)+前端不显示+服务端 fail-closed，禁止按 PRD §1.5 开建
10. 【提审后功能库】③技能维护 ④地图周边 ⑤到达打卡——完整设计（含专家修正）见 `.trae/documents/features-post-launch.md`

【工程纪律（不可违背）】
- 先读后动；改代码前先给计划
- accepted tag 验收保护：改动要触及任一 accepted tag 内文件/功能，必须先用 git diff <最近accepted tag>..HEAD -- <文件> 列出改动计划与受影响内容，等用户明确说「同意/可以/按这个改」才动
- 审计阶段严禁生成功能代码（含数据清理工具、云函数 action），只做检查与报告；测试数据下线一律走云数据库手工 is_deleted=true
- 云函数改完走 .trae/predeploy.ps1 门禁，逐个部署
- 所有改动必须附：文件路径、改前/改后、需在开发者工具复检的项
- 编译验证用 scan-miniprogram.ps1；miniprogram-automator 与 DevTools 不兼容，勿重试

【关键铁律速查】
- 登录态唯一来源：wx.getStorageSync('v2_login_ok')；禁止用 app.globalData.userInfo 做门禁
- 解包铁律：doc(id).get() → 单对象；where().get() → 数组取 [0]；只改查询不改解包会静默失效
- 状态提示一律 catch-up（状态+__shownStatus 标记，每状态首次检测即弹），不依赖 prevStatus 跳变/瞬时窗口；顶部横幅按状态常驻兜底
- 导航先行、toast 后置（放 success 回调）；禁用「toast→setTimeout→导航」与 700/800ms 魔法延迟；导航必带 fail + console.error
- 金额整数分存储，总价服务端重算，前端金额不可信；禁止前端直写业务库
- 所有云函数用 resolveOpenid；mock_openid 仅 admin_config.env==='dev' 放行（prod fail-closed）
- 仅用 rpx；不引入未声明 npm 包；WeUI 需显式 @import
- 微信 <button> 有内置 min-width，需外层 view 定宽 + 内层 button 透明或强制 min-width/max-width:100%
- 通知去重合并：同收件人+订单+type 未读覆盖更新；confirm_item 用 confirm:{item} 区分四项
- 订单概要统一格式：结构化三行 9 字段（单号·场景含子场景全量·金额·时长·人数 / 时间 / 📍地址不截断·AA），order-action/im-conv 两处 buildOrderSummary 保持一致
- 云端 status 字面量用点号 S3.5/S10.5（前端 normalizeStatus 转下划线）；my_orders/filter 匹配须用点号
- 前端无 env 感知：能力开关由 config_public 下发派生布尔（tip_enabled 等），经 bootstrap CLOUD_MAP 写入 CONFIG，fail-closed 兜底
- PowerShell 5 不支持 &&，用 ; 分隔；git push 可加 -c http.proxy= 绕过失效代理

【经验沉淀机制（强制执行）】
- 每逢里程碑收尾（用户说「总结/沉淀」「测试通过」）主动执行，不提醒
- 沉淀三处：项目记忆 project_memory.md 追加经验章节 + HANDOFF.md 更新基线/待办/快照/§9 + HANDOFF-PROMPT.md 刷新衔接提示词
- 沉淀后 Grep 自检落盘，并向用户流出写入原文

【下一步动作】
先读取上述必读材料并核对 git log/tag 状态，再向用户确认待办顺序后开始。
注意：正式开始前先执行 `git -c http.proxy= push origin master`（若 `git log origin/master..HEAD --oneline` 非空则先生成补推，确保 GitHub 上的 HANDOFF 与本地一致，避免读到过期文档）；再核对 `git tag | grep accepted` 的 13 个 accepted tag 与工作区状态。
```

## 补充叮嘱（不粘贴给新任务，给你自己）
- 每次刷新本提示词后，必须跑「衔接提示词完整性检查清单」（7 维度 + 10 关键术语反向 Grep + 出包三处一致/git 入库）。
- 审计 8/8 已收官（2026-09-28），别再重跑已过项；审计阶段只报告不修码（例外：高危安全修复经用户确认后可改）。
- 13 个 accepted tag 全在；HEAD 本地=`54427bc`（GitHub 已同步至业务 `16b909f`，未推最近 3 个 docs commit 以 `git log origin/master..HEAD` 为准）；数据库写操作（造种子数据/清理）可用 tcb CLI 直读写（node 直调），但仍守「用户确认才动业务数据」。
- 新账号若读不到记忆/文档（权限/磁盘差异），把本文件「衔接提示词」节人工贴入。
- 提审前必复核：auto_approve_partner=false ✅、配置回正 ✅、测试账号清理、env 切 prod；W9 已发布验收通过。
- 云端通道：tcb CLI 直调 cloud1（node 直调 bin/tcb；NoSQL JSON 用 node execSync；fn invoke 用 -e，db nosql 用 --envId；db nosql dump --output-dir）；腾讯云 SCF 官网控制台（st_forbidden）勿用；云端测试面板 env=dev mock 可用。
- 密钥已轮换（admin_web_key/idcard_aes_key 新值仅用户持有）；提醒用户勿再粘贴完整 admin_config/密钥。
- 备份基线 2026-09-29：bundle v0.11.0 + robocopy 热备已含最新 HEAD；backup.ps1 AdminKey 通道待用户用密钥补跑。
