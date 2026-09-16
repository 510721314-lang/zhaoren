// PRD章节: 3.2.1 首页 / 3.2.3 耍伴推荐 / 1.8.1 新人福利 / 1.7 紧急联系人 / R1 夜间红线
// P1: 接云端 user-login peek_login, 删除 mock CURRENT_USER 依赖
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    statusBarHeight: 20,
    city: '成都',
    scenes: SCENES,
    activeTab: 'demand',
    demandList: [],
    partnerList: [],       // P2 接云端 partner-profile 列表
    user: {},
    unconfirmedContact: null,
    showEmergency: false,
    showWelfare: true,
    welfare: CONFIG.NEWBIE,
    isRedline: false,
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: CONFIG.TIME_REDLINE.close,
    trafficOrders: CONFIG.NEW_PARTNER.trafficSupportOrders,
    reserveDiscountText: `${CONFIG.MATCH.reserveDiscount * 10}折`
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
    this.fetchUser();
    this.fetchSquare();
  },

  fetchUser() {
    callCloud('user-login', { action: 'peek_login' }).then((r) => {
      if (r.ok && r.data && r.data.found && r.data.user) {
        this.setData({ user: r.data.user });
      }
    });
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 每次显示刷新广场(可能刚发布了新需求)
    this.fetchSquare();
  },

  // 拉取需求广场(云端 demand 集合)
  fetchSquare() {
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'square', limit: 20 },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          this.setData({ demandList: r.data.list || [] });
        }
      },
      fail: () => {
        // 静默失败, 保留上次数据
      }
    });
  },

  onPullDownRefresh() {
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'square', limit: 20 },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          this.setData({ demandList: r.data.list || [] });
        }
        wx.stopPullDownRefresh();
        wx.showToast({ title: '已刷新', icon: 'none' });
      },
      fail: () => {
        wx.stopPullDownRefresh();
      }
    });
  },

  // H1 城市切换（简化：action-sheet）
  onCityTap() {
    wx.showActionSheet({
      itemList: ['成都', '绵阳', '德阳'],
      success: (res) => {
        this.setData({ city: ['成都', '绵阳', '德阳'][res.tapIndex] });
      }
    });
  },
  onSearchTap() {
    wx.showToast({ title: '搜索页将在后续版本上线', icon: 'none' });
  },
  onBellTap() {
    wx.showToast({ title: '系统通知列表待接入', icon: 'none' });
  },

  // H3 紧急联系人
  onEmergencyConfirm() {
    wx.showToast({ title: '紧急联系人设置页待接入', icon: 'none' });
  },
  onEmergencyClose() {
    this.setData({ showEmergency: false });
  },

  // H4 场景宫格 → P06 预选场景
  onSceneTap(e) {
    const { code, more } = e.currentTarget.dataset;
    if (more) {
      wx.showToast({ title: '健身/情绪/宠物陪伴即将上线', icon: 'none' });
      return;
    }
    const gate = redline.checkEntryLocked();
    if (gate.locked) {
      wx.showToast({ title: gate.msg, icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/publish/publish?sceneCode=${code}`,
      fail: () => wx.showToast({ title: '发布页将在批次2上线（已预选' + (redline.getScene(code) || {}).name + '）', icon: 'none' })
    });
  },

  // H5 新人福利
  onWelfareReceive() {
    this.setData({ showWelfare: false });
    wx.showToast({ title: `领取成功，首单立减${CONFIG.NEWBIE.firstOrderDiscount}元`, icon: 'success' });
  },

  // H6 双Tab
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  // H7 卡片交互（跳详情页，带真实 demand _id）
  onDemandTap(e) {
    const demand = (e.detail && e.detail.demand) || {};
    const id = demand._id;
    if (!id) {
      wx.showToast({ title: '需求数据异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/demand-detail/demand-detail?id=${id}`,
      fail: () => wx.showToast({ title: '详情页打开失败', icon: 'none' })
    });
  },
  onPartnerTap() {
    wx.navigateTo({
      url: '/pages-v2/partner-detail/partner-detail',
      fail: () => wx.showToast({ title: '耍伴详情将在批次2上线', icon: 'none' })
    });
  },

  onReserve() {
    wx.showToast({ title: `已为您预约${CONFIG.TIME_REDLINE.open}开服提醒`, icon: 'none' });
  }
});
