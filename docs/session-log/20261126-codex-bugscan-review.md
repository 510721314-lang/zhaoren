# CODEX bug-scan-report 双代理实证审核

> 评审对象：[docs/bug-scan-report-20261126.md](../bug-scan-report-20261126.md)（CODEX 全项目扫描报告，声明扫描时点 HEAD `0c0e7b18`）
> 评审方式：zhaoren-tech-review 双代理交叉（代理 A 事实核验 / 代理 B 误报与合规核查）+ 主对话实测裁决
> 评审日期：2026-11-26
> 纪律：只读不改码；每个问题 2/2 确认才立项，1/1 可低成本验证由主对话裁决。

## 一、推断意图
CODEX 对 `C:\zhaoren` 做离线门禁+单测+静态扫描，输出 BUG 清单与加固方案，供上线前参考。本审核验证报告每条声明的真伪，区分"已证实缺陷 / 误报 / 未验证建议"。

## 二、审核结论表

| # | 报告声明 | 报告值 | 实测值 | 判定 | 证据 | 置信度 |
|---|---|---|---|---|---|---|
| 1 | BUG-01：`check-doc-links.test.js:43` L1 失败 → verify 红 | 1 FAIL / exit 1 | 7/7 pass / EXIT=0 | **误报** | `node --test scripts/check-doc-links.test.js` → tests 7 pass 7 fail 0；`npm run verify:offline` → EXIT=0 | 高 |
| 2 | 测试通过数 | 1262 PASS / 1 FAIL | 1263 PASS / 0 FAIL | 不符 | `npm test` TAP：tests 1263 / pass 1263 / fail 0 | 高 |
| 3 | A/B 等价是否执行 | 未运行（因 test 失败） | 已执行 473 cases | 不符 | verify 末尾 `A/B EQUIVALENT: 473 cases (237 explicit + 236 auto; 110 known-evolution)` | 高 |
| 4 | verify:offline 退出码 | 1 | 0 | 不符 | `$LASTEXITCODE=0` | 高 |
| 5 | 密钥扫描文本文件数 | 2043 | 2047 | 不符（计数差4；"无凭据泄漏"结论属实） | `node scripts/check-secrets.js` → 扫描 2047 文本文件，未发现凭据泄漏；差 4 为新增未跟踪文档 | 高 |
| 6 | 云函数 JS 语法 | 315 个通过 | 315 个 | 属实 | `check-syntax.js` → SYNTAX ALL OK (315 files) | 高 |
| 7 | 小程序 JS 文件 | 103 个 | 103 个 | 属实 | `check-miniprogram-syntax.js` → 103 files | 高 |
| 8 | 静默 catch 基线 | 200 处 / 80 文件 | 200 / 80 | 属实 | `check-silent-catch.js` → 200 处 / 80 文件 | 高 |
| 9 | live 文档 / 链接 | 33 / 98 | 33 / 98 | 属实 | `check-doc-links.js` → 33 个 live 文档 / 98 条链接 | 高 |
| 10 | action handler 本地运行 | 161 个无异常 | 161 个 | 属实 | `check-handlers.js` → 161 actions | 高 |
| 11 | 集合定义一致性 | 38 × 5 | 38 × 5 | 属实 | `check-collections-consistency.js` → 38 集合 × 5 处 | 高 |
| 12 | OBS-01：legal_doc / service_sop 索引警告 | 2 条待云端确认 | 本地 2 条 WARN 真实；**2026-11-26 云端 listIndexes 回读确认两条索引生产均存在且与台账对齐** | 属实 + 已闭环 | `check-index-ledger.js` → 2 条 WARN；云端回读：legal_doc 含 uniq_doc_type_scope_version{doc_type,scope,version} UNIQUE、service_sop 含 idx_scene_sort{scene_code,sort}；警告系本地缓存 `.tmp-tcb/indexes-actual.json` 过时 | 高 |
| 13 | OBS-02：音频降级日志 | 非缺陷 | 行为属实，非缺陷 | 属实 + 合规 | `alert-feedback.js` L41-53：无 InnerAudioContext 时降级震动，预期行为 | 高 |
| 14 | L91：product-overview 页面数 39 与 app.json 一致 | 一致 | 主包20+分包19=39 | 属实 | app.json 实测 39 页、5 tab、__usePrivacyCheck__、getLocation/chooseLocation 声明一致 | 高 |
| 15 | 第四部分加固方案是否夹带已证实缺陷 | — | 无夹带；仅"先修复 BUG-01"依赖误报 | 合规（1 处须修正） | 通读 §四：均为上线前建议，未把建议写成既成缺陷；无过时口径（对照 tech-debt/CHANGELOG） | 中高 |

## 三、验证者修正（BUG-01 误报根因分析）

- **排除"报告生成后代码被修复"**：`git log` 显示 `check-doc-links.js` / `check-doc-links.test.js` 自引入 commit `dec8d5ce` 后字节未变；`git diff` 两文件为空；`git stash list` 空。即报告扫描时点与当前为同一份代码。
- **排除"环境差异"**：当前标准 Windows 环境实测 L1 通过，被测逻辑 [check-doc-links.js L46-51](../scripts/check-doc-links.js#L46-L51)（`decodeURIComponent` → 剥锚点 → 盘符规整 → `fs.statSync`）与 L1 负例断言匹配，负例确实触发 exit 1，无漏检。
- **最可能原因（无实证，仅推断）**：CODEX 扫描时点工作区存在未提交的临时改动后被回退，或误读/误标测试输出。该时点状态不可溯。
- **修正口径**：报告"BUG-01 致 verify 红 / A/B 未执行 / 1262 PASS 1 FAIL"在当前代码状态下不成立，应作废并以当前实测（全绿、A/B 473 通过）为准。

## 四、定级
- **BUG-01**：误报 → 不修代码。
- **报告自身 4 处计数/结论错误**（测试数、A/B 状态、退出码、密钥文件数）：属报告过期结论，非代码缺陷 → 可修正报告文本（纯 docs）。
- **OBS-01**：2026-11-26 云端 `listIndexes` 回读确认两条索引生产均存在且与台账对齐（`legal_doc` 含 UNIQUE）→ 警告系本地缓存过时，非生产缺失，无需补建（已闭环）。
- **OBS-02**：非缺陷 → 不修。
- **第四部分加固方案**：为合理的上线前建议，未验证项报告已自承 → 保留，仅移除依赖误报 BUG-01 的条目。

## 五、后续选项（用户选定，不擅自执行）
- **A**：修正原 bug-scan-report 的过期结论（BUG-01 改标误报、测试数 1263 全过、A/B 已执行、EXIT=0、密钥数 2043→2047、删除"先修复 BUG-01"）——纯 docs，1 文件。
- **B**：云端回读 OBS-01 两条索引（`tcb` listIndexes，联网+配额），确认生产是否真缺。
- **C**：A + B 都做。
- **D**：仅保留本评审报告，不改原报告、不做云端回读。
- **E**：什么都不做。
