# 部署记录表（deploy log）

> 目的：部署回滚最小方案（专家优化建议 ①）。每次云函数部署前先 git bundle 归档上一版，部署完成后在此表追加一行；回滚点 = 前一 commit。
> 铁律：部署前工作区须干净；归档发生在**部署命令执行前**；部署后 90-120 秒再验证（云端 npm install 进行中）。
> 回滚操作：`git checkout <回滚点 commit> -- cloudfunctions/<函数名>`（或整体 checkout）→ 重新部署该函数。

## 记录表

| 日期 | 函数 | 前 commit | 后 commit | 部署前 bundle | 回滚点 | 说明 |
|---|---|---|---|---|---|---|
| 2026-10-07 | admin-web | d13e7ad | ebc2f4b | zhaoren-deploy-20261007-20261007-081223.bundle | d13e7ad | P0② 网关鉴权失败告警(bad_key/missing_key → platform_event) |
| 2026-10-07 | order-timer | d13e7ad | ebc2f4b | zhaoren-deploy-20261007-20261007-081223.bundle | d13e7ad | P0②③ error_scan 巡检项④网关鉴权突增 + auditPrune 90 天留存 |
| 2026-10-07 | admin-action | d13e7ad | ebc2f4b | zhaoren-deploy-20261007-20261007-081223.bundle | d13e7ad | P0④ config_history 集合 + config_set 快照 + 敏感键掩码 + 保留 100 版 |
| 2026-10-07 | admin-web | 0051ba0 | 0059b0f | zhaoren-deploy-20261007-20261007-083725.bundle | 0051ba0 | 专家复核项① `recordGatewayBadKey` 改 await（防响应后运行时回收截断事件写入） |
| 2026-10-07 | admin-action | 0051ba0 | 0059b0f | zhaoren-deploy-20261007-20261007-083725.bundle | 0051ba0 | 专家复核项③ `config_history` 纳入 EXPORT_COLLECTIONS（打通端到端验证/备份通道） |
| 2026-10-07 | order-timer | 2d918e1 | N/A（探针代码未入 git，已移除） | zhaoren-deploy-20261007-probe-20261007-102434.bundle | 2d918e1 | 【诊断探针·已移除】实证 orderTimer 每 5 分钟确实在调用函数，但 context 无 TRIGGER_NAME（SCF 事件格式），每轮被 ot_forbidden 拦截 |
| 2026-10-07 | order-timer | 2d918e1 | 42d8aa9 | zhaoren-deploy-20261007-fix-20261007-103336.bundle | 2d918e1 | 【修复】isTimer 判定兼容 SCF 定时触发器事件格式（+本次无 OPENID 约束防伪造）→ 心跳 10:40:06 恢复，巡检闭环 |
| 2026-10-07 | order-timer | e7321f1 | 6353ce0 | zhaoren-deploy-20261007-prunelog-20261007-104923.bundle | e7321f1 | auditPrune 结果落库（admin_config.audit_prune_last，dry-run 也记）→ 打通「先看统计再置 false」 |
| 2026-10-07 | admin-action | e7321f1 | 6353ce0 | zhaoren-deploy-20261007-prunelog-20261007-104923.bundle | e7321f1 | config_get 透出 audit_prune_last（实测键已返回） |
| 2026-10-07 | order-action | 8de7c4e | e46bb0f | zhaoren-deploy-20261007-143825.bundle | 8de7c4e | 第一批①：履约中禁改期（可改期收窄为仅 S2）+ 改期生效后重置四项确认；gate 七步 ALL PASS |
| 2026-10-07 | order-action | 8de7c4e | e46bb0f | zhaoren-deploy-20261007-143825.bundle | 8de7c4e | 第一批②：加时/改期被响应通知独立类型（extend_confirm/extend_reject）+ writeNotice 补 await；S3 禁改期云端实测 oa_modify_status、gate ALL PASS |
| 2026-10-07 | partner-action | 8de7c4e | 702df72 | zhaoren-deploy-20261007-143825.bundle | 8de7c4e | P6 小修：W1 开通线统一为 exam_bank.pass_line(=100，与接单同源)；云端实测 85 分被拒(>=100分)；gate ALL PASS |
| 2026-10-07 | demand-publish | 83de472 | 26628ee | zhaoren-deploy-20261007-172632.bundle | 83de472 | 第二批①：发布/编辑双路径计价分支（hourly/fixed/公益）+ project_attr 落库（断链①修复）+ total_fen 统一结算口径 |
| 2026-10-07 | order-create | 83de472 | 26628ee | zhaoren-deploy-20261007-172632.bundle | 83de472 | 第二批②：接单价格校验分支（fixed 走 accept_total 客单价区间、公益豁免；hourly 走 rate 区间）+ 订单快照 pricing_type/project_attr |
| 2026-10-07 | home-action | 83de472 | 26628ee | zhaoren-deploy-20261007-172632.bundle | 83de472 | 第二批③：广场/场景/附近 4 处价格过滤改 _.or（fixed/公益放行，Object.assign 拍平坑规避）+ mapDemand budget 分支；线上实测 square 返回 pricing_type=hourly |
| 2026-10-07 | order-action | 83de472 | 26628ee | zhaoren-deploy-20261007-172632.bundle | 83de472 | 第二批④：加时 fixed 单 0 元放行（add_amount_fen=0）+ extend_confirm 跳过重算（仅 duration_h 累加） |
| 2026-10-07 | admin-action | 83de472 | 26628ee | zhaoren-deploy-20261007-172632.bundle | 83de472 | 第二批⑤：CONFIG_SCHEMA 3 键（fixed_price_min/max、welfare_fixed_price_fen，无默认=留空不钳制/公益 fail-closed）+ config_public 补录 + config_set 交叉校验；线上实测交叉被拒 config_bad_fixed_range 且无落库、3 键未配置不透出 |
| 2026-10-07 | payment-mock | 83de472 | 26628ee | zhaoren-deploy-20261007-172632.bundle | 83de472 | 第二批⑥：cashier_info 回传 pricing_type（pay 页一口价展示分支依赖） |
| 2026-10-07 | partner-action | 83de472 | 26628ee | zhaoren-deploy-20261007-172632.bundle | 83de472 | 第二批⑦：update_config 存 accept_total_min/max_fen（一口价接单区间，null=不限、无平台钳制）+ my_profile 回显 |
| 2026-10-07 | user-login | 5c1e60d | 868d518 | zhaoren-deploy-20261007-212249.bundle | 5c1e60d | 第三批3A①：断链②登录惰性恢复（maybeRestoreSuspend，5 处登录读取点；停用中不拦登录） |
| 2026-10-07 | order-create | 5c1e60d | 868d518 | zhaoren-deploy-20261007-212249.bundle | 5c1e60d | 第三批3A②：suspended 拦截接单双入口（order_suspended / order_creator_suspended） |
| 2026-10-07 | demand-publish | 5c1e60d | 868d518 | zhaoren-deploy-20261007-212249.bundle | 5c1e60d | 第三批3A③：suspended 拦截发单/发布更新（publish_suspended / update_suspended） |
| 2026-10-07 | partner-apply | 5c1e60d | 868d518 | zhaoren-deploy-20261007-212249.bundle | 5c1e60d | 第三批3A④：suspended 拦截耍伴申请（apply_suspended；注：该函数现无前端调用入口，实为死路径） |
| 2026-10-07 | home-action | 5c1e60d | 868d518 | zhaoren-deploy-20261007-212249.bundle | 5c1e60d | 第三批3A⑤：活跃用户栏 nin 补 suspended（推荐栏白名单天然排除） |
| 2026-10-07 | partner-action | 5c1e60d | 868d518 | zhaoren-deploy-20261007-220202.bundle | 5c1e60d | 第三批3A⑥：apply 入口补 suspended 拦截（pa_suspended）——走查发现「成为耍伴」实走本函数 |
| 2026-10-08 | init-db | eb18639 | 36da9d7 | zhaoren-deploy-20261008-064735.bundle | eb18639 | 第三批3B①：no_show_report 集合 + 4 索引台账（含 credit_score_log 聚合索引）+ 索引结果可观测化（warning 区分"已存在/失败"） |
| 2026-10-08 | order-action | eb18639 | 36da9d7 | zhaoren-deploy-20261008-064735.bundle | eb18639 | 第三批3B②：爽约 3 action（submit/defense/detail）+ no_show_rules 同步（msgSecCheck/上限/时限） |
| 2026-10-08 | admin-action | eb18639 | 36da9d7 | zhaoren-deploy-20261008-064735.bundle | eb18639 | 第三批3B③：no_show_report_list / no_show_decide + 9 个 CONFIG_SCHEMA 键 + config_public no_show 组 + EXPORT_COLLECTIONS |
| 2026-10-08 | admin-web | eb18639 | 36da9d7 | zhaoren-deploy-20261008-064735.bundle | eb18639 | 第三批3B④：爽约申诉管理页（列表/详情/裁定）+ 路由/菜单（前端 rebuild 已入库） |

