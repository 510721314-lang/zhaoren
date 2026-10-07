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

> 备注（第一批 3 行）：共用部署前归档 bundle `zhaoren-deploy-20261007-20261007-081223.bundle`（SHA256 已记 CHECKSUMS.txt，git-head=d13e7ad，即部署前云端版本）；部署后 commit=ebc2f4b（三函数一次提交，回滚点=d13e7ad）。
> 备注（第二批 2 行，专家复核整改）：共用部署前归档 bundle `zhaoren-deploy-20261007-20261007-083725.bundle`（git-head=0051ba0）；部署后 commit=0059b0f，回滚点=0051ba0。
> 备注（第三批 2 行，orderTimer 触发器根因闭环）：探针版与修复版均基于 2d918e1；探针仅作诊断且已随修复版移除；修复后心跳 10:40:06 恢复、gate 第 7 步 OK，回滚点=2d918e1。
> 备注（本批 3 行，第一批 + P6 小修）：共用部署前归档 bundle `zhaoren-deploy-20261007-143825.bundle`（git-head=8de7c4e，SHA256 已补记 CHECKSUMS.txt）；部署后 commit：第一批=e46bb0f、P6=702df72；回滚点=8de7c4e。
> 备注（第二批 7 行，一口价与时薪价并存）：共用部署前归档 bundle `zhaoren-deploy-20261007-172632.bundle`（git-head=26628ee，SHA256 已记 CHECKSUMS.txt）；部署后 commit=26628ee；回滚点=83de472。gate 七步 ALL PASS；线上实测：square 透出 pricing_type ✓、config_set 交叉校验拒绝（config_bad_fixed_range）且无落库 ✓、3 键未配置不透出 ✓。决策 A：公益入口保留（publish 页显示），未配置 welfare_fixed_price_fen 时服务端 fail-closed（publish_welfare_not_open）；公益发行完整链路走人工走查（待用户小程序端操作）。

## 使用说明

- 新增部署前：`git -C c:\zhaoren bundle create "C:\zhaoren-bak\zhaoren-deploy-<YYYYMMDD>-<HHMMSS>.bundle" master --tags`，核 SHA 记 `C:\zhaoren-bak\CHECKSUMS.txt`
- 部署后：按上表格式追加一行（前 commit 用上一版 HEAD，后 commit 用部署完成后的新 HEAD）
- 回滚：用表中「回滚点」commit 的代码重新部署，出错靠本表兜底而非手工记忆
