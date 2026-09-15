// components/nav-bar · 通用导航：返回箭头/标题/右侧动作区插槽
// PRD章节: 全局通用（pages-spec 通用规则：顶部nav-bar统一高92rpx）
Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true },
    fixed: { type: Boolean, value: true },
    bg: { type: String, value: 'var(--bg-card)' }
  },
  data: {
    statusBarHeight: 20
  },
  lifetimes: {
    attached() {
      let h = 20;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        h = info.statusBarHeight || 20;
      } catch (e) { h = 20; }
      this.setData({ statusBarHeight: h });
    }
  },
  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.switchTab({ url: '/pages-v2/index/index', fail: () => {} });
      }
      this.triggerEvent('back');
    }
  }
});
