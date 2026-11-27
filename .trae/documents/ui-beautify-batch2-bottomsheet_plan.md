# UI 优化 · 第 2 批 token 收敛 + bottom-sheet px→rpx + safe-area 甄别结论

## Context（为什么做）
承接 UI 美化第 1 批（profile.wxss 已推送 commit `5ddf4318`）。本轮只做三件已完成只读甄别的事：
1. **第 2 批 token 收敛**：把 message/notices/index/service 中零星硬编码色值做甄别，只改「真盲区」（品牌色/功能色背景上的裸 `#fff`，暗色下不跟随 token），带 fallback 的规范写法与设计稿选定色一律不动。
2. **bottom-sheet px→rpx**：独立组件，把魔法 px 转 rpx 对齐项目规范，1px 物理边框 + `env(safe-area-inset-bottom)` 保留。
3. **safe-area 补缺甄别**：全量 39 页 vs 已用 safe-area 的 17 页，逐页判断缺口页是否真有底部按钮被 home indicator 遮挡。只出甄别结论，不自动改。

全程遵守「最小改动（≤3 文件 / ≤30 行）」「先说后做」。基线：HEAD=`5ddf4318`，工作区干净，与 origin/master 对齐。

---

## 改动清单（待批准后落笔）

### A. 第 2 批 token 收敛 — 3 处真盲区（2 文件，3 行）
浅色模式视觉零变化（`--text-invert` 浅色=`#FFFFFF`），暗色字色自动跟随 token。

| 文件 | 行 | 改前（含上下文以保证唯一匹配） | 改后 |
|---|---|---|---|
| `miniprogram/pages-v2/index/index.wxss` | 92-94 | `background: var(--brand-primary);` / `color: #fff;` / `font-size: var(--font-sm);` | 仅 `color: #fff;` → `color: var(--text-invert);` |
| `miniprogram/pages-v2/index/index.wxss` | 229-231 | `background: var(--brand-primary);` / `color: #fff;` / `font-size: var(--font-md);` | 仅 `color: #fff;` → `color: var(--text-invert);` |
| `miniprogram/pages-v2/service/service.wxss` | 141-142 | `font-size: 72rpx;` / `color: #fff;`（`.svc__card-cover--ph`，背景为 L137 品牌绿渐变） | 仅 `color: #fff;` → `color: var(--text-invert);` |

**刻意不动（0 盲区，已甄别）**：
- `notices.wxss` 7 处、`message.wxss` L117-121、`order-detail.wxss` 20 处：全是 `var(--token, #fallback)` 规范写法。
- `message.wxss` L11/L12 棕金渐变（tokens 无棕色系，设计特例）。
- `index.wxss` L201 浅绿渐变、L217 hero 标题色（设计稿选定，与 token 微差但强行对齐反改已上线视觉）。
- `service.wxss` L137 渐变（`#06AD56` 无对应 token，设计色）。
- `custom-tab-bar` 15 处：独立渲染层取不到 `page{}` CSS 变量，改 `var()` 会透明——已验证正确设计，保留。

### B. bottom-sheet px→rpx — 9 行（1 文件）
文件：`miniprogram/components/bottom-sheet/index.wxss`（全文 53 行已实测核对）。换算 1px=2rpx。

| 行 | 改前 | 改后 |
|---|---|---|
| 18 | `border-radius: 16px 16px 0 0;` | `border-radius: 32rpx 32rpx 0 0;` |
| 30 | `width: 40px;` | `width: 80rpx;` |
| 31 | `height: 4px;` | `height: 8rpx;` |
| 33 | `border-radius: 2px;` | `border-radius: 4rpx;` |
| 34 | `margin: 8px auto;` | `margin: 16rpx auto;` |
| 37 | `padding: 8px 20px 12px;` | `padding: 16rpx 40rpx 24rpx;` |
| 41 | `font-size: 16px;` | `font-size: 32rpx;` |
| 48 | `padding: 16px 20px;` | `padding: 32rpx 40rpx;` |
| 51 | `padding: 12px 20px calc(12px + env(safe-area-inset-bottom));` | `padding: 24rpx 40rpx calc(24rpx + env(safe-area-inset-bottom));` |

**保留不动**：L38 `border-bottom: 1px solid var(--border-2);`、L52 `border-top: 1px solid var(--border-2);`（1px 物理边框，Retina 屏用 rpx 会模糊，技能允许）；L51 中的 `env(safe-area-inset-bottom)`（系统值）。L4 `rgba(0,0,0,0.4)`、L22 `max-height: 80vh` 非 px，不动。

