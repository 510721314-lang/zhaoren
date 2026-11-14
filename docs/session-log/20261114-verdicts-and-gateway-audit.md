# 2026-11-14 · 评审裁决存档（zz-warmup 口径对齐 + 网关审计收口）

## 目标
固化 zz-warmup/超时口径对齐评审（丙档修复）与 admin-web 网关安全收口（甲方案）两次双专家评审的验证者修正记录，防止同类误判复发。

## 结论（验证者修正三点 + 甲方案要点）
1. **频次推算分歧裁决**：A 判 120 次/天 vs B 判 128 次/天——裁决 **120 正确**。依据：zz-warmup/index.js L72-78 `hour < ACTIVE_END` 窗口守卫使 22 点档 4 次触发直接 `skipped`，仅 7-21 点 15 小时 ×4=60 次有效执行 ×2 目标 = **120 次目标调用/天**（zz-warmup 自身被触发 64 次/天，总调用 184）。B 的 128 未计窗口守卫。**防复发教训：定时器频次推算必须区分「cron 触发次数」与「有效执行次数」，有效执行 = 触发次数 − 窗口守卫 skip 数。**
2. **openid.js「17 业务函数」勿误伤**：该计数是 openid.js 载体清单（17 正式函数），与预热 TARGETS=2 无关，口径对齐时禁把它当作漂移项订正。
3. **历史档不改**：HANDOFF-20261013/14、deploy-log 历史行、app.js L66 演变注记等均为带日期上下文的历史记录，按惯例不回改，仅订正「现行口径」载体（REGISTRY 现行行 / dev-manual / skills）。
4. **甲方案（T-9.14 网关审计）双专家 2/2 立项**：缺陷①空 key 放行＝代码真修已闭合（2026-11-10 bootstrap 收紧）；缺陷③写操作零审计＝A2 补 fn_migrate_tip_partner 成功/失败双路径 writeAudit（专家 A 证伪草案 v1「仅剩 fn_migrate 一处」——seed_* 系列与 admin_logout 亦零留痕，登记不修）；缺陷②canAccess 白名单缺口登记遗留（持钥者即管理员，实际越权增量有限）。哈希链并发分叉被 audit_verify 裁为 `fork_noise` 非篡改（双写入方既存噪声，非本次新增）。

## 证据（命令与实测值）
- REGISTRY #33（L42）与 CHANGELOG L9 已含裁决核心口径（120/64 触发/60 有效执行×2）。
- 甲方案部署链：admin-web deploy success（53 files / 548.9 KB）；SHA 回读 index.js `E0CFACE575` / audit.js `4B0C5FB5B8` 双 MATCH；网关 fn_migrate 幂等空跑 200 `{ok:true,fixed:0}`；audit_query 实测最新条目 action=`fn_migrate_tip_partner`、detail={fixed:0,scanned:0}、prev_hash 入链（audit_log total 22578）。
- 门禁：verify:offline EXIT=0（960/960）、A/B 455 EQUIVALENT（npm test 与 A/B 均不含 admin-web，回归靠部署实测——已声明入 CHANGELOG）。

## 改动与提交
- 丙档（口径对齐）：`df8d9070`（docs 7 处）+ `d6b01d7b`（cloudbaserc 触发器防回退 + 头注订正）——已推送远端。
- 甲方案：`7ff72400`（admin-web/index.js +15 行审计）+ `85bafdfd`（台账四处销账）+ deploy-log 登记 commit——**本地待推**。
- A3 裁定：CORS 维持 `*` 销账，用户已认可（tech-debt F6 行仅 CORS 子项，另两件保留）。

## 未决项
1. push：3 commit 待推，直连/7890 通道间歇可用，待窗口。
2. T-9.14 ②canAccess 白名单缺口：登记遗留，后续批次处置。
3. seed_* 成功路径零审计、admin_logout 置删零留痕：登记不修（理由见上）。
4. P3-46 iOS 真机补验、体验版回归 19 条：待测试条件。

## 下次入口
- HANDOFF-20261114.md §0 校验 + §7 继承段（T-9.14 行已改「部分收口·2026-11-14 甲方案」）。
- push 恢复后先 `git rev-list --count origin/master..HEAD` 核对=0。
