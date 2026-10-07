# 设计稿（2026-10-07）：双计价模式 / 爽约处罚 / 履约中禁改期

> 状态：**设计稿，尚未实施**。三个议题均涉及已验收基线（定价口径、订单状态机、超时规则），实施前需 PRD 负责人逐项确认。
> 依据：基于当前代码的只读调研（定价链路 / 改期链路 / 爽约能力现状）。

## 决策基线（已拍板）

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 计价模式 | **一口价 与 时薪价 并存**（发布时二选一），非替换 |
| 2 | 一口价订单加时/延长时长 | **总价不变** |
| 3 | 耍伴接单筛选 | **新增「客单价区间」**（时薪单仍用原时薪区间） |
| 4 | 公益单 | **归入一口价** |
| 5 | 禁改期范围 | **S3（履约中）与 S3.5（履约中断）均禁止改期** |

---

## 议题一：一口价与时薪价并存

### 现状（事实）
- 发布时用户填「预算 __ 元/小时」；`total_fen = rate_fen × duration_h`（demand-publish:426）
- `total_fen` **已是唯一结算口径**：下单直接用（order-create:586-587）、分账（money_rules）、支付（payment-mock:192）、青年限额（三方校验）
- 时薪区间钳制 `rate_min_fen`/`rate_max_fen`（兜底 3000/10000）
- 耍伴接单筛选用**时薪区间**（take_rules.js:51-60 的 `accept_rate_min_fen/max_fen`）
- 公益单写死时薪 3000 分（config/index.js:107）
- **无一口价字段**

### 数据模型
```
demand.pricing_type    'hourly' | 'fixed'   ← 新增；缺省 hourly（兼容存量）
demand.rate_fen                              ← 保留（hourly 口径）
demand.fixed_price_fen                       ← 新增（fixed 口径）
demand.total_fen                             ← 统一结算口径，不变
order_main.pricing_type / total_fen          ← 订单侧冗余快照（便于展示与对账）
```
> 关键：**两种模式都收敛到 `total_fen` → 结算链路零改动**。

### 改动清单
1. **demand-publish**
   - 新增 `pricing_type` 枚举校验
   - `hourly`：原逻辑（rate_fen × duration_h）
   - `fixed`：校验 `fixed_price_fen` 落在新配置区间 → `total_fen = fixed_price_fen`
   - 公益单：改为一等公民 `pricing_type='fixed'` + `fixed_price_fen=配置值`
   - 青年限额、红线、时间窗冲突判定**均沿用 `total_fen`**，无需分支
2. **order-create**：取价沿用 `demand.total_fen`；把 `pricing_type` 快照进订单
3. **take_rules（接单筛选）**——本次唯一"真改逻辑"处
   - 耍伴配置新增 `accept_total_min_fen/accept_total_max_fen`（客单价区间）
   - 匹配：`hourly` 单 → 原时薪区间；`fixed` 单 → 客单价区间
   - **兜底**：耍伴未配置客单价区间时，默认不限制（宁松勿错，避免误拦）
4. **前端**
   - publish 页新增计费方式切换器（时薪 / 一口价），切换时输入框与文案联动
   - 列表/详情/卡片：按 `pricing_type` 显示「¥X/小时」或「一口价 ¥X」
   - 一口价单在改期/加时入口明确提示「一口价订单延长时长不加价」
5. **后台配置（CONFIG_SCHEMA）**
   - `fixed_price_min_fen` / `fixed_price_max_fen`（一口价区间）
   - `welfare_fixed_price_fen`（公益一口价，替代现有 `welfare_hourly_rate_fen`；旧键保留读兼容）

### 风险与边界
- 接单筛选双口径：**必须明确兜底策略**，否则一口价单可能被时薪区间误拦
- 存量公益单（hourly 口径）读时按 `pricing_type` 分支，不批量迁移
- 一口价单的 `rate_fen` 置空 → 任何读 `rate_fen` 的展示/筛选点都要改判（需全仓 grep 遗漏点）

---

## 议题二：爽约处罚

### 现状（事实）
- **服务端零实现**：全仓无 `no_show/noshow`；仅前端常量 `NO_SHOW{scoreDeduct:20,maxTimes:3,suspendDays:7}`（零引用）
- `order-action` 不写任何信用分；`credit_score_log` 现仅 `init / evaluation / admin_adjust` 三种 type
- 现有 timer 全是「超时自动流转」（S1 15min、S0 30min、S3.5 24h、S2.5 改期超时），**都不是主观爽约**

