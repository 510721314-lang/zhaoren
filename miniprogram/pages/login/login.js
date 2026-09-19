// pages/login/login.js
const app = getApp();

Page({
  data: {
    mode: 'login',     // login | register
    account: '',
    password: '',
    confirmPassword: '',
    submitting: false,
    agreed: false
  },

  onLoad(opts) {
    if (opts && opts.mode === 'register') {
      this.setData({ mode: 'register' });
    }
  },

  switchMode(e) {
    const m = e.currentTarget.dataset.mode;
    this.setData({ mode: m });
  },

  onAccountInput(e) { this.setData({ account: e.detail.value.trim() }); },
  onPasswordInput(e) { this.setData({ password: e.detail.value }); },
  onConfirmPasswordInput(e) { this.setData({ confirmPassword: e.detail.value }); },

  toggleAgree() { this.setData({ agreed: !this.data.agreed }); },
  goAgreement() { wx.navigateTo({ url: '/pages/agreement/agreement' }); },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  // 统一调 user-login: loading title 基于 action 参数而非 this.data.mode (mode 在注册自动登录时会变)
  callLoginAction(action, extraData) {
    const isLoginAction = action === 'password_login';
    wx.showLoading({ title: isLoginAction ? '登录中' : '注册中', mask: true });
    wx.cloud.callFunction({
      name: 'user-login',
      data: Object.assign({ action }, extraData || {}),
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.ok) {
          this.applyResult(res.result);
        } else {
          const msg = (res.result && res.result.msg) || '操作失败';
          wx.showToast({ title: msg, icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常,请稍后重试', icon: 'none' });
      }
    });
  },

  applyResult(result) {
    // 注册返回 {msg}, 登录返回 {user}
    const d = result.data;
    if (this.data.mode === 'register') {
      wx.showToast({ title: '注册成功,正在登录', icon: 'success' });
      // 关键: 先把 mode 切到 login, 否则接下来 password_login 成功后又会进 register 分支 → 无限循环
      this.setData({ mode: 'login' });
      // 注册成功后直接走 password_login
      setTimeout(() => {
        this.callLoginAction('password_login', {
          login_account: this.data.account,
          password: this.data.password
        });
      }, 600);
      return;
    }
    // 登录成功: 写 globalData+storage, syncTabBar, 返回
    const user = d.user;
    app.setLoginUser(user);
    app.setActiveRole('user');
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      wx.navigateBack({ delta: 1 });
    }, 500);
  },

  onSubmit() {
    const { mode, account, password, confirmPassword, agreed } = this.data;
    if (!agreed) {
      wx.showToast({ title: '请先阅读并同意用户协议和隐私政策', icon: 'none' }); return;
    }
    if (!account || account.length < 4) {
      wx.showToast({ title: '账号需 4 位以上', icon: 'none' }); return;
    }
    if (!password || password.length < 6) {
      wx.showToast({ title: '密码需 6 位以上', icon: 'none' }); return;
    }
    if (mode === 'register') {
      if (password !== confirmPassword) {
        wx.showToast({ title: '两次密码不一致', icon: 'none' }); return;
      }
    }
    this.setData({ submitting: true });
    if (mode === 'login') {
      this.callLoginAction('password_login', { login_account: account, password });
    } else {
      // 注册: 先 peek_login 确认当前 openid 已有账号(微信/手机号登录过)
      wx.showLoading({ title: '检查中', mask: true });
      wx.cloud.callFunction({
        name: 'user-login',
        data: { action: 'peek_login' },
        success: (r) => {
          wx.hideLoading();
          if (r.result && r.result.ok && r.result.data && r.result.data.found) {
            this.callLoginAction('password_register', { login_account: account, password });
          } else {
            wx.showModal({
              title: '需要先登录一次',
              content: '请先返回「我的」页用微信或手机号登录一次建号，再来这里设置账号密码。',
              confirmText: '去登录', cancelText: '取消',
              success: (mr) => { if (mr.confirm) wx.navigateBack({ delta: 1 }); }
            });
            this.setData({ submitting: false });
          }
        },
        fail: () => {
          wx.hideLoading();
          this.setData({ submitting: false });
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      });
      return;
    }
    this.setData({ submitting: false });
  },

  goBack() { wx.navigateBack({ delta: 1 }); }
});
