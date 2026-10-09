# 找人帮忙小程序 · 新任务投喂提示词（最终版 · 2026-10-09）

> 【入库注记 · 2026-10-09 补做】原文所述 `cfd9655（提示词入库）` 当时未完成，本文件即补做产物（对应补做 commit）。补做时实测 HEAD=`a64fd4d`（功能 3ce629d + deploy-log a64fd4d 均已交付）。原文所述 `C:\zhaoren-bak\zhaoren-deploy-20261009-113029.bundle` 未随新机迁移存在，同日已重建 `C:\zhaoren-bak` + 补打全量 bundle + 新建 CHECKSUMS.txt（详见 docs/deploy-log.md 备注）。

## 项目与环境
- 项目：「找人帮忙」微信小程序（原生 + 微信云开发），env=cloud1-d9gkefwcp5c777088，根目录 c:\zhaoren
- 远端：`https://github.com/510721314-lang/zhaoren.git` 分支 master
- 用户：零基础产品负责人（PRD 负责人）。协作方式：读码/改码/门禁/备份/部署/commit/push 由 AI 全权执行，用户负责审核定方向、提供模板配置、执行手动走查与控制台操作

## 本轮任务：订阅消息增强（需求①增强）——已全量交付，进入走查/启用阶段
对已授权耍伴，在推送站内 system_notice 的同时额外发一条微信订阅消息（cloud.openapi.subscribeMessage.send），弥补纯 pull 站内通知的即时性短板。

### 实现原则（不可违背）：配置化 + 静默降级
- 云调用未开通 / admin_config.sub_msg_templates 未配（缺 tmpl_id）/ 用户未授权 / 订阅配额耗尽（errno 43101）/ 模板字段不足 → 一律 catch 吞掉，退回站内 system_notice，绝不阻断现有推送链路与原流程
- 模板ID + 字段号配置化下发（admin_config.sub_msg_templates.demand_grab），不硬编码
- 模板未配时前端「抢单提醒」开关自动置灰；用户提供模板后 config_public 自动透出、开关自动可点，前端无需再发版

## 交付状态（已完成 + 已核验，勿重复验证）
- 功能实现 + commit + 部署 + push + 入库全部完成，门禁全绿
- 关键 commit：3ce629d（功能 +176/-7，6 文件）→ a64fd4d（deploy-log 3 行）→ cfd9655（提示词入库）；HEAD=cfd9655=origin/master
- 回滚点 2193257；部署前归档 C:\zhaoren-bak\zhaoren-deploy-20261009-113029.bundle（SHA256 985E0010…821，与 CHECKSUMS.txt 台账一致）
- 云端已部署 order-timer / admin-action / partner-action；CLI 下载云端代码与本地 SHA256 逐字节一致（C03AE071 / 192131D6 / 5F399C0B），新符号命中 5/9/7
- 门禁最新复跑：node --check 5/5、npm test 130/130
- 工作区干净，仅 1 个未跟踪文件：.trae/documents/20261008-站内抢单通知-代他人发布-3B走查.md（十·八批次走查记录，待走查后定夺入库）
- 已知轻微冗余（非缺陷，勿改）：accept-config 的 subMsgCfg.page 前端未使用（跳转页由服务端 sendDemandSub 控制）

## 实现锚点（改哪段看哪段）
**1) cloudfunctions/order-timer/index.js**
- processDemandNotify：查 demand {grab_notify_pending:true, status:'matching', is_deleted:false}，created_at asc，limit BATCH=50；候选=同场景+approved+accept_switch非false+信用≥min_credit_take_order；范围内=需求有合法经纬度 且 耍伴 home_location 有坐标 且 haversineKm ≤ min(own_max_distance_km, platform take_distance_max_km)
- targets 为 {openid, sub}，sub = p.sub_msgs.demand_grab.authorized===true
- 先对全 targets 写 system_notice（type=demand_grab / title=有新需求可接单 / action_key=jump_demand / demand_id），再对「配了 tmpl_id 且 sub=true」子集调 sendDemandSub（Promise.allSettled + 吞 catch）；处理完 CAS 置 grab_notify_pending=false；返回 {done, fail, scanned}
- 顶层 fmtDate（L168）、sendDemandSub（L179，subscribeMessage.send L196）；字段映射缺省 {thing1:'subject', thing2:'scene', time:'start_time'}，page 缺省 pages-v2/demand-detail/demand-detail，miniprogramState 缺省 formal

