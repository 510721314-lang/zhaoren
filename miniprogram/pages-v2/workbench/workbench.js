// PRD章节: 2.4 耍伴工作台 / 3.10 资金 / 3.1 信用 / 3.6 安全
const CONFIG = require('../../config/index.js');
const { SCENES, FUND_STATUS } = require('../../config/enums.js');
const { CURRENT_USER } = require('../../mock/users.js');
const { orders } = require('../../mock/orders.js');
const { incomes, summarize } = require('../../mock/incomes.js');
const redline = require('../../utils/redline.js');

Page({
  data: {
    user: CURRENT_USER,
    // W1 接单开关
    acceptingOrders: true,
    todaySummary: { count: 2, upcoming: '14:00 华西医院陪诊' },
    // W2 数据卡
    todayCount: 1,
    weekIncomeYuan: '0.00',
    creditLevel: 'L2',
    // W3 周日历
    weekDays: [],
    todayOrders: [],
    // W4 资金四态
    fundTabs: [
      { key: 'splitting', name: '分账中' },
      { key: 'withdrawable', name: '可提现' },
      { key: 'processing', name: '提现处理中' },
      { key: 'arrived', name: '已到账' }
    ],
    fundActive: 'withdrawable',
    fundAmount: '0.00',
    // W6 待办
    pendingOrders: [],
    // W5 一键报警
    alarmConfirmVisible: false,
    // 三态UI
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    confirmTimeoutMin: CONFIG.ORDER.confirmTimeoutMin
  },

  onLoad() {
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  fetchData() {
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        this.computeData();
        this.setData({ loading: false });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  reload() { this.fetchData(); },

  computeData() {
    // 周日历
    const today = new Date();
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
      const wd = ['日','一','二','三','四','五','六'][d.getDay()];
      // mock：今日有单
      const hasOrder = i === 0;
      weekDays.push({ dateStr, wd, hasOrder, isToday: i === 0 });
    }
    // 今日订单时间轴
    const todayOrders = orders.filter((o) => o.status === 'S3' || o.status === 'S2').slice(0, 3).map((o) => {
      const scene = SCENES.find((s) => s.code === o.scene_code);
      return {
        _id: o._id,
        time: o.service_time,
        sceneName: scene ? scene.name : '',
        sceneColor: scene ? scene.color : '',
        partnerName: o.partner_name,
        locationName: o.location.name,
        status: o.status
      };
    });
    // 资金四态
    const sum = summarize();
    const fund = sum[this.data.fundActive] || 0;
    // 待办：S1订单
    const pendingOrders = orders.filter((o) => o.status === 'S1');
    // 周收入（已到账）
    const weekIncomeFen = sum.arrived;
    this.setData({
      weekDays,
      todayOrders,
      fundAmount: (fund / 100).toFixed(2),
      pendingOrders,
      todayCount: todayOrders.length,
      weekIncomeYuan: (weekIncomeFen / 100).toFixed(2)
    });
  },

  // W1 接单开关
  onToggleAccepting(e) {
    this.setData({ acceptingOrders: e.detail.value });
    wx.showToast({ title: e.detail.value ? '已开始接单' : '已暂停接单', icon: 'none' });
  },

  // W3 周日历点击
  onWeekDayTap() { /* mock：仅显示当日 */ },

  // 联系用户
  onContactUser(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages-v2/chat/chat?orderId=${id}`, fail: () => wx.showToast({ title: '聊天页待接入', icon: 'none' }) });
  },

  // 一键导航
  onNavigate(e) {
    wx.showToast({ title: '地图导航功能建设中', icon: 'none' });
  },

  // W4 资金tab
  onFundTabTap(e) {
    const key = e.currentTarget.dataset.key;
    const sum = summarize();
    this.setData({ fundActive: key, fundAmount: ((sum[key] || 0) / 100).toFixed(2) });
  },

  // 跳钱包
  goWallet() {
    wx.navigateTo({ url: '/pages-v2/wallet/wallet', fail: () => wx.showToast({ title: '钱包页待接入', icon: 'none' }) });
  },

  // W5 一键报警
  onAlarm() {
    this.setData({ alarmConfirmVisible: true });
  },
  closeAlarmConfirm() { this.setData({ alarmConfirmVisible: false }); },
  confirmAlarm() {
    this.setData({ alarmConfirmVisible: false });
    wx.showToast({ title: '已模拟拨打110并通知平台客服', icon: 'none', duration: 2000 });
  },

  // W6 待办
  onConfirmOrder(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages-v2/order-detail/order-detail?orderId=${id}`, fail: () => {} });
  },
  onRejectOrder(e) {
    wx.showToast({ title: '已拒绝', icon: 'none' });
  }
});
