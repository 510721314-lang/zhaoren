// pages/mine/mine.js - 我的 · 登录与实名注册(对应 PRD 3.1)
const app = getApp();

Page({
  data: {
    // 用户信息
    user: null,             // {nickname, avatar, phone, idcard_masked, age, ...}
    isLoggedIn: false,
    isNewUser: false,
    isPartner: false,       // 是否已开通耍伴(云端 roles 含 partner; WXML 不支持 indexOf,用布尔值)
    activeRole: 'user',     // 当前界面身份 user|partner(仅影响展示)

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
    userCreditCls: 'credit-high',
    partnerCreditCls: 'credit-high',
    creditLogs: [],

    // 状态
    isSubmitting: false,
    version: 'v1.0.0-mvp',

    // 版本号连击(5 次出管理口令弹窗)
    versionTaps: 0,
    versionTapTimer: null
  },

  onLoad() {
    // 不在 onLoad 自动登录: 让双入口 guest-box 真正可见, 等用户点击按钮才走对应登录流程
    // 已登录用户会在 onShow 里被处理
  },

  onShow() {
    app.syncTabBar();
    if (this.data.isLoggedIn) {
      this.loadCredit();
      this.refreshUser();
      return;
    }
    // 未登录态: 尝试静默查号(不自动建号), 若云端能查到已有账号则续上登录
    // 查不到就保留 guest-box 给用户选入口
    this.tryResumeLogin();
  },

  // 静默续查(不建号, 仅查已有账号避免重复体验未登录态)
  tryResumeLogin() {
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'peek_login' },
      success: (res) => {
        if (!res.result || !res.result.ok) return;
        const d = res.result.data;
        if (d && d.found && d.user) {
          // 已存在正常账号: 直接续上登录(不是注册, 不会弹选身份)
          this.applyLoginResult({ ok: true, data: { user: d.user } });
        } else if (d && d.closed) {
          this.resetAuthState();
        } else if (d && (d.frozen || d.banned)) {
          // 有账号但状态异常: 提示一下, 保留 guest-box
          wx.showToast({ title: d.msg || '账号受限', icon: 'none' });
        }
        // found=false → 留在 guest-box, 让用户点按钮选入口
      },
      fail: () => {
        // 网络异常也留在 guest-box, 不要强制建号
      }
    });
  },

  // 统一封装登录动作: 微信一键 / 手机号快捷 都调这个
  callLoginAction(action, extraData) {
    wx.showLoading({ title: '登录中', mask: true });
    wx.cloud.callFunction({
      name: 'user-login',
      data: Object.assign({ action }, extraData || {}),
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.ok) {
          this.applyLoginResult(res.result);
        } else {
          const code = res.result && res.result.code;
          if (code === 'login_account_closed') {
            this.resetAuthState();
            wx.showToast({ title: (res.result && res.result.msg) || '该账号已注销', icon: 'none' });
          } else if (code === 'phone_decrypt_fail' || code === 'phone_no_code') {
            wx.showModal({
              title: '手机号获取失败',
              content: (res.result && res.result.msg) + '，请改用「微信一键登录」或稍后重试。',
              showCancel: false, confirmText: '好的'
            });
          } else if (code === 'phone_no_account') {
            // 点了手机号登录但该 openid 下无账号 → 引导走注册入口
            wx.showModal({
              title: '暂无账号',
              content: '这个手机号在我们平台还没有账号，是否要先注册？',
              confirmText: '去注册', cancelText: '取消',
              success: (r) => {
                if (r.confirm) {
                  // 标记让注册按钮点击时能识别来源(直接调后端即可, 无需传递状态)
                  wx.showToast({ title: '请点「手机号快捷注册」', icon: 'none' });
                }
              }
            });
          } else if (code === 'phone_already_exists') {
            // 点了手机号注册但已有账号 → 引导走登录入口
            wx.showModal({
              title: '已有账号',
              content: '这个手机号在我们平台已有账号，是否直接登录？',
              confirmText: '去登录', cancelText: '取消',
              success: (r) => {
                if (r.confirm) {
                  wx.showToast({ title: '请点「手机号快捷登录」', icon: 'none' });
                }
              }
            });
          } else {
            wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' });
          }
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常,请稍后重试', icon: 'none' });
      }
    });
  },

  // 登录/注册成功后统一应用状态(两个入口: login/phone_login 共用)
  applyLoginResult(result) {
    const user = result.data.user;
    this.setData({
      user,
      isLoggedIn: true,
      isNewUser: !!result.data.is_new,
      isPartner: (user.roles || []).indexOf('partner') >= 0,
      nickname: user.nickname || '',
      avatarUrl: user.avatar || '',
      userCredit: user.user_credit_score || 800,
      partnerCredit: user.partner_credit_score || 800,
      userCreditCls: this.creditCls(user.user_credit_score || 800),
      partnerCreditCls: this.creditCls(user.partner_credit_score || 800)
    });
    app.globalData.userInfo = user;
    app.globalData.role = (user.roles && user.roles[0]) || 'user';
    let activeRole = app.getActiveRole();
    if (activeRole === 'partner' && (user.roles || []).indexOf('partner') < 0) {
      activeRole = 'user';
      app.setActiveRole('user');
    }
    this.setData({ activeRole });
    app.syncTabBar();
    if (result.data.is_new) {
      wx.showToast({ title: '欢迎加入', icon: 'success' });
      this.askRegisterRole((user.roles || []).indexOf('partner') >= 0);
    }
    this.loadCredit();
  },

  // 静默登录(微信 openid 自动建号/查号, 幂等)
  silentLogin() {
    this.callLoginAction('login');
  },

  // 信用分颜色: >=800 绿 / 600-799 橙 / <600 红(WXML 不支持比较表达式, 预处理类名)
  creditCls(score) {
    if (score >= 800) return 'credit-high';
    if (score >= 600) return 'credit-mid';
    return 'credit-low';
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
            userCreditCls: this.creditCls(d.user_credit_score),
            partnerCreditCls: this.creditCls(d.partner_credit_score),
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
          const isPartner = (user.roles || []).indexOf('partner') >= 0;
          const patch = {
            user,
            isPartner,
            nickname: user.nickname || '',
            avatarUrl: user.avatar || ''
          };
          // 耍伴权限消失时, 界面身份回退发单人
          if (!isPartner && app.getActiveRole() === 'partner') {
            app.setActiveRole('user');
            patch.activeRole = 'user';
          }
          this.setData(patch);
          app.globalData.userInfo = user;
        }
      }
    });
  },

  // ───────── 身份选择与切换 ─────────
  // 新用户注册: 选择初始身份(注册后随时可在本页切换/增加)
  askRegisterRole(alreadyPartner) {
    setTimeout(() => {
      wx.showActionSheet({
        itemList: ['我要找人帮忙（成为发单人）', '我想成为耍伴（接单赚钱）'],
        success: (r) => {
          if (r.tapIndex === 0) {
            app.setActiveRole('user');
            this.setData({ activeRole: 'user' });
          } else {
            // 已是耍伴直接切换; 否则去申请页(实名+紧急联系人+审核)
            app.setActiveRole('partner');
            this.setData({ activeRole: 'partner' });
            if (!alreadyPartner) {
              wx.navigateTo({ url: '/pages/partner-apply/partner-apply' });
            }
          }
        },
        fail: () => {
          // 未选择默认发单人, 后续可随时切换
          app.setActiveRole('user');
          this.setData({ activeRole: 'user' });
        }
      });
    }, 600);
  },

  // 点击身份切换卡
  onRoleTap(e) {
    const role = e.currentTarget.dataset.role;
    if (!role || role === this.data.activeRole) return;
    if (role === 'user') {
      app.setActiveRole('user');
      this.setData({ activeRole: 'user' });
      wx.showToast({ title: '已切换为发单人', icon: 'none' });
      return;
    }
    // 切换耍伴: 必须云端已有 partner 角色(申请审核通过), 否则引导申请=「增加身份」
    if (!this.data.isPartner) {
      wx.showModal({
        title: '增加「耍伴」身份',
        content: '成为耍伴需实名认证、填写紧急联系人并通过审核（约 1 分钟）。完成后即可在大厅接单赚钱，是否现在申请？',
        confirmText: '去申请',
        cancelText: '暂不',
        success: (r) => {
          if (r.confirm) {
            wx.navigateTo({ url: '/pages/partner-apply/partner-apply' });
          }
        }
      });
      return;
    }
    app.setActiveRole('partner');
    this.setData({ activeRole: 'partner' });
    wx.showToast({ title: '已切换为耍伴', icon: 'none' });
  },

  // ───────── 登录 / 退出 / 注销 ─────────
  // 未登录态点击「微信一键登录」(openid 静默建号/查号)
  onLoginTap() {
    this.silentLogin();
  },

  // 未登录态点「手机号登录/注册」→ 跳独立 phone-login 页
  onPhoneLogin() {
    wx.navigateTo({ url: '/pages/phone-login/phone-login' });
  },

  // 未登录态点「账号密码登录/注册」→ 跳独立 login 页
  onPasswordLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  // 清空本地登录态(微信 openid 由云端环境隐式提供, 退出仅清除本端展示)
  resetAuthState() {
    app.globalData.userInfo = null;
    app.globalData.role = 'guest';
    app.setActiveRole('user');
    this.setData({
      user: null,
      isLoggedIn: false,
      isNewUser: false,
      isPartner: false,
      activeRole: 'user',
      creditLogs: [],
      nickname: '',
      avatarUrl: ''
    });
  },

  // 退出登录(二次确认)
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将不展示个人信息，确定退出吗？',
      confirmText: '退出',
      success: (r) => {
        if (!r.confirm) return;
        this.resetAuthState();
        wx.showToast({ title: '已退出登录', icon: 'none' });
      }
    });
  },

  // 注销账号(两步强确认: 告知后果 → 输入「注销」)
  onCloseAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销后将清空昵称、手机号、身份证、紧急联系人等个人信息，且不可恢复；待接单需求将自动取消。有进行中订单时无法注销。',
      confirmText: '继续',
      confirmColor: '#B03A2E',
      success: (r1) => {
        if (!r1.confirm) return;
        wx.showModal({
          title: '请确认注销',
          editable: true,
          placeholderText: '输入「注销」二字确认',
          confirmText: '确认注销',
          confirmColor: '#B03A2E',
          success: (r2) => {
            if (!r2.confirm) return;
            if ((r2.content || '').trim() !== '注销') {
              wx.showToast({ title: '请输入「注销」确认', icon: 'none' });
              return;
            }
            this.doCloseAccount();
          }
        });
      }
    });
  },

  doCloseAccount() {
    wx.showLoading({ title: '注销中', mask: true });
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'close_account' },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.ok) {
          this.resetAuthState();
          wx.showModal({
            title: '已注销',
            content: '账号已注销，个人信息已清空。感谢你的使用。',
            showCancel: false
          });
        } else {
          wx.showModal({
            title: '无法注销',
            content: (res.result && res.result.msg) || '注销失败,请稍后重试',
            showCancel: false
          });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  // 跳转协议: privacy→隐私政策, 其余→用户协议(agreement 页不再动态切换)
  toAgreement(e) {
    const type = e.currentTarget.dataset.type || 'user';
    const url = type === 'privacy'
      ? '/pages/privacy/privacy'
      : '/pages/agreement/agreement';
    wx.navigateTo({ url });
  },

  // 耍伴入口:已是耍伴进中心页,否则进申请页
  onPartnerTap() {
    const url = this.data.isPartner
      ? '/pages/partner-center/partner-center'
      : '/pages/partner-apply/partner-apply';
    wx.navigateTo({ url });
  },

  // ───────── 功能列表菜单 ─────────
  onMenuTap(e) {
    const action = e.currentTarget.dataset.action;
    switch (action) {
      case 'demands':
        // 我的需求: 复用订单 Tab, 预选「我发的单」(含待接单需求)
        app.globalData.orderTabRole = 'user';
        wx.switchTab({ url: '/pages/order/order' });
        break;
      case 'blog_my':
        wx.navigateTo({ url: '/pages/blog/blog?scope=my' });
        break;
      case 'partner':
        this.onPartnerTap();
        break;
      case 'contacts':
        // 滚动到本页紧急联系人编辑卡(rect.top 为视口相对坐标, 需叠加页面当前滚动偏移)
        wx.createSelectorQuery()
          .select('#contact-card').boundingClientRect()
          .selectViewport().scrollOffset()
          .exec((res) => {
            const rect = res && res[0];
            const view = res && res[1];
            if (rect && view) {
              wx.pageScrollTo({ scrollTop: view.scrollTop + rect.top - 20, duration: 200 });
            }
          });
        break;
      case 'agreement':
        this.toAgreement(e);
        break;
      case 'privacy':
        this.toAgreement(e);
        break;
      case 'service':
        wx.showModal({
          title: '联系客服',
          content: '当前为测试环境(MVP)，客服功能暂未开通。\n如有问题请发邮件至：\nsupport@zhaoren-mvp.test\n（正式版将提供在线客服）',
          showCancel: false,
          confirmText: '我知道了'
        });
        break;
    }
  },

  // ───────── 版本号 5 连击 → 管理口令(UI 与跳转; 鉴权阶段 5 实现) ─────────
  onVersionTap() {
    this.setData({ versionTaps: this.data.versionTaps + 1 });
    if (this.versionTapTimer) clearTimeout(this.versionTapTimer);
    this.versionTapTimer = setTimeout(() => this.setData({ versionTaps: 0 }), 3000);
    if (this.data.versionTaps >= 5) {
      this.setData({ versionTaps: 0 });
      wx.showModal({
        title: '管理员入口',
        editable: true,
        placeholderText: '请输入管理口令',
        confirmText: '进入',
        success: (r) => {
          if (!r.confirm) return;
          // 本版仅保留 UI 与跳转方法; 口令鉴权在阶段 5 接入 admin-action 校验
          wx.navigateTo({
            url: `/pages/admin/admin?token=${encodeURIComponent(r.content || '')}`
          });
        }
      });
    }
  }
});
