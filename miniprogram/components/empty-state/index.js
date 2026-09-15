// components/empty-state · 空状态：图标 + 主文案 + 副文案 + 可选按钮
Component({
  properties: {
    icon: { type: String, value: '📭' },
    title: { type: String, value: '暂无内容' },
    desc: { type: String, value: '' },
    btnText: { type: String, value: '' }
  },
  methods: {
    onBtn() {
      this.triggerEvent('btntap');
    }
  }
});
