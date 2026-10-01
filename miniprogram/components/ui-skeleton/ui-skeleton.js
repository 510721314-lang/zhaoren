Component({
  properties: {
    type: { type: String, value: 'list' },   // list | card | circle
    rows: { type: Number, value: 4 },
    avatar: { type: Boolean, value: false }
  }
});
// 依赖全局骨架类(.sk-*, @keyframes skeleton-shimmer 见 app.wxss)