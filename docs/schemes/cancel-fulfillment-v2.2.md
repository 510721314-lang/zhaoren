# 订单取消全状态 + 信用分处罚 实现方案 v2.2.1（评审修订版）

> **状态**：待用户批准「开始执行 W0/W1」后编码。本阶段（规划）**不动任何代码**。
> **修订记录**：
> - v2.2（2026-11-24）：初稿，整合 B1-B17 决策 + 双专家二轮评审硬阻塞关闭。
> - v2.2.1（2026-11-24）：双代理交叉评审（A 事实核验 25/25 属实；B 完整性/偏离 18 项）后修订——修复评审 18 项；**新增用户约束「管理动作与业务参数一律后台可配，禁止写死在程序里」**（见 §0.0/§0.1）。
> **评审留痕**：A 代理 25 项声明核验全属实；B 代理 18 项问题（高 6/中 6/低 6）经主对话抽查裁决全部成立（sync-money-rules.ps1 目标、action_take.js 路径等已实证）。
> **关联**：`docs/FUNCTION-REGISTRY.md`（待登记 #207+）、`docs/CHANGELOG.md`、`docs/tech-debt-inventory-20261105.md`。

---

## 0.0 新增约束（2026-11-24 用户拍板）：管理动作与业务参数一律后台可配

**原文**：「需要通过后台订单取消及其相关决策等事项相关管理，一定不要将管理动作行为写死在程序里。」

**落地边界——「机制写死、参数全配」二分法**：

| 类别 | 处理 | 理由 |
|---|---|---|
| **程序骨架（不可配）** | 状态机合法流转边（附录A 红线）、CAS/事务原子性机制、frozen 互斥机制、通知 4 副本结构、退款上限校验 | 这些是正确性/资金安全保证，属附录A 不可变红线与代码结构，配置化反而危险 |
| **业务参数（全部可配）** | 功能开关、确认窗口、处罚梯度、退款档位、冷却时长、跨单频次阈值 | 见 §0.1 总表，走 admin_config + 默认值兜底链（规则 §32） |
| **管理动作（全部人工后台操作）** | 裁决（支持/不支持取消+责任方判定）、免罚、调分反转（cancel_reverse）、平台强制取消、处罚申诉处理 | 复用 admin-action 现有模式（dispute_handle / user_credit_adjust / noshow_decide），AI 与程序不代做管理决策 |
| **系统定时动作（窗口可配）** | S2 取消确认 2h 超时转裁决（D6 已拍板固定「转裁决不自动同意」，仅窗口时长可配） | 超时行为本身是拍板业务规则，时长参数化 |

**配置读取纪律**：
- 服务端云函数每次执行从 `admin_config` 读键，**禁止硬编码业务参数**；读不到走默认值兜底链（规则 §32），默认值与 §0.1 表一致。
- 前端展示口径（`miniprogram/config/index.js`）与服务端 `admin_config` 键**对齐校验**（zhaoren-config-sync 纪律，双侧实测对账 §39）。
- admin-web `Config.vue` 新增「取消规则」配置区（仿现有 NO_SHOW 9 键区域模式）。
- 改配置走 admin-action 写接口 + 审计，禁止直改数据库。

## 0.1 后台可配置项总表（SSOT：admin_config）

| 键 | 类型 | 默认值 | 说明 | 落点波次 |
|---|---|---|---|---|
| `cancel_enable` | bool | `false` | 取消功能全局开关（W3 真机通过后才置 true）；false 时所有取消入口拒绝 | W3 |
| `cancel_confirm_window_min` | int | `120` | S2/S2_6 取消申请对方确认窗口（分钟），超时转裁决 | W3 |
| `cancel_penalty` | object | `{s2_far:-5, s2_mid:-15, s2_near:-25, s3:-30, fulfill:-20}` | 各场景发起方扣分梯度（分）；S0/S1 恒为 0 不配置 | W3 |
| `cancel_refund_tiers` | object | `{far_hours:24, far_rate:1.0, mid_hours:4, mid_rate:0.8, near_rate:0.5}` | 协商型梯度退款档位（小时+比例） | W3 |
| `cancel_cooldown_withdraw_min` | int | `60` | 撤回后重发冷却（分钟，B6） | W3 |
| `cancel_cooldown_rejected_min` | int | `1440` | 被拒/裁决不支持后重发冷却（分钟，D14） | W3 |
| `cancel_freq_window_hours` | int | `24` | 跨单取消频次统计窗口（小时，W6 软门槛） | W6 |
| `cancel_freq_max` | int | `3` | 窗口内取消次数上限，超过则本单取消转人工裁决（软门槛非封禁，D9） | W6 |

> 配置三件套落点：`admin-action/config_schema.js`（键校验）+ `config_defaults.js`（默认值）+ `init-db/index.js`（初始化默认行）。**W3 改动清单显式包含这三处**（评审 #5）。

## 0.2 决策记录（已拍板）

