// components/bottom-sheet · 底部弹窗：遮罩 + 顶部圆角 + 拖拽条 + 默认/底部双插槽
// visible 受控；closeOnMask 控制点击遮罩是否关闭
Component({
  options: { multipleSlots: true },
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    closeOnMask: { type: Boolean, value: true },
    hasFooter: { type: Boolean, value: false }
  },
  methods: {
    onMaskTap() {
      if (this.properties.closeOnMask) {
        this.triggerEvent('close');
      }
    },
    noop() {}
  }
});
