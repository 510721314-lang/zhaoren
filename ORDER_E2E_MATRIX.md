# 订单异常场景 · 端到端覆盖矩阵

> 目标：把「多重场景下的异常订单处理」显性化为可追踪矩阵，区分**已测层**与**缺口**。
> 覆盖层图例：
> - `R` 规则层单测（order_state / money / no_show / urge / take rules）— 纯逻辑正确性
> - `A_ok` action 层 A/B 成功路径（显式用例到 ok:true，含拆分等价）
> - `A_fail` action 层 A/B 拒绝分支（合法 fail code，自动种子）
> - `E2E` action 全链路成功（真实 DB 副作用：多表写/日志/通知/流水/CAS）
> - `—` 未覆盖（待补）

## 一、主轴 + 异常迁移（22 条）

| # | 场景/事件 | from→to | 关键异常点 | R | A_ok | A_fail | E2E |
|---|---|---|---|---|---|---|---|
| 1 | 取消（已付退） | S1/S0→S6 | 已付原路退、demand 释放 | ✅ | ✅admin强制 | — | ✅order(S1+demand释放) / timer(S1超时) |
| 2 | 取消申请挂起 | S2→null | 挂起不改主轴、2h 超时裁决 | ✅ | — | ✅ | — |
| 3 | 支付超时 | S0→S6 | 30min 未付释放 demand | ✅ | — | — | ✅timer(S0→S6+释放) |
| 4 | 支付成功 | S0→S2 | 支付流水成功校验 | ✅ | — | ✅ | — |
| 5 | 开始服务 | S2→S3 | 未冻结 guard | ✅ | ✅ | ✅ | ✅ |
| 6 | 修改/加时 apply/reject/confirm | S2/S2_5 | 未冻结、confirmHours 自动拒绝 | ✅ | ✅ | ✅ | ✅order(apply+confirm) / timer(S2_5超时拒绝) |
| 7 | 中断报告 | S3→S3.5 | 原因必填、未冻结、24h→S4 | ✅ | — | ✅ | — |
| 8 | 恢复服务 | S3.5→S3 | — | ✅ | ✅ | ✅ | ✅ |
| 9 | 部分同意 | S3.5→S4 | 裁限期裁决 | ✅ | ✅ | — | ✅order(partial_confirm) / timer(S3.5超时→S4) |
| 10 | 里程碑提交/确认 | S3↔S3 | 确认窗自动确认 | ✅ | ✅ | ✅ | ✅order(submit+confirm) / timer(超时自动确认) |
| 11 | 加时请求 | S3→S3 | 2h 未响应自动拒绝 | ✅ | ✅ | — | ✅apply |
| 12 | 加时补付 | S3→S3 | 补付流水成功 | ✅ | ✅ | — | ✅confirm(fixed) |
| 13 | 完成服务 | S3→S5 | 里程碑 100% 或豁免 | ✅ | ✅ | ✅ | ✅ |
| 14 | 比例确认 | S4→S5 | 双方各确认一次 | ✅ | ✅ | — | ✅ratio 50 |
| 15 | 评价 | S5→S8 | 无重复评价、48h 自动评 | ✅ | ✅entry | ✅entry | ✅entry(evaluation-submit) / timer(S5超时→S9默认评) |
| 16 | 投诉 open | S2+→frozen | 售后窗口内、不改主轴 | ✅ | ✅ | ✅ | ✅S8→S10.5 / ✅S2→S10.5(D1 白名单放开) |
| 17 | 投诉 withdraw | *→原态 | 未受理才回退 | ✅ | ✅ | ✅ | ✅S10.5→S8 |
| 18 | 争议裁决-退款 | * | 金额≤可退上限；全退 S7/部分退回主轴 | ✅ | ✅refund | ✅ | ✅上限+部分退 |
| 19 | 争议裁决-完成 | * | 有评价→S8；无→S5 | ✅ | ✅ | ✅ | ✅已评→S8 |
| 20 | 售后过期 | S8→S10 | 窗口届满、settle ready | ✅ | — | — | ✅timer(S8→S10, 冻结守卫) |
| 21 | 爽约裁定 | * | 受害方退款通道、赔付 10% | ✅ | ✅upheld | ✅ | ✅submit/defense/withdraw |
| 22 | 结算 | S8/S9/S10 | 余额=Σ基数−已提现 | ✅ | — | — | ✅entry(balance_info 可提现口径+到账回写) |
| 23 | 订单事件时间线 | *（只读） | 多源合并/倒序/去重/限流 50/隐私（不外显 openid） | — | — | ✅entry(缺order_id/越权) | ✅entry(5 源合并+倒序+去重+限流+隐私) |
| 24 | 种子工具鉴权（P0 整改） | * | fail-closed：真实 OPENID∈admin_openids 或 admin-web 代理共享密钥握手；不再信任 mock_openid | — | — | ✅entry(越权/伪造/空白名单) | ✅entry(6 例：拒/放行两路) |
| 25 | 手机号加密（P0 整改） | * | AES-256-GCM 密文 + HMAC 确定性查询键 + 掩码；dual-read 兼容存量明文 | ✅(8 例:加密/解密/哈希/掩码/回退) | — | — | ✅user-login 写读全链路 + demand-publish 解密取号 |

