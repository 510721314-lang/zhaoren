# 技术评估报告 · 订单履约域重构与测试基建

> 评估对象：P0 巨型文件拆分（order-action / admin-action）+ 测试基建加固 + 订单异常覆盖
> 评估时点：2026-10-12　方法：代码/产物静态审查 + 哈希比对 + 测试证据核验
> 结论口径：以「可复现证据」为准，区分「真覆盖」与「mock 形式覆盖」

---

## 0. 总体评级

| 维度 | 评级 | 一句话 |
|---|---|---|
| 拆分工程质量 | **A−** | 结构清晰、零循环依赖、等价可证；扣分在 ctx 隐式契约无类型约束 |
| 测试基建质量 | **B+** | A/B 等价 + 入口契约设计合理、可复现；mock 保真度有明确边界 |
| 覆盖充分性 | **B+** | 22 迁移全绿，但部分为 mock 层覆盖，非真实 DB 端到端 |
| 生产代码风险 | **需关注** | 发现 1 项 P0（openid.js 分叉无漂移守护）+ 3 项 P1/P2 |

**总体**：本次重构**质量达标、可交付**；但评估中发现 3 处**与本次改动无关、却影响提审稳定性**的存量风险，建议纳入提审前整改。

---

## 1. 拆分工程质量

### 优点（有证据）
- **入口瘦身显著**：order-action 2002→338 行、admin-action 3529→544 行，action 抽到同级 `action_*.js`，按业务域聚合，可读性大幅提升。
- **零循环依赖**：handler 禁止反向 `require('./index')`，共享符号经 `ctx` 注入——由 `scripts/check-handlers.js` 实测「114 actions 0 抛错」佐证无漏注入。
- **行为等价可证**：A/B harness 双跑「拆分前 baseline vs 当前」，**201 cases 0 diff**（含 87 显式 + 114 自动），远比单一单测可信。
- **分发层统一**：`HANDLERS = Object.assign({}, require('./action_*'))` 单一分发表，路由与鉴权门集中。

### 风险
- **ctx 隐式契约无类型约束**：`ctx` 是个大对象字面量，handler 解构所需符号，缺一个就是运行时 `undefined`。当前靠守门脚本兜底，**无编译期/类型保障**。→ 建议：为 `ctx` 定义 JSDoc `@typedef` 并让 handler 标注 `@param {Ctx}`（低成本、IDE 可静态检查）。
- **handler 文件间共享私有 helper 的边界**：抽离后各 handler 仅依赖 ctx，但也意味着**跨 handler 复用逻辑**无处安放（易复制粘贴）。

---

## 2. 测试基建质量

### A/B 等价 harness（`_shared/ab_equivalence.js`）
- **设计合理**：同一 store 快照 + 两个独立 sdk 实例，normalize 掉时间戳/随机单号，assert 深等。
- **局限（须知晓）**：它证的是「**拆分前后一致**」，**不是「逻辑正确」**；且若某 action 在两侧都 short-circuit 在同一门，则深层逻辑未被触达（已用显式用例 + 深路径夹具缓解）。

### mock SDK（`_shared/_mock_sdk.js`）保真度边界
| 能力 | 现状 | 影响 |
|---|---|---|
| `where().get()` 操作符匹配 | ✅ 支持 neq/eq/in/nin/gt/gte/lt/lte/exists + `_.or/_.and` | 良 |
| `where().update()` 返回 updated | 默认恒 `1`（可 `updateCount` 覆盖） | **CAS 成功路径可测，失败路径需显式注入** |
| `db.runTransaction` | ✅ 已补（复用 collection 工厂） | 可跑事务型入口 |
| `aggregate()` | 按集合名返回固定 list，**同集合多次聚合返回同一值** | balance_info 的 settled/splitting/month 三查询**无法分别赋值**（已在测试中规避，非精确） |
| 真实并发 | ❌ 无 | 「双写竞争」只能测**落败分支**，非真实竞态 |

→ **结论**：mock 足以支撑「入口契约 + 分支覆盖」，但**不能替代真实云数据库/事务/并发**的端到端验证。报告已诚实标注。

### 覆盖的真实度分级
| 级别 | 说明 | 数量 |
|---|---|---|
| 真业务覆盖 | 直达 ok:true 或多表副作用（demand 释放、信用分、通知、审计） | ~20 E2E + 11 timer |
| 分支覆盖 | 各类拒绝码正反对照 | ~90 |
| mock 形式覆盖（弱） | 仅触达入口门，未及深层 | 少量 |

---

## 3. 生产代码风险盲点（本次评估的核心发现）

### 🔴 P0 · `openid.js` 多副本且**无漂移守护**
`openid.js` 是安全关键模块（fail-closed 环境门控：prod 强制忽略 `mock_openid` 防冒充）。实测**17 个函数各持一份，存在 3 种变体**：

