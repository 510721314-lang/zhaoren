# 找人帮忙小程序 · 新任务投喂提示词（最新完整版）

## Intent（目标）
为「找人帮忙」微信小程序（原生 + 微信云开发，env=cloud1-d9gkefwcp5c777088，项目根 c:\zhaoren）在站内抢单通知（需求①）基础上完成订阅消息增强：对已授权耍伴在推送站内 `system_notice` 的同时，额外发一条微信订阅消息（`cloud.openapi.subscribeMessage.send`），弥补纯 pull 站内通知的即时性短板。

用户是零基础产品负责人（PRD 产品负责人）。协作方式：**技术执行（读码/改码/门禁/备份/部署/commit/push）由 AI 全权承担，用户负责审核定方向、提供模板配置与执行手动走查**。

## 已确认实现原则（不可违背）
**配置化 + 静默降级**：
- 云调用未开通 / `admin_config.sub_msg_templates` 未配（缺 `tmpl_id`）/ 用户未授权 / 订阅配额耗尽（errno **43101**，一次性订阅）/ 模板字段不足 → 一律 catch 吞掉，**退回站内 system_notice，绝不阻断现有推送链路与原流程**。
- 模板ID + 字段号（thing1/thing2/time几）配置化下发（存 `admin_config.sub_msg_templates.demand_grab`），**不硬编码**。
- 未配置模板时前端「抢单提醒」开关自动置灰，能力无害隐藏；用户提供模板后 config_public 自动透出、开关自动可点，**前端无需再发版**（前端已按配置态渲染）。

## 当前状态（本特性已全量交付）
- 功能已完整实现 + commit + 部署 + push，门禁全绿。
- git：master 工作区**干净**（除 1 个未跟踪走查文档），origin/master = `a64fd4d`。
- **未跟踪文件**：`.trae/documents/20261008-站内抢单通知-代他人发布-3B走查.md`（十·八批次走查记录，待用户完成走查后决定是否入库）。
- deploy-log 已记 3 行（commit `a64fd4d`）；部署前归档 `zhaoren-deploy-20261009-113029.bundle`（SHA256 已记 `C:\zhaoren-bak\CHECKSUMS.txt`）；回滚点 `2193257`。
- 云端已部署且 `success=true`：order-timer（13.2KB）/ admin-action（69.7KB）/ partner-action（27.5KB）。
- **唯一未启用项**：订阅消息模板配置（用户待办⑥，用户提供后非改码触发，不阻塞其余待办）。

## 已实现代码锚点（改哪段看哪段）
**1) cloudfunctions/order-timer/index.js**
- `processDemandNotify(now, cfg)`（原 L168-220 起）：查 demand `{grab_notify_pending:true, status:'matching', is_deleted:false}` 按 created_at asc limit `BATCH=50`；对每条找可接耍伴（同场景 + approved + accept_switch 非 false + 信用≥min_credit_take_order；范围内 = 需求有合法经纬度 且 耍伴 home_location 有坐标 且 haversineKm ≤ min(own_max_distance_km, platform take_distance_max_km)）。
- targets 为 `{openid, sub}` 数组，`sub = !!(p.sub_msgs && p.sub_msgs.demand_grab && p.sub_msgs.demand_grab.authorized === true)`。
- 先对全 targets 写 system_notice（type=demand_grab / title=有新需求可接单 / action_key=jump_demand / demand_id），`pushed` = fulfilled 数。
- 再对「配置了 tmpl_id 且 sub=true」子集调 `sendDemandSub(d, subTmpl, openid)`（Promise.allSettled + 吞 catch 记日志）。
- 处理完 CAS 置 grab_notify_pending=false（markDone 内联），返回 `{done, fail, scanned}`。
- 顶层 `sendDemandSub(d, subTmpl, openid)`：从 `subTmpl.fields`（缺省 `{thing1:'subject', thing2:'scene', time:'start_time'}`）映射取值构造 `data={kw:{value}}`（subject=content_options[0]或title、scene=场景码、start_time=fmtDate）；调 `subscribeMessage.send({touser, templateId, page: subTmpl.page||'pages-v2/demand-detail/demand-detail', data, miniprogramState: subTmpl.miniprogram_state||'formal'})`。另有 `fmtDate(ts)`。

