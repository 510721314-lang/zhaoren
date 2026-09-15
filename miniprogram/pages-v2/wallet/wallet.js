// PRD章节: 3.10 资金钱包 / 3.10.2 提现 / 3.10.3 极速提现 / 3.10.4 收益明细
const CONFIG = require('../../config/index.js');
const { FUND_STATUS } = require('../../config/enums.js');
const { CURRENT_USER } = require('../../mock/users.js');
const { incomes, summarize, balanceFen } = require('../../mock/incomes.js');
const redline = require('../../utils/redline.js');

Page({
  data: {
    user: CURRENT_USER,
    balanceYuan: '0.00',
    monthIncomeYuan: '0.00',
    totalIncomeYuan: '0.00',
    // V2 极速提现进度
    fastUsed: 0,
    fastMax: CONFIG.WITHDRAW.fastOrders,
    fastProgress: 0,
    // V3 四态tab
    fundTabs: [
      { key: 'splitting', name: '分账中' },
      { key: 'withdrawable', name: '可提现' },
      { key: 'processing', name: '提现处理中' },
      { key: 'arrived', name: '已到账' }
    ],
    fundActive: 'withdrawable',
    fundAmount: '0.00',
    // V4 收益明细
    incomeList: [],
    // V5 提现弹窗
    withdrawSheetVisible: false,
    withdrawAmount: '',
    fastWithdraw: false,
    bankTail: '8888',
    // 三态UI
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    fastArriveDays: CONFIG.WITHDRAW.fastArriveDays,
    arriveDays: CONFIG.WITHDRAW.arriveDays
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
    const sum = summarize();
    const balFen = balanceFen();
    // 本月/累计（mock：arrived为累计，本月=arrived）
    const totalArrived = sum.arrived;
    const fastUsed = CURRENT_USER.fast_withdraw_used || 0;
    this.setData({
      balanceYuan: (balFen / 100).toFixed(2),
      monthIncomeYuan: (totalArrived / 100).toFixed(2),
      totalIncomeYuan: (totalArrived / 100).toFixed(2),
      fastUsed,
      fastProgress: Math.min((fastUsed / CONFIG.WITHDRAW.fastOrders) * 100, 100),
      fundAmount: ((sum[this.data.fundActive] || 0) / 100).toFixed(2),
      incomeList: incomes.map((i) => Object.assign({}, i, {
        grossYuan: (i.gross_fen / 100).toFixed(2),
        commissionYuan: (i.commission_fen / 100).toFixed(2),
        netYuan: (i.net_fen / 100).toFixed(2),
        subsidyYuan: i.subsidy_fen ? (i.subsidy_fen / 100).toFixed(2) : ''
      }))
    });
  },

  // V3 四态tab
  onFundTabTap(e) {
    const key = e.currentTarget.dataset.key;
    const sum = summarize();
    this.setData({ fundActive: key, fundAmount: ((sum[key] || 0) / 100).toFixed(2) });
  },

  // V5 提现弹窗
  openWithdraw() {
    this.setData({ withdrawSheetVisible: true, withdrawAmount: '', fastWithdraw: false });
  },
  closeWithdraw() { this.setData({ withdrawSheetVisible: false }); },
  onWithdrawAmountInput(e) {
    this.setData({ withdrawAmount: e.detail.value });
  },
  onFastToggle(e) {
    this.setData({ fastWithdraw: e.detail.value });
  },

  confirmWithdraw() {
    const amt = Number(this.data.withdrawAmount);
    if (!amt || isNaN(amt)) {
      wx.showToast({ title: '请输入金额', icon: 'none' });
      return;
    }
    // 校验1：低于起提金额
    if (amt < CONFIG.WITHDRAW.minAmount) {
      wx.showToast({ title: `单次最低${CONFIG.WITHDRAW.minAmount}元`, icon: 'none' });
      return;
    }
    // 校验2：极速提现各额度（阈值取自 CONFIG.WITHDRAW）
    if (this.data.fastWithdraw) {
      const todayFast = amt; // mock：本次即累计
      if (todayFast > CONFIG.WITHDRAW.fastPerDayMax) {
        wx.showToast({ title: `单日极速提现上限${CONFIG.WITHDRAW.fastPerDayMax}元`, icon: 'none' });
        return;
      }
      if (amt > CONFIG.WITHDRAW.fastPerOrderMax) {
        wx.showToast({ title: `极速提现单笔上限${CONFIG.WITHDRAW.fastPerOrderMax}元`, icon: 'none' });
        return;
      }
      if (this.data.fastUsed >= CONFIG.WITHDRAW.fastOrders) {
        wx.showToast({ title: `极速提现次数已用完（前${CONFIG.WITHDRAW.fastOrders}单）`, icon: 'none' });
        return;
      }
    }
    this.setData({ withdrawSheetVisible: false });
    wx.showToast({ title: `提现申请成功，T+${CONFIG.WITHDRAW.arriveDays}到账`, icon: 'success', duration: 2000 });
  },

  // V6 工具行
  onToolTap(e) {
    const name = e.currentTarget.dataset.name;
    wx.showToast({ title: `${name}功能建设中`, icon: 'none' });
  }
});
