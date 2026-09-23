// PRD章节: 2.2 广场广播 / 1.8.4 供需匹配 / 1.5 公益 / R1 夜间红线 / R9 场景认证
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { takeOrder } = require('../../utils/take-order.js');

Page({
  data: {
    loading: true,
    banners: [],     // 活动 banner 列表 (home_action_list 返回)
    cards: [],       // 活动卡片列表
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
  onShareAppMessage() {
    return {
      title: '找个人帮忙 · 需求广场',
      path: '/pages-v2/square/square'
    };
  },


  onLoad() {
    // onLoad 已拉首屏, 首次 onShow 跳过避免双拉; 发布返回时 onShow 正常刷新
    this.__skipNextShow = true;
    this.setData({ chips: this.buildChips() });
    this.fetchSquare();
    this.fetchActivities();
  },

  // 场景 chips: 优先全局动态场景(首页/发布页/接单配置同步, 后台可增删), 兜底 enums SCENES
  buildChips() {
    let list = null;
    try {
      const app = getApp();
      const dyn = app && app.globalData && app.globalData.availableScenes;
      if (Array.isArray(dyn) && dyn.length) list = dyn;
    } catch (e) {}
    if (!list) list = SCENES;
    return [{ code: 'all', name: '全部' }]
      .concat(list.map((s) => ({ code: s.code, name: s.name })))
      .concat([{ code: 'public_welfare', name: '💚 公益免费' }]);
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline(), chips: this.buildChips() });
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
      fail: () => {},
      complete: () => { this.setData({ loading: false }); }
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
    // 实名门禁: 未实名 -> 弹「去实名」(动态加载避免冷启动时序)
    try {
      const { requireRealname } = require('../../utils/bootstrap.js');
      if (!requireRealname('发布需求')) return;
    } catch (e) {}
    wx.navigateTo({
      url: '/pages-v2/publish/publish',
      fail: () => wx.showToast({ title: '发布页打开失败', icon: 'none' })
    });
  },

  // ───────── 活动 banner / 卡片 ─────────
  fetchActivities() {
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'home_activity_list' },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          this.setData({
            banners: r.data.banners || [],
            cards: r.data.cards || []
          });
        }
      },
      fail: () => { /* 活动拉取失败静默降级, 首页仍可用 */ }
    });
  },

  onActivityTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const act = (this.data.banners[idx] || this.data.cards[idx]);
    if (!act) return;
    const p = act.jump_param || {};
    switch (act.jump_to) {
      case 'demand_publish': {
        const url = '/pages-v2/publish/publish' + (p.scene ? '?scene=' + p.scene : '');
        wx.navigateTo({ url });
        break;
      }
      case 'scene_list': {
        const url = '/pages-v2/square/square' + (p.scene_code ? '?scene_code=' + p.scene_code : '');
        wx.redirectTo({ url });
        break;
      }
      case 'webview': {
        if (!p.url) return;
        wx.navigateTo({ url: '/pages-v2/webview/webview?url=' + encodeURIComponent(p.url),
          fail: () => wx.showToast({ title: '链接打开失败', icon: 'none' }) });
        break;
      }
      case 'activity_detail':
      default: {
        wx.showToast({ title: '活动详情即将上线', icon: 'none' });
      }
    }
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
      wx.showToast({ title: `夜间${redline.DISPLAY_CLOSE}-${CONFIG.TIME_REDLINE.open}暂停抢单`, icon: 'none' });
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