**2) cloudfunctions/admin-action/index.js**
- config_public（L420-427 派生 + L539-540 下发）：有 tmpl_id → sub_msg.demand_grab={enabled:true, tmpl_id, page, miniprogram_state, fields}；否则 {enabled:false}
- config_set（L2099-2112）：支持写 sub_msg_templates（白名单仅 demand_grab，merge；tmpl_id 校验 ^[A-Za-z0-9_-]{1,80}$）
- CONFIG_SCHEMA 未加键（嵌套对象不适用标量 schema），属有意设计

**3) cloudfunctions/partner-action/index.js**
- sub_authorize（L639-654）：入参 {tmpl:'demand_grab', authorized:bool} → 写 partner_profile.sub_msgs.demand_grab={authorized, updated_at} + writeAudit(partner_sub_authorize)
- my_profile 回传 sub_msgs（L699）

**4) 前端**
- miniprogram/config/index.js：SUB_MSG.demandGrab 兜底（L67）
- pages-v2/pkg-low/accept-config/accept-config.js：subAuthorized/subMsgCfg（L71-72）；fetchData 并行拉 admin-action config_public 取 sub_msg.demand_grab、用 my_profile.sub_msgs 回显（L132/152-160）；onSubToggle（L447-480）：模板未配 toast+置灰，勾选 wx.requestSubscribeMessage 且 accept 才 sub_authorize({authorized:true})，关闭直写 false
- accept-config.wxml：卡片 L180-183，enabled 控文案、disabled=!enabled

## 用户待办（手动，按序，跨会话持续有效）
① 控制台建 demand 复合索引（唯一无法自动验证项）：字段 grab_notify_pending(Boolean)↑ + status(String)↑ + created_at(Number)↓，非唯一，建议名 grab_pending_scan。不建则抢单通知扫描不生效
② 走查①「站内抢单通知」闭环　③ 走查②「代他人发布」　④ 走查③「3B 爽约（提交/举证/裁定）」
⑤ 走查结果回填 docs/deploy-log.md
⑥ 启用订阅消息：申请并审核通过「抢单提醒」模板，取模板ID+字段号，写入 admin_config.sub_msg_templates.demand_grab（tmpl_id、fields:{实际字段号:'subject'|'scene'|'start_time'}、可选 page/miniprogram_state；经 admin-web config_set 或控制台）→ 前端 config_public 自动透出、开关自动可点

## 测试身份
管理员 openid=oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c｜耍伴 test_partner_001

## 纪律 / 关键经验（必守）
- 备份纪律：云函数改动必须重新部署才生效；部署前先 commit（保工作区干净）→ git bundle 归档至 C:\zhaoren-bak（时间戳命名）+ SHA 记 CHECKSUMS.txt → 记 docs/deploy-log.md（回滚点=前一 commit）；提交前跑门禁（node --check + npm test 130）
- push 绕 proxy：git -C c:\zhaoren -c http.proxy= -c https.proxy= push（默认 proxy 指死端口 7890 会超时）
- 金额/状态机/新字段：先读码再改、不臆造字段；命名按既有约定（sub_msgs / sub_authorize）
- 运营参数 SSOT：服务端恒读 admin_config 实配值，前端 CONFIG/CLOUD_MAP 仅兜底
- 部署串行禁并发（否则 Updating 冲突）；用 --remote-npm-install；免费版超时锁死 3 秒，长流程靠「每步落库 + 幂等 + 断点续跑」
- 部署后验证可选：CLI cloud functions download 下载云端代码与本地比对 SHA256
- commit/push 需经用户确认；云函数代码/索引台账已纳入备份（L6/L7）

## Language
中文。代码注释也中文。