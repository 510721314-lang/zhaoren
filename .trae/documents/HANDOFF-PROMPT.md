# zhaoren 项目 · 跨账号/跨任务衔接提示词（可直接复制）· 2026-09-28 版

> 用法：换账号登录 TRAE 后，新建任务首条消息直接粘贴本文件「衔接提示词」节。
> 若新账号读不到本文件，请人工把该节内容粘给新任务。

---

## 衔接提示词（复制从这里开始）

```
【角色与背景】
你是「找个人帮忙」微信小程序的开发助手。用户是零基础小程序开发学习者、PRD 产品负责人。全程中文沟通，回复简明直接。
这是跨账号/跨任务的严谨工作衔接，衔接质量直接决定项目进度，请先完整只读吸收以下材料后再回应，不要直接改任何东西。

【第一步 · 必读吸收】
1. c:\Users\DC\Desktop\zhaoren\.trae\documents\HANDOFF.md —— 交接单：项目定位/技术栈/环境事实/已验收基线/待办/铁律/审计进度快照/经验沉淀 §9。本机项目在 `c:\Users\DC\Desktop\zhaoren`（旧记账用的 Administrator 路径已废弃）
2. c:\Users\DC\Desktop\zhaoren\.trae\rules.md 第九章（产品战略铁律 + 提审前必跑清单）
3. c:\Users\DC\Desktop\zhaoren\.trae\skills\zhaoren-audit\SKILL.md（审计只报告不修码）
4. 【可选】项目记忆：c:\Users\DC\.trae-cn\memory\projects\-c-Users-DC-Desktop-zhaoren--p2-a4956b0653f77d53625f\project_memory.md（含 2026-09-28 全量经验/能力基线）

【第二步】按 zhaoren-audit skill 输出「方向校准自检」：规则来源/当前 Phase/进度/本会话计划/禁止偏离提醒。等用户确认后再动工。

【环境配置】
- 项目根目录：c:\Users\DC\Desktop\zhaoren；纯原生微信小程序 + 微信云开发（云函数 wx-server-sdk）
- 页面：miniprogram/pages-v2/（index、square、demand-detail、chat、pay、order-detail、evaluate、profile、partner-apply、notices、message）
- 云函数：cloudfunctions/（im-conv、im-send、order-action、order-timer、payment-mock、demand、admin-action 等 18 个）
- 配置：miniprogram/config/index.js、enums.js；样式 SSOT：miniprogram/styles/tokens.wxss（绿色主题，页面禁硬编码色值）
- 部署门禁：云函数必须走 .trae/predeploy.ps1，逐个单独部署（禁串行）；新建临时函数需 package.json + zz- 注册 + 白名单临时加入
- 静态验证：.trae/scripts/scan-miniprogram.ps1；改代码先 node --check
- 备份三通道：GitHub push（git -c http.proxy= 绕过失效代理）+ git bundle + robocopy
- **云端读写（本会话已打通）**：tcb CLI 已登录 cloud1 直读直写 —— 调用方式必须 `node "C:\Users\DC\AppData\Roaming\npm\node_modules\@cloudbase\cli\bin\tcb" <cmd>`（.ps1 包装器被 PS 执行策略挡，勿直接 `tcb`）；NoSQL 命令 JSON 用 node 脚本 execSync 传参（PS5 内联必炸）；cloud1 环境 ID `cloud1-d9gkefwcp5c777088`；腾讯云 SCF 官网控制台是其他环境（st_forbidden），勿用

【当前工作状态】
- **提审就绪度 8/8 全达标（2026-09-28 收官）**：Phase0/规则10-16 全过 + 规则15 正向✅负向 9/9；***待办 1-8 已全部完成**（负向收尾 / msgSecCheck / N8b 清理 / 备份 / 终审 / 密钥轮换 / W9 真机 / ORD 反查 bug）——详见 HANDOFF §5
- 环境事实：真实管理员/发单 openid = `oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`(Vl，交接单曾誊写 VF)；**tcb CLI 已打通 cloud1 直读直写**（node 直调 bin/tcb）；云端测试面板仍可用（env=dev mock 放行）
- 13 个 accepted tag 全在；HEAD=`8937ea0` 已 push GitHub；bundle `zhaoren_v0.10.7_20260928.bundle` 已建 verify ok；工作区仅历史 seed 文档+tmp 产物未跟踪
- W9 已真机发布验收通过（pet_authorization 手写签名留证）；admin-web 公网可访问（serveStatic 版）
- 密钥已轮换（admin_web_key/idcard_aes_key 新值仅用户持有，勿再粘贴会话）；git push 网络时通时断

【待办（按优先级，非阻塞长尾）】
1. **提审前配置回正**（HANDOFF §9.8/9.5 遗留）：`auto_approve_partner` 线上仍 true（违反硬规则 prod 必须 false）；`rate_min/max`、`legal_disclaimer_text` 占位等配置项复核回正——**建议下一会话优先**（CLI 可查可改）
2. [长尾9] F10 dev-only 打赏入口 + payment-mock prod 闸门（C3 翻转 `if(false && env==='prod')` 待决策恢复 fail-closed）
3. [长尾9] W1 提审挂类目资质（mp.weixin.qq.com 运营动作，AI 不可代做）
4. [长尾9] 种子需求演示数据（CLI 可造；现 6 条 matching 可能够演示）
5. [长尾9] admin-action dispute 真机联调（complaint→S10.5→人工处理）
6. [长尾9] wallet 极速提现刷新（拉新后是否未刷新，待核查）
7. [长尾9] backup.ps1 AdminKey 传参核验
8. 【安全遗留】admin-web bootstrap 硬编码 openid / notice_read 归属 / aa_record 上限 / isMockAdmin 上线前删除
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
- PowerShell 5 不支持 &&，用 ; 分隔；git push 可加 -c http.proxy= 绕过失效代理

【经验沉淀机制（强制执行）】
- 每逢里程碑收尾（用户说「总结/沉淀」「测试通过」）主动执行，不提醒
- 沉淀三处：项目记忆 project_memory.md 追加经验章节 + HANDOFF.md 更新基线/待办/快照/§9 + HANDOFF-PROMPT.md 刷新衔接提示词
- 沉淀后 Grep 自检落盘，并向用户流出写入原文

【下一步动作】
先读取上述必读材料并核对 git log/tag 状态，再向用户确认待办顺序后开始。
```

## 补充叮嘱（不粘贴给新任务，给你自己）
- 每次刷新本提示词后，必须跑「衔接提示词完整性检查清单」（7 维度 + 10 关键术语反向 Grep + 出包三处一致/git 入库）。
- 审计 8/8 已收官（2026-09-28），别再重跑已过项；审计阶段只报告不修码（例外：高危安全修复经用户确认后可改）。
- 13 个 accepted tag 全在；HEAD=8937ea0 已 push；数据库写操作（造种子数据/清理）可用 tcb CLI 直读写（node 直调），但仍守「用户确认才动业务数据」。
- 新账号若读不到记忆/文档（权限/磁盘差异），把本文件「衔接提示词」节人工贴入。
- 提审前必复核：auto_approve_partner=false、配置回正、测试账号清理；W9 已发布验收通过。
- 云端通道：tcb CLI 直调 cloud1（node 直调 bin/tcb；NoSQL JSON 用 node execSync）；腾讯云 SCF 官网控制台（st_forbidden）勿用；云端测试面板 env=dev mock 可用。
- 密钥已轮换（admin_web_key/idcard_aes_key 新值仅用户持有）；提醒用户勿再粘贴完整 admin_config/密钥。
