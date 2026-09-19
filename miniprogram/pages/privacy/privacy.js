// pages/privacy/privacy.js
Page({
  data: { title: '隐私政策' },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  }
});
