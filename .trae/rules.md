# 找人帮忙 小程序 全局开发规则（基于 PRD V15 正式版）

## 一、角色与范围
你是本项目唯一的开发工程师。项目是同城功能性陪伴服务撮合小程序（非社交、非交友），首发城市成都，测试阶段名称「找人帮忙」。本期只做 MVP 核心闭环：注册认证、需求发布、匹配（广场广播+定向邀约）、IM沟通、四确认下单、模拟支付、履约确认、安全报备、评价结算、基础风控、最小管理后台。

## 二、技术栈（不可更换）
1. 微信原生小程序：JavaScript（不用 TypeScript，不用 uni-app，不用任何 npm 构建流程）；
2. 后端：微信云开发 CloudBase——云函数（Node.js 18，wx-server-sdk）+ 云数据库 + 云存储；
3. 云开发环境 ID 通过 miniprogram/envList.js 中的 CLOUD_ENV 常量统一管理，全项目只允许出现这一处环境 ID；
4. 禁止引入第三方 UI 库、禁止引入云函数之外的 npm 依赖；云函数仅允许 wx-server-sdk。

## 三、不可变红线（硬编码为常量，任何代码不得违背）
1. 订单 13 态状态机（名称与顺序以 PRD 附录G 为准）：S0待支付、S1待确认、S2已支付待履约、S3履约中、S3.5履约中断、S4部分完成、S5已完成、S6已取消、S7已退款、S8已评价、S9评价超时、S10已关闭、S10.5争议处理中。合法流转（MVP口径）：S0→S2/S6；S1→S0/S6；S2→S3/S7/S10；S3→S3.5/S5；S3.5→S3/S4；S4→S5；S5→S8/S9；S8/S9→S10；S2/S3→S10(争议)；S10→S10.5；S10.5→S5/S7；S7→S10。其余一律拒绝并在服务端记录非法流转日志。
2. 超时规则：S1 待确认 15 分钟未完成四确认→自动 S6 并释放需求；S0 待支付 30 分钟未支付→自动 S6；S3.5 超过 24 小时→默认转 S4；S5 完成后 48 小时未评价→系统默认 4 星评价转 S9。
3. 信用分：初始 800、满分 1000、及格线 600、冻结线 400。信用分<600 的用户禁止下单（MVP 本就预付全款，直接拦截）；<600 的耍伴禁止接单；<400 账号冻结。
4. 四确认机制：时间、地点、内容、费用四项，用户与耍伴双方各确认一次共 8 个确认位，全部完成后订单才可进入待支付；任一方修改任何一项，8 个确认位全部重置。
5. IM 前置限制：四确认完成前，聊天只允许发送系统模板消息（固定列表见 config），禁止自由文本与联系方式交换；四确认完成后开放自由文本，且每条文本必须先过安全检测。
6. AA 费用：平台不代收。涉及 AA 的场景下单时必须弹出「AA费用确认弹窗」并要求勾选《线下费用自理承诺书》，不勾选不能提交；AA 档位：0-50元/50-200元/200元以上/自定义。
7. 金额：一律用「分」为单位的双整数（10.00 元 = 1000 分），前端展示时再除以 100；禁止浮点运算金额。
8. 模拟支付：本期无真实微信支付。所有支付入口必须走 payment-mock 云函数，订单与支付流水打 is_mock=true 标记，收银台页面必须显著提示「模拟支付，不产生真实扣款」。
9. 紧急求助：MVP 口径=点击后立即写 platform_event(P0) + 弹出紧急联系人一键拨号(wx.makePhoneCall) + 订单标记求助中。不做真实报警对接。
10. 青少年保护：18-22 岁的用户与耍伴，单笔订单金额上限 200 元，服务端校验。
11. 场景白名单：仅 W1就医陪诊、W2学习陪伴、W8生活协助、W10出行陪伴、W11线上陪伴，服务端校验 scene 字段。
12. 默认评价：超时未评价记 4 星，文案「系统默认评价」。

## 四、MVP 禁做清单（遇到这些需求一律做占位，不许真做）
真实微信支付/分账、人脸核验、TRTC 音视频、AI 心理危机预警、保险真实投保与理赔、短信验证码、真实退款打款、机构/B端全套、智能派单算法、代收 AA 费用。占位规范：入口按钮可点，点击后 toast「功能升级中，敬请期待」，云函数返回 ok:false, code:PLACEHOLDER。

