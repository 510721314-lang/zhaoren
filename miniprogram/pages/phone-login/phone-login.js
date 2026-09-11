// pages/phone-login/phone-login.js
const app = getApp();
const COUNTDOWN_SEC = 60;

Page({
  data: {
    mode: 'login',     // login | register
    phone: '',
    smsCode: '',
    submitting: false,
    canSend: true,
    smsBtnText: '获取验证码',
    agreed: false,
    _timer: null
  },

  onLoad(opts) {
    if (opts && opts.mode === 'register') {
      this.setData({ mode: 'register' });
    }
  },

  onUnload() {
    if (this.data._timer) { clearInterval(this.data._timer); this.setData({ _timer: null }); }
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  onPhoneInput(e) { this.setData({ phone: e.detail.value }); },
  onSmsCodeInput(e) { this.setData({ smsCode: e.detail.value }); },

  toggleAgree() { this.setData({ agreed: !this.data.agreed }); },
  goAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }); },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  // 发送验证码: 调 user-login send_sms_code, 成功后启动倒计时
  onSendCode() {
    const phone = this.data.phone.trim();
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' }); return;
    }
    wx.showLoading({ title: '发送中', mask: true });
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'send_sms_code', phone },
      success: (r) => {
        wx.hideLoading();
        if (r.result && r.result.ok) {
          wx.showToast({ title: '验证码已发送', icon: 'success' });
          this.startCountdown();
        } else {
          wx.showToast({ title: (r.result && r.result.msg) || '发送失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  startCountdown() {
    let left = COUNTDOWN_SEC;
    this.setData({ canSend: false, smsBtnText: left + 's 后重试' });
    const timer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(timer);
        this.setData({ canSend: true, smsBtnText: '重新获取', _timer: null });
      } else {
        this.setData({ smsBtnText: left + 's 后重试' });
      }
    }, 1000);
    this.setData({ _timer: timer });
  },

  onSubmit() {
    const { mode, phone, smsCode, agreed } = this.data;
    if (!agreed) {
      wx.showToast({ title: '请先阅读并同意用户协议和隐私政策', icon: 'none' }); return;
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '手机号格式有误', icon: 'none' }); return;
    }
    if (!/^\d{4,6}$/.test(smsCode)) {
      wx.showToast({ title: '请输入验证码', icon: 'none' }); return;
    }
    this.setData({ submitting: true });
    const action = mode === 'login' ? 'phone_login' : 'phone_register';
    wx.showLoading({ title: mode === 'login' ? '登录中' : '注册中', mask: true });
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action, phone, sms_code: smsCode },
      success: (res) => {
        wx.hideLoading();
        this.setData({ submitting: false });
        if (res.result && res.result.ok) {
          this.applyResult(res.result);
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  applyResult(result) {
    const d = result.data;
    const user = d.user;
    app.globalData.userInfo = user;
    app.globalData.role = (user.roles && user.roles[0]) || 'user';
    app.setActiveRole('user');
    app.syncTabBar();
    const tip = this.data.mode === 'login' ? '登录成功' : '注册成功';
    wx.showToast({ title: tip, icon: 'success' });
    // 新号弹身份选择
    if (this.data.mode === 'register' && d.is_new) {
      const pages = getCurrentPages();
      const minePage = pages.find(p => p.route === 'pages/mine/mine');
      if (minePage && typeof minePage.askRegisterRole === 'function') {
        minePage.askRegisterRole();
      }
    }
    setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
  },

  goBack() { wx.navigateBack({ delta: 1 }); }
});
