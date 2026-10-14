# 订单异常场景测试报告

> 项目：找人帮忙微信小程序（原生 + 微信云开发）　范围：订单履约域异常分支
> 结论时点：2026-10-12　分支：`master`（本地领先远程 1 docs commit，网络恢复后推送）
> 特性：**纯测试基建，零生产代码改动**
>
> ⚠️ 时点后变更（2026-10-14 补记）：下文按 **2026-10-12 时点**如实记录，勿据以判断当前拆分状态——`order-timer` 与 `payment-mock` 当时**尚未拆分**，现均已完成物理拆分（order-timer→4 个 `action_*.js` + `SECTIONS` 段落分发；payment-mock→4 个 `action_*.js`），且已纳入 A/B 等价覆盖（详见 `docs/CHANGELOG.md` 2026-10-14 各拆分记录）。第 29 行「未拆分函数」口径仅指该时点。

---

## 一、结论摘要

| 指标 | 结果 |
|---|---|
| 单元测试（含入口契约） | **212 pass / 0 fail** |
| A/B 等价（拆分前 baseline vs 当前） | **201 cases（87 显式 + 114 自动）0 diff** |
| 守门脚本（handler ctx 漏注入） | **114 actions 0 抛错** |
| 状态迁移场景覆盖 | **22 / 22 全覆盖** |
| 正交/并发/兼容异常 | CAS 落败 / 退款上限 / 爽约处罚链 / 读兼容 均覆盖 |

**总体结论**：订单履约 22 个状态迁移的异常分支（含系统态超时、并发竞态落败、冻结守卫、驳回）均已建立可复现的自动化覆盖；拆分后的行为与拆分前逐字节等价。剩余未覆盖项均因**无对应 action 入口**，非测试缺口。

---

## 二、测试方法与证据来源（三层机制）

| 层 | 机制 | 适用对象 | 证明力 |
|---|---|---|---|
| R 规则层 | `_shared/*.test.js`（node:test） | 状态机 / 资金 / 爽约 / 催单 / 接单规则 | 逻辑正确性 |
| A/B 等价 | `_shared/ab_equivalence.js`（mock SDK 双跑 baseline vs 当前） | order-action / admin-action（**已拆分**函数） | 拆分零行为变更 |
| 入口契约 | `_shared/*.entry.test.js`（mock SDK 驱动 `main`） | evaluation-submit / order-timer / payment-mock（**未拆分**函数） | 入口行为契约（输入→返回码） |

> 说明：**已拆分函数**用 A/B 等价证明「拆分前后一致」；**未拆分函数** A/B 无意义，改用入口契约测试（mock `wx-server-sdk`，无副作用断言）。

### 复现命令
```powershell
# 1) 单测
node --test cloudfunctions\_shared\*.test.js
# 2) A/B 等价（先取拆分前 baseline）
git show 2467602^:cloudfunctions/order-action/index.js  > cloudfunctions\order-action\_orig_baseline.js
git show d689141^:cloudfunctions/admin-action/index.js   > cloudfunctions\admin-action\_orig_baseline.js
node cloudfunctions\_shared\ab_equivalence.js
Remove-Item cloudfunctions\order-action\_orig_baseline.js,cloudfunctions\admin-action\_orig_baseline.js
# 3) 守门
node scripts\check-handlers.js
```

---

## 三、场景明细 · 主轴 + 异常迁移（22 条）

图例：R=规则单测；A/B=action 层等价（成功/拒绝）；契约=入口契约测试。