| 编号 | 决策 | 结论 | 说明 |
|---|---|---|---|
| B1 | `<400` 自动冻结 | **一期不自动冻，订正红线#3 口径** | `<400` 记为「待冻结」，管理员 moderation 处理；同步订正 rules-core 附录A #3、PRD、HANDOFF（W0）。自动冻为二期独立项。**（原 D4 与本条同源，编号合并，不再单列）** |
| B2 | 部分退款目标态 + 结算 | **部分退一律→S7 终态，结算按 `paid_fen - refunded_fen` 分账** | 不回主轴；**no.18 现行「部分退→回主轴」描述随 W0 订正（sync 三副本）**（评审 #3） |
| B3 | 取消挂起是否置 frozen | **pending 期间置 `frozen=true`** | 复用现有 `isFrozen` 守卫；撤回/超时/裁决/同意时清 frozen |
| B4 | tip 小费取消处理 | **tip 随订单同比例退给用户** | `tip_refund_fen = round(tip_total_fen × refund_fen / paid_fen)` |
| B5 | 协商型免罚 | **协商型只走固定梯度扣分；免罚只能走平台裁决申诉** | 免罚由管理员裁决判定（人工后台动作），调分写 `credit_score_log type='cancel_reverse'` |
| B6 | 撤回冷却 | **撤回后不可立即重发**（默认 60 分钟，可配 `cancel_cooldown_withdraw_min`） | 被拒/裁决不支持冷却默认 24h（可配 `cancel_cooldown_rejected_min`）；两档共用字段 `cancel_cooldown_until` |
| D1 | S3+ 取消路径 | 走 S10.5 裁决二跳 | |
| D2 | 取消赔付口径 | 零现金赔付，只扣信用分 | 订正 money_rules 头注释（W2，@VERIFIED 核验后） |
| D3 | S3+ 退款算法 | 一期管理员手填 refund_fen | 不做自动比例 |
| D5 | S1 取消处罚 | 双方都不罚 | S0/S1 未支付无损失 |
| D6 | S2 超时 | 确认窗口（默认 120 分钟，可配）超时→转 S10.5 裁决，**不自动同意** | 行为固定，仅窗口可配 |
| D7 | S5/S8 禁自助取消 | 是 | 只能争议退款（no.18）或平台强制取消 |
| D8 | 分波上线 | 是 | 见 §8 |
| D9 | 跨单取消频次 | **W6（一期）软门槛**：窗口内超阈值→本单取消转人工裁决，不封禁；阈值可配（§0.1） | 评审 #7 口径统一：归 W6 一期 |
| D10 | 裁决「不支持取消」 | 发起方不扣分（取消未成功）；管理员判恶意可额外扣分 | 原散落 §3.2，补录决策表（评审 #1） |
| D11 | S2_5 归属 | 归裁决型（不走协商） | 补录决策表（评审 #1） |
| D12 | 退券 | **S2+ 取消不退券**（防套现） | 云函数侧暂无券实现，落地前确认无套现口 |
| D13 | 撤回功能 | 一期做 | pending 未超时可撤回，不扣分，冷却可配 |
| D14 | 被拒后冷却 | 一期做 | 默认 24h，可配 `cancel_cooldown_rejected_min` |
| D15 | S2_5 置 frozen | **是** | 改期期间冻结改期外操作；`modify_confirm/reject` 清 frozen |
| D16 | 平台强制取消 | 一期只做「投诉裁决成立→强制退」，复用 dispute_handle | 独立入口二期 |
| D17 | 免罚判定 | 一期人工裁决 | dispute_handle 加「取消责任方」字段（管理动作，人工） |

---

## 1. 现状与问题（实证）

| 项 | 现状 | 证据 |
|---|---|---|
| 可直接取消 | 仅 S0/S1 | `cloudfunctions/order-action/action_lifecycle.js:29-34` |
| S2 取消 | 迁移表 no.4 有 `cancel_request` 定义，**无 handler/无定时器/无前端** | `order_state.js:118`；`index.js:460-472`（HANDLERS 无注册）、`index.js:536`（ORDER_ID_ACTIONS 无）；`order-timer/action_timeout.js`（无确认窗口扫描） |
| S3+ 取消 | 完全无路径 | TRANSITIONS 无对应事件 |
| 取消处罚 | 零处罚（不扣信用分） | cancel 函数无 credit 调用 |
| 取消退款 | 零退款（S0/S1 未支付） | cancel 函数无 refund 调用 |
| 梯度退款 | 仅前端配置，服务端无函数；`money_rules.js` 头注释 @VERIFIED 声称已验证梯度退款但**无实现**（订正前需核验归档验证记录，见评审 #12） | `miniprogram/config/index.js:73-77`；`_shared/money_rules.js:1` vs 导出 L158-164 |
| 退款并发 | 现有靠主轴状态 CAS 串行化 | `payment-mock/action_pay.js:219-223`；`admin-action/action_dispute_handle.js:69` |
| `<400` 冻结 | 红线#3 规定，但无执行方（仅 4 处配置读取） | `config_schema.js:65` 等；全 cloudfunctions 无消费 |
| 结算 | `partner_income_fen` 退款全链路不修改，部分退会倒挂；S7 不在结算集合 | `payment-mock/action_account.js:22`；refund 链路 grep 无写入 |
| tip 挂账 | tip 独立流水，取消退订单款时 tip 既不退也不结 | `action_pay.js:321-340` |