**2) cloudfunctions/admin-action/index.js**
- CONFIG_SCHEMA（L98-193）**未**加 schema 键（sub_msg_templates 是嵌套对象，不适用 int/bool 标量 schema）。
- config_public（L415+）：下发 `sub_msg.demand_grab`（有 tmpl_id → `{enabled:true, tmpl_id, page, miniprogram_state:'formal', fields}`；否则 `{enabled:false}`）。
- config_set：支持写 `sub_msg_templates`（白名单仅 demand_grab 子阈，merge 进 admin_config，校验 tmpl_id 格式 `^[A-Za-z0-9_-]{1,80}$`）。

**3) cloudfunctions/partner-action/index.js**
- 新增 action `sub_authorize`（在 update_config 与 my_profile 之间）：入参 `{tmpl:'demand_grab', authorized:bool}`，写 `partner_profile.sub_msgs.demand_grab={authorized, updated_at}`，并 writeAudit（action:'partner_sub_authorize'）。
- my_profile 返回新增 `sub_msgs`。

**4) 前端**
- `miniprogram/config/index.js`：新增 `SUB_MSG.demandGrab` 兜底 `{enabled:false, tmplId:'', page:'pages-v2/demand-detail/demand-detail', miniprogramState:'formal'}`。
- `miniprogram/pages-v2/pkg-low/accept-config/accept-config.js`：data 增 `subAuthorized` / `subMsgCfg`；fetchData 并行多拉一次 `admin-action config_public` 取 `sub_msg.demand_grab` 覆盖兜底、并用 `my_profile.sub_msgs` 回显；新增 `onSubToggle(e)`——模板未配 toast+置灰，勾选走 `wx.requestSubscribeMessage({tmplIds:[tmplId]})`，`res[tmplId]==='accept'` 才 `sub_authorize({authorized:true})`，关闭直接 `sub_authorize({authorized:false})`。
- `accept-config.wxml`：新增「抢单提醒」卡片，`{{subMsgCfg.enabled}}` 控制文案，`disabled="{{!subMsgCfg.enabled}}"`。

## 用户待办（手动，跨会话持续有效，按序）
①（若未建）控制台建 demand 复合索引 `{grab_notify_pending:1, status:1, created_at:-1}`（wx-server-sdk 无 createIndex，必须控制台；不建则抢单通知扫描不生效）。
②走查①「站内抢单通知」闭环。③走查②「代他人发布」。④走查③「3B 爽约（提交/举证/裁定）」。
⑤走查结果回填 `docs/deploy-log.md`。
⑥**启用订阅消息**：拿到微信公众平台已审核的「抢单提醒」模板ID + 字段号，写入 `admin_config.sub_msg_templates.demand_grab`（结构：`tmpl_id`、`fields:{实际字段号:'subject'|'scene'|'start_time'}`、可选 `page`/`miniprogram_state`；可经 admin-web config_set 或控制台写入）→ 前端 config_public 自动透出、开关自动可点。

## 测试身份
管理员 openid=oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c｜耍伴 test_partner_001。

## 纪律 / 关键经验（跨会话必守）
- **备份纪律**：云函数改动必须重新部署才生效；部署前 `git -C c:\zhaoren bundle create "C:\zhaoren-bak\zhaoren-deploy-<时间戳>.bundle" master --tags` 归档上一版 + 记 `docs/deploy-log.md`（回滚点 = 前一 commit）+ SHA 记入 `C:\zhaoren-bak\CHECKSUMS.txt`；**部署前工作区须干净**（即先 commit）；提交前跑门禁（`node --check` + `npm test` 130 条）。
- **push 远端需绕 proxy**：`git -C c:\zhaoren -c http.proxy= -c https.proxy= push`（默认 proxy 指向死端口 7890 会超时）。
- **金额/状态机/新字段改动**：先读码再改、不臆造字段；新落库字段按既有约定命名（如 `sub_msgs`、`sub_authorize`）。
- **运营参数 SSOT**：服务端恒读 `admin_config` 实配值，前端 `CONFIG`/`CLOUD_MAP` 仅兜底；新增配置尽量走 config_public 下发。
- **部署串行**禁并发（否则报 Updating 冲突）；用 `--remote-npm-install`；免费版超时锁死 3 秒，长流程靠「每步落库 + 幂等 + 断点续跑」。
- **commit/push 需经用户确认**（本次功能已获确认完成；后续走查文档等入库同样先确认）。

## Language
中文。代码注释也中文。