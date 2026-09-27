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
1. c:\Users\Administrator\Desktop\zhaoren\.trae\documents\HANDOFF.md —— 交接单：项目定位/技术栈/环境事实/已验收基线/待办/铁律/审计进度快照/经验沉淀。特别阅读 §9 多轮任务经验沉淀（同类bug根治闭环/catch-up铁律/导航纪律/避坑清单）——即使读不到项目记忆，也能从此节获取全部经验
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
- 云端读写受限（重要）：本机无 cloudbase CLI / cloudbase MCP 挂载 → AI 无法自动读写云端，需用户配合「微信开发者工具云端测试面板 / 云数据库」

【当前工作状态】
- 已完成：提审就绪审计（Phase0/10/11/12/13/14/16 已过 7/8）、四确认聊天流程、消息通知双向同步（去重合并）、加时/改期横幅、订单概要统一 9 字段三行格式、状态提示 catch-up 模式根治、规则15 真机双身份正向链路通过 + 负向 6/9（N3/N5/N6b/N7/N8/N9）、**admin-web 代理旁路安全修复（36daa77 已部署）**、**pay/order-detail 页子场景显示（5c1ad92）**
- 已有 13 个 accepted tag：accepted-20260925-detail-link / flow / bugfix / weaknet / nearby / nearby-loc、accepted-20260926-batch456 / fenzhang、accepted-20260927-chat-confirm / order-notice / chat-status-notify / rule15 / security-fix（36daa77）
- 最新 HEAD：`13c6840`（交接文档）；已 push GitHub，bundle v0.10.6 含全部 refs；robocopy 快照 worktree_20260927_security 停在 36daa77 待补刷（见待办4）
- 工作区：仅 3 个无关未跟踪文件（seed-scene-demands*.md 历史文档、tmp_cf_check_result.txt 临时产物，无需处理）

【待办（按优先级）】
1. 规则15 负向收尾：N1（四确认超时15min）/ N2（支付超时30min）/ N4（履约中断需S3订单）/ N6a（可选）——其余已通过；完成后 8/8 出终审报告
2. 【提审阻塞·内容安全】complaint_reason / modify/extend reason / milestone note / sos/checkin note 等自由文本未过 msgSecCheck（审核7项内容安全合规缺口，非普通长尾）——需补 msgSecCheck 后部署 order-action/safety-report/payment-mock
3. 【数据清理】N8b 测试污染：S9 订单 a9defcfd6aa20230011cfea075899ac6 已被打赏 1250 分（tip_no=TIP202609275612e18196f78237），云数据库手工删除该 tip 流水/标记 is_test，防提审脏数据
4. 【备份补全】robocopy 快照 worktree_20260927_security 停在 36daa77 落后 2 commit——新电脑克隆后废弃旧 worktree，或补刷到 13c6840
5. 安全：轮换 admin_web_key 与 idcard_aes_key（曾明文暴露会话）；admin-web bootstrap 硬编码 openid / notice_read 归属 / aa_record 上限 / isMockAdmin 上线前删除
6. 功能长尾：order-action get_confirmation 的 ORD 反查 bug（index.js:217 遮蔽）
7. 独立阻塞项：W9 宠物陪伴真机发布（verifySignatureFile 真实手写签名 PNG）+ 旧「测试」需求 is_deleted=true 下线
8. 长尾：F10 dev-only 打赏入口、W1 提审挂类目资质、种子需求演示数据、admin-action dispute 真机联调、wallet 极速提现刷新、backup.ps1 AdminKey

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
- 每次刷新本提示词后，必须跑「衔接提示词完整性检查清单」（7 维度 + 10 关键术语反向 Grep + 出包三处一致/git 入库），清单全文见项目记忆同名字节。
- 审计 Phase0 已通过，别再重跑；审计阶段只报告不修码（例外：高危安全修复经用户确认后可改，参考 36daa77）。
- 13 个 accepted tag 已全部 push（含 security-fix@36daa77）；HEAD=13c6840 已 push。
- 新账号若读不到记忆/文档（权限/磁盘差异），把本文件「衔接提示词」节人工贴入。
- W9 真机发布 + 旧「测试」需求下线（is_deleted=true）未完成，提审演示前必须处理。
- 云端读写受限：本机无 cloudbase CLI/MCP，需用户配合「微信开发者工具云端测试面板 / 云数据库」。云开发控制台多实例易混，必须用微信开发者工具内置控制台（cloud1-d9gkefwcp5c777088），判断标准=order_main 含 status/scene/total_fen/content_options。
- admin_web_key/idcard_aes_key 曾明文暴露会话 → 待用户配合轮换；提醒用户勿再粘贴完整 admin_config。
