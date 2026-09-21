---
name: mini-a11y-perf-check
description: Run accessibility and performance audits for existing WeChat mini programs covering dark mode, safe area, font scaling, Audits score, setData, image, and animation optimization. Use when the user asks for a11y check, dark mode audit, safe area, font zoom, performance audit, or setData and image optimization. Do not use for new feature development.
---

# Mini A11y & Perf Check

存量微信小程序适配与性能体检。覆盖暗色模式、安全区、字体放大、Audits 体验评分，以及 setData / 图片 / 动画性能优化。

## 体检清单

### 1. 暗色模式
- 设计 token 必须定义 `@media (prefers-color-scheme: dark)` 反色块
- 文字色在暗色下提亮（`--text-1` → 浅灰），背景加深（`--bg-page` → `#14161A`）
- 按钮文字对比度 ≥ WCAG AA (4.5:1)。禁用按钮文字须用 `--text-disabled`，不能用 `--text-invert`
- `--text-invert`（暗色下近黑）仅用于亮色按钮背景上的文字，不可用作卡片边框（边框在暗色下会隐形，改用 `rgba(255,255,255,0.45)`）
- 场景色在暗色下降饱和，阴影加深

### 2. 安全区
- 所有固定底栏（position: fixed; bottom: 0）必须加 `padding-bottom: env(safe-area-inset-bottom)`
- 自定义 tabBar 必须处理 Home Indicator 区域
- 顶部自定义导航栏加 `padding-top: env(safe-area-inset-top)` 或 `statusBarHeight`

### 3. 字体放大
- 文本 line-height 用倍数（1.5 / 1.6），不用固定 rpx（按钮 `height == line-height` 除外）
- 微信设置字体调最大时，文字不截断、按钮不变形
- `white-space: nowrap` 的标签需评估放大后是否溢出

### 4. Audits 体验评分
- 首屏渲染 < 1s，避免 setData 过大
- 页面切换无白屏，用骨架屏替代"加载中"文案
- 图片按需加载，列表图片加 `lazy-load`

## 性能优化

### 5. setData
- 只传变化字段，禁止 `setData({ list: newList })` 整列重设，改用 `list: this.data.list.concat(newList)` 增量追加
- 单次 setData 数据量 < 256KB
- 避免在 `onPageScroll` / `touchmove` 中高频 setData

### 6. 图片
- 长列表 `<image>` 必须加 `lazy-load`
- 设置 `width`/`height` 或 `mode`，避免布局抖动
- 优先 WebP 格式，头像用 `aspectFill`

### 7. 动画
- 仅用 `opacity` / `transform`，禁用 `left` / `top` / `width` / `box-shadow` 动画
- 禁用 `wx.createAnimation` 逐帧，改用 CSS `@keyframes`
- `setInterval` 频率 > 500ms 且仅更新文本的（倒计时、轮询）属于业务逻辑可保留

## 执行步骤

1. 扫描 wxss 硬编码色值（排除 `var(--xxx,#fallback)`），输出问题清单
2. 确认 tokens.wxss 暗色块完整，计算按钮文字对比度
3. 搜索 `position: fixed` + `bottom: 0`，检查安全区适配
4. 搜索 `white-space: nowrap` 和固定 line-height，评估字体放大风险
5. 搜索 `setData` 整列替换，改为增量追加
6. 搜索 `<image` 缺少 `lazy-load` 的列表图片
7. 搜索 `createAnimation` / `transition: (left|top|width)`，替换为 transform

## 输出

- 问题清单（文件路径 + 行号 + 改前改后）
- 对比度计算结果
- 复检项：真机暗色模式、刘海安全区、微信字体最大、低网速骨架屏
