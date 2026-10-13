# 技术评审报告（2026-10-13，双代理交叉评审 —— 运维/代码负债两批闭环）

> 评审对象：①运维负债 #4-#7 闭环（commit `00a78e1`）②代码/架构负债 #1+#2 闭环（commit `21fc90c`：admin_login 防爆破锁定 + openid.js 全量 17 函数单一源收敛）
> 方法：`zhaoren-tech-review` 流程 —— 代理 A（结构性问题猎手）+ 代理 B（定点抽查）独立验证，2/2 双确认才立项；评审同时独立复现门禁与云端 download 核验。
> 处置拍板（2026-10-13，用户）：**A = 修 #1/#3/#4/#5；#2（失败计数读-改-写竞态，与 user-login 同款）登记不修**。修复当日实施并部署（admin-action / init-db），见 `docs/deploy-log.md` 2026-10-13 第三行（修复 commit `f9dcdc6` / 文档 `90909c2`；回滚点 `c130f28`）。

## 总体判断

两批闭环的核心链路改动**全部通过**：admin-action 迁移逻辑与旧超集逐行等价、云端 17 份 `openid.js` 与 3 份 `security_policy.js` SHA 与规范源完全一致、门禁全绿。**无 P2/P3 级别问题**；仅存 5 项 P4（纯理论边界/低危），其中 4 项当日修复、1 项登记不修。

## 一、通过证据（评审实测）

| 项 | 证据 |
|---|---|
| openid.js 单一源收敛 | 云端 download 核验 17/17 份 SHA == `_shared/openid.js` 规范源（含 `invalidateEnvCache`）；admin-action 网关校验上移 `index.js` `resolveOpenidWithProxy`，行为锁定 2 例测试 |
| admin_login 防爆破锁定 | 入口契约 4 例（失败计数 +1 / 第 5 次置锁并清零 / 锁定中不验密直接拒 / 验密成功清零）；P1 `admin_login_fail` 事件保留，触发锁定的一次 payload.locked=true |
| 运维负债 #4-#7 | `action_import` 注册核验；索引台账 33/33（设计=已建）；zz-warmup 触发器全天候（tcb 通道绕开 -10008）；备份清单补 complaint→37 集合 |
| 等价性 | A/B 205 例等价（87 explicit + 118 auto；9 known-evolution） |
| 门禁 | 评审时 verify:offline pass 346/0；修复后 348/0（+2 例） |

## 二、P4 问题表（5 项）与处置

| # | 级别 | 问题 | 位置 | 处置 |
|---|---|---|---|---|
| 1 | P4 | 禁用→启用不清锁定残留（启用后可能被历史 `pwd_lock_until` 误拒） | `action_admin_account.js:41` | ✅ 已修：启用时清零 `pwd_fail_count/pwd_lock_until` + 入口契约用例（验收=禁用再启用后立即可用密码登录） |
| 2 | P4 | 失败计数读-改-写竞态（与 user-login 同款） | `action_auth_pre.js:55-63` | 📌 登记不修（拍板；并发窗口极窄，留待与 user-login 统一治理） |
| 3 | P4 | 计数写入 catch 静默吞错（锁定可能未落库而无人知） | `action_auth_pre.js:63` | ✅ 已修：改 `log.w` 留痕（验收=写失败时日志可见） |
| 4 | P4 | 阈值下调无反向用例（改坏实现无用例失败） | `security_policy.test.js` | ✅ 已修：补 maxFail=4、count=3→置锁用例（验收=把上限写死为 5 时该用例必失败） |
| 5 | P4 | 文档残留 + login_locked 未登记 | init-db 注释 / wx-cloud-deploy SKILL:41「正式 15 个」/ partner-card 云端.md / TECHNICAL_ASSESSMENT.md / HANDOFF.md | ✅ 已修：清单 15→17 载体（+辅助 3 个）、历史快照加注（Desktop\zhaoren 已废弃）、TA 4.1 校正 + 4.2 登记 login_locked 与评审结论、deploy-log 计数修正（9 known-evolution） |

## 三、验证者修正（防影响面误判）

- **errorScan 告警签名只取 level/type、不含 payload** —— `admin_login_fail` 新增 `locked` 字段不会破坏巡检去重（此点曾被初判为风险，双验证者纠正）。
- `security_policy.js` 是 **3 消费者**（user-login / init-db / admin-action）；**17** 为 `openid.js` 载体数 —— 两数字勿混用。
- `admin-action/openid.js` 收敛后**已非「超集」**：与规范源逐字节一致，超集逻辑位于其 `index.js` 包装层（`resolveOpenidWithProxy`）。

## 四、过程修正（工作流，已固化）

- **先提交再部署**：本批（21fc90c）部署时工作区未先提交，归档 bundle 只能取部署前 HEAD、回滚点含混 → 纪律修正为「提交（工作区干净）→ bundle 归档 → 串行部署」，已写入 `zhaoren-tech-review` SKILL §5；本次 P4 修复已按新纪律执行。
- 核验手法补记：`tcb fn list` 默认 limit=20（复核清单须 `--limit 50`，否则第 21 个起静默漏显）；`functions download` 核验建议**按函数分目录**（同 path 平铺会互相覆盖同名文件）。

## 一句话结论

两批闭环质量达标、云端一致性与行为等价均有实证；5 项 P4 按拍板「能修即修、竞态登记」处置完毕，提审前无未决安全/可靠性问题。