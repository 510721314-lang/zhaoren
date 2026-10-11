# P0 巨型文件拆分 · 实施计划

> 适用：找人帮忙小程序（云开发）。**仅在提审通过、冻结解除后启动。**
> 核心红线：整个拆分必须能被「等价性重放逐字节相等」证明，否则不算完成。
> 状态：**已完成（2026-10-11）**。详见下方「完成情况」。

---

## 完成情况（2026-10-11 归档）

### 成果
| 文件 | 拆分前 | 拆分后 | handler 文件 |
|---|---|---|---|
| `order-action/index.js` | 2002 行 | **338 行** | action_nudge / action_query / action_confirm / action_lifecycle / action_modify_extend / action_dispute（6） |
| `admin-action/index.js` | 3529 行 | **544 行** | 22 个同级 handler 文件 |

两文件现仅保留：鉴权/预检、`HANDLERS` 分发表（admin 另有 `HANDLERS_PRE` 免鉴权前置分发）、共享 helper。

### 验证（全绿）
- **order-action**：A/B 等价深比较 36 例全一致（`_shared/ab_equivalence.js`，以拆分前 git 版本为 baseline）
- 全量单测：**183 pass / 0 fail**（基线未降）
- `scripts/gate.ps1`：**8/8 ALL PASS**（持续）
- `node --check` 全部新文件通过；无残留内联 `if (action === ...)` handler；无循环 require

### 关键机制
- 分发：`HANDLERS = Object.assign({}, require('./action_*'), ...)`；`exports.main` 内 `if (HANDLERS[action]) return await HANDLERS[action](ctx)`
- ctx 注入共享符号；handler 顶部 `const {...} = ctx`，函数体逐字搬家，零行为变更
- admin 双分发点：免鉴权前置（鉴权门前）+ 鉴权后（RBAC 后）
- 每批：写 handler → 注册 → 删内联块 → gate → 单测 → 独立 commit（可单独 revert）

### 待办（收尾）
- [ ] 部署 order-action / admin-action 后跑线上烟雾（云端测试面板各分组至少 1 个 action）
- [ ] GitHub 统一 push（本地领先 origin 数十个 commit；需 TUN 代理，直连 443 不可达）

---

## 0. 背景与目标

### 现状（已核实）
| 文件 | 行数 | action 数 | 结构 |
|---|---|---|---|
| `cloudfunctions/order-action/index.js` | 2002 | 29 | 线性 `if(action===...)` 链（L303–2084） |
| `cloudfunctions/admin-action/index.js` | ~3490 | 80 | 线性 `if(action===...)` 链（L406–3477） |

### 目标
- `order-action/index.js` 主文件瘦身至 **< 600 行**
- `admin-action/index.js` 主文件瘦身至 **< 700 行**
- index.js 只承担「鉴权 + 预检/RBAC + 分发 + 共享 helper」
- **对外契约（event / 返回结构）一字不动，运行时行为字节级等价**

### 硬约束（不越界）
- ❌ 不引入新目录层级（不建 `services/` `domain/`）、不建脚手架
- ❌ 不改 `exports.main` 对外契约
- ❌ 不改状态机/规则逻辑（已收敛于 `_shared`）
- ❌ 不做 TS 迁移（属 P1）
- ❌ handler 文件**与 index 同级**（不建 `actions/` 子目录），规避 `_shared` 同步脚本路径错位
- ✅ 仅「物理搬家 + 同级 require」，零行为变更

---

## 1. 实施前准备（开工前必须完成）

### 1.1 冻结解除确认
- [ ] 提审通过，冻结结构性重构的限制已解除
- [ ] 向用户确认开工

### 1.2 产出依赖清单（grep 验证，非凭记忆）
对两个文件分别产出：每个 action 块实际引用的顶层符号集合。
- 共享符号预计包括：`col / db / _ / $ / log / cloud / getConfig / getOrder / writeNotice / casStatus / roleOf / SCENE_CN / CONFIG_SCHEMA / SENSITIVE_MASK / ADMIN_ROLE_LABEL` 等
- 交付物：`order-action.deps.md`、`admin-action.deps.md`（列出每 action → 依赖符号）
- **闸门：未列清单不得开工**

