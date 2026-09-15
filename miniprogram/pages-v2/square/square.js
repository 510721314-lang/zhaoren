// PRD章节: 2.2 广场广播 / 1.8.4 供需匹配 / 1.5 公益 / R1 夜间红线 / R9 场景认证
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { demands: ALL_DEMANDS } = require('../../mock/demands.js');
const { CURRENT_USER } = require('../../mock/users.js');

Page({
  data: {
    chips: [],
    activeChip: 'all',
    sorts: ['综合', '距离', '最新', '单价'],
    activeSort: 0,
    list: [],
    todayCount: 0,
    onlinePartners: 8,
    user: CURRENT_USER,
    certifiedScenes: CURRENT_USER.certified_scenes,
    grabbedIds: [],
    isRedline: false,
    sheetVisible: false,
    selectedDemand: null,
    selectedCertified: false,
    // C 可运营参数（供 WXML 绑定）
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: CONFIG.TIME_REDLINE.close,
    confirmTimeoutMin: CONFIG.ORDER.confirmTimeoutMin,
    matchExpandMin: CONFIG.MATCH.expandMin,
    reserveDiscountText: `${CONFIG.MATCH.reserveDiscount * 10}折`
  },

  onLoad() {
    const chips = [{ code: 'all', name: '全部' }]
      .concat(SCENES.map((s) => ({ code: s.code, name: s.name })))
      .concat([{ code: 'public_welfare', name: '💚 公益免费' }]);
    this.setData({ chips, todayCount: ALL_DEMANDS.length }, () => this.buildList());
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  onPullDownRefresh() {
    setTimeout(() => {
      this.buildList();
      wx.stopPullDownRefresh();
    }, 500);
  },

  onChipTap(e) {
    this.setData({ activeChip: e.currentTarget.dataset.code }, () => this.buildList());
  },

  onSortTap(e) {
    this.setData({ activeSort: Number(e.currentTarget.dataset.index) }, () => this.buildList());
  },

  buildList() {
    const { activeChip, activeSort, grabbedIds, certifiedScenes } = this.data;
    let list = ALL_DEMANDS.filter((d) => d.status === 'matching');
    if (activeChip === 'public_welfare') {
      list = list.filter((d) => d.project_attr === 'public_welfare');
    } else if (activeChip !== 'all') {
      list = list.filter((d) => d.scene_code === activeChip);
    }
    if (activeSort === 1) {
      list = list.slice().sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));
    } else if (activeSort === 2) {
      list = list.slice().sort((a, b) => (a.publisher.minutes_ago || 0) - (b.publisher.minutes_ago || 0));
    } else if (activeSort === 3) {
      list = list.slice().sort((a, b) => (a.budget || 0) - (b.budget || 0));
    }
    list = list.map((d) => Object.assign({}, d, {
      grabbed: grabbedIds.indexOf(d._id) > -1,
      certified: certifiedScenes.indexOf(d.scene_code) > -1
    }));
    this.setData({ list });
  },

  // R9：未认证灰态由 demand-card 渲染；点击时二次兜底提示
  onGrab(e) {
    const demand = e.detail.demand;
    if (this.data.isRedline) {
      wx.showToast({ title: `夜间${CONFIG.TIME_REDLINE.close}-${CONFIG.TIME_REDLINE.open}暂停抢单`, icon: 'none' });
      return;
    }
    const certified = this.data.certifiedScenes.indexOf(demand.scene_code) > -1;
    if (!certified) {
      const scene = redline.getScene(demand.scene_code);
      wx.showToast({ title: `需先完成${scene ? scene.cert : '场景认证'}`, icon: 'none' });
      return;
    }
    // 18-22岁青年保护：单笔金额（单价×时长）上限取 CONFIG.YOUTH.maxOrderAmount
    if (demand.project_attr === 'commercial') {
      const amount = Number(demand.budget) * Number(demand.duration_hours || 1);
      const youth = redline.validateYouthAmount(amount, this.data.user.age);
      if (!youth.ok) {
        wx.showToast({ title: youth.msg, icon: 'none' });
        return;
      }
    }
    this.setData({ sheetVisible: true, selectedDemand: demand, selectedCertified: certified });
  },

  closeSheet() {
    this.setData({ sheetVisible: false });
  },

  // mock 创建 S1 订单 → 进入四确认 IM
  confirmGrab() {
    const demand = this.data.selectedDemand;
    const grabbedIds = this.data.grabbedIds.concat([demand._id]);
    this.setData({ sheetVisible: false, grabbedIds }, () => this.buildList());
    wx.showToast({ title: '抢单成功，已创建待确认订单(S1)', icon: 'none', duration: 1800 });
    setTimeout(() => {
      wx.navigateTo({
        url: `/pages-v2/chat/chat?demandId=${demand._id}&mockStatus=S1`,
        fail: () => wx.showToast({ title: '聊天页将在批次2上线，已进入S1四确认', icon: 'none', duration: 2000 })
      });
    }, 700);
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