| # | 场景/事件 | 迁移 | 异常点 | 覆盖与用例 | 结果 |
|---|---|---|---|---|---|
| 1 | 取消（已付退） | S1/S0→S6 | demand 释放 | A/B `cancel_S1_release_ok`（demand 释放+通知+审计）／契约 order-timer S1 超时 | ✅ |
| 2 | 取消申请挂起 | S2→null | 2h 超时裁决 | R（迁移表）+ A/B 拒绝分支 | ✅ |
| 3 | 支付超时 | S0→S6 | 30min 释放 demand | 契约 `order-timer` S0→S6+释放 | ✅ |
| 4 | 支付成功 | S0→S2 | 流水校验 | R + A/B 拒绝分支 | ✅ |
| 5 | 开始服务 | S2→S3 | 未冻结 guard | A/B `start_S2_ok` | ✅ |
| 6 | 修改/加时 apply/confirm | S2/S2_5 | confirmHours 自动拒绝 | A/B `modify_apply_ok`/`modify_confirm_ok` + 契约 timer S2_5 超时拒绝 | ✅ |
| 7 | 中断报告 | S3→S3.5 | 原因必填 | R + A/B 拒绝分支（无独立 action） | ✅ |
| 8 | 恢复服务 | S3.5→S3 | — | A/B `resume_ok` | ✅ |
| 9 | 部分同意 | S3.5→S4 | 裁限期 | A/B `partial_confirm_ok` + 契约 timer S3.5 超时→S4 | ✅ |
| 10 | 里程碑提交/确认 | S3↔S3 | 确认窗自动确认 | A/B `milestone_submit_ok`/`milestone_confirm_ok` + 契约 timer 自动确认 | ✅ |
| 11 | 加时请求 | S3→S3 | 2h 自动拒绝 | A/B `extend_apply_ok` | ✅ |
| 12 | 加时补付 | S3→S3 | 补付流水 | A/B `extend_confirm_ok`（fixed 定价） | ✅ |
| 13 | 完成服务 | S3→S5 | 里程碑 100% | A/B `complete_S3_ok` | ✅ |
| 14 | 比例确认 | S4→S5 | 双方各确认 | A/B `ratio_confirm_ok`（ratio 50） | ✅ |
| 15 | 评价 | S5→S8 | 无重复评价 | 契约 `evaluation-submit`（成功/幂等/状态门）+ 契约 timer S5 超时→S9 | ✅ |
| 16 | 投诉 open | S2+→frozen | 售后窗口内 | A/B `complaint_open_ok`（S8→S10.5+冻结位） | ✅ |
| 17 | 投诉 withdraw | *→原态 | 未受理才回退 | A/B `complaint_withdraw_ok`（S10.5→S8 解冻） | ✅ |
| 18 | 争议裁决-退款 | * | 金额≤可退上限 | A/B `dispute_refund_ok`/`dispute_refund_partial_ok`/`dispute_refund_amount_exceed` | ✅ |
| 19 | 争议裁决-完成 | * | 有评价→S8；无→S5 | A/B `dispute_complete_evaluated_ok`（S8） | ✅ |
| 20 | 售后过期 | S8→S10 | 窗口届满 | 契约 `order-timer` S8→S10 + 冻结守卫 | ✅ |
| 21 | 爽约裁定 | * | 赔付/退款通道 | A/B `no_show_submit_ok`/`defense_ok`/`withdraw_ok` + admin `noshow_upheld_ok` | ✅ |
| 22 | 结算 | S8/S9/S10 | 余额=Σ基数−已提现 | 契约 `payment-mock` balance_info（可提现口径+到账回写） | ✅ |

---

## 四、场景明细 · 正交 / 并发 / 兼容异常

| 场景 | 异常点 | 覆盖 | 结果 |
|---|---|---|---|
| CAS 并发抢更新 | updated!==1 未抢到、异常回 false | R（4 例）+ A/B/契约 action 级落败分支 4 例 | ✅ |
| 退款金额上限/重复退款 | 已退+本次≤已付 | A/B `dispute_refund_amount_exceed` + `dispute_refund_partial_ok` | ✅ |
| 爽约处罚链 | 扣分/停用/通知副作用 | R + A/B `noshow_upheld_ok` + 契约申诉链 | ✅ |
| 读兼容 mapStatus | 旧 S9→S8+auto_done；S10.5→原态+open+frozen | R（4 例） | ✅ |
| 影子校验 | 白名单外迁移仅告警不阻断 | R | ✅ |
| 资金结算资格 | S8/S9/S10 才算已结算 | R + 契约 balance_info | ✅ |
| 订单冻结守卫 | 争议/申诉期间禁止推进类操作 | A/B（start/complete 冻结）+ 契约 timer S8 冻结不归档 | ✅ |