---

## 2. 取消矩阵 v2.2.1（全状态）

| 状态 | 发起方 | 方式 | 退款 | 发起方扣分（默认值，可配 §0.1） | 终态 | 备注 |
|---|---|---|---|---|---|---|
| S0 待支付 | user | 直接取消 | 无 | 0 | S6 | 已有，不变 |
| S0 | 平台 | 强制取消 | 无 | 管理员判定 | S6 | W5 |
| S1 待确认 | both | 直接取消 | 无 | 0（D5 双方不罚） | S6 | 已有，不变 |
| S1 | 平台 | 强制取消 | 无 | 管理员判定 | S6 | W5 |
| S2 已支付待履约 | both | 协商型 | 梯度（默认 100%/80%/50%，可配） | -5/-15/-25（可配） | S7（同意）/ S10.5（拒绝/超时） | W3 |
| S2 | 平台 | 强制取消 | 管理员填 | 管理员判定 | S7 | W5 |
| S2_5 改期中 | both | 裁决型（D11） | 管理员填（含改期争议） | -20（可配） | S10.5→裁决→S7 | W4；D15 置 frozen |
| S2_6 履约申请中 | both | 协商型 | 梯度（可配） | -5/-15/-25（可配） | S7/S10.5 | W3；T6 新增 S2_6→S7 边 |
| S2_6 | 平台 | 强制取消 | 管理员填 | 管理员判定 | S7 | W5 |
| S3 履约中 | both | 裁决型 | 管理员填（按比例） | -30（可配） | S10.5→S7 | W4 |
| S3 | 平台 | 强制取消 | 管理员填 | 管理员判定 | S7 | W5 |
| S3_6 / S3.5 / S4 | both | 裁决型 | 管理员填 | -20（可配） | S10.5→S7 | W4 |
| S3_6 / S3.5 / S4 | 平台 | 强制取消 | 管理员填 | 管理员判定 | S7 | W5 |
| S5 已完成 | — | 禁自助取消 | — | — | （争议退款 no.18 / 平台强制 W5） | D7 |
| S8 已评价 | — | 禁自助取消 | — | — | （平台强制 W5，需结算回滚） | D7 |
| S9（退役→S8） | — | 同 S8 | — | — | — | mapStatus 自动归 S8 |
| S10.5 争议中 | — | 禁（frozen） | — | — | — | 裁决后经 `cancel_dismissed` 回主轴或→S7 |
| S6/S7/S10 终态 | — | 禁 | — | — | — | |

> **禁止取消白名单之外的所有情形**：终态、S10.5、已有 pending 取消申请、已 frozen（投诉/爽约中）。
> 所有退款比例与扣分分值均为**后台可配默认值**，服务端从 admin_config 读（§0.0/§0.1）。

---

## 3. 业务流程

### 3.1 协商型取消（S2 / S2_6）

```
[发起方] 点「申请取消」(弹框：梯度退款比例 + 扣分档位提示，均从配置读取展示)
   │
   ▼
校验：cancel_enable 开关 && status∈{S2,S2_6} && !isFrozen && cancel_request 无 pending
      && 未在冷却期（cancel_cooldown_until）
   │ 通过
   ▼
CAS 抢占：order.cancel_request = {status:'pending', by:role, by_openid, at,
         deadline: now + cancel_confirm_window_min, reason}
         置 frozen=true（B3）
   │
   ▼
4 副本通知双方 + writeAudit（"X 申请取消，请窗口期内确认"）
   │
   ├─[对方同意]──▶ CAS(pending) ──▶ cancelRefundFen 梯度退（档位可配，按同意时刻算 lead）──▶
   │                同事务{退款流水+tip同比例退+fund点路径+扣分(梯度可配)+日志+状态→S7} ──▶
   │                清 frozen ──▶ 通知到账
   ├─[对方拒绝]──▶ CAS(pending) ──▶ status='rejected'，cancel_cooldown_until=now+rejected_min(可配)
   │                ──▶ 转 S10.5(dispute_type='cancel') ──▶ 通知
   ├─[窗口超时]──▶ order-timer 扫描 deadline ──▶ status='timeout' ──▶ 转 S10.5 ──▶ 通知（D6 不自动同意）
   └─[发起方撤回]──▶ CAS(pending && 未超时) ──▶ status='withdrawn'，清 frozen，
                    cancel_cooldown_until=now+withdraw_min(可配) ──▶ 不扣分（B6）──▶ 通知
```

