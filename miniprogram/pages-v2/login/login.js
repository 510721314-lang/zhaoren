// PRD章节: 3.1.1 登录授权 / 1.6.1 用户类型分流 / R5 年龄红线
// P1: 接云端 user-login peek_login, 删除 mock CURRENT_USER 依赖
//     登录按钮的手机号/实名/人脸流程暂保留 mock (真实链路 P2+ 实现)
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');

const PHONE_RE = /^1\d{10}$/;
const ACCOUNT_RE = /^[a-zA-Z0-9_]{4,20}$/;
const PASSWORD_RE = /^\S{6,32}$/;
const SMS_CODE_RE = /^\d{6}$/;

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

Page({
  data: {
    tab: 'wechat',
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
    isRedline: false,
    // 手机号/密码 Tab 字段
    phone: '',
    smsCode: '',
    smsCountdown: 0,
    loginAccount: '',
    loginPassword: '',
    phLogging: false,
    pwLogging: false,
    // 校验态
    phoneValid: false,
    smsCodeValid: false,
    accountValid: false,
    passwordValid: false,
    // 手工输入手机号入口(默认收起, 首选一键授权)
    showManual: false
  },

  // ── Tab 切换 ──
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
  },

  // ── 手机号一键授权: 微信自动拉取当前绑定手机号, code 仅可消费一次 ──
  onGetPhoneNumber(e) {
    if (!this.data.allChecked) { wx.showToast({ title: '请先勾选协议', icon: 'none' }); return; }
    const detail = e.detail || {};
    // 用户拒绝授权/取消: detail.code 为空, 静默返回
    if (!detail.code) return;
    if (this.data.phLogging) return;
    this.setData({ phLogging: true });
    wx.showLoading({ title: '登录中…', mask: true });
    // 后端 phone_login 一键语义: 有账号登录, 无账号自动注册
    callCloud('user-login', { action: 'phone_login', phone_code: detail.code }).then((r) => {
      wx.hideLoading();
      this.setData({ phLogging: false });
      if (r.ok && r.data && r.data.user) {
        this.afterVerified(r.data.user);
      } else {
        wx.showModal({ title: '登录失败', content: r.msg || r.code || '请稍后重试', showCancel: false });
      }
    });
  },

  // ── 手工输入手机号入口展开/收起 ──
  toggleManual() {
    this.setData({ showManual: !this.data.showManual });
  },

  // ── 手机号 Tab ──
  onPhoneInput(e) {
    const phone = (e.detail.value || '').trim();
    this.setData({ phone, phoneValid: PHONE_RE.test(phone) });
  },
  onSmsInput(e) {
    const smsCode = (e.detail.value || '').trim();
    this.setData({ smsCode, smsCodeValid: SMS_CODE_RE.test(smsCode) });
  },
  onSendSms() {
    if (!this.data.phoneValid || this.data.smsCountdown > 0) return;
    if (!this.data.allChecked) { wx.showToast({ title: '请先勾选协议', icon: 'none' }); return; }
    callCloud('user-login', { action: 'send_sms_code', phone: this.data.phone }).then((r) => {
      if (!r.ok) { wx.showToast({ title: r.msg || '发送失败', icon: 'none' }); return; }
      // 后端 dev 模式回传 dev_code, prod 不回(防泄露)
      if (r.data && r.data.dev_code) {
        wx.showModal({ title: '验证码', content: r.data.dev_code, showCancel: false, confirmText: '复制', success: (m) => { if (m.confirm) wx.setClipboardData({ data: r.data.dev_code }); }});
      } else {
        wx.showToast({ title: '验证码已发送', icon: 'none' });
      }
      this.startCountdown(60);
    });
  },
  startCountdown(sec) {
    this.setData({ smsCountdown: sec });
    const t = setInterval(() => {
      const n = this.data.smsCountdown - 1;
      if (n <= 0) { clearInterval(t); this.setData({ smsCountdown: 0 }); }
      else this.setData({ smsCountdown: n });
    }, 1000);
  },
  onPhoneRegister() {
    if (!this.data.allChecked || !this.data.phoneValid || !this.data.smsCodeValid || this.data.phLogging) return;
    this.setData({ phLogging: true });
    wx.showLoading({ title: '注册中…', mask: true });
    callCloud('user-login', { action: 'phone_register', phone: this.data.phone, sms_code: this.data.smsCode }).then((r) => {
      wx.hideLoading(); this.setData({ phLogging: false });
      if (!r.ok || !r.data || !r.data.user) { wx.showModal({ title: '注册失败', content: r.msg || '请稍后重试', showCancel: false }); return; }
      const u = r.data.user;
      if (u.status === 'frozen') { wx.showModal({ title: '账号已冻结', content: '请联系管理员', showCancel: false }); return; }
      this.afterVerified(u);
    });
  },
  onPhoneLogin() {
    if (!this.data.allChecked || !this.data.phoneValid || !this.data.smsCodeValid || this.data.phLogging) return;
    this.setData({ phLogging: true });
    wx.showLoading({ title: '登录中…', mask: true });
    callCloud('user-login', { action: 'phone_login', phone: this.data.phone, sms_code: this.data.smsCode }).then((r) => {
      wx.hideLoading(); this.setData({ phLogging: false });
      if (!r.ok) { wx.showModal({ title: '登录失败', content: r.msg || '请稍后重试', showCancel: false }); return; }
      const u = r.data.user;
      if (u.status === 'frozen') { wx.showModal({ title: '账号已冻结', content: '请联系管理员', showCancel: false }); return; }
      this.afterVerified(u);
    });
  },

  // ── 账号密码 Tab ──
  onAccountInput(e) {
    const loginAccount = (e.detail.value || '').trim();
    this.setData({ loginAccount, accountValid: ACCOUNT_RE.test(loginAccount) });
  },
  onPasswordInput(e) {
    const loginPassword = e.detail.value || '';
    this.setData({ loginPassword, passwordValid: PASSWORD_RE.test(loginPassword) });
  },
  onPasswordLogin() {
    if (!this.data.allChecked || !this.data.accountValid || !this.data.passwordValid || this.data.pwLogging) return;
    this.setData({ pwLogging: true });
    wx.showLoading({ title: '登录中…', mask: true });
    callCloud('user-login', { action: 'password_login', login_account: this.data.loginAccount, password: this.data.loginPassword }).then((r) => {
      wx.hideLoading(); this.setData({ pwLogging: false });
      if (!r.ok || !r.data || !r.data.user) { wx.showModal({ title: '登录失败', content: r.msg || '请稍后重试', showCancel: false }); return; }
      this.afterVerified(r.data.user);
    });
  },
  onPasswordRegister() {
    if (!this.data.allChecked || !this.data.accountValid || !this.data.passwordValid || this.data.pwLogging) return;
    this.setData({ pwLogging: true });
    wx.showLoading({ title: '注册中…', mask: true });
    callCloud('user-login', { action: 'password_register', login_account: this.data.loginAccount, password: this.data.loginPassword }).then((r) => {
      wx.hideLoading(); this.setData({ pwLogging: false });
      if (r.ok) { wx.showToast({ title: '密码设置成功,可直接登录', icon: 'success', duration: 1500 }); return; }
      // register_no_user → 自动微信登录建号再回来
      if (r.code === 'register_no_user') {
        wx.showModal({ title: '需先登录微信', content: '账号密码注册前请先微信登录, 系统会自动跳转', showCancel: false, confirmText: '立即登录', success: () => {
          this.doWechatLogin(() => {
            this.setData({ tab: 'password' });
            wx.showToast({ title: '微信登录已完成,请重试点注册', icon: 'none', duration: 2000 });
          });
        }});
        return;
      }
      wx.showModal({ title: '注册失败', content: r.msg || '请稍后重试', showCancel: false });
    });
  },
  // 账号密码注册前置: 隐式微信登录(静默建号)
  doWechatLogin(cb) {
    callCloud('user-login', { action: 'login' }).then((r) => {
      if (r.ok && r.data && r.data.user) { cb && cb(); return; }
      wx.showModal({ title: '登录失败', content: r.msg || '请稍后重试', showCancel: false });
    });
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
      // 实名闸门后移: 登录即可进首页, 实名仅在发布需求/接单/下单等关键操作时要求
      if (!u.is_realname_done) {
        wx.setStorageSync('pending_realname', true);
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