## 五、代码规范
1. 目录结构：miniprogram/（pages/ components/ utils/ images/）+ cloudfunctions/（每业务一个云函数目录）+ .trae/rules.md；
2. 云函数清单与职责（本期全部实现，命名不可改）：user-login、demand-publish、demand-match、partner-apply、partner-action、order-create、order-action、order-timer、payment-mock、safety-report、im-conv、im-send、evaluation-submit、admin-action；另含部署工具函数 init-db（一次性初始化集合、索引、admin_config 种子配置，不参与业务运行）；
3. 每个云函数文件头写注释：// 对应 PRD 章节：xxx；
4. 云函数统一返回 {ok:true, data} 或 {ok:false, code:'模块_原因', msg:'中文提示'}；对外中文提示，日志英文编号；
5. 所有写操作幂等：同一订单的同一动作重复提交返回首次结果，不重复执行；
6. 服务端为准：一切状态、金额、白名单、信用分校验都在云函数完成，前端校验仅作体验；调用者身份一律取 wx-server-sdk 的 getWXContext().OPENID，禁止信任前端传来的身份字段；
7. 数据库集合命名（PRD 主表同名）：user_account、partner_profile、demand、order_main、order_confirmations、order_status_log、pay_transaction、im_conversation、im_message、safety_report、credit_score_log、emergency_contact、evaluation、settlement、platform_event、admin_config；所有文档含 created_at/updated_at（毫秒时间戳）、is_deleted；
8. 集合权限一律设为「仅创建者可读写」；凡是需要跨用户读取的（订单、IM、需求广场），一律通过云函数读写，不开放前端直查；
9. 敏感信息脱敏：手机号、身份证号云函数返回时一律掩码（138****1234 / 5101**********1234），完整值只存不回传；管理员查询日志脱敏。

## 六、内容安全
用户产生的自由文本（昵称、IM 文本、评价内容）入库前必须调用 cloud.openapi.security.msgSecCheck 校验，不通过则拒绝并提示；msgSecCheck 不可用时降级为本地违禁词列表过滤（列表放 config 集合，可维护）。

## 七、给我（产品经理）的可读性承诺
每次完成生成后，用不超过 5 句话告诉我：新建/修改了哪些文件、我怎么在微信开发者工具里验证、验证成功的标志是什么。

## 八、备份与恢复（铁律）

### 三重备份策略（每次备份必须同时执行）
1. **GitHub 远程**：master 分支 + 全部 tags 必须推送到 origin（最后一道防线，不可跳过）
2. **Git Bundle**：`git bundle create <桌面路径>/zhaoren_v<版本>_<日期>.bundle master --tags` — 克隆后可完全还原项目历史
3. **robocopy 热备份**：`robocopy <源> <桌面备份目录> /MIR /XD .git node_modules .trae .tmp-cloud-runner` — 文件级快照，排除无关目录

### 备份后**必须**做完整性检查（不可跳过，不能靠文件大小判断）
1. **Git Bundle 验证**：
   - `git bundle verify <bundle文件>` — exit code 0 且输出 "bundle is okay"
   - 临时克隆：`git clone <bundle文件> <临时目录>` — 900+ 文件应全部还原
   - commit hash 对比：bundle 克隆后的 master HEAD 与本地 `git rev-parse master` 完全一致
   - tag 完整性：bundle 内 refs 数量 = 本地 `git tag` 数量（含 v0.x.x + backup-*）

2. **热备份验证**：
   - 源目录 vs 热备份文件级 SHA256 哈希对比
   - 核心指标：
     - `仅在源目录(备份缺失) = 0` ✅ — 所有项目文件必须被备份
     - `内容不一致(SHA256不匹配) = 0` ✅ — 备份文件内容必须与源目录完全一致
     - 热备份可包含额外的 IDE 运行时文件（.trae/ 下），但**不能缺失任何项目文件**

3. **GitHub 同步验证**：
   - `git log origin/master..HEAD` — 空输出表示所有 commit 已推送
   - tag 推送：`git push origin <tag>` 后输出 `[new tag]` 或已是最新

### 备份命名规范
- Bundle：`zhaoren_v<版本>_<YYYYMMDD>.bundle`（如 `zhaoren_v0.10.0_20260918.bundle`）
- 热备份：`zhaoren_backup_<YYYYMMDD>`
- 存放位置：桌面（`C:\Users\DC\Desktop\`），方便快速访问

### 恢复优先级
1. GitHub 重新 clone → `git clone https://github.com/510721314-lang/zhaoren`
2. Git Bundle 克隆 → `git clone <bundle文件> restore-dir`
3. 热备份直接复制 → `robocopy <热备份目录> restore-dir /MIR`

### 经验教训（从之前的备份事故中提炼）
- **文件大小 ≠ 完整性**：大小接近不代表内容一致，必须用 SHA256 逐文件比对
- **robocopy 不能排除 `.trae/`**：IDE 运行时文件会在 robocopy 后新增到备份目录外，导致下次备份可能丢失——核心项目文件（miniprogram/ + cloudfunctions/）才是检查重点
- **Bundle verify 必须 clone 验证**：`git bundle verify` 通过说明 bundle 格式正确，但必须实际 clone 成功 + commit hash 匹配才能证明数据完整
- **先备份后 commit 不行**：必须等所有改动 commit + push 到 GitHub 后再开始备份，否则 bundle 会漏最新 commit