**退款计算**（协商型）：`refund_fen = cancelRefundFen(fund.paid_fen, leadMs, cfg)`，leadMs = 履约开始时间 - **同意时刻**（不按申请时刻）；cfg 从 admin_config `cancel_refund_tiers` 读，读不到走兜底默认。`tip_refund_fen = round(tip_total_fen × refund_fen / paid_fen)`（B4）。

### 3.2 裁决型取消（S2_5 / S3 / S3_6 / S3.5 / S4）

```
[发起方] 点「申请取消（需平台处理）」(弹框：进入争议裁决 + 扣分档位提示)
   │
   ▼
校验：cancel_enable && status∈{S2_5,S3,S3_6,S3.5,S4} && !isFrozen && 无 pending && 未冷却
   │
   ▼
CAS：置 frozen=true，cancel_request={status:'pending',...}，直接转 S10.5(dispute_type='cancel')
   │
   ▼
通知双方 + writeAudit
   │
   ▼
[平台管理员] 在 admin 后台 dispute_handle 裁决（人工管理动作，不写死）：
   - 填 refund_fen（0 ≤ refund_fen ≤ paid_fen - already_refunded）
   - 选「取消责任方」（发起方/对方/不可抗力/平台）→ 决定扣分与免罚（B5/D17）
   - 系统校验后同事务{退款流水+fund点路径+tip退+扣分或免罚+状态→S7(B2)+清 frozen}
   │
   ├─[支持取消]──▶ S7，按责任方扣分或免罚（D10）
   └─[不支持取消]──▶ 经 cancel_dismissed 回原主轴态（记录 pre_dispute_status），清 frozen，
                     发起方不扣分；管理员判恶意可额外扣分（D10）
```

> **回退边红线补录**：「S10.5 → 原 S2/S2_5/S2_6/S3/S3_6/S3.5/S4」不在现行附录A，W0 补录（评审 #3）。

### 3.3 平台强制取消（W5，一期复用 dispute_handle）

- 触发：投诉裁决成立 / 违规订单，**管理员后台人工操作**（不写死自动触发）。
- **W1 执行期发现（2026-11-24）**：`admin-action/action_order_demand_ops.js:25-58` 已存在 `order_force_cancel`（现仅支持 S0/S1：直改 S6+释放 demand+审计 `action:'admin_force_cancel'`）。W5 改为**扩展现有 handler** 至 S2-S8（补 refund_fen/接管 cancel_request/S8 结算回滚），并迁移到 `casTransition(event='admin_force_cancel')` 走状态机白名单（现有实现未传 event，属兼容放行路径）；不新建入口。
- 新 TRANSITIONS 行 `admin_force_cancel`（from S0-S8，to null 由业务定 S6/S7）已在 W1 加入（no.37）。
- 接管已有 `cancel_request`：清 pending、清 frozen、撤销未生效扣分。
- S8 强制取消：需先回滚结算（若已结算），平台担责追回。
- 必写 writeAudit（操作人、原因、refund_fen）。

---

## 4. 资金与退款设计（T1-T4）

### 4.1 梯度退款纯函数（T1）

在 `cloudfunctions/_shared/money_rules.js` 新增：
```js
// 梯度退款：leadMs = 履约开始时间 - 同意时刻；cfg 从 admin_config cancel_refund_tiers 读，兜底默认同 §0.1
function cancelRefundFen(paidFen, leadMs, cfg) {
  const rate = leadMs >= cfg.far_hours*3600e3 ? cfg.far_rate
             : leadMs >= cfg.mid_hours*3600e3 ? cfg.mid_rate
             : cfg.near_rate;
  return Math.round(paidFen * rate);
}
// 可退上限：防超额退
function refundCap(paidFen, alreadyRefundedFen) { return Math.max(0, paidFen - alreadyRefundedFen); }
```
- **档位 SSOT 是 admin_config `cancel_refund_tiers`**（评审 #10），服务端云函数读配置 + 兜底默认；前端 `config/index.js` 展示口径与其对齐校验（zhaoren-config-sync，双侧对账）。
- 单测 `money_rules.test.js` 覆盖：各档位边界、paid=0、already>paid、cfg 缺失走兜底。
- **sync 目标更正（评审 #6，已实证）**：`sync-money-rules.ps1` 现有目标为 **payment-mock / order-create / order-action** 三处（漏 order-create 会被 SHA 门禁拦截）；admin-action 为**新增目标**，需扩脚本 + 在 admin-action 落副本文件。
- **money_rules.js 是 @VERIFIED 文件**（评审 #12）：订正头注释前先核验归档中该验证记录对应的具体函数（保留已验证部分，只删/改梯度退款描述），按规则 §2 出说明并获书面批准。

### 4.2 退款原子性（T2）