### 核心难点：判定
平台**无法自动判定"人到没到"**，必须引入「申诉—裁定」链路。

### 流程设计（轻量版）
```
一方发起「对方爽约」申诉（限已支付/已确认订单 S2 及之后、且已过约定开始时间）
  → 进入 no_show_report（状态 S0 受理）
  → 被诉方 48h 内可举证答辩（S1 举证）
  → 平台管理员裁定（S2 裁定：成立 / 不成立）
     · 成立 → 执行处罚
     · 不成立 → 关闭，申诉方计一次"恶意申诉"（可选）
  → 双方收到通知
```
> 也可先做**极简版**：不做用户举证界面，仅「用户提交申诉 → 管理员后台裁定」，把成本压到最低。

### 处罚措施（全部复用现有能力，零新增基础设施）
| 处罚 | 复用 | 位置 |
|---|---|---|
| 信用分 −20（`type:'no_show'`） | 信用分体系 | `credit_score_log` |
| 累计 3 次 → 停用 7 天 | `penalty(level=suspend_7d)` / `user_freeze` | admin-action:2842-2878 / 776-792 |
| 天然联动 | 信用分 <600 自动禁接单/下单 | rules.md 红线（已存在） |
| 资金赔付 | ⚠ **MVP 为 mock 支付，暂不可做真实扣款/赔付** | 待真实支付接入 |

### 数据模型
```
no_show_report（新集合）
  order_id, reporter_openid, target_openid, role('user'|'partner')
  reason, evidence_files[]
  status: 'S0'受理 | 'S1'举证 | 'S2'已裁定
  verdict: 'upheld'成立 | 'rejected'不成立
  decided_by, decided_at, decided_reason
  created_at, updated_at, is_deleted
credit_score_log.type 新增 'no_show'
user_account.no_show_count 累计次数（或从 credit_score_log 聚合）
```

### 管理端
- `admin-action` 新增 `no_show_report_list`（列表）/ `no_show_decide`（裁定，接 penalty）

---

## 议题三：履约中禁止改期

### 现状（事实）
允许改期的状态是 **S2 与 S3**（order-action:875 `status !== 'S2' && status !== 'S3'` → 拒绝），而 **S3 就是"履约中"**。改期流程：S2/S3 → CAS 到 **S2_5**（写 `pending_modify`）→ 同意写 `start_time` + `modify_count+1` / 拒绝回原状态 / 超时（order-timer:286-332）自动拒。

### 改动清单
1. **order-action:875**：允许状态 `['S2','S3']` → `['S2']`
2. **前端** order-detail.js:771-905：改期入口按状态隐藏（仅 S2 显示）
3. **order-timer:236**：S2_5 超时回退分支 `pm.from_status === 'S3' ? 'S3' : 'S2'` → 收口为只回 S2
4. **存量兼容**：已处于 S2_5 且原状态为 S3 的在途申请 → 建议**允许其按原逻辑走完**（不追溯变更），避免卡死
5. S3.5（履约中断）一并禁止（已拍板）

### 顺带修复的两个既有问题（建议一起做）
- **改期不重置四确认**：改期同意后 `start_time` 变了，但 8 个确认位沿用旧值 → 建议改期生效时**重置四项确认**（与 S1 的 `update_item` 一致）
- **S2_5 未列入 rules.md 的 13 态状态机红线** → 补文档（代码已实现，红线表缺失）

---

## 实施顺序建议
1. **议题三**（改动最小、风险最低，可独立上线）
2. **议题一**（需先做全仓 `rate_fen` 读取点排查，避免遗漏）
3. **议题二**（需新建集合 + 管理端，工作量最大，可最后做）

## 待确认项
- 议题一：一口价区间（`fixed_price_min_fen/max_fen`）默认值取多少？公益一口价定多少？
- 议题一：爽伴未配置客单价区间时的兜底（建议"不限制"）是否同意？
- 议题二：是否接受**极简版**（无用户举证界面）先上线？
- 议题二：裁定"成立"后是否同时给受害方补偿（MVP 无法做真实赔付，可先只做"免违约金取消 + 信用加分"）？
- 议题三：存量 S2_5（原 S3）在途订单，是允许走完还是强制拒绝？
