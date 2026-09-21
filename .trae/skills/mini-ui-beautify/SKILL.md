---
name: mini-ui-beautify
description: 原生微信小程序存量项目UI美化——设计token收敛、交互细节、适配兼容、体验评分闭环。
---

# 原生微信小程序 UI 美化（存量项目）

## 适用场景
项目已开发完成，需统一视觉、补交互细节、修适配问题、跑上线前体验评分。

## 工作流（严格按顺序）
1. **扫描**：遍历所有 .wxss，列出硬编码十六进制色值、魔法间距数字，输出《问题清单》。
2. **建 token**：在 app.wxss 写入颜色/间距/圆角/阴影/字号 CSS 变量，并配 prefers-color-scheme 暗色块。
3. **逐页替换**：每个 page 的 wxss 改用 var(--*)，改完即在开发者工具自定义编译该页验收。
4. **交互补齐**：按钮加 hover-class（禁止手写重 hover）；列表/详情生成骨架屏；空数据出空状态组件。
5. **适配**：全局加 safe-top / safe-bottom；字号改相对单位；检查 line-height 倍数。
6. **体检**：跑 Audits + Trace，输出《性能清单》—— setData 合并、图片尺寸/WebP/lazy-load、阴影降级。
7. **真机复检**：刘海、安全区、暗色、微信字体放大、低网速骨架屏。

## 硬性约束
- 仅用 rpx；不引入未声明 npm 包；WeUI 需显式 @import。
- 动效只用 opacity / transform / CSS animation，不写 JS 逐帧。
- 点击区 ≥ 88rpx；颜色对比度满足 AA。
- setData 只传变化字段，禁止整列重设。
- 所有改动必须附：文件路径、改前/改后、需在开发者工具复检的项。
