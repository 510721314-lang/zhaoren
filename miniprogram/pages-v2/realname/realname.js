// pages-v2/realname · 实名认证(上线前测试期: 模拟模式)
// 门禁: 未实名禁止发布需求/接单(客户端 requireRealname + 服务端 demand-publish/order-create 双保险)
// 正式版: 本页接入 身份证照片OCR + bind_idcard(校验位/年龄/AES加密, 后端已就绪) + 人脸核验
const redline = require('../../utils/redline.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

Page({
  data: {
    statusBarHeight: 20,
    submitting: false,
    done: false,
    simulated: false,
    isRedline: false
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    // 登录态唯一来源: globalData/storage 的 userInfo(由 user-login 写入)
    let u = null;
    try {
      const app = getApp();
      u = (app && app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo') || null;
    } catch (e) {}
    this.setData({
      done: !!(u && u.is_realname_done),
      simulated: !!(u && u.is_realname_simulated)
    });
  },

  onReserve() { redline.reserveNotice(); },

  onSimulate() {
    if (this.data.submitting || this.data.done) return;
    wx.showModal({
      title: '模拟实名认证',
      content: '测试期间将直接标记为已实名，不采集身份证与人脸信息。正式上线后将改为真实核验。',
      confirmText: '模拟通过',
      cancelText: '取消',
      success: (res) => { if (res.confirm) this._submit(); }
    });
  },

  _submit() {
    this.setData({ submitting: true });
    wx.showLoading({ title: '认证中', mask: true });
    callCloud('user-login', { action: 'simulate_realname' }).then((r) => {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (!r.ok || !r.data || !r.data.user) {
        wx.showToast({ title: r.msg || '认证失败,请重试', icon: 'none' });
        return;
      }
      const u = r.data.user;
      // 持久化登录态(与登录流程一致: app.setLoginUser -> globalData + storage)
      try {
        const app = getApp();
        if (app && app.setLoginUser) app.setLoginUser(u);
      } catch (e) {}
      try { require('../../utils/bootstrap.js').clearRealnamePending(); } catch (e) {}
      wx.showToast({ title: '模拟实名已通过', icon: 'success' });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 900);
    }).catch(() => {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  }
});