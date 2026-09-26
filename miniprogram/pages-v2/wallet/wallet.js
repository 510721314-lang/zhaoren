// PRD章节: 3.10 资金钱包 / 3.10.2 提现 / 3.10.3 极速提现 / 3.10.4 收益明细
// P2: 接云端 payment-mock balance_info + income_list, 删 mock 依赖
const CONFIG = require('../../config/index.js');
const { FUND_STATUS } = require('../../config/enums.js');
const redline = require('../../utils/redline.js');
const { getScene } = redline;

// scene code → 显示名: 优先全局动态场景(后台可增删, 含新增场景), 兜底 redline.getScene(硬编码 SCENES)
function sceneName(code) {
  const s = getScene(code);
  return (s && s.name) || code || '其他';
}

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

// 时间戳 → 可读文本(YYYY-MM-DD HH:mm)
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => n < 10 ? '0' + n : '' + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

Page({
  data: {
    balanceYuan: '0.00',
    monthIncomeYuan: '0.00',
    totalIncomeYuan: '0.00',
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
    // V6 提现记录
    withdrawList: [],
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
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad() {
    // onLoad 已拉首屏, 首次 onShow 跳过避免双拉; 支付/提现返回 onShow 正常刷新
    this.__skipNextShow = true;
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.fetchData();
  },

  fetchData() {
    this.setData({ loading: true, loadError: false });
    Promise.all([
      callCloud('payment-mock', { action: 'balance_info' }),
      callCloud('payment-mock', { action: 'income_list' }),
      callCloud('payment-mock', { action: 'withdraw_list', limit: 20 })
    ]).then(([balR, incR, wdR]) => {
      const d = {};
      if (balR.ok) {
        const b = balR.data;
        d.balanceYuan = ((b.withdrawable_fen || 0) / 100).toFixed(2);
        d.monthIncomeYuan = ((b.month_income_fen || 0) / 100).toFixed(2);
        d.totalIncomeYuan = ((b.total_income_fen || 0) / 100).toFixed(2);
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
          scene_name: sceneName(i.scene),
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
      if (wdR.ok) {
        d.withdrawList = (wdR.data.list || []).map((w) => {
          const arrived = w.status === 'success';
          return {
            withdraw_no: w.withdraw_no,
            type: w.type,
            amountYuan: ((w.amount_fen || 0) / 100).toFixed(2),
            status: w.status,
            statusText: arrived ? '已到账' : (w.status === 'processing' ? '处理中' : '其他'),
            arrived: arrived,
            typeText: w.type === 'fast' ? '极速提现' : '普通提现',
            created_text: fmtTime(w.created_at),
            arrived_text: fmtTime(w.arrived_at || w.expect_arrive_at)
          };
        });
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
  },
  onReserve() { require('../../utils/redline.js').reserveNotice(); }
});