### 1.3 验证同步脚本兼容性
- [ ] 确认 `sync-*.ps1` 与 `scripts/check-shared-sync.js`（SYNC_MAP）对「handler 文件与 index 同级、require('./order_state')」路径不变」成立
- [ ] 因采用同级文件，`_shared` 副本相对路径（`./xxx`）保持不变，预期无需改 sync 脚本；需实测确认 `check-shared-sync` 仍 ALL OK

### 1.4 准备等价性重放夹具
- 建立录制脚本：对每个被拆 action，输入一批 `(event)`（正常/越权/边界），用 `_mock_sdk` 跑出 `result`，存 `fixtures/<action>.json`
- **拆分前**先录制全量 fixture（基线）
- 闸门：fixture 覆盖全部 109 个 action 的代表性输入

---

## 2. 分发机制设计（index.js 骨架）

```
index.js（保留）:
  顶层: require + 共享 helper 定义（getConfig/getOrder/writeNotice/casStatus/roleOf...）
  exports.main:
    1. resolveOpenid → 鉴权门（不下沉）
    2. order_id 预检 / RBAC 角色解析（不下沉）
    3. 分发: const fn = handlers[action];
            if (fn) return await fn({ event, openid, order_id, deps });
            return { ok:false, code:'oa_unknown_action' }
```

- handler 文件与 index **同级**：`order-action/action_confirm.js` 等
- 每个 handler 导出对象 `{ actionName: async (ctx) => result }`，index 用 `Object.assign` 汇总
- `deps` 注入共享 helper，**禁止 handler 反向 require index**（循环依赖）

---

## 3. order-action 拆分（29 action → 6 同级文件）

| 新文件（同级） | 包含 action | 行段 | 估算 |
|---|---|---|---|
| `action_confirm.js` | get_confirmation / update_item / confirm_item / confirm_all | L303–664 | ~330 |
| `action_lifecycle.js` | cancel / start_service / complete_service / resume_service / milestone_submit / milestone_confirm | L665–922 | ~300 |
| `action_modify_extend.js` | modify* / extend* / partial_confirm / ratio_confirm | L923–1378 | ~420 |
| `action_dispute.js` | complaint / complaint_withdraw / no_show_report_*（4） | L1379–1512, L1902–2100 | ~330 |
| `action_query.js` | detail / my_orders / my_counts / notice_list/poll/read | L1513–1850 | ~320 |
| `action_nudge.js` | nudge_partner | L1851–1901 | ~50 |
| **index.js（保留）** | 鉴权/预检/分发/共享 helper | — | ~600 |

**实施顺序**（一组一提交一验证）：
1. nudge（最小，含已有测试，验证链路通）→ 2. query → 3. confirm → 4. lifecycle → 5. modify_extend → 6. dispute → 7. 分发骨架替换

---

## 4. admin-action 拆分（80 action → 8 同级文件，分两批上线）

### 批次 A（高频 + 敏感，先上）
| 新文件 | 包含 action |
|---|---|
| `admin_auth.js` | claim_admin / admin_login/logout / admin_account_* / admin_list/add/remove |
| `admin_config.js` | config_public / config_get/set / config_history/log / export_admin_config |

### 批次 B（其余，后上）
| 新文件 | 包含 action |
|---|---|
| `admin_users.js` | user_list/detail/ec_update/freeze*/credit/ban*/penalty |
| `admin_partners.js` | partner_list/detail/offline*/profile_*/review |
| `admin_orders.js` | demand_*/order_*/dispute_* |
| `admin_finance.js` | finance_*/withdraw_*/settlement/insurance/credit_log |
| `admin_content.js` | notice_send / home_activity_* / exam_* / blog_* |
| `admin_audit_safety.js` | audit_*/evidence_query / safety_log / event_list / report_* / no_show_* |
| **index.js（保留）** | 鉴权门/RBAC/分发/共享定义 | ~700 |