### C. safe-area 补缺甄别 — 结论：无需改动（0 文件）
全量 39 页，17 页已用 safe-area（内联 `calc(env(safe-area-inset-bottom))`），22 页缺口。`app.wxss` L121 虽定义全局工具类 `.safe-bottom`，但**无一页面引用**——所有安全区都靠各页 wxss 内联。逐项甄别 22 个缺口页：

- **tabBar 页**：仅 `service` 是缺口页，但它是 tab 页，底部已被 custom-tab-bar 覆盖 → 不需补。
- **有底部提交按钮的 6 个缺口页**，核对按钮底距是否越过 home indicator 安全线（≈68rpx）：
  - `order-detail` 根 padding-bottom 160rpx、`partner-apply` 200rpx → 远超安全线，**安全不动**。
  - `exam`(48rpx)、`no-show-report`(24rpx)、`blog-publish`(60rpx)、`partner-profile-edit`(24rpx)：提交按钮**后面都紧跟一段提示文字**（`.exam__safe`/`.ns__footer`/`.bp__tip`/`.ppe__safe`），按钮实际底距 ≈ 84–100rpx，**均已越过 68rpx，按钮可点**；仅非操作的提示文案微贴底。
- 其余 16 页（agreement/privacy/study/credit/contacts/safety/exam-status/my-demands/orders/nearby-list/nearby-map/workbench/notices/wallet）为纯内容/列表页，可滚动、无固定底部操作栏 → 不需补。

**结论**：本批无「底部按钮」真盲区，不做改动。若后续追求像素级完美，可单开一批把上述 4 页根 `padding-bottom` 改为 `calc(X + env(safe-area-inset-bottom))`，但属锦上添花、非盲区修复，本轮不纳入。

---

## 影响面评估
- 改动均为 WXSS 样式值替换，不动 WXML/JS/组件结构/接口字段，不触及 `@VERIFIED` 逻辑。
- token 收敛：浅色模式零视觉变化；暗色模式下品牌绿背景上的白字会从硬编码 `#fff` 跟随 token 变为 `#F2F3F5`（对比度仍 AA）。
- bottom-sheet：仅单位换算，尺寸视觉不变（1px=2rpx 等价）；圆角/内边距/字号在各机型等比缩放，更贴合项目 rpx 规范。
- 不涉及 app.json / app.js / 登录态 / 云函数 / 数据库，无高危区改动。

## 风险等级
**低**。纯样式增量替换，无逻辑变更；浅色模式零差异，暗色模式为预期的 token 跟随。UI 改动须真机双端（iOS + Android）各验一遍浅色/暗色。

## 执行步骤（批准后）
1. 先跑 `npm run verify:offline` 取基线；失败即停，不绕过。
2. **批次 A**：Edit `index.wxss`（2 处）+ `service.wxss`（1 处）→ grep 复核这 3 处已改、其他设计色 `#fff` 未被误伤 → 追加 `docs/CHANGELOG.md` 一行 → 自证（编译无报错）。
3. **批次 B**：Edit `bottom-sheet/index.wxss`（9 处）→ grep 复核仅剩 L38/L52 的 `1px` 边框 → 追加 `docs/CHANGELOG.md` 一行 → 自证。
4. 两批分别走「问你是否 commit+push」（§3 写操作授权按需、单会话不继承），commit 只点名目标文件、message 走 `git commit -F <tmp>`（UTF-8 无 BOM），push 带代理 `http://127.0.0.1:7890` 并用同代理 `git ls-remote origin master` 核对远端 SHA == 本地 HEAD，输出 `§44_CHECK=PASS` 才声明成功。
5. 批次 C（safe-area）无改动，仅把甄别结论记入 CHANGELOG 一行（docs 单独提交或并入批次 B，待你定）。

## 验证方式
- **我可自证（开发者工具）**：WXSS 编译无报错、Console 无新增报错；grep 确认目标替换精准无误伤；bottom-sheet 唤起后尺寸/圆角/手柄视觉与改前一致。
- **须你人工/真机验证**（§5 UI 改动标注）：
  - iOS + Android 各验 index 页按钮字色、service 页服务卡封面占位字色——浅色与正常一致，暗色下字色跟随变暗白（非死白）。
  - 唤起 bottom-sheet（如发布页/详情页的底部弹层）：圆角、手柄条、标题字号、内容内边距、底部按钮区在 iPhone 刘海机/Android 全面屏上视觉正常，底部安全区留白仍在（L51 保留）。
  - 切系统深色模式重看上述页面。
- **回归既有功能**：index 页按钮点击跳转、service 页服务卡点击、所有用到 bottom-sheet 组件的页面弹层交互（不涉及 JS，仅确认未破坏布局）。
