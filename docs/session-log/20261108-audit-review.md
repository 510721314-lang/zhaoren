# 2026-11-08 全项目代码静态扫描报告 · 双专家评审会话

## 1. 目标

对 `docs/audit-20261108-code-scan.md`（全项目代码 Bug 静态扫描报告）执行双代理交叉评审，判定其能否作为修复立项依据，并订正报告中的事实/口径偏差。

## 2. 结论

- 报告整体**可用**，但需 5 处订正后作为修复基线；订正已完成。
- 定级：2/2 确认 4 项、主对话实测新增必修 1 项（kefu）、驳回代理 B 2 项（31 处偏低 / 云函数未覆盖）。
- 修复仍待用户选定范围（A 全部 6 批 / B 只修 P2 kefu / C 主链路 / E 暂不修），本轮**未改任何业务代码**。

## 3. 证据（命令与实测值）

| 项 | 实测 |
|---|---|
| 复跑跳转扫描（260 字符口径，临时脚本已删） | `TOTAL_CALLS=129`、`MISSING_FAIL=31`，与报告一致 |
| `kefu.js:96` | `wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages-v2/index/index' }) })`，index 为 tabBar 页 → `navigateTo` 必失败 |
| `bootstrap.js:259 / :334` | 均为 `wx.showModal({ ... fail: () => {} })` 的**弹窗**兜底，非跳转兜底 |
| `index.js:332` / `square.js:158` | `wx.navigateTo({ url })`，url = `publish?scene=` 动态拼接，无 `fail` |
| `publish.js:1079` | `redirectTo` 无 fail，但 1082–1087 有二级兜底；扫描因 260 字符窗口串读而漏检 |
| 4.1/4.2/4.3 计数 | 12 + 18 + 1 = 31，与总数对齐 |

## 4. 改动与提交

- 改 `docs/audit-20261108-code-scan.md`：§1 结论、§4.1 表格与计数、§4.2 计数、新增 §4.3、§5.1 移出 bootstrap、§5.2 补记、§6 OBS-2、§7 批次与边界、§9 补第 4 项、新增 §10 评审记录。
- 新增本文件。
- **代码修复（用户选 A 全部 6 批 + 续做剩余）合计 18 文件 36 处**：第一批 9 文件 20 处（blog ×4、blog-detail ×2、index ×2、square ×2、profile ×1、my-demands ×1、notices ×6 差异化文案、kefu ×1 `navigateTo`→`switchTab`、exam ×1）；第二批 9 文件 16 处（admin 8 文件 14 处——8 处 `redirectTo` 到 tabBar 页改 `reLaunch` + 6 处子页补 `fail`；blog-publish ×1、exam ×1）。**app.js 未动**（`reLaunch` 到 tabBar 合法）。
- 门禁：`SYNTAX ALL OK (283)` / `MINIPROGRAM SYNTAX ALL OK (103)` / `tests 866 pass 0 fail` / `A/B EQUIVALENT 456` / `SHARED SYNC ALL OK` / `SSOT 0` / `RULES-SIZE OK 16643B`。
- **未 commit**（T-0.8：commit/push 须单独批准）。

## 5. 未决项

1. 修复已按 A 全部 6 批执行完毕，**待真机验证**（§8-8 逐批点击被改入口）。
2. 代码 + docs 的 commit 待批准。
3. 3 笔历史提交未推（`7e18038` / `5d84bcb` / `9a16a65`），GitHub 443 被重置。
4. 云函数侧鉴权/超时/静默吞错专项未扫（登记报告 §9-4）。

## 6. 下次入口

修复已执行，下一步：真机逐批验证被改入口（正常跳转 + 失败 toast，重点 kefu 返回键）→ 通过后 commit（代码与 docs 分开）→ 更新 FUNCTION-REGISTRY 验收状态。
