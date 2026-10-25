# 授权备忘（补充）：提审冻结期实施「法律合规交互优化 U1+U2+U3」

> 本文件是 [legal-compliance-1a-authorization-20261025.md](legal-compliance-1a-authorization-20261025.md) 的**续篇**，同依据 `.trae/rules/` R5。
> 关系：批 1a 建立 `legal_doc` 与发布/回滚；本次在其上加场景免责版本化与后台交互重构。

## 决策事实

| 项 | 内容 |
|---|---|
| 决策时间 | 2026-10-25 |
| 决策人 | 用户（项目所有者） |
| 需求规格 | [req-legal-ui-20261025.md](req-legal-ui-20261025.md)（R1/R2/R3，D1/D4/D5/D6 已拍板） |
| 授权范围 | **U1 前端 + U2 后端 + U3 场景版本历史**（全量） |
| 依据 | 用户在 D4 选择「全量含后端（需授权）」 |

## 授权动作清单

| # | 动作 | 碰冻结面 | 审核员可见 | 风险 |
|---|---|---|---|---|
| 1 | `action_legal_doc.js`：DOC_TYPES 增 `scene_disclaimer`；`publish/list/rollback` 支持 `scope` | 是（生产云函数） | 否（新分支/新增字段） | 低（既有 5 类文档路径不变） |
| 2 | 新增 `legal_doc_retire`（场景停用：新版本空内容 + 从 config map 移除） | 是 | 否 | 低 |
| 3 | `admin-web` Legal.vue：R1 下拉过滤、R2 只读+版本历史、R3 逐项重置/保存 | 否 | 否（审核员看不到后台） | 低 |
| 4 | 部署 `admin-action` 一次 + 托管重发 `dist` | 是（仅该函数） | 否 | 中（有回滚点） |

**不变更**：`miniprogram/` 全部代码、`user-login`、`order-action` 等其它云函数、5 类文档既有版本的语义。

## 双写与兼容（关键）

场景免责版本化后，`legal_doc` 为权威源，但**仍回写** `admin_config.legal_scene_disclaimers`，因为**3 个云函数在运行时读该字段**：
- [home-action/index.js:141-172](file:///c:/zhaoren/cloudfunctions/home-action/index.js#L141-L172)（C 端展示）
- [order-create/index.js:139](file:///c:/zhaoren/cloudfunctions/order-create/index.js#L139)
- [demand-publish/index.js:82](file:///c:/zhaoren/cloudfunctions/demand-publish/index.js#L82)

→ 上述三处**零改动**，C 端与审核员可见行为不变。

## 风险知悉

1. 生产云函数变更 → 部署前 `git bundle` 归档 + deploy-log 回滚点；部署后网关实测。
2. 索引：`legal_doc (doc_type, scope, version)` 暂不声明/不建（集合量级仅数十条），登记为后续 owed。
3. 「保存即发布」误操作风险 → 前端二次确认 + `platform_event`/`config_history` 留痕 + 可回滚。