- **外层串行门**：`cancel_request` 状态 CAS（`where({_id, 'cancel_request.status':'pending'})`）或主轴状态 CAS，保证同一时刻只有一个退款执行者。
- **fund 纵深防御**：点路径写 `fund.refunded_fen` 用 `_.inc(refund_fen)`，CAS 条件引用**当前**值：`'fund.refunded_fen': db.command.lt(paid_fen - refund_fen + 1)`（严格 `<` 防末笔双过）。不用客户端陈旧 `already`。

### 4.3 退款与扣分同事务（T3）

1. 外层 `order_main` CAS（推进状态 + 点路径写 `fund.refunded_fen`）—— 串行门。
2. **同一 `db.runTransaction`** 内：`pay_transaction`(refund) + `pay_transaction`(tip_refund) + `user_account` 读-钳制[0,1000]-写信用分 + `credit_score_log` + `order_status_log`。
3. 事务失败 → 整体回滚（含信用）→ 补偿仅回退 `order_main` 状态/fund。
4. 补偿二次失败 → P0 留痕（仿 `payment-mock/action_pay.js:7-16` `reportCompensateFail`）；`dispute_handle` 现补偿仅 `log.e`（:103），一并补 `platform_event`。

### 4.4 fund 统一点路径 + 共享规则（T4）

- 禁止整体覆盖 `fund` 对象（会重置 `settle_state`）。所有退款写 `fund.refunded_fen` / `fund.refunded_at` 点路径。
- 抽 `_shared/refund_rules.js`（可退上限、fund 点路径写、tip 同比例退、结算基数），sync 到 payment-mock/order-create/order-action + 新增 admin-action。

### 4.5 结算基数（B2）

- 部分退→S7 终态，不回主轴；no.18 旧描述「部分退→回主轴」随 W0 订正。
- 耍伴可提现基数改为 `paid_fen - refunded_fen`；`action_account.js`/`action_withdraw.js` 聚合口径调整（W4）。
- tip：同比例退用户后，剩余 tip 结算给耍伴（S7 纳入结算集合，W4）。

---

## 5. 信用分处罚规则

### 5.1 扣分梯度（收敛到 `_shared/credit_rules.js`，T5；**分值全部后台可配**）

```js
// cfg 从 admin_config cancel_penalty 读，兜底默认同 §0.1；代码只做场景→键映射，不写死分值
function cancelCreditDelta(status, leadMs, cfg) {
  if (status === 'S2' || status === 'S2_6') {
    return leadMs >= cfg.farHours*3600e3 ? cfg.s2Far
         : leadMs >= cfg.midHours*3600e3 ? cfg.s2Mid : cfg.s2Near;
  }
  if (status === 'S3') return cfg.s3;
  if (['S2_5','S3_6','S3.5','S4'].includes(status)) return cfg.fulfill;
  return 0; // S0/S1 不罚（D5，固定规则不配置）
}
```
- 扩展 `sync-credit-rules.ps1` 目标：现有 evaluation-submit/order-timer 两处，**新增 order-action/admin-action**（评审确认现无副本）。
- 分值后台可配（§0.1 `cancel_penalty` 键，admin-web Config.vue 可改，走审计）。

### 5.2 扣分写库（T8）

- 同用户并发多单取消：按 openid 聚合 `_.inc` 批量写（仿 `order-timer/action_lifecycle.js:113-145` 模式），另加钳制守卫（<0 置 0）或异步对账。
- 写 `credit_score_log`（type='cancel'，关联 order_id）。
- 按发起方角色选 `user_credit_score` / `partner_credit_score`。
- 扣分后门槛校验：<600 禁接单/下单（已有：`cloudfunctions/order-create/action_take.js:82`、`cloudfunctions/demand-publish/action_publish.js:250`，评审 #13 补全前缀）；<400 记「待冻结」（B1）。

### 5.3 免罚与反转（B5，全部人工后台动作）

- 协商型：默认扣发起方分，不接受自判免罚。
- 免罚/改罚/调分反转：仅管理员在后台操作（dispute_handle 责任方判定 / `admin-action/action_user_ops.js:23` `user_credit_adjust`，调分写 `credit_score_log type='cancel_reverse'`）。

---

## 6. 风控

| 机制 | 规则 | 实现 | 参数 |
|---|---|---|---|
| 功能开关 | `cancel_enable=false` 时全部取消入口拒绝 | 读配置 | W3 |
| 去重 | 同方同单已有 `cancel_request.status==='pending'` → 拒 | CAS 抢占 | — |
| 并发 | 双方同时取消 → CAS 抢 `cancel_request` 字段，只一方成功 | CAS | — |
| frozen 互斥（B3） | 取消挂起置 frozen；投诉/爽约/改期/开始履约/加时在 isFrozen 时被拒；反之亦然 | 复用 `index.js:273-275` | — |
| S2_5 frozen（D15） | 改期进入 S2_5 置 frozen；modify_confirm/reject 清 | W1 状态机 | — |
| 撤回冷却（B6/D13） | pending 未超时可撤，不扣分，清 frozen，写冷却 | W3/W6 | `cancel_cooldown_withdraw_min`（默认 60） |
| 被拒冷却（D14） | 被拒/裁决不支持→不可同单再发 | W3 | `cancel_cooldown_rejected_min`（默认 1440） |
| 跨单频次（D9） | 窗口内超阈值→本单取消转人工裁决（软门槛，W6 一期） | W6 | `cancel_freq_window_hours`/`cancel_freq_max` |
| 申诉 | 复用投诉/争议通道，管理员人工调分 `cancel_reverse` | W6 | — |
| demand | S0/S1 取消释放 demand（已有）；S2+ 取消不释放 | 实现区分 | — |
| 评价 | S2+ 取消→S7 不触发评价 | 实现区分 | — |

