# 授权备忘：提审冻结期实施「法律合规批 1a」

> 依据 `.trae/rules/` R5「业务代码改动需新立项 + 用户批准 + 递增版本号」
> 立此备忘，供后续会话与审计回溯，防误判为违反冻结纪律。

## 决策事实

| 项 | 内容 |
|---|---|
| 决策时间 | 2026-10-25 |
| 决策人 | 用户（项目所有者） |
| 授权范围 | **仅批 1a**（服务端 additive + admin-web UI + 集合迁移） |
| 明确排除 | **批 1b**：`user-login` 改造、C 端协议页动态化、通用免责接通 —— 留待提审通过后 |
| 依据文档 | [legal-compliance-redesign-20261025.md](legal-compliance-redesign-20261025.md) §3、§5 |

## 关键前提（风险评估依据）

**提审尚未提交**：[HANDOFF-20261024-final.md](HANDOFF-20261024-final.md#L175-L192) 记录 v1.6.37 已上传体验版，但 F1（隐私指引）/F2（位置权限）/F4（合法域名）未完成，仍处「等待完成后提交」状态。因此当前为**预备冻结**，审核员尚未接触本小程序。

## 授权动作清单（逐项）

| # | 动作 | 是否碰冻结面 | 审核员可见 | 风险 |
|---|---|---|---|---|
| 1 | 新建集合 `legal_doc` | 否（数据层） | 否 | 低（纯增量，幂等创建） |
| 2 | 存量 `admin_config.legal_*` 6 字段迁移为 v1 记录 | 否（数据层） | 否 | 低（只读原字段后新增记录，不改原值） |
| 3 | `admin-action` 新增 `legal_doc_list / legal_doc_publish / legal_doc_rollback` | 是（生产云函数） | 否（新分支，无现有调用方） | 低（纯新增，不改既有 action 行为） |
| 4 | `config_public` 增补 `legal_public.privacy_policy / disclaimer_text / version` | 是（生产云函数） | 否（仅增字段，不改既有字段） | 低（additive，旧客户端忽略新字段） |
| 5 | `admin-web` Legal.vue 改造为文档卡片 + 版本历史 | 否（admin-web 不在冻结面） | 否（审核员看不到后台） | 低 |
| 6 | 部署 `admin-action`（仅此一个函数） | 是 | 否 | 中（部署本身有回滚成本，按 SOP 归档） |

**不变更**：`miniprogram/` 全部代码、`user-login`、`order-action` 等其它云函数、`admin_config` 现有字段值。

## 风险知悉与保险措施

用户已知悉以下风险并接受：

1. **生产云函数变更后，v1.6.37 体验版运行的后端与上传时不完全一致**。缓解：批 1a 全部为 additive，既有代码路径行为逐字不变；部署后跑冒烟（config_get / config_public / 登录）。
2. **部署需回滚能力**。执行前：`git bundle` 归档 + deploy-log 记录回滚点；执行后：download 核验标记串。
3. **不递增小程序版本号**：因 `miniprogram/` 零改动，v1.6.37 仍为提审候选版本；若后续实施批 1b 再递增至 v1.6.38。

## 后继动作（解冻后）

批 1b：`user-login` 版本下发 + 重签机制、C 端 agreement/privacy 动态化、通用免责接通 —— 需提审通过（或用户另行书面授权）后实施，届时递增版本号。
