// pages/mine/mine.js - 我的 · 登录与实名注册(对应 PRD 3.1)
const app = getApp();

Page({
  data: {
    // 用户信息
    user: null,             // {nickname, avatar, phone, idcard_masked, age, ...}
    isLoggedIn: false,
    isNewUser: false,
    isPartner: false,       // 是否已是耍伴(WXML 不支持 indexOf,用布尔值)

    // 编辑态
    nickname: '',           // 微信 chooseAvatar / nickname 输入同步
    avatarUrl: '',
    inputPhone: '',
    inputIdcard: '',
    contactName: '',
    contactPhone: '',
    contactRelation: '',
    contactName2: '',
    contactPhone2: '',
    contactRelation2: '',
    hasSecondContact: false,

    // 信用分
    userCredit: 800,
    partnerCredit: 800,
    creditLogs: [],

    // 状态
    isSubmitting: false,
    version: 'v1.0.0-mvp'
  },

  onLoad() {
    this.silentLogin();
  },

  onShow() {
    if (this.data.isLoggedIn) this.loadCredit();
  },

  // 静默登录
  silentLogin() {
    wx.showLoading({ title: '登录中', mask: true });
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'login' },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.ok) {
          const user = res.result.data.user;
          this.setData({
            user,
            isLoggedIn: true,
            isNewUser: !!res.result.data.is_new,
            isPartner: (user.roles || []).indexOf('partner') >= 0,
            nickname: user.nickname || '',
            avatarUrl: user.avatar || '',
            userCredit: user.user_credit_score || 800,
            partnerCredit: user.partner_credit_score || 800
          });
          app.globalData.userInfo = user;
          app.globalData.role = (user.roles && user.roles[0]) || 'user';
          if (res.result.data.is_new) {
            wx.showToast({ title: '欢迎加入', icon: 'success' });
          }
          this.loadCredit();
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '登录失败', icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.log('login fail', err);
        wx.showToast({ title: '网络异常,请稍后重试', icon: 'none' });
      }
    });
  },

  // 拉取信用分
  loadCredit() {
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'get_my_credit' },
      success: (res) => {
        if (res.result && res.result.ok) {
          const d = res.result.data;
          this.setData({
            userCredit: d.user_credit_score,
            partnerCredit: d.partner_credit_score,
            creditLogs: d.logs || []
          });
        }
      }
    });
  },

  // 头像选择(微信官方 chooseAvatar)
  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl });
  },

  // 昵称输入(微信官方 nickname)
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  // 保存昵称与头像
  async saveProfile() {
    const { nickname, avatarUrl } = this.data;
    if (!nickname && !avatarUrl) {
      wx.showToast({ title: '请填写昵称或头像', icon: 'none' });
      return;
    }
    this.setData({ isSubmitting: true });
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'update_profile', nickname, avatar: avatarUrl },
      success: (res) => {
        this.setData({ isSubmitting: false });
        if (res.result && res.result.ok) {
          wx.showToast({ title: '已保存', icon: 'success' });
          this.refreshUser();
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ isSubmitting: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  // 手机号输入
  onPhoneInput(e) { this.setData({ inputPhone: e.detail.value }); },

  // 保存手机号
  savePhone() {
    const phone = this.data.inputPhone.trim();
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '手机号需 11 位 1 开头', icon: 'none' });
      return;
    }
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'bind_phone', phone },
      success: (res) => {
        if (res.result && res.result.ok) {
          wx.showToast({ title: '手机号已保存', icon: 'success' });
          this.setData({ inputPhone: '' });
          this.refreshUser();
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '网络异常', icon: 'none' })
    });
  },

  // 身份证输入
  onIdcardInput(e) { this.setData({ inputIdcard: e.detail.value.trim() }); },

  // 保存身份证
  saveIdcard() {
    const idcard = this.data.inputIdcard.trim();
    if (idcard.length !== 18) {
      wx.showToast({ title: '身份证号需 18 位', icon: 'none' });
      return;
    }
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'bind_idcard', idcard },
      success: (res) => {
        if (res.result && res.result.ok) {
          wx.showToast({ title: '实名认证完成', icon: 'success' });
          this.setData({ inputIdcard: '' });
          this.refreshUser();
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '校验失败', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '网络异常', icon: 'none' })
    });
  },

  // 紧急联系人输入
  onCNameInput(e) { this.setData({ contactName: e.detail.value }); },
  onCPhoneInput(e) { this.setData({ contactPhone: e.detail.value }); },
  onCRelationInput(e) { this.setData({ contactRelation: e.detail.value }); },
  onCName2Input(e) { this.setData({ contactName2: e.detail.value }); },
  onCPhone2Input(e) { this.setData({ contactPhone2: e.detail.value }); },
  onCRelation2Input(e) { this.setData({ contactRelation2: e.detail.value }); },
  toggleSecondContact() { this.setData({ hasSecondContact: !this.data.hasSecondContact }); },

  // 保存紧急联系人
  saveContacts() {
    const { contactName, contactPhone, contactRelation,
      hasSecondContact, contactName2, contactPhone2, contactRelation2 } = this.data;
    if (!contactName || !contactPhone || !contactRelation) {
      wx.showToast({ title: '请完整填写第一联系人', icon: 'none' });
      return;
    }
    const contacts = [{ name: contactName, phone: contactPhone, relation: contactRelation }];
    if (hasSecondContact) {
      if (!contactName2 || !contactPhone2 || !contactRelation2) {
        wx.showToast({ title: '请完整填写第二联系人', icon: 'none' });
        return;
      }
      contacts.push({ name: contactName2, phone: contactPhone2, relation: contactRelation2 });
    }
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'set_emergency_contact', contacts },
      success: (res) => {
        if (res.result && res.result.ok) {
          wx.showToast({ title: '紧急联系人已保存', icon: 'success' });
          this.setData({
            contactName: '', contactPhone: '', contactRelation: '',
            contactName2: '', contactPhone2: '', contactRelation2: '',
            hasSecondContact: false
          });
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '网络异常', icon: 'none' })
    });
  },

  // 重新拉取用户信息(脱敏后)
  refreshUser() {
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'login' },
      success: (res) => {
        if (res.result && res.result.ok) {
          const user = res.result.data.user;
          this.setData({
            user,
            isPartner: (user.roles || []).indexOf('partner') >= 0,
            nickname: user.nickname || '',
            avatarUrl: user.avatar || ''
          });
          app.globalData.userInfo = user;
        }
      }
    });
  },

  // 跳转协议
  toAgreement(e) {
    const type = e.currentTarget.dataset.type || 'user';
    wx.navigateTo({ url: `/pages/agreement/agreement?type=${type}` });
  },

  // 耍伴入口:已是耍伴进中心页,否则进申请页
  onPartnerTap() {
    const url = this.data.isPartner
      ? '/pages/partner-center/partner-center'
      : '/pages/partner-apply/partner-apply';
    wx.navigateTo({ url });
  },

  // 占位:后续用于隐藏管理入口
  onAboutTap() {}
});
