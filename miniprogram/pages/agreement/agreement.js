// pages/agreement/agreement.js
Page({
  data: { title: '用户协议' },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  }
});
