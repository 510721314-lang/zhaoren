Component({
  externalClasses: ['ext-class'],
  options: { addGlobalClass: true },
  properties: {
    icon: { type: String, value: '' },
    title: { type: String, value: '' },
    badge: { type: String, value: '' },
    openType: { type: String, value: '' }   // 微信 button open-type(如 contact), 空则普通行
  },
  methods: {
    onTap() { this.triggerEvent('tap'); },
    onError(e) { this.triggerEvent('error', e.detail); }
  }
});
