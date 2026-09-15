// components/section-card · 白底圆角通用区块容器（可选标题 + 右侧extra插槽）
Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: '' },
    padded: { type: Boolean, value: true }
  }
});