---

## 五、系统态定时任务（order-timer 入口契约 11 例）

| 巡检项 | 触发条件 | 预期 | 结果 |
|---|---|---|---|
| 鉴权门 | 非管理员/非定时器 | `ot_forbidden` | ✅ |
| S1 待确认超时 | created_at > now−15min | S1→S6 + 释放 demand | ✅ |
| S0 支付超时 | pay_expire_at 过期 | S0→S6 + 释放 demand | ✅ |
| S3.5 中断超时 | interrupted_at > now−24h | S3.5→S4 | ✅ |
| S2_5 改期超时 | pending_modify.expire_at 过期 | 自动拒绝回原状态 | ✅ |
| S3 里程碑超时 | submitted_at > now−15min | confirmed 全置 true | ✅ |
| S5 超时默认评价 | service_completed_at > now−48h | S5→S9 + 写系统评价 star=4 | ✅ |
| S8 售后届满 | evaluated_at > now−15d | S8→S10 归档 | ✅ |
| **守卫** S8 冻结 | frozen=true | 不归档 | ✅ |
| S4 裁定期届满 | updated_at > now−7d | 写 P1 platform_event | ✅ |
| **守卫** S5 未到期 | 未超时 | 不处理 | ✅ |

---

## 六、独立函数入口契约

| 函数 | 文件 | 例数 | 覆盖要点 |
|---|---|---|---|
| evaluation-submit（#15） | `_shared/evaluation-submit.entry.test.js` | 11 | 成功 S5→S8（信用分+2+四集合落库）/ 幂等 / 冻结 / 状态门 / CAS 落败 |
| order-timer（系统态） | `_shared/order-timer.entry.test.js` | 11 | 见上节 |
| payment-mock（#22 结算） | `_shared/payment-mock.entry.test.js` | 4 | 可提现口径 / 到账回写 / 无收入 / 钳零 / 打赏计入 |
| CAS 落败（order-action） | `_shared/order-action.entry.test.js` | 3 | cancel / start_service / complete_service → `oa_status_conflict` |
| 鉴权/归属（order-action） | `_shared/order-action.entry.test.js` | 6 | nudge 越权/未到时间/不存在/缺ID/成功；cancel 非参与方 |

---

## 七、未覆盖项与说明（非缺口）

| 项 | 原因 |
|---|---|
| #2 取消申请、#7 中断报告 | 经状态机事件表达，**无独立 order-action 入口**，无从补 action 用例（规则层已覆盖） |
| 线上只读烟雾 | 环境依赖：需在云开发控制台/网关侧操作，测试期内已用 mock 全链路替代 |

---

## 八、风险与边界（诚实声明）

1. **A/B 等价证明的是「拆分前后一致」，不等于「逻辑本身正确」**；逻辑正确性由规则层单测 + 入口契约共同保证。
2. **入口契约为 mock 驱动**（`wx-server-sdk` stub），验证入口返回码与关键副作用（写入捕获），**不替代真实云数据库/事务**的端到端验证；提审前建议在云开发控制台跑一轮只读烟雾。
3. **广场数据 24h 过期**：`home_probe_square` 依赖线上 `demand(status=matching)` 种子，提审前若为空需先 reseed（见 `REFACTOR_ACCEPTANCE.md` §三）。
4. 本报告全部结论可由 §二 命令复现；**零生产代码改动**（改动仅限 `_shared/_mock_sdk.js`、`ab_equivalence.js`、`*.entry.test.js` 与文档）。

---

_配套文件：`ORDER_E2E_MATRIX.md`（覆盖矩阵）、`REFACTOR_ACCEPTANCE.md`（拆分验收归档）。_
