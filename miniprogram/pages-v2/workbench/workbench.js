// PRD章节: 2.4 耍伴工作台 / 3.10 资金 / 3.1 信用 / 3.6 安全
// P2: 接云端 payment-mock balance_info + income_list, 删 mock 依赖
const CONFIG = require('../../config/index.js');
const { SCENES, FUND_STATUS } = require('../../config/enums.js');
const redline = require('../../utils/redline.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    acceptingOrders: true,
    todaySummary: { count: 0, upcoming: '' },
    todayCount: 0,
    weekIncomeYuan: '0.00',
    creditLevel: 'L2',
    weekDays: [],
    todayOrders: [],
    fundAmount: '0.00',
    incomeList: [],
    pendingOrders: [],
    alarmConfirmVisible: false,
    loading: false,
    loadError: false,
    isRedline: false,
    confirmTimeoutMin: CONFIG.ORDER.confirmTimeoutMin
  },

  onLoad() { this.fetchData(); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    this.fetchData();
  },

  fetchData() {
    this.setData({ loading: true, loadError: false });
    Promise.all([
      callCloud('payment-mock', { action: 'balance_info' }),
      callCloud('payment-mock', { action: 'income_list', limit: 10 })
    ]).then(([balR, incR]) => {
      const d = {};
      if (balR.ok) {
        const b = balR.data;
        d.fundAmount = ((b.withdrawable_fen || 0) / 100).toFixed(2);
        d.weekIncomeYuan = ((b.month_income_fen || 0) / 100).toFixed(2);
        d.todayCount = b.total_completed || 0;
        d.creditLevel = 'L2'; // mock: 待接 partner-profile
      }
      if (incR.ok) {
        d.incomeList = (incR.data.list || []).slice(0, 5).map((i) => ({
          order_no: i.order_no,
          scene: i.scene,
          status: i.status,
          netYuan: ((i.partner_income_fen || 0) / 100).toFixed(2),
          created_at: i.created_at
        }));
      }
      d.todaySummary = {
        count: d.todayCount,
        upcoming: d.incomeList && d.incomeList.length ? `${d.incomeList[0].scene || ''} 待处理` : '暂无进行中订单'
      };
      // 周日历 (静态占位, 后续接真实排期)
      const today = new Date();
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const dt = new Date(today.getTime() + i * 86400000);
        weekDays.push({ day: dt.getDate(), isToday: i === 0, hasOrder: false });
      }
      d.weekDays = weekDays;
      this.setData(Object.assign(d, { loading: false }));
    }).catch(() => {
      this.setData({ loading: false, loadError: true });
    });
  },

  reload() { this.fetchData(); },

  onAcceptToggle(e) {
    this.setData({ acceptingOrders: !this.data.acceptingOrders });
    wx.showToast({ title: this.data.acceptingOrders ? '已开启接单' : '已暂停接单', icon: 'success' });
  },

  onAlarmTap() { this.setData({ alarmConfirmVisible: true }); },
  closeAlarm() { this.setData({ alarmConfirmVisible: false }); },
  confirmAlarm() {
    this.setData({ alarmConfirmVisible: false });
    wx.showToast({ title: '已通知客服介入', icon: 'success' });
  }
});