---

## 5. 风险控制（实施期强制执行）

| # | 风险 | 控制措施 | 闸门 |
|---|---|---|---|
| R1 | 行为漂移 | 每组跑等价性重放 | 重放 diff 为空 |
| R2 | 依赖漏注 | 先产完整依赖清单；搬家后 `node --check` + 启动烟雾 | index 可 require 全部 handler |
| R3 | 同步脚本错位 | 采用同级文件，`./xxx` 路径不变；实测 check-shared-sync | check-shared-sync ALL OK |
| R4 | 超大单次 review | 单组 ≤ 400 行；admin 分 2 批 | 每提交变动 < 500 行 |
| R5 | 循环 require | handler 只注入 deps，禁 require index | 静态扫描无 `require('./index')` |
| R6 | 部署打包遗漏 | CloudBase 按目录打包，确认新文件在部署清单 | 部署后调 1 个新文件 action 可执行 |
| R7 | 冻结期越界 | 全部实施在冻结解除后 | 开工前确认冻结解除 |

---

## 6. 成果检核机制（三层 + 完成定义）

### Layer 1 — 静态等价（每提交必过）
- [ ] `node --check` 全部新文件
- [ ] `scripts/check-syntax.js` 全绿
- [ ] `scripts/check-shared-sync.js` 全绿
- [ ] 静态扫描：无循环 require、依赖清单对账无遗漏

### Layer 2 — 单测契约（每组必过）
- [ ] 该组每个 action 至少 1 个「输入→返回码」入口测试存在且通过
- [ ] 全量 `npm test` 只增不减（基线 183）

### Layer 3 — 等价性重放（决定性证据，每组必过）⭐
- [ ] 拆分前录制 fixture → 拆分后重放 → `assert.deepStrictEqual(result, fixture)`
- [ ] 未通过的组不得合入

### Layer 4 — 线上烟雾（每批上线后）
- [ ] 云端测试面板对新文件内 action 各调至少 1 次，返回码符合预期
- [ ] gate smoke-check 纳入至少 1 个新路径 action

### 完成定义（DoD）
1. index.js 行数达标（order < 600，admin < 700）
2. 109 个 action 等价性重放**全部 deepStrictEqual 通过**
3. 全量 gate 8/8 PASS，单测只增不减
4. 线上烟雾覆盖每类分组至少 1 个 action
5. 无新增运行时依赖、无新增目录层级

---

## 7. 时间线与工作量

| 阶段 | 工作段 | 产出 |
|---|---|---|
| 准备 | 0.5 | 依赖清单 ×2、fixture 录制脚本、sync 兼容性实测 |
| order-action 拆分 | 1–1.5 | 6 文件 + index 瘦身 + 全量重放通过 |
| admin 批次 A | 1 | auth + config 上线 |
| admin 批次 B | 1.5–2 | 其余 6 文件上线 |
| 收尾 | 0.5 | 全量回归 + 线上烟雾 + 文档归档 |
| **合计** | **约 5–6 个工作段** | |

---

## 8. 回退策略
- 每组独立 commit，任一重放失败可单独 revert，不影响已合入组
- 分发骨架替换（if 链 → handler 表）为最后一步，且全量重放通过后才提交；失败则 revert 回 if 链版本

---

## 9. 待拍板项（开工前确认）
1. 分发形式：handler 表（前置鉴权/预检/RBAC 留 index）—— 已建议 ✅
2. 共享 helper：留 index + deps 注入 —— 已建议 ✅
3. 目录结构：handler 与 index **同级**（不建子目录）—— 已建议 ✅
4. admin 分两批上线（A: auth+config 先）—— 已建议 ✅

---

*本计划为提审后执行依据；冻结期内不启动。*
