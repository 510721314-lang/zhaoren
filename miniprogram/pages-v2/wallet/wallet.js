// PRD章节: 3.10 资金钱包 / 3.10.2 提现 / 3.10.3 极速提现 / 3.10.4 收益明细
// P2: 接云端 payment-mock balance_info + income_list, 删 mock 依赖
const CONFIG = require('../../config/index.js');
const { FUND_STATUS } = require('../../config/enums.js');
const redline = require('../../utils/redline.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    balanceYuan: '0.00',
    monthIncomeYuan: '0.00',
    splittingYuan: '0.00',
    // V2 极速提现进度
    fastUsed: 0,
    fastMax: CONFIG.WITHDRAW.fastOrders,
    fastProgress: 0,
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
    fastArriveDays: CONFIG.WITHDRAW.fastArriveDays,
    arriveDays: CONFIG.WITHDRAW.arriveDays
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
      callCloud('payment-mock', { action: 'income_list' })
    ]).then(([balR, incR]) => {
      const d = {};
      if (balR.ok) {
        const b = balR.data;
        d.balanceYuan = ((b.withdrawable_fen || 0) / 100).toFixed(2);
        d.monthIncomeYuan = ((b.month_income_fen || 0) / 100).toFixed(2);
        d.splittingYuan = ((b.splitting_fen || 0) / 100).toFixed(2);
      }
      if (incR.ok) {
        d.incomeList = (incR.data.list || []).map((i) => ({
          order_no: i.order_no,
          scene: i.scene,
          status: i.status,
          netYuan: ((i.partner_income_fen || 0) / 100).toFixed(2),
          grossYuan: ((i.total_fen || 0) / 100).toFixed(2),
          feeYuan: ((i.fee_fen || 0) / 100).toFixed(2),
          created_at: i.created_at,
          service_completed_at: i.service_completed_at
        }));
      }
      this.setData(Object.assign(d, { loading: false }));
    }).catch(() => {
      this.setData({ loading: false, loadError: true });
    });
  },

  reload() { this.fetchData(); },

  // V5 提现弹窗
  openWithdraw() {
    this.setData({ withdrawSheetVisible: true, withdrawAmount: '', fastWithdraw: false });
  },
  closeWithdraw() { this.setData({ withdrawSheetVisible: false }); },
  onWithdrawAmountInput(e) { this.setData({ withdrawAmount: e.detail.value }); },
  onFastToggle(e) { this.setData({ fastWithdraw: e.detail.value }); },

  confirmWithdraw() {
    const amt = Number(this.data.withdrawAmount);
    if (!amt || isNaN(amt)) {
      wx.showToast({ title: '请输入金额', icon: 'none' }); return;
    }
    if (amt < CONFIG.WITHDRAW.minAmount) {
      wx.showToast({ title: `单次最低${CONFIG.WITHDRAW.minAmount}元`, icon: 'none' }); return;
    }
    if (this.data.fastWithdraw && amt > CONFIG.WITHDRAW.fastPerOrderMax) {
      wx.showToast({ title: `极速提现单笔上限${CONFIG.WITHDRAW.fastPerOrderMax}元`, icon: 'none' }); return;
    }
    this.setData({ withdrawSheetVisible: false });
    wx.showToast({ title: `提现申请成功，T+${CONFIG.WITHDRAW.arriveDays}到账`, icon: 'success', duration: 2000 });
  },

  onToolTap(e) {
    const name = e.currentTarget.dataset.name;
    wx.showToast({ title: `${name}功能建设中`, icon: 'none' });
  }
});