> 备注（第一批 3 行）：共用部署前归档 bundle `zhaoren-deploy-20261007-20261007-081223.bundle`（SHA256 已记 CHECKSUMS.txt，git-head=d13e7ad，即部署前云端版本）；部署后 commit=ebc2f4b（三函数一次提交，回滚点=d13e7ad）。
> 备注（第二批 2 行，专家复核整改）：共用部署前归档 bundle `zhaoren-deploy-20261007-20261007-083725.bundle`（git-head=0051ba0）；部署后 commit=0059b0f，回滚点=0051ba0。
> 备注（第三批 2 行，orderTimer 触发器根因闭环）：探针版与修复版均基于 2d918e1；探针仅作诊断且已随修复版移除；修复后心跳 10:40:06 恢复、gate 第 7 步 OK，回滚点=2d918e1。
> 备注（本批 3 行，第一批 + P6 小修）：共用部署前归档 bundle `zhaoren-deploy-20261007-143825.bundle`（git-head=8de7c4e，SHA256 已补记 CHECKSUMS.txt）；部署后 commit：第一批=e46bb0f、P6=702df72；回滚点=8de7c4e。
> 备注（第二批 7 行，一口价与时薪价并存）：共用部署前归档 bundle `zhaoren-deploy-20261007-172632.bundle`（git-head=26628ee，SHA256 已记 CHECKSUMS.txt）；部署后 commit=26628ee；回滚点=83de472。gate 七步 ALL PASS；线上实测：square 透出 pricing_type ✓、config_set 交叉校验拒绝（config_bad_fixed_range）且无落库 ✓、3 键未配置不透出 ✓。决策 A：公益入口保留（publish 页显示），未配置 welfare_fixed_price_fen 时服务端 fail-closed（publish_welfare_not_open）；公益发行完整链路走人工走查（待用户小程序端操作）。
> 备注（第三批 3A 6 行，断链②修复）：前 5 函数共用部署前归档 bundle `zhaoren-deploy-20261007-212249.bundle`；partner-action 用 `zhaoren-deploy-20261007-220202.bundle`（git-head 均为 5c1e60d）；部署后 commit=868d518；回滚点=5c1e60d。gate 七步 ALL PASS（首次 smoke 因 admin-action 冷启动 2.5s 超时 FAIL，重试全绿）；云端 `cloud functions download` 6 函数关键文件 SHA256 与本地全部一致。行为走查（走查账号 oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c，网关 penalty 造停用、走查后已复原 status=normal + accept_switch=true）：模拟器实测接单被拦「账号停用中,7天后自动恢复」✓、发布需求提交同文案 ✓；「成为耍伴」申请入口以代码级验证记录（真机重测待补）；到期惰性恢复分支=单测 4 条覆盖、live 待补（无独立测试环境，未手改控制台字段）。不在拦截范围（已确认）：接单配置保存（partner-action update_config，属"已有耍伴改配置"）。既有缺口记录：partner-action apply 的 frozen/banned 拦截缺失（本批仅补 suspended，未动）。
> 备注（第三批 3B 4 行，爽约申诉与裁定）：共用部署前归档 bundle `zhaoren-deploy-20261008-064735.bundle`（git-head=eb18639）；部署后 commit=36da9d7；回滚点=eb18639。gate 七步 ALL PASS；本地 130 单测全绿。云端验证：config_get 9 键（config_schema + operations 默认值 48/48/20/3/7/180/3/10/1 全对）✓、config_public.no_show 组透出 ✓、`export_collection no_show_report` ok 且 total=0（集合已由 init-db bootstrap 创建）✓、`no_show_report_list` ok（counts 全 0）✓、下载 init-db/order-action/admin-action 共 5 个文件 SHA256 全 SAME ✓、admin-web 首页 200 且 `NoShow-Cx4wNhie.js` 200 ✓。**重大发现**：wx-server-sdk 无 createIndex API（`createIndex is not a function`）→ init-db 索引清单从未经此路径生效（历史全部索引同此，旧代码把错误静默吞进 skipped）；本批已改为把非"已存在"错误写入 warnings；**4 个新索引已由用户在云开发控制台手工创建**（2026-10-08 用户确认；索引无法从云函数侧读取，以控制台索引列表为准）。行为走查（提交/举证/裁定全链路）待用户模拟器操作后补记。
> 备注（前端批次 1+2，**无云函数部署**）：pages-v2 重建服务动态三页（blog/blog-detail/blog-publish）+「我的」页「我的动态」入口（双身份）+ partner-detail T3.5 动态入口；云函数 `blog-action` 零改动、本批**未部署任何云函数**。本地门禁：`node --check` 通过、check-syntax 104 文件 OK、130 单测全绿、SSOT/nightmask/shared-sync ALL PASS。模拟器验收（用户操作）：TA的动态列表/入口/点赞/评论 均通过。**3B 爽约行为走查：挂起**（用户决定，待恢复后补记）。**遗留问题（既有，非本批引入）**：跨账号云存储图片全站不显示（动态图 + 耍伴证照/荣誉），根因=**云存储读权限为私密档**（`resource.openid == auth.openid`）——双账号全新数据实测 A↔B 互不可见、各自可见，一锤定音；已定修复方案 **A**（存储安全规则 `{"read": true, "write": "resource.openid == auth.openid"}`，控制台配置、零代码）；**已于 2026-10-08 由用户在控制台把存储权限改为「所有用户可读，仅创建者可读写」并实测通过**（跨账号互见图、TA的动态、他人耍伴详情证照 均恢复正常）。注：A+（按路径放开 blog/partner-cert）经查**不可行**——微信云存储安全规则为整桶级、`resource` 仅暴露 openid、无 path。
> 备注（批次 3，推荐耍伴 + 卡片最新动态，**代码完成·待部署**）：前端 `demand-detail`（`__renderDemand` 落 `recommendPartners` + `onBlogMore` + wxml `bind:more`）+ `partner-card.compute` 的 `statsText` 兜底（缺 on_time_rate/praise_rate 时显示「数据积累中」而非「准时率 %」）；云函数 `demand-publish` 新增 `buildRecommendPartners(d)`（同场景可接单+审核通过+信用达标 → 按信用分 Top5；批量富化 user_account/blog_post；失败/无候选一律 `[]` 不阻断 detail），`detail` 返回 `recommend_partners`。本地门禁 gate 1-5 ALL PASS。后端未上线时前端自动降级隐藏横滑区（可先验降级路径）。**待部署 `demand-publish`（部署前请示用户）**，部署后需在控制台补索引：`partner_profile{status,accept_switch,credit_score}`、`{accept_scenes,status,credit_score}`、`blog_post{author_openid,status,created_at}`。（注：原计划的 `order_main` 计数索引已省——改为并行富化 + 不做逐人计数，规避 detail 冷启动 3s 超时。）

## 使用说明

- 新增部署前：`git -C c:\zhaoren bundle create "C:\zhaoren-bak\zhaoren-deploy-<YYYYMMDD>-<HHMMSS>.bundle" master --tags`，核 SHA 记 `C:\zhaoren-bak\CHECKSUMS.txt`
- 部署后：按上表格式追加一行（前 commit 用上一版 HEAD，后 commit 用部署完成后的新 HEAD）
- 回滚：用表中「回滚点」commit 的代码重新部署，出错靠本表兜底而非手工记忆
