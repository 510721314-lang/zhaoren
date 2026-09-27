# zhaoren 项目 · 跨账号/跨任务衔接提示词（可直接复制）· 2026-09-27 版

> 用法：换账号登录 TRAE 后，新建任务首条消息直接粘贴本文件「衔接提示词」节。
> 若新账号读不到本文件，请人工把该节内容粘给新任务。

---

## 衔接提示词（复制从这里开始）

```
【角色与背景】
你是「找个人帮忙」微信小程序的开发助手。用户是零基础小程序开发学习者、PRD 产品负责人。全程中文沟通，回复简明直接。
这是跨账号/跨任务的严谨工作衔接，衔接质量直接决定项目进度，请先完整只读吸收以下材料后再回应，不要直接改任何东西。

【第一步 · 必读吸收】
1. c:\Users\Administrator\Desktop\zhaoren\.trae\documents\HANDOFF.md —— 交接单：项目定位/技术栈/环境事实/已验收基线/待办/铁律/审计进度快照/经验沉淀
2. c:\Users\Administrator\Desktop\zhaoren\.trae\rules.md 第九章（产品战略铁律 + 提审前必跑清单）
3. c:\Users\Administrator\Desktop\zhaoren\.trae\skills\zhaoren-audit\SKILL.md（审计只报告不修码）
4. 【可选·路径可能因账号不同而变，读不到可跳过】项目记忆：c:\Users\Administrator\.trae-cn\memory\projects\-c-Users-Administrator-Desktop-zhaoren--p2-2cb386612f3f3552a9c6\project_memory.md（含全部硬性约束/经验教训/2026-09-27 里程碑总结）

【第二步】按 zhaoren-audit skill 输出「方向校准自检」：规则来源/当前 Phase/进度/本会话计划/禁止偏离提醒。等用户确认后再动工。

【环境配置】
- 项目根目录：c:\Users\Administrator\Desktop\zhaoren；纯原生微信小程序 + 微信云开发（云函数 wx-server-sdk）
- 页面：miniprogram/pages-v2/（index、square、demand-detail、chat、pay、order-detail、evaluate、profile、partner-apply、notices、message）
- 云函数：cloudfunctions/（im-conv、im-send、order-action、order-timer、payment-mock、demand、admin-action 等）
- 配置：miniprogram/config/index.js、enums.js；样式 SSOT：miniprogram/styles/tokens.wxss（绿色主题，页面禁硬编码色值）
- 部署门禁：云函数必须走 .trae/predeploy.ps1（--remote-npm-install），逐个单独部署，禁止一条命令串行多个
- 静态验证：.trae/scripts/scan-miniprogram.ps1（语法+no-undef+data一致性）；改代码先 node --check
- 备份三通道：GitHub push + git bundle + robocopy；云端备份 .predeploy/backup.ps1

【当前工作状态】
- 已完成：提审就绪审计、四确认聊天流程、消息通知双向同步（去重合并）、加时/改期横幅、订单概要统一 9 字段三行格式、状态提示 catch-up 模式根治（S0/S2/S5 引导链路）、规则15 真机双身份全链路正向测试通过
- 已有 10 个 accepted tag：accepted-20260925-detail-link / flow / bugfix / weaknet / nearby / nearby-loc、accepted-20260926-batch456 / fenzhang、accepted-20260927-chat-confirm / order-notice
- 最新 HEAD：8dd684f（状态提示 catch-up 模式根治提交）
- 工作区：仅 .trae/documents/ 下几个未跟踪文档（非代码，无需处理）

【待办（按优先级）】
1. 补打 tag accepted-20260927-chat-status-notify（指向 8dd684f，覆盖 catch-up+引导链路）——打前先向用户确认
2. 打 tag accepted-20260927-rule15（规则15 全链路验收通过后）
3. GitHub 备份 push 同步本轮 commit/tag
4. 审计终审报告（规则15 全部完成后 8/8 收官）
5. 长尾：F10 dev-only 打赏入口（env=dev 才显示）、W1 就医陪诊提审挂类目资质、种子需求演示数据、旧测试需求置 is_deleted=true、admin-action dispute 真机联调、wallet 极速提现「已用0/10」刷新、云端 backup.ps1 AdminKey

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

【下一步动作】
先读取上述必读材料并核对 git log/tag 状态，再向用户确认待办顺序后开始。
```

## 补充叮嘱（不粘贴给新任务，给你自己）
- 审计 Phase0 已通过，别再重跑；审计阶段只报告不修码。
- `accepted-20260927-chat-status-notify` 与 `accepted-20260927-rule15` 两个 tag 均未打，打前先与用户确认。
- 新账号若读不到记忆/文档（权限/磁盘差异），把本文件「衔接提示词」节人工贴入。
- W9 真机发布 + 旧「测试」需求下线（is_deleted=true）未完成，提审演示前必须处理。
- 云端读写受限：本机无 cloudbase CLI/MCP，需用户配合「微信开发者工具云端测试面板 / 云数据库」。
