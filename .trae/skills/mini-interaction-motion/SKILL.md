---
name: mini-interaction-motion
description: Patch button feedback, skeleton screens, empty states, and lightweight entry motion for existing WeChat mini programs. Use when the user asks for interaction polish, hover-class, skeleton, empty state, or entry animation improvements. Do not use for new page builds or backend logic.
---

# Mini Interaction Motion

存量微信小程序交互细节补齐。仅使用 WXSS 的 opacity / transform / animation，禁止 JS 逐帧动画。改动保持小步可回退。

## 全局动效体系（app.wxss）

优先在 `app.wxss` 沉淀原子化 class，页面仅挂载类名，避免每页各写一套。

### 按压反馈
```css
.btn-press { transition: opacity .15s ease, transform .15s ease; }
.btn-press:active { opacity: 0.8; transform: scale(0.97); }
.btn-press[disabled] { opacity: 1; transform: none; }

.card-press { transition: transform .18s ease; }
.card-press:active { transform: scale(0.985); }
```
- button 用 `btn-press`，纯容器入口用 `card-press`
- disabled / loading 态必须排除按压效果

### 进场动效
```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20rpx); }
  to { opacity: 1; transform: translateY(0); }
}
.fade-in-up { opacity: 0; animation: fadeInUp .4s ease forwards; }
```
- 列表项 stagger 通过 inline style `animation-delay:{{index * 0.04}}s;` 实现
- 仅用 opacity / transform，不触发重排

### 骨架屏
```css
@keyframes skeleton-shimmer {
  0% { background-position: -468rpx 0; }
  100% { background-position: 468rpx 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--bg-segment) 25%, var(--bg-input) 50%, var(--bg-segment) 75%);
  background-size: 936rpx 100%;
  animation: skeleton-shimmer 1.4s ease infinite;
  border-radius: 8rpx;
}
```
配合 `.sk-line / .sk-circle / .sk-card` 形状类复用。

### 空状态
```css
.empty-state { text-align: center; padding: 120rpx 48rpx; }
.empty-icon { font-size: 80rpx; opacity: 0.6; margin-bottom: 24rpx; }
.empty-text { font-size: var(--font-lg); color: var(--text-2); }
.empty-sub { font-size: var(--font-base); color: var(--text-3); margin-top: 12rpx; }
```
组件形式 `<empty-state icon="" title="" desc="" btnText="" bind:btntap="" />`。

## 执行步骤

### 1. 按钮反馈
- 扫描所有 `<button>`，非 disabled 的统一加 `hover-class="btn-press"`
- 已有 `hover-class` 的保留，不覆盖
- 检查点击区域高度 ≥ 88rpx，不足的在 wxss 补 min-height
- 禁用按钮不加 hover-class

批量脚本思路：正则匹配 `<button\b([^>]*)>`，排除含 `disabled` 或已有 `hover-class` 的，追加 `hover-class="btn-press"`。

### 2. 骨架屏
- 首页、详情页、列表页的 data 加 `loading: true`
- 数据请求 complete 回调设 `loading: false`
- wxml 用 `wx:if="{{loading}}"` 显示骨架块，`wx:else` 显示内容
- 骨架块数量与实际卡片数量接近（2-3 张）

### 3. 空状态
- 列表空数据用 `<empty-state>` 组件，必须含 icon + title + desc + btnText
- 网络异常态统一 `icon="📡" title="网络异常" desc="请检查网络后重试" btnText="重试"`
- 业务空态根据场景提供操作按钮（去发布、刷新等）

### 4. 进场动效
- 列表项外包 `<view class="fade-in-up" style="animation-delay:{{index * 0.04}}s;">`
- 卡片组件内部不重复加动画，由外层容器负责
- 不超过 8 项的列表才加 stagger，长列表只加 fade-in 避免卡顿

### 5. 性能检查
- 搜索 `createAnimation` — 全部替换为 CSS animation
- 搜索 `transition: (left|top|width|height)` — 能改 transform 的就改
- `setInterval` 频率 > 500ms 且仅更新文本的（倒计时、轮询）保留，属于业务逻辑
- 禁用 `box-shadow` / `filter` 动画

## 输出

改动完成后输出：
1. 变更文件清单（路径 + 改动摘要）
2. 微信开发者工具复检项：真机按压、暗色模式骨架屏、字体放大后布局、长列表滚动性能
