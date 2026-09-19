// PRD章节: 3.1.1 登录授权 / 1.6.1 用户类型分流 / R5 年龄红线
// P1: 接云端 user-login peek_login, 删除 mock CURRENT_USER 依赖
//     登录按钮的手机号/实名/人脸流程暂保留 mock (真实链路 P2+ 实现)
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
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
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
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
      // 步骤2: 若未实名, 弹阻断弹窗(本期实名链路未开放, 需实名才能进入)
      if (!u.is_realname_done) {
        wx.showModal({
          title: '需先完成实名认证',
          content: '本期实名认证链路正在升级，请稍后再试。您也可以联系客服协助开通。',
          showCancel: false,
          confirmText: '我知道了',
          success: () => { this.setData({ logging: false }); }
        });
        return;
      }
      this.afterVerified(u);
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
    wx.setStorageSync('v2_login_ok', true);
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
  },

  // 🔧 Phase 1.4 短信验证 mock: 纯前端生成 6 位码 + showModal 显示
  onDebugSms() {
    wx.showModal({
      title: '输入手机号',
      editable: true,
      placeholderText: '仅用于 mock, 不上传服务器',
      success: (res) => {
        if (!res.confirm) return;
        const phone = String(res.content || '').trim();
        if (!/^\d{6,}$/.test(phone)) {
          wx.showToast({ title: '请输入有效手机号', icon: 'none' });
          return;
        }
        const code = String(Math.floor(Math.random() * 900000) + 100000);
        try { wx.setStorageSync('mock_sms_' + phone, code); } catch (e) {}
        wx.showModal({
          title: '短信验证码(mock)',
          content: `手机号 ${phone}\n验证码: ${code}\n\n(此码已缓存到 mock_sms_${phone})`,
          showCancel: false,
          confirmText: '好的'
        });
      }
    });
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