> 所有阈值/时长均为后台可配默认值（§0.1），禁止写死。

---

## 7. 技术设计

### 7.1 字段 schema（`order_main` 灵活文档型，补 init-db 默认值 + 读兼容）

```js
order.cancel_request = {
  status: 'pending' | 'agreed' | 'rejected' | 'timeout' | 'withdrawn',
  by: 'user' | 'partner', by_openid: string,
  at: number, deadline: number, reason: string,
  refund_fen: number, tip_refund_fen: number
}
order.cancel_cooldown_until: number
order.frozen: boolean                 // 已有
order.dispute_type: string            // 已有，取消转裁决置 'cancel'
order.pre_dispute_status: string      // 新增：转裁决前主轴态，裁决不支持时回退用
// fund 正交位（已有，点路径增量写）
```
- 复用 `order.cancel_request` 字段形状（`urge_rules.js:63` 已预期 `status==='pending'`，催办互斥自动生效）。

### 7.2 状态机改动（T6/T7，W1）

`order_state.js`（@VERIFIED 2026-10-13，**分行分 event，不动 no.3、不动 mapStatus/ALL_STATES**）：

| event | from | to | 说明 |
|---|---|---|---|
| no.4 `cancel_request`（**from 扩**） | `['S2','S2_6']` | `null`（挂起不改主轴） | S2 现有保留，**扩 S2_6 协商申请**（评审 #2：否则 S2_6 申请被白名单拦截，W3 走不通） |
| `cancel_request`（新行） | `['S2_5','S3','S3_6','S3.5','S4']` | `S10.5` | 裁决型申请 |
| `cancel_confirm` | `['S2','S2_6']` | `S7` | 协商同意直退（T6，补录附录A S2_6→S7） |
| `cancel_timeout` | `['S2','S2_6']` | `S10.5` | 确认窗口超时转裁决 |
| `cancel_dismissed` | `['S10.5']` | `['S2','S2_5','S2_6','S3','S3_6','S3.5','S4']`（回 pre_dispute_status） | 裁决不支持取消回主轴（评审 #3，**附录A 补录**） |
| `admin_force_cancel` | `['S0'..'S8']` | `S6`/`S7` | 平台强制取消（T7，W5） |

- no.3（S1/S0→S6）保持不变 → `order_state.test.js` 的 no.3 白名单断言（**:198**）与 `transitionAllowed('cancel','S2','S3')===false`（**:199**）仍真（评审 #14 精确行号）。
- 更新 `TRANSITIONS.length===28` 断言（**:33**）为新行数 + 新增正向用例。
- **no.18 描述订正**：「部分退→回主轴」改「部分退→S7（B2）」，随 `sync-order-state.ps1`（位于 `cloudfunctions/_shared/`）同步三副本（评审 #3）。
- 同步补录附录A：S2_6→S7、cancel_request 扩 S2_6 与裁决型 from、S10.5 回退边、admin_force_cancel。
- **W1 零行为变更自证**（评审 #15）：新事件名 `cancel_confirm/cancel_timeout/cancel_dismissed/admin_force_cancel` 全局 grep 无运行时调用方（cancel_request 现仅 3 份定义无调用），新行不会被运行时读到。

### 7.3 通知与审计（§45）

- 每节点 4 副本通知 + `writeAudit`：发起/同意/拒绝/超时/撤回/裁决结果/退款到账。
- **writeNotice 落点**（评审 #9）：`cloudfunctions/order-action/index.js:173` 定义（另有 `partner-action/index.js:26`、`im-send/index.js:90` 共 3 份代码副本 + action_change.js 包装）。取消链路**只复用不改结构**；如确需改通知结构，按 §45「4 副本同批改」纪律一次改齐。

---

## 8. 编码实施计划（分波次，每波独立 commit，可回滚）

> **铁律**：每波前先出该波详细改动清单等用户批准；每波后 `verify:offline` + 单测 + 部署验证 + REGISTRY/CHANGELOG + 真机验收，通过才进下一波。W1/W2 零行为变更，先过审。

