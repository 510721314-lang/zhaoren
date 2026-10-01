# 小程序 UI 系统优化方案（2026-10-01）

> 对齐主流：微信设计规范 / iOS-Android 设计语言 / 无障碍指南
> 现状评分：Token 体系 8.5 · 品牌一致性 6 · 组件化 6.5 · 图标/情感化 5 · 交互动效 7.5 · 适配无障碍 6.5

## 原则
1. 单一主色：微信绿 #07C160 为唯一品牌主色；安全色语义化；禁止页面调色
2. 组件优于样式：全局工具类 → 自定义组件库（ui-button/ui-card/...）
3. 动效只做"微"：反馈与引导；尊重 prefers-reduced-motion
4. 情感化适度：空态/完成态用图标插画，不用 emoji 当业务图标

## 模块
- A 资产收敛：导航栏双轨(#D4875A→#07C160)、删旧橙残留、补 token(z-index/线宽/状态色板/color-scheme:dark)
- B 组件体系化：components/ui/ 8+4 组件（button/card/cell/tag/empty/skeleton/toast-banner/dialog + 现有 night-mask/empty-state/bottom-sheet 归并）
- C 图标插画：iconfont 替代高频 emoji；场景宫格统一描边；banner/空态轻插画
- D 排版首屏：字号刻度 10-20pt 阶梯；首页两级信息架构
- E 微交互标准：时长/缓动表、模板化按压/进场/stagger、reduced-motion 降级
- F 体验细节：骨架全接入、空态三件套、toast 三色统一
- G 适配无障碍：字号放大流式布局、点击区≥88rpx、对比度 AA、safe-top 自绘页补齐

## Roadmap
- P0 提审前：导航栏统一、删旧橙、色值扫描收敛、点击区/对比度抽检 【已开始】
- P1 上线后一期：ui/ 组件库 8 组件 + 4 页改造；图标系统；骨架全接入
- P2 二期：首页信息重构、插画空态、微动效标准、AUDITS≥90

## 验收（mini-ui-beautify 流程）
问题清单(色值/魔法间距扫描) → 建 token → 逐页替换验收 → 交互补齐 → 适配 → AUDITS+Trace 体检 → 真机复检(刘海/暗色/字体放大/低网速)

## 硬性约束
仅 rpx · 动效仅 opacity/transform/CSS · 点击区≥88rpx · AA 对比度 · setData 只传变化字段 · v1 页移除后清理旧橙主题