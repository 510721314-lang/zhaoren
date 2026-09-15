// custom-tab-bar · V15.1 自定义TabBar（5位：首页/广场/中央发布/消息/我的）
// 契约：app.json tabBar.custom=true + list 注册4个真实tab页；中央发布钮为绝对定位，不走switchTab
const redline = require('../utils/redline.js');

Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages-v2/index/index', text: '首页', icon: '🏠' },
      { pagePath: '/pages-v2/square/square', text: '广场', icon: '🧭' },
      { pagePath: '/pages-v2/message/message', text: '消息', icon: '💬' },
      { pagePath: '/pages-v2/profile/profile', text: '我的', icon: '👤' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset;
      if (this.data.selected === index) return;
      wx.switchTab({ url: path, fail: () => {} });
    },
    goPublish() {
      const gate = redline.checkEntryLocked();
      if (gate.locked) {
        wx.showToast({ title: gate.msg, icon: 'none' });
        return;
      }
      // P06 发布页在批次2实现，先保留跳转契约
      wx.navigateTo({
        url: '/pages-v2/publish/publish',
        fail: () => {
          wx.showToast({ title: '发布页将在批次2上线', icon: 'none' });
        }
      });
    }
  }
});
