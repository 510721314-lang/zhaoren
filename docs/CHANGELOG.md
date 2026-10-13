# 变更日志（CHANGELOG）

> 规则：每次代码改动收尾时追加一行；日期｜变更内容｜可能影响的功能｜回归结论。
> 配套 `docs/FUNCTION-REGISTRY.md`（功能清单）与 `.trae/rules/project_rules-20261013.md`（九条铁律）使用。

| 日期 | 变更内容 | 可能影响的功能 | 回归结论 |
|---|---|---|---|
| 2026-10-13 | 建立 AI 协作防回退规则体系：`.trae/rules/project_rules-20261013.md`（九条铁律，alwaysApply）+ `.trae/rules/miniprogram-config-guard.md`（5 个配置文件 globs 保护）+ `docs/FUNCTION-REGISTRY.md`（50 条功能清单，已验证 33 / 待验证 17） | 全局规则文件，零行为变更；仅约束 AI 后续协作行为 | 7 处 @VERIFIED 标记所在文件 node --check 7/7 PASS；FUNCTION-REGISTRY 表格格式自证；待用户真机复核 17 条"待验证"功能 |
| 2026-10-13 | 给 7 个重点功能加 `// @VERIFIED 2026-10-13` 标记：login.js / publish.js / order-detail.js / no-show-report.js / redline.js / _shared/security_policy.js / _shared/openid.js | 仅注释行，零运行时影响 | 7/7 语法 PASS；标记依据=project_memory L48-52/L71/L83-85/L104/L109-111/L155-156/L181/L280 |
| 2026-10-13 | 修复上轮遗漏：`_shared/security_policy.js`、`_shared/openid.js` 加注释后造成 20 处副本 SHA 漂移（check-shared-sync 会 FAIL），已跑 `sync-security-policy.ps1` + `sync-openid.ps1` 修复 | 无（副本内容回归同源） | SHARED SYNC ALL OK |
| 2026-10-13 | 按 C 方案给剩余 26 条"已验证"功能补 `// @VERIFIED 2026-10-13` 标记，共 23 个源文件：index/square/nearby-map/partner-detail/message/privacy 页 + partner-apply/safety-report/im-conv/home-action/order-timer/init-db/zz-warmup/admin-action/admin-web/order-action 云函数 + utils/cloud/swr + 4 个 `_shared` 规范源(partner_audit/order_state/money_rules/urge_rules) | 全部为注释行，零运行时影响；4 个 `_shared` 规范源已跑对应 sync-*.ps1 同步副本（partner_audit×2/order_state×2/money_rules×3/urge_rules×2） | check-shared-sync.js = SHARED SYNC ALL OK（0 漂移 0 缺失）；25 文件 node --check bad=0 |