| 变体 | SHA 前缀 | 副本数 | 说明 |
|---|---|---|---|
| 主流 | `936B5855187C` | 15 | order-action / payment-mock / evaluation-submit … |
| admin-action | `58861B644478` | 1 | **超集**：额外含 admin-web 网关密钥校验（防客户端直调冒充管理员） |
| init-db | `9CCC5D8767C9` | 1 | 独立变体，用途待确认 |

**风险**：`scripts/check-shared-sync.js` 的 `SYNC_MAP` 覆盖 7 个共享模块（take_rules / money_rules / test_data / partner_audit / no_show_rules / order_state / urge_rules），**唯独不含 `openid.js`** → **安全逻辑变更无一致性守护**，改一处漏同步其余将静默放过（安全回归）。

**建议**：把 `openid.js` 纳入 `SYNC_MAP`（以主流变体为规范源），admin-action/init-db 的差异部分抽为可注入参数或独立扩展点；或至少加一条「变体清单 + 差异说明」守护断言。

### 🟡 P1 · 信用分 delta 规则重复未入 `_shared`
星级→信用分映射在两处各写一份：
- `evaluation-submit/index.js:140`：`star >= 5 ? 2 : star===4?1:...`
- `order-timer/index.js:537`：`defaultStar >= 5 ? 2 : ...`

**风险**：规则漂移（用户评价 vs 系统默认评口径不一致）。**建议**：抽到 `_shared/credit_rules.js`（与 money_rules 同法）并纳入 SYNC_MAP + 单测。

### 🟡 P1 · 状态机迁移表仅「影子校验」不阻断
`_shared/order_state.js` 的 `TRANSITIONS`（22 条白名单）当前**只作 SSOT + 单测目标 + 影子告警**，`casTransition` 不因白名单外迁移而拒绝。**风险**：非法迁移目前**不会**被拦截（依赖各调用点自觉）。→ 建议按既定 Wave 计划逐步开启强制拦截。

### 🟢 P2 · order-timer 批量扫描的语义
`BATCH=50` + `Promise.allSettled`：部分失败被吞（仅 `out.skipped` 记录竞态），大量积压时单轮处理上限 50。**建议**：监控积压量，必要时提高批量或分页循环。

---

## 4. 建议（按优先级）

| 级别 | 事项 | 收益 |
|---|---|---|
| **P0** | `openid.js` 纳入 SYNC_MAP / 建立变体守护 | 消除安全模块静默漂移 |
| **P1** | 信用分规则抽 `_shared/credit_rules.js` + 单测 | 消除口径漂移 |
| **P1** | `ctx` 补 `@typedef` JSDoc | 静态可检，防漏注入 |
| **P2** | 状态机迁移表开强制拦截（按 Wave） | 非法迁移可拦 |
| **P2** | order-timer 积压监控 | 系统态兜底可靠 |
| **P2** | 提审前真实环境只读烟雾 | 补 mock 无法覆盖的 DB/事务 |

### 4.1 整改执行记录（2026-10-12）
| 级别 | 事项 | 状态 |
|---|---|---|
| **P0** | openid.js 纳入共享同步守护 | ✅ 已执行（规范源 `_shared/openid.js` + `sync-openid.ps1` + SYNC_MAP 15 目录；admin-action/init-db 显式排除为有意变体） |
| **P1** | 信用分规则抽 `_shared/credit_rules.js` | ⏸ 暂缓（未选） |
| **P1** | `ctx` 补 `@typedef` JSDoc | ✅ 已执行（order-action `HandlerCtx` / admin-action `AdminHandlerCtx`，注释级、零运行时） |
| **P2** | 状态机迁移表开强制拦截 | ✅ 已执行（`casTransition` 事件驱动拦截；20 个调用点补 event；退役态 S9 兼容放行；A/B 201 cases 0 diff 证明未误伤真实迁移） |
| **P2** | order-timer 积压监控 | ⏸ 待办 |
| **P2** | 提审前真实环境只读烟雾 | ⏸ 待办（需环境） |

> 整改后回归：单测 216/0、A/B 201 cases 0 diff、守门 114/0、shared-sync ALL OK。
> **注意**：P2 强制拦截为行为增强，`order-action`/`order-timer` 变更后**需重新部署**方在线上生效（本地已改，云端未部署）。

---

## 5. 是否可支撑提审？

**可以**，本次重构（拆分 + 覆盖）质量达标：结构清爽、行为等价有证、异常分支覆盖完整。**但**：§3 的 P0（openid.js 分叉）为**存量安全一致性风险**，建议提审前一并整改（成本低、收益高）；P1 项可评估后决定是否顺带。

> 注：本次评估**未改动任何生产代码**；发现项均为静态审查结论，P0 项已给出可落地方向。

---

_取证：`scripts/check-shared-sync.js`（SYNC_MAP）、`Get-FileHash` 副本比对、`cloudfunctions/admin-action/openid.js`、`evaluation-submit/index.js:140`、`order-timer/index.js:537`、`_shared/order_state.js`。_
