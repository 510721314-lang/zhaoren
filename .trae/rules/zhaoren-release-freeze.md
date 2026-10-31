---
alwaysApply: true
---

# 提审冻结期规则（v1.6.x · 2026-10 起）

## 1. 真值优先级（冲突时按此裁决）
1. 云端回读：`tcb fn detail` / `tcb fn code download` / 控制台用量实测
2. 仓库台账：`docs/HANDOFF-20261031.md`（唯一现行）→ `docs/CHANGELOG.md` → `docs/tech-debt-inventory-20261015.md`
3. 助手记忆与历史对话

出现不一致时，先回读再回写台账；禁止只改记忆而不改台账。

## 2. 每轮开工顺序（只读，先于任何写操作）
1. 读现行 HANDOFF 的「下一步」与未闭合项编号
2. `npm run verify:offline` 取基线（失败即停，不得绕过）
3. 声明本轮改动上限：≤3 文件 / ≤30 行；超出先问

## 3. 冻结期禁止
- 禁止改 `app.json` / `project.config.json` / `project.private.config.json`（另见 miniprogram-config-guard.md）；新增页面只能追加
- 配额余量不足 1 万：禁止并行触发部署、触发器变更、备份重跑；并行只允许只读核查
- 任何 `_shared` 规范源字节变化，必须跑对应 `sync-*.ps1` 并复检 `SHARED SYNC ALL OK`
- 禁止以记忆或助理口径代替云端回读下结论
- 提审提交、加购、支付等人工动作，AI 不代点
- 2026-10-31 用户授权：本会话 commit/push 由 AI 自行执行，细则见 `docs/HANDOFF-20261031.md` §0A-1。

## 4. 知识库入口（按需检索，不整篇灌入）
- 交接与待办：`docs/HANDOFF-20261031.md`
- 变更与回归结论：`docs/CHANGELOG.md`
- 技术债：`docs/tech-debt-inventory-20261015.md`
- 部署记录：`docs/deploy-log.md` ／ 功能验收：`docs/FUNCTION-REGISTRY.md`
- 提审填报：`docs/runbooks/pre-release-filing-checklist.md`
- 运维 SOP：`docs/runbooks/`
- 场景技能：`.trae/skills/`
