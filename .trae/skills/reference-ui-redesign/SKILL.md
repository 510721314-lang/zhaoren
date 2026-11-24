---
name: reference-ui-redesign
description: 按用户上传的参考图重设计找人帮忙小程序页面——方案B保留浅色token对齐参考图布局与视觉元素，不动@VERIFIED逻辑，最小改动，验证后闭环commit/push/上传体验版。Use when 用户上传参考图或设计稿要求重新设计、美化或对齐某个小程序页面。Do not use for 云函数逻辑改动、接口字段变更或用户明确要求整页切深色。
---

# 参考图 UI 重设计 · 方案 B 模式

本仓库小程序页面（首页/广场/服务/消息/我的 等 v2 页）统一走 token 体系（`miniprogram/styles/tokens.wxss`，`.v2` 作用域，深浅双模式），主色 `#07C160`。当用户上传参考图要求按图重设计某页时，走本流程。

## 0. 先澄清方向（不可跳过）

用户文字可能口误（如说「首页-我的」但图是「消息」页）。先核对参考图顶部标题 / tabBar 选中项，定位到 `app.json` 里实际页面对应的文件，明确告知用户「图是 X 页，是否改 X 页」，等确认再继续。

## 1. 方案决策（默认 B）

| 方案 | 做法 | 适用 |
|---|---|---|
| **B（默认）** | 保留浅色 token，对齐参考图的**布局结构与视觉元素**（卡片化、圆底图标、状态胶囊、信息小卡、section header 等），不整页切深色 | 用户未指定风格；与已重设计的首页/我的保持统一 |
| A | 整页复刻参考图深色背景 | 用户明确要求整页深色 |

选 B 的理由：避免与全局浅色 token 体系割裂；暗色模式靠 token 自动适配；不波及其他 v2 页。

## 2. 执行纪律（铁律）

- **先说后做**：动手前只出方案（根因/差距 → 改动清单 → 影响面 → 风险 → 待确认点），等用户书面批准才改文件。
- **不碰 @VERIFIED**：带 `// @VERIFIED` 的 js 函数/文件禁止改内部逻辑、字段名、数据绑定、事件处理。若需新增能力，**仅在末尾新增独立方法**（如 `onAllOrders`），不修改已验证逻辑。改前说明「为什么必须改」。
- **不改组件源码**：`status-tag` / `ui-card` / `ui-cell` / `nav-bar` 等公共组件被多页引用，改源码会波及其他页面。优先用页面级 wxss 覆盖或 ext-class；组件默认样式已与全局卡片统一时直接复用。
- **不动云函数**：除非用户点名，否则不碰 `cloudfunctions/`。后端字段（如 `order_summary.l1` 是拼接字段）若需拆分才能对齐参考图，**保持现状不拆**，在方案里说明差距，等用户决定是否立项动云函数。
- **纯展示计算用 WXS**：需要在 wxml 内做的计算（count 汇总、场景→emoji 映射等）用 `<wxs module>` 实现，**零 js 逻辑改动**。模板不调用任意 js 函数。
- **样式走 token**：新增样式用 `var(--bg-card)` / `--text-1` / `--brand-primary` / `--shadow-card` 等，暗色自动适配。参考图指定的设计色（如棕色留存条）可硬编码，但在台账里标注「真机需验暗色对比度」。
- **最小改动**：单次默认 ≤3 文件 / ≤30 行；超出先停下来问。禁止整文件重写、禁止顺手优化无关代码。
- **不引入新组件库**：主色沿用 `#07C160`。

## 3. 标准步骤

1. **定位**：从参考图判断页面 → `app.json` 查 tabBar/pages 注册 → 确认目标文件（`pages-v2/<page>/`）。
2. **读现状**：Read 目标页 `.wxml` / `.wxss` / `.js`（重点：数据字段、事件绑定、`@VERIFIED` 标记、现有 token 用法）；必要时查后端字段结构（grep 云函数）确认哪些信息已有、哪些需动云函数。
3. **列差距**：参考图元素 vs 现有，逐项标「已有/需改/需新增/需动云函数」。
4. **出方案**：含改动清单（文件 + 改哪一处一句话）、影响面（对照 FUNCTION-REGISTRY）、风险等级、待确认点（跳转目标、是否加兜底、是否拆字段等）。**等批准**。
5. **改代码**：优先改 `.wxml` / `.wxss`；`.js` 仅新增方法不改已验证逻辑。每处 Edit 后确认锚点唯一。
6. **验证（代码级自证）**：
   - `node scripts/check-miniprogram-syntax.js` → 必须 ALL OK
   - `GetDiagnostics` → 必须 0
   - 包体：无新增图片则主包无影响；有新增图片需算体积（主包 < 2MB）
7. **沉淀台账**：
   - `docs/FUNCTION-REGISTRY.md` 新增条目（状态「待验证」+ 验收步骤 ①-N + 代码级自证结论）
   - `docs/CHANGELOG.md` 追加当日行
8. **等用户批准提交上传**，再执行：
   - commit 代码 → commit docs（分开，不混合）
   - `git push origin master` → `git ls-remote origin master` 直连核对 SHA == 本地 HEAD，必须 MATCH_OK 才能声明已推送（§44）
   - CLI 上传体验版（版本号递增）：`cli.bat upload --project "C:\zhaoren" -v x.y.z -d "描述"`。已知 IDE 可能首次抖动（code 10 / 端口超时），重试一次即成功，非代码问题
   - `docs/deploy-log.md` 追加行（from/to/回退基线/包体/门禁）→ commit → push → ls-remote 实证
9. **真机验收**：列出需用户手动验证的清单（iOS + Android 各一遍，重点暗色对比度）。通过后把 REGISTRY 条目改「已验证」+ CHANGELOG 追加回归结论行 + docs commit + push。

## 4. 验收回归清单模板

代码级自证项（我自己过）：语法检查 / 诊断 / 包体 / 未改 js 逻辑字段绑定。

真机项（用户手动，iOS+Android）：①留存/提示条 ②头部卡 ③新增入口（section header / 横条 / 查看按钮）跳转正确 ④列表项渲染（有值显示、无值不空白）⑤状态标签 ⑥徽标/红点位置 ⑦分区点击（卡片主体 vs 聊天按钮）不回归 ⑧加载/空/错误态不回归 ⑨与其他页风格统一 ⑩暗色模式对比度 ⑪既有功能不回归（跳转、开关、弹层等）。

## 5. 已知先例（避免重复踩坑）

- 体验版上传 CLI 首次报 `[error] code 10` / `✖ compile_start` / `IDE may already started at port 28023` / `wait IDE port timeout` → IDE 瞬时抖动，重试一次即成功（v1.6.16/v1.6.17/v1.6.18/v1.6.19 实证），不是代码问题。
- push 成功判据：不能仅凭 exit code，必须 `git ls-remote origin master` 直连核对 SHA == 本地 HEAD（§44）；ls-remote 须带与 push 相同的代理覆盖。
- PowerShell 中 `git push` 的 `NativeCommandError` 是 git 写 stderr 的正常现象，exit code 0 即成功，但仍须 ls-remote 实证。
- 头像兜底：peer 无头像 URL 时，用 WXS 按场景名映射 emoji（场景中文名见 `cloudfunctions/_shared/scene_meta.js`：就医陪诊/学习陪伴/健身陪伴/游玩陪伴/情绪陪伴/生活协助/宠物陪伴/出行陪伴/线上陪伴），有 URL 优先显示。
