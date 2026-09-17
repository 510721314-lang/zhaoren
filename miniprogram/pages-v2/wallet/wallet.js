// PRD章节: 3.10 资金钱包 / 3.10.2 提现 / 3.10.3 极速提现 / 3.10.4 收益明细
// P2: 接云端 payment-mock balance_info + income_list, 删 mock 依赖
const CONFIG = require('../../config/index.js');
const { FUND_STATUS } = require('../../config/enums.js');
const redline = require('../../utils/redline.js');

const SCENE_NAMES = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    balanceYuan: '0.00',
    monthIncomeYuan: '0.00',
    splittingYuan: '0.00',
    // V3 四态 tab
    fundTabs: [
      { key: 'withdrawable', name: '可提现' },
      { key: 'splitting', name: '分账中' },
      { key: 'processing', name: '处理中' }
    ],
    fundActive: 'withdrawable',
    fundAmount: '0.00',
    fundAmountMap: { withdrawable: '0.00', splitting: '0.00', processing: '0.00' },
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
        const amtMap = {
          withdrawable: d.balanceYuan,
          splitting: d.splittingYuan,
          processing: ((b.processing_fen || 0) / 100).toFixed(2)
        };
        d.fundAmountMap = amtMap;
        d.fundAmount = amtMap[this.data.fundActive] || amtMap.withdrawable;
      }
      if (incR.ok) {
        d.incomeList = (incR.data.list || []).map((i) => ({
          order_no: i.order_no,
          scene: i.scene,
          scene_name: SCENE_NAMES[i.scene] || i.scene || '其他',
          status: i.status,
          netYuan: ((i.partner_income_fen || 0) / 100).toFixed(2),
          grossYuan: ((i.total_fen || 0) / 100).toFixed(2),
          feeYuan: ((i.fee_fen || 0) / 100).toFixed(2),
          commissionYuan: ((i.fee_fen || 0) / 100).toFixed(2),
          subsidyYuan: i.subsidy_fen ? (i.subsidy_fen / 100).toFixed(2) : null,
          is_welfare: !!i.is_welfare,
          partner_name: i.user_nickname || i.partner_name || '',
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

  // V3 四态 tab 切换
  onFundTabTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.fundActive) return;
    this.setData({ fundActive: key, fundAmount: (this.data.fundAmountMap || {})[key] || '0.00' });
  },

  // V5 提现弹窗
  openWithdraw() {
    this.setData({ withdrawSheetVisible: true, withdrawAmount: '', fastWithdraw: false });
  },
  closeWithdraw() { this.setData({ withdrawSheetVisible: false }); },
  onWithdrawAmountInput(e) { this.setData({ withdrawAmount: e.detail.value }); },
  onFastToggle(e) { this.setData({ fastWithdraw: e.detail.value }); },

  confirmWithdraw() {
    if (this._withdrawing) return;  // 提交锁: 防双击并发
    const amt = Number(this.data.withdrawAmount);
    const isFast = this.data.fastWithdraw;
    if (!amt || isNaN(amt)) {
      wx.showToast({ title: '请输入金额', icon: 'none' }); return;
    }
    if (amt < CONFIG.WITHDRAW.minAmount) {
      wx.showToast({ title: `单次最低${CONFIG.WITHDRAW.minAmount}元`, icon: 'none' }); return;
    }
    if (isFast && amt > CONFIG.WITHDRAW.fastPerOrderMax) {
      wx.showToast({ title: `极速提现单笔上限${CONFIG.WITHDRAW.fastPerOrderMax}元`, icon: 'none' }); return;
    }
    this._withdrawing = true;
    // 云端提现:普通 withdraw(T+1 在途) / fast_withdraw(T+0 即时到账),金额一律转分
    callCloud('payment-mock', {
      action: isFast ? 'fast_withdraw' : 'withdraw',
      amount_fen: Math.round(amt * 100)
    }).then((r) => {
      if (!r.ok) {
        wx.showToast({ title: r.msg || '提现失败', icon: 'none', duration: 2500 });
        return;
      }
      this.setData({ withdrawSheetVisible: false, withdrawAmount: '', fastWithdraw: false });
      wx.showToast({
        title: isFast ? '极速提现已到账' : `提现申请成功，T+${CONFIG.WITHDRAW.arriveDays}到账`,
        icon: 'success', duration: 2000
      });
      this.fetchData();
    }).catch(() => wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' }))
      .then(() => { this._withdrawing = false; });
  },

  onToolTap(e) {
    const name = e.currentTarget.dataset.name;
    wx.showToast({ title: `${name}功能建设中`, icon: 'none' });
  }
});