> 注：#15 评价位于独立云函数 `evaluation-submit`、系统态定时任务位于 `order-timer`、#22 结算位于 `payment-mock`（均未参与 index.js 拆分，A/B 等价不适用），以入口契约测试覆盖（`order-action.entry.test.js` 16 例 + `zz-seed-orders.entry.test.js` 6 例 + `evaluation-submit.entry.test.js` 11 例 + `order-timer.entry.test.js` 11 例 + `payment-mock.entry.test.js` 结算 4 例）。

## 二、正交/并发/兼容异常

| 场景 | 关键异常点 | R | A_ok | A_fail | E2E |
|---|---|---|---|---|---|
| CAS 并发抢更新 | 双写竞争、updated!==1 未抢到、异常回 false | ✅(4用例) | — | — | ✅action级落败分支(cancel/start/complete/eval) |
| 影子校验 | 白名单外迁移告警不阻断 | ✅ | — | — | — |
| 读兼容 mapStatus | 旧 S9→S8+auto_done、S10.5→原态+open+frozen | ✅(4用例) | — | — | — |
| 退款金额上限/重复退款 | 已退+本次≤已付 | ✅ | — | ✅超上限 | ✅部分退 |
| 爽约处罚链 | 扣分/停用/通知 副作用 | ✅规则 | ✅ | — | ✅申诉链+裁定 |
| 资金结算资格 | S8/S9/S10 才算已结算 | ✅ | — | — | — |

## 三、当前结论
- **规则层（R）**：状态机 22 迁移 + CAS + 兼容 + 资金/爽约/催单/接单规则 + 手机号加密 → **已充分单测**（当前 **240/0**，含规则 + 各入口契约 + action 级 CAS 落败 + phone_crypt 8 例 + zz-seed-orders 鉴权 6 例）。
- **action 拒绝分支（A_fail）**：全部 115 action 经自动种子覆盖到合法 fail code（另有 evaluation-submit + order-timer 鉴权门）。
- **action 成功路径（A_ok）**：admin 侧（取消/争议退款/投诉/爽约）+ order 侧（取消/开始/完成/改期/里程碑/加时/等）+ 争议完成裁决 均有显式 ok 用例；#15 评价走入口契约。
- **端到端（E2E）**：已补 action 级（A/B 0 diff）+ **入口契约**（order-action 16 + evaluation-submit 11 + order-timer 11 + payment-mock 结算 4）。order-timer 覆盖 8 类系统态扫描（S1/S0 超时取消、S3.5 中断→S4、S2_5 改期自动拒绝、S3 里程碑自动确认、S5 超时默认评价→S9、S8 售后归档→S10、S4 裁定期升级，含冻结/未到期守卫）；#22 结算覆盖可提现口径（Σ基数−提现占用）+ T+1 到账回写；#23 时间线覆盖 5 源合并/倒序/去重/限流/隐私。**剩余仅：#2取消申请/#7中断（无独立 action）。**

## 四、待补缺口（建议优先级）
P0：#1✅ #18✅ #19✅ ；CAS 并发 action 级✅（落败分支）
P1：#6✅ #8✅ #9✅ #10✅ #11✅ #12✅ #14✅ #15✅ #16✅ #17✅ #21✅ ；剩 #2 取消申请、#7 中断(无独立 action，经状态机事件表达)
P2（系统态）：#3✅ #20✅ #22✅
> **全部可做项已清干净**：order-action/admin-action（A/B harness）+ evaluation-submit/order-timer/payment-mock（入口契约）内功能 + action 级 CAS 落败分支均已覆盖；#2/#7 无独立 action。
