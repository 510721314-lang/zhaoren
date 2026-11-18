---
alwaysApply: true
---

# project_rules-20261013 · 索引

路径与文件名不变，全仓 `§N` 交叉引用不断链。
- **§0–§9（原文常驻，逐字）**：`.trae/rules/project-rules-core.md`
- **§10–§43（全文归档，按 `## N.` 检索）**：`.trae/documents/project-rules-full-20261029.md`
- **§10–§43（摘要）**：`project-rules-core.md` 文末「§10–§43 实证型高危条款」
- **全局规则指针（原 rules.md）**：`.trae/rules.md`（业务红线已迁 core 附录A）
- **提审冻结期规则（按需检索，不常驻注入）**：`zhaoren-release-freeze.md`

## 常驻要点（2026-11-15 自 freeze 上提，原文见上方文件）
- 真值优先级：云端回读 > 仓库台账 > 助手记忆；不一致时先回读，再回写台账。
- 每轮开工：先读现行 HANDOFF 的「下一步」，再跑 `npm run verify:offline`；失败即停，不得绕过。
- `_shared` 规范源字节有变化，必须跑对应 `sync-*.ps1` 并复检 `SHARED SYNC ALL OK`。
- 写操作授权：commit/push 按需、单会话、不继承，每次均须用户单独书面批准；提审、加购、支付等人工动作 AI 不代点。
- 配额余量不足 1 万：禁止并行触发部署、触发器变更、备份重跑；并行只允许只读核查。

> 新增 §N：先写归档全文，再在 core 摘要区补一条并扩本行区间；门禁双重校验（区间覆盖 + 归档节存在）。
> 节标题不列表；需要时 Grep 归档 `^## N.`。
