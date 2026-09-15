// PRD章节: 3.1.1 登录授权 / 1.6.1 用户类型分流 / R5 年龄红线
// mock 流程：微信授权 → 手机号验证 → 实名/人脸 → 年龄校验(≥18) → 紧急联系人引导 → 个人/机构分流 → 首页
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { CURRENT_USER } = require('../../mock/users.js');

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
    rejected: false,        // R5 年龄不足拒绝页
    rejectReason: '',
    mockUser: CURRENT_USER,
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
      // 人脸信息处理声明（本期弹窗展示摘要）
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

    // 步骤1：手机号验证（mock）
    wx.showLoading({ title: '手机号验证中…', mask: true });
    setTimeout(() => {
      wx.hideLoading();
      // 步骤2：身份证OCR + 人脸核验（mock）
      wx.showLoading({ title: '实名人脸核验中…', mask: true });
      setTimeout(() => {
        wx.hideLoading();
        this.afterVerified();
      }, 700);
    }, 700);
  },

  afterVerified() {
    const user = this.data.mockUser;
    // R5：年龄校验
    if (!redline.isAdult(user.age)) {
      this.setData({
        logging: false,
        rejected: true,
        rejectReason: `您的年龄为${user.age}周岁，本平台仅向${CONFIG.ADULT_AGE}周岁及以上用户提供服务`
      });
      return;
    }

    // 长者保护：打卡频率提升（阈值/频率均取 CONFIG.ELDERLY）
    if (Number(user.age) >= CONFIG.ELDERLY.age) {
      wx.showToast({ title: `长者保护已启用·安全打卡${CONFIG.ELDERLY.checkinMin}分钟/次`, icon: 'none', duration: 2500 });
    }

    // 紧急联系人引导（存在未确认联系人时）
    const unconfirmed = (user.emergency_contacts || []).find((c) => !c.verified);
    const continueFlow = () => {
      wx.setStorageSync('v2_mock_login', true);
      this.askUserType();
    };
    if (unconfirmed) {
      wx.showModal({
        title: '紧急联系人待确认',
        content: `您的紧急联系人「${unconfirmed.name}」尚未完成确认，确认后才能在求助场景中及时通知TA。`,
        confirmText: '去确认',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) {
            wx.showToast({ title: '紧急联系人设置页待接入', icon: 'none' });
          }
          continueFlow();
        }
      });
    } else {
      continueFlow();
    }
  },

  // L5 用户类型分流
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
      fail: () => {
        this.setData({ logging: false });
      }
    });
  },

  backReject() {
    this.setData({ rejected: false, logging: false });
  }
});
