---
name: zhaoren-experience-sedimentation
description: 把一次排查/修复/机制设计得来的可复用结论固化进项目治理制品（规则/CHANGELOG/台账/技术债/交接文档/项目记忆）。Use when 事故根因已定性、机制或口径已定型、会话收尾需要沉淀经验，或用户说「沉淀 / 入规则 / 记下来 / 收尾」。Do not use for 一次性调试、纯功能开发，或尚未验证的猜测。
---

# Zhaoren 经验沉淀（Experience Sedimentation）

本 Skill 是 `.trae/rules.md` 第九章（收尾沉淀）的可执行落地，把「沉淀经验」这一高频动作标准化，避免经验只留在当次会话里、随上下文蒸发。

## 触发时机

1. **事故根因定性后**：排查闭合、结论可复用
2. **机制 / 约定 / 口径定型后**：如新增规则章节、确定双挂载口径、确定库过滤口径
3. **会话收尾**：`rules` §9 要求收尾沉淀（CHANGELOG + 台账同口径）
4. **用户显式要求**：用户说「沉淀 / 入规则 / 记下来 / 收尾」

## 元工作流（四步，顺序不可颠倒）

### 第一步 识别（可复用性判别）

- 这条结论**下次还会用到**吗？一次性现象不沉淀。
- 是否**已有同类条文**？先搜 `rules` / CHANGELOG / tech-debt / handoff；命中则**修订旧条**，不新增重复条（防条文打架）。
- 区分 **通用规律** 与 **本会话实例**：技能/规则只写前者；实例写进 CHANGELOG 或技术债。

### 第二步 验证（实证优先）

- 结论必须有**可复现证据**：命令 + 输出 + 退出码，或 diff / 计数核对。
- 遵循**三重假阳性警戒**：绿 / 部署成功 / SHA 一致 均不等于可用，需端到端实证。
- 时段敏感、并发、幂等类结论必须给出**稳定复现法**（如改 TZ 把 now 搬进危险时段、分发表显式排位），不得用「一次观测」当证据。

### 第三步 落位（制品决策表）

| 发现类型 | 落点 | 理由 |
|---|---|---|
| 通用工程规律 / 跨项目红线 | `.trae/rules/project_rules-*.md` 新增 §N（H/I/J 编号顺延） | 常驻、alwaysApply |
| 业务红线 | `.trae/rules.md` 对应章 | 战略级 |
| 版本 / 变更事实 | `docs/CHANGELOG.md`（日期｜变更｜影响｜回归） | 逐版留痕 |
| 功能状态 | `docs/FUNCTION-REGISTRY.md`（#N 行） | 提审就绪度 |
| 未偿还的技术债 | `docs/tech-debt-inventory-*.md`（B- / P- 项） | 防遗忘 |
| 跨会话交接 | `docs/HANDOFF-*.md`（§6 经验 E-6.x） | 会话延续 |
| 项目级约定 / 教训 | 项目 `project_memory.md` | 本仓库长期生效 |
| 用户级偏好 / 画像 | `user_profile.md` | 跨项目 |

- **一次发现通常落 2~3 处**（如 规则 §N + CHANGELOG + 记忆），但**同一事实只描述一次**，其余用引用。
- 新校验脚本 / 门禁必须**双挂载**（`verify:offline` + `predeploy`），仅挂一处视为无效。

### 第四步 登记与提交

- **口径一致性**：台账与 CHANGELOG 对同一事件措辞必须一致；**禁过度声称**（「已闭环」「全部一致」「缺口全消」须有对应实证，否则改限定表述）。
- **不伪造台账**：未登记的版本号 / 条目，不得事后补写成「当时已做」。
- **提交纪律**：单独 commit（不夹带无关改动）；`git status --short` 取证；**提交不代 push**，push 需用户明确指示。
- **编码纪律**（§25）：含中文的 `.ps1` 必须带 UTF-8 BOM，改动后复检前三字节 `EF BB BF` 并用 `Parser::ParseFile` 复验；`.md` 用 UTF-8 无 BOM。

## 取证模板（收尾自检）

```text
git status --short          # 仅预期文件被改动（其余 ?? 为既有未跟踪文件，勿扫）
git diff --stat             # 改动范围与预期一致
# 计数核对：技能数 / 台账行数 / 链接数 / 文件数 +1 或 ±n 是否等于预期
```

## 禁止事项

- 把一次性发现硬塞进通用规则（污染规则库）
- 无实证即写「已修复 / 已闭环」
- 修改受保护文件（`app.json` / `project.config.json` / `project.private.config.json` / `sitemap.json`；禁建 `ext.json`）
- 不同口径描述同一事实（台账与 CHANGELOG 打架）
- commit 时夹带 `zz-*` / temp 探针或未跟踪的无关文件

## 与现有 Skill 的协作

| Skill | 关系 |
|---|---|
| `zhaoren-audit` | 同构：audit 落地 rules 第九章「提审」部分；本 Skill 落地「收尾沉淀」部分 |
| `zhaoren-tech-review` | 上游：复核 / 评审产出的结论 → 由本 Skill 落位 |
| `zhaoren-handoff-prompt` | 下游：本 Skill 沉淀进 handoff §6 的经验 → 由 handoff-prompt 生成衔接提示词 |
