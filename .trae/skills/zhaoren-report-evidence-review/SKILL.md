---
name: zhaoren-report-evidence-review
description: 对项目内评估报告/技术文档的事实性断言（数字/不足/未落地/规模/评级）做只读实证复核，证伪过时或无证据表述。Use when 用户要求对报告「做实证复核」「核对数字/断言」「剩余部分复核」，或质疑某结论无据时。Do not use for 写新报告、改业务代码、真机验证、云函数部署。
---

# 报告断言实证复核（zhaoren）

对评估报告 / 技术文档中的事实性断言做只读实证复核，找出**过时、无证据或自相矛盾**的表述。
核心纪律：**每个数字 / 判断必须取真值源实测，禁止凭印象；先出复核表，等用户批准再改。**

## 触发信号

- 用户说「对报告做实证复核」「核对剩余部分」「这个数字 / 结论对吗」
- 报告含「不足 / 未落地 / 未做 / 待补 / 规模 / 行数 / 评级」类断言
- 同一报告内可能存在口径矛盾（如分项之和 ≠ 合计、改了 A 处没改同义的 B 处）

## 流程

### 1. 完整读目标文档，列断言清单

- 完整 Read 目标文档全文（不要只读片段）
- 列出所有事实性断言，建表：位置 ｜ 主张 ｜ 真值源 ｜ 状态（已复核 / 待复核）
- 已复核过的标注，不重复劳动

### 2. 逐项只读实证（禁止凭记忆 / 印象）

每项断言取对应真值源实测（映射见下文）。**口径必须声明**：总行 vs 非空行、时点快照 vs 当前值。
找不到真值源的断言标注「待确认」，不得凭印象判属实或判错。

### 3. 输出复核表

| 位置 | 主张 | 实测值 | 口径 | 判定 | 需动作 |
|---|---|---|---|---|---|

判定规则：

- 实测与报告吻合 → **属实**，不改
- 报告数字与当前微差，但属报告生成时点后的增长 → **历史快照**，非错误，不回改（文档须声明数值取自生成时点）
- 报告断言被真值源证伪 → **过时 / 无证据**，列入修正
- 报告内部自相矛盾 → 必须 grep 全文找同义表述，**一并修正**，不得只改一处

### 4. 等批准再改 + 验证 + 提交

- 改前先给方案（文件:行号 + 改动 + 影响面 + 风险），等用户书面批准
- 改完跑 `node scripts/check-doc-links.js` 确认链接未断；纯文档修正无需重跑全链 verify
- commit 走标准流程：
  - `git add` **只点名目标文件**，禁 `git add -A` / `git add .`（防误纳禁提交文件）
  - 含中文 / 双引号的 message 用 `git commit -F <临时文件>`（UTF-8 无 BOM）
  - push 带代理 `http://127.0.0.1:7890`，事后同代理 `git ls-remote origin master` 核对远端 SHA == 本地 HEAD，输出 `§44_CHECK=PASS` 才声明成功（§44）

## 真值源映射（避免重复摸索）

| 断言类 | 真值源 | 取法 / 口径 |
|---|---|---|
| 测试用例总数 | `scripts/test-manifest.json` | 各数组 `.length` 求和（结构是数组不是对象，**禁**用 `.count`） |
| 测试文件数 | `scripts/test-manifest.json` | `Object.keys` 长度 |
| 集合数 | `scripts/check-collections-consistency.js` | 运行取输出（如 "38 集合 × N 处一致"） |
| 规则配额 inject / 余量 / max§ | `scripts/check-rules-size.js` | 运行取 stdout 解析 |
| 文档死链 | `scripts/check-doc-links.js` | 运行取 EXIT |
| app.json 页数 | `miniprogram/app.json` | 主包 pages 长度 + 各分包 pages 长度求和 |
| 项目规模文件数 / 行数 | node 递归 fs 统计 | 必须声明口径：前端合计含 `.json` 等配置文件（非二进制），行数默认非空行；排除 `node_modules` / `.tmp-tcb` / `miniprogram_npm` |
| 巨页行数 | 非空行口径 | 查 `plan-frontend-split-*.md` 口径出处 + tech-debt 台账 + `git log`（已拆分的文件行数会变，"已裁定不拆"可能已过时） |
| 技术债项数 / 明细 / 结案率 | `docs/tech-debt-inventory-*.md` | 台账头部关键计数表 + 未闭合表逐项核对 |
| A/B 等价用例数 / known-evolution | 台账头部 或 spawn `ab_equivalence` | 取 stdout 解析，禁凭声明行 |
| 源码是否有 TypeScript | Glob 源码目录 | 限定 `miniprogram` / `cloudfunctions` / `scripts`，排除 `node_modules` / `.tmp-tcb`（`.tmp-tcb` 是 gitignore 临时目录，依赖类型声明不算项目源码） |
| 体验版版本号 / HEAD | `docs/deploy-log.md` | 取最后一条体验版行（版本号历史可能重置不单调，文件尾 = 最新） |

## 纪律与教训（本项目实证沉淀）

- **真值优先级**（报告须附声明）：云端回读（tcb）> 仓库台账（docs/）> 报告描述。冲突时先回读再回写台账。
- **改一处必须 grep 全文找同义表述**：L49 修正"深度不足"后 L85 未同步 → 同一报告内矛盾。修正一处措辞时全文搜同义。
- **数字必须声明口径与时点**：L31 巨页 1386/1081/1078 是 2026-11-08 非空行快照，未标注会被误读为当前总行；L14 合计含 `.json` 但分项只列代码文件，不说明会困惑。
- **历史快照不回改**：报告生成时点（如 HEAD `4e3e9528`）的数字若与当前微差，属时点差异非错误，不回改；文档须有"数值取自生成时点实测"声明。
- **连续两处断言被证伪要停下来**：说明该报告 / 该类断言系统性失准，须全量清扫而非逐个挤牙膏。
- **禁提交文件**（永远不 commit）：`.trae/documents/select_confirmed_alert_plan.md`、`docs/老人居家SOP合订本20261122.md`、`docs/老人居家SOP简化文档.html`；`git add` 只能点名目标文件。
- **PowerShell 5 陷阱**：含中文 / 双引号的 commit message 必须 `git commit -F <临时文件>`（PS5 会把双引号拆成 pathspec），临时文件用 UTF-8 无 BOM 写入；git stderr 进度会被包装成 `NativeCommandError` 红字，是正常显示，真值以 range 输出 + ls-remote 为准。
- **Shell 递归超时**：查 `.ts` / 统计行数时禁用 PowerShell `Get-ChildItem -Recurse` 扫全仓（会遍历 `.tmp-tcb` / `node_modules` 海量文件超时），用 Glob 或 node 递归并排除目录。

## 不要用于

- 写新报告 / 新文档
- 改业务代码、云函数、配置（走对应技能）
- 真机验证、云函数部署、支付 / 提审等人工动作