### W0：冻结前置（纯 docs，零代码）—— **待用户批准后立即执行**
- 订正红线#3 口径（B1）：`.trae/rules/project-rules-core.md` 附录A #3（L128 附近）「<400 账号冻结」→「<400 记为待冻结，管理员处理；一期不自动冻，二期实现」；同步 PRD_v15.1.md（L5890 附近，执行时精确定位）与现行 HANDOFF（docs/HANDOFF-20261122-b.md）对应条目（评审 #18）。
- 补录附录A 新流转边：S2_6→S7、cancel_request 扩 S2_6 与裁决型 from、S10.5 回退边、admin_force_cancel（评审 #3）。
- 订正 no.18「部分退→回主轴」旧口径为「部分退→S7」（B2），注明随 sync-order-state.ps1 三副本同改（评审 #3）。
- 产物：docs commit（单独）。不碰代码。

### W1：状态机扩表（零行为变更，不接 handler）
- **改动**：`cloudfunctions/order-action/order_state.js`（新增 event 行，no.4 from 扩 S2_6，不动 no.3/mapStatus/ALL_STATES）；`cloudfunctions/_shared/order_state.test.js`（:33 length 断言 + :198/:199 既有断言保持 + 正向用例）；跑 `cloudfunctions/_shared/sync-order-state.ps1` 同步（评审 #16）。
- **验证**：`verify:offline` EXIT=0、A/B EQUIVALENT、`order_state.test.js` 全过、`check-shared-sync` OK、GetDiagnostics 0、**新事件名全局 grep 无调用方**（评审 #15）。
- **风险**：低（纯新增）。**回滚**：revert commit。
- **部署**：order-action + order-timer（DevTools CLI 或右键上传，含 openapi 的函数禁 tcb CLI——zhaoren-ops #14）。

### W2：退款与信用分纯函数 + 配置键（_shared 层，零行为变更）
- **改动**：
  - `_shared/money_rules.js`（`cancelRefundFen`/`refundCap` + 单测；**@VERIFIED 核验后订正头注释**，评审 #12）
  - `_shared/credit_rules.js`（`cancelCreditDelta` + 单测，分值走 cfg 参数不写死）
  - `sync-money-rules.ps1`（**目标确认为 payment-mock/order-create/order-action；新增 admin-action 目标**，评审 #6）
  - `sync-credit-rules.ps1`（新增 order-action/admin-action 目标）
  - `admin-action/config_schema.js` + `config_defaults.js` + `init-db/index.js`（§0.1 全部键，评审 #5）
- **验证**：`node --test` 全过、SHARED SYNC ALL OK、verify EXIT=0。
- **风险**：低。**回滚**：revert。
- **部署**：_shared 副本随 W3 携带部署，本波无独立部署。

### W3：协商型取消链路（S2/S2_6）—— 第一个有行为变更的波次
- **改动**：
  - `cloudfunctions/order-action/action_cancel.js`（新增）：`cancel_request`/`cancel_confirm`/`cancel_reject`/`cancel_withdraw`，读配置（§0.1 全部键），接 W2 退款函数（T3 同事务）+ 扣分（聚合 _.inc），置/清 frozen
  - `order-action/index.js`：注册 HANDLERS + ORDER_ID_ACTIONS
  - `order-timer/action_timeout.js`：确认窗口超时扫描（deadline 过期→S10.5）
  - `order-timer` 的 money_rules/credit_rules/order_state 副本 sync
  - **前端 `order-detail.wxml/.js`：@VERIFIED 文件（js L1 标记 2026-10-13）——按规则 §2 单列批准项：为何必须改（S2/S2_6 需取消入口）+ 向后兼容（只新增入口按钮与 onAction 分支，不动既有函数逻辑，旧调用方零影响）+ 需你书面批准后才动**（评审 #4）
  - admin-web `Config.vue`「取消规则」配置区
- **验证**：单测（含并发双方同意不重复退、超额退拦截）、verify EXIT=0、真机造 S2 单全流程、配置改后生效验证、暗色/浅色。
- **风险**：高。**回滚**：`cancel_enable=false` 关开关即停用（后台可配，不需回滚代码）。
- **部署**：order-action + order-timer + admin-action（config schema）+ 体验版上传。
- **REGISTRY**：#207 协商型取消。

### W4：裁决型取消链路（S2_5/S3/S3_6/S3.5/S4）
- **改动**：
  - `order-action`：裁决型入口（申请直接转 S10.5，dispute_type='cancel'，记 pre_dispute_status）
  - `admin-action/action_dispute_handle.js`：「取消责任方」字段 + 免罚判定 + `cancel_dismissed` 回主轴分支 + tip 同比例退 + 补 platform_event 补偿留痕
  - `payment-mock/action_account.js`/`action_withdraw.js`：结算基数 `paid-refunded`；S7 纳入 tip 结算集合
  - 前端 order-detail（@VERIFIED，同 W3 批准流程）S2_5/S3/S3_6/S3.5/S4 入口
- **验证**：单测、真机造 S3 单、admin 后台裁决、结算对账（双侧 grep §39）。
- **部署**：order-action + admin-action + payment-mock + 体验版。
- **REGISTRY**：#208 裁决型取消。

