// app.js - 找人帮忙 小程序入口
App({
  globalData: {
    userInfo: null,   // 登录后填充 { openid, nick, avatar, phone, role, creditScore }
    role: 'guest'     // 'guest' | 'user' | 'partner' | 'admin'
  },

  onLaunch() {
    // 初始化云开发 · 环境ID 来自 envList.js 唯一来源
    if (wx.cloud) {
      wx.cloud.init({
        env: require('./envList.js').CLOUD_ENV,
        traceUser: true
      });
    }
  }
});
