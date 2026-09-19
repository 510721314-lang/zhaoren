// PRD章节: 2.2 广场广播 / 1.8.4 供需匹配 / 1.5 公益 / R1 夜间红线 / R9 场景认证
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { takeOrder } = require('../../utils/take-order.js');

Page({
  data: {
    chips: [],
    activeChip: 'all',
    sorts: ['综合', '距离', '最新', '单价'],
    activeSort: 0,
    list: [],
    rawList: [],       // 云端原始需求列表
    todayCount: 0,
    onlinePartners: 8,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: CONFIG.TIME_REDLINE.close,
    confirmTimeoutMin: CONFIG.ORDER.confirmTimeoutMin,
    matchExpandMin: CONFIG.MATCH.expandMin,
    reserveDiscountText: `${CONFIG.MATCH.reserveDiscount * 10}折`
  },

  onLoad() {
    // onLoad 已拉首屏, 首次 onShow 跳过避免双拉; 发布返回时 onShow 正常刷新
    this.__skipNextShow = true;
    const chips = [{ code: 'all', name: '全部' }]
      .concat(SCENES.map((s) => ({ code: s.code, name: s.name })))
      .concat([{ code: 'public_welfare', name: '💚 公益免费' }]);
    this.setData({ chips });
    this.fetchSquare();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    // 首次 onShow 跳过(onLoad 已拉); 发布返回/切回广场时刷新
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.fetchSquare();
  },

  onPullDownRefresh() {
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'square', limit: 50 },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          this.setData({ rawList: r.data.list || [] });
          this.buildList();
        }
        wx.stopPullDownRefresh();
      },
      fail: () => wx.stopPullDownRefresh()
    });
  },

  // 拉取云端需求广场
  fetchSquare() {
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'square', limit: 50 },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          const list = r.data.list || [];
          this.setData({
            rawList: list,
            todayCount: list.filter((d) => d.status === 'matching').length
          });
          this.buildList();
        }
      },
      fail: () => {}
    });
  },

  onChipTap(e) {
    this.setData({ activeChip: e.currentTarget.dataset.code }, () => this.buildList());
  },

  // S0 引导卡: 发布需求 / 切换耍伴身份
  onHeroPublish() {
    const gate = redline.checkEntryLocked();
    if (gate.locked) {
      wx.showToast({ title: gate.msg, icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages-v2/publish/publish',
      fail: () => wx.showToast({ title: '发布页打开失败', icon: 'none' })
    });
  },
  onSwitchPartner() {
    wx.switchTab({
      url: '/pages-v2/profile/profile',
      fail: () => wx.showToast({ title: '请在「我的」切换身份', icon: 'none' })
    });
  },

  onSortTap(e) {
    this.setData({ activeSort: Number(e.currentTarget.dataset.index) }, () => this.buildList());
  },

  buildList() {
    const { activeChip, activeSort, rawList } = this.data;
    let list = (rawList || []).filter((d) => d.status === 'matching');
    if (activeChip === 'public_welfare') {
      list = list.filter((d) => d.project_attr === 'public_welfare');
    } else if (activeChip !== 'all') {
      list = list.filter((d) => d.scene_code === activeChip);
    }
    if (activeSort === 1) {
      list = list.slice().sort((a, b) => (a.distance_km || 9999) - (b.distance_km || 9999));
    } else if (activeSort === 2) {
      list = list.slice().sort((a, b) => (a.publisher.minutes_ago || 0) - (b.publisher.minutes_ago || 0));
    } else if (activeSort === 3) {
      list = list.slice().sort((a, b) => (a.budget || 0) - (b.budget || 0));
    }
    this.setData({ list });
  },

  // 点击抢单 → 直接进接单链路: 免责声明 modal(同意并接单) → 定位 → 建单
  // 不用 bottom-sheet 二次确认(真机渲染不可靠)
  onGrab(e) {
    if (this.data.isRedline) {
      wx.showToast({ title: `夜间${CONFIG.TIME_REDLINE.close}-${CONFIG.TIME_REDLINE.open}暂停抢单`, icon: 'none' });
      return;
    }
    const demand = e.detail.demand;
    if (!demand) return;
    takeOrder(demand, {
      onSuccess: (data) => {
        wx.showToast({ title: '抢单成功,已进入待确认(S1)', icon: 'success', duration: 1500 });
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages-v2/chat/chat?orderId=${data.order_id}`,
            fail: () => wx.showToast({ title: '聊天页打开失败', icon: 'none' })
          });
        }, 700);
      },
      onError: (r) => {
        // 需求已被抢/过期 → 刷新广场同步状态
        if (r && (r.code === 'order_demand_closed' || r.code === 'order_demand_expired')) {
          this.fetchSquare();
        }
      }
    });
  },

  onCardTap(e) {
    wx.navigateTo({
      url: `/pages-v2/demand-detail/demand-detail?id=${e.detail.demand._id}`,
      fail: () => wx.showToast({ title: '需求详情将在批次2上线', icon: 'none' })
    });
  },

  onReserve() {
    wx.showToast({ title: `已为您预约${CONFIG.TIME_REDLINE.open}开服提醒`, icon: 'none' });
  }
});
