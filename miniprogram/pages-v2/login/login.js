// PRD章节: 3.1.1 登录授权 / 1.6.1 用户类型分流 / R5 年龄红线
// P1: 接云端 user-login peek_login, 删除 mock CURRENT_USER 依赖
//     登录按钮的手机号/实名/人脸流程暂保留 mock (真实链路 P2+ 实现)
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    agreeItems: [
      { key: 'user', label: '《用户服务协议》' },
      { key: 'privacy', label: '《隐私政策》' },
      { key: 'face', label: '《人脸信息处理声明》' }
    ],
    agreements: { user: false, privacy: false, face: false },
    allChecked: false,
    logging: false,
    rejected: false,
    rejectReason: '',
    age: null,
    hasEmergency: false,
    statusBarHeight: 20,
    isRedline: false
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
    this.peekExistingUser();
  },

  peekExistingUser() {
    callCloud('user-login', { action: 'peek_login' }).then((r) => {
      if (!r.ok || !r.data || !r.data.found) return;
      // 已有账号: 预填年龄(后端 safeUserDoc 已脱敏, age 直接用)
      const u = r.data.user;
      this.setData({ age: u.age || null });
    });
  },

  toggleAgreement(e) {
    const key = e.currentTarget.dataset.key;
    const agreements = Object.assign({}, this.data.agreements);
    agreements[key] = !agreements[key];
    this.setData({
      agreements,
      allChecked: agreements.user && agreements.privacy && agreements.face
    });
  },

  openAgreement(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'user') {
      wx.navigateTo({ url: '/pages/agreement/agreement', fail: () => wx.showToast({ title: '协议页待接入', icon: 'none' }) });
    } else if (key === 'privacy') {
      wx.navigateTo({ url: '/pages/privacy/privacy', fail: () => wx.showToast({ title: '隐私页待接入', icon: 'none' }) });
    } else {
      wx.showModal({
        title: '人脸信息处理声明',
        content: '我们仅在实名认证环节采集您的人脸信息，用于公安身份核验，核验后不留存原始人脸图像，详见完整声明。',
        showCancel: false,
        confirmText: '我知道了'
      });
    }
  },

  onLogin() {
    if (!this.data.allChecked || this.data.logging) return;
    this.setData({ logging: true });

    // 步骤1: 微信登录 (user-login login 自动建号/返回已有号)
    wx.showLoading({ title: '登录中…', mask: true });
    callCloud('user-login', { action: 'login' }).then((r) => {
      wx.hideLoading();
      if (!r.ok || !r.data || !r.data.user) {
        this.setData({ logging: false });
        wx.showModal({ title: '登录失败', content: r.msg || '请稍后重试', showCancel: false });
        return;
      }
      const u = r.data.user;
      // 步骤2: 若未实名, 走实名引导(本期 mock)
      if (!u.is_realname_done) {
        wx.showLoading({ title: '实名人脸核验中…', mask: true });
        setTimeout(() => {
          wx.hideLoading();
          this.afterVerified(u);
        }, 700);
      } else {
        this.afterVerified(u);
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ logging: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  afterVerified(user) {
    // R5：年龄校验
    if (user.age && user.age < CONFIG.ADULT_AGE) {
      this.setData({
        logging: false,
        rejected: true,
        rejectReason: `您的年龄为${user.age}周岁，本平台仅向${CONFIG.ADULT_AGE}周岁及以上用户提供服务`
      });
      return;
    }
    wx.setStorageSync('v2_mock_login', true);
    this.askUserType();
  },

  askUserType() {
    wx.showActionSheet({
      itemList: ['我是个人用户', '我是机构用户'],
      success: (res) => {
        this.setData({ logging: false });
        if (res.tapIndex === 0) {
          wx.switchTab({ url: '/pages-v2/index/index' });
        } else {
          wx.showToast({ title: 'B端入口请访问机构后台小程序', icon: 'none', duration: 2500 });
        }
      },
      fail: () => { this.setData({ logging: false }); }
    });
  },

  backReject() {
    this.setData({ rejected: false, logging: false });
  }
});