### W5：平台强制取消（admin）
- **改动**：**扩展现有** `admin-action/action_order_demand_ops.js` 的 `order_force_cancel`（W1 发现已存在，现仅 S0/S1）到 S2-S8：补 refund_fen 参数、接管 cancel_request 清理、S8 结算回滚、迁移到 `casTransition(event='admin_force_cancel')`；admin 后台入口（人工操作，复用现有按钮扩状态范围）。
- **验证**：admin 后台操作、审计留痕、结算回滚对账。
- **部署**：admin-action。
- **REGISTRY**：#209。

### W6：风控完善 + 申诉
- **改动**：`action_cancel.js` 跨单频次软门槛（读 `cancel_freq_*` 配置）；`admin-action/action_user_ops.js` 接 `cancel_reverse` 调分（人工）；免罚申诉入口。
- **部署**：order-action + admin-action。
- **REGISTRY**：#210。

### 波次×部署对象总表（评审 #8）

| 波次 | 部署对象 | 通道 |
|---|---|---|
| W1 | order-action、order-timer | DevTools CLI / 右键上传（openapi 函数禁 tcb CLI） |
| W2 | 无（_shared 随 W3 携带） | — |
| W3 | order-action、order-timer、admin-action、体验版 | 同上 + cli upload |
| W4 | order-action、admin-action、payment-mock、体验版 | 同上 |
| W5 | admin-action | 同上 |
| W6 | order-action、admin-action | 同上 |

---

## 9. 影响面与回归

| 既有功能 | 影响 | 回归验证 |
|---|---|---|
| 已验证四页（index/profile/message/service） | order_state.js 只新增不改，前端不直接 import，**不影响** | 真机冒烟 |
| S0/S1 现有取消 | no.3 不变，**行为不变** | 真机 |
| 投诉/爽约（frozen） | 取消置 frozen 后互斥（预期行为：取消挂起期间投诉被拒） | 真机验并发 |
| 催办（urge_rules） | 复用 cancel_request.pending 字段，催办互斥自动生效（正向） | 真机 |
| 改期（S2_5） | D15 置 frozen；**需回归改期链路**（含 modify_confirm/reject 清 frozen） | 真机 |
| 结算/提现 | 基数改 paid-refunded；**需对账** | 双侧数据核对 §39 |
| 评价 | S7 不触发评价 | 真机 |
| admin-web 配置 | 新增「取消规则」区，改配置走审计 | 后台操作验证 |

---

## 10. 已知限制与二期

| 项 | 一期处理 | 二期 |
|---|---|---|
| `<400` 自动冻结 | 不实现，订正红线口径（B1） | order-timer 信用冻结扫描 |
| S3+ 自动比例退款 | 管理员手填（D3） | 按时长/milestone 自动比例 |
| 跨单取消频次硬拦截 | W6 软门槛转人工（D9，阈值可配） | 实时风控引擎 |
| 平台强制取消独立入口 | 复用 dispute_handle（D16） | 独立后台按钮 |
| 耍伴垫付费用 | 不处理（零赔付） | 垫付凭证上传+裁量 |
| 优惠券 | S2+ 不退（D12） | 券功能落地后细化 |

---

## 11. 经验沉淀随附（本会话 E1-E5，编码阶段一并落盘）

| # | 经验 | 落点 |
|---|---|---|
| E1 | 色值收口口径：`var(--token,#fallback)` 保留；仅纯硬编码或引用不存在的 token 才改 | docs/session-log/（会话收尾落盘时新建目录，评审 #11：原 project_memory.md 不存在） |
| E2 | custom-tab-bar 独立渲染层取不到 page CSS 变量，硬编码+暗色媒体查询是故意设计 | 同上 |
| E3 | UI 真机验收分阶段落账：单端通过先标「X端已通过，另一端待验」，双端都过才标「已验证」 | 同上 |
| E4 | 可点击元素无反馈时复用全局 `btn-press` 补 hover-class | 补进 `wxapp-ui-polish` 技能（已确认存在） |
| E5 | push 成功须 `git ls-remote origin master` 带同代理覆盖核对 SHA==HEAD | 已有 §44，补示例到 `zhaoren-frequent-flows` 技能 |

---

## 12. 待用户确认（三类批准，勿混淆，评审 #17）

| # | 事项 | 性质 |
|---|---|---|
| 1 | **本文档 v2.2.1 是否批准**（产物批准） | 方案评审通过即视为批准 |
| 2 | **是否同意从 W0 + W1 开始执行**（执行授权，按波逐次） | W1 完成验证后需再批准 W2 |
| 3 | **W0 红线#3 口径订正**（改 rules-core/PRD/HANDOFF，触及全局规则文件） | 按 §3 需书面批准 |
| 4 | W3/W4 改 order-detail（@VERIFIED）届时单独书面批准 | 按规则 §2 |

> §0.2 决策记录（B1-B17）为已拍板事项的登记，非待决项。
