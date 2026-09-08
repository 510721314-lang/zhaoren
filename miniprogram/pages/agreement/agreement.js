// pages/agreement/agreement.js - 协议占位
Page({
  data: {
    type: 'user',
    title: '用户协议',
    content: '测试版本,正式协议上线前发布'
  },
  onLoad(opts) {
    const type = opts.type || 'user';
    this.setData({
      type,
      title: type === 'privacy' ? '隐私政策' : '用户协议'
    });
    wx.setNavigationBarTitle({ title: this.data.title });
  }
});
