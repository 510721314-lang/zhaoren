// PRD章节: 3.5.1 费用与支付 / 3.7 保险
// P0-3: 接云端 payment-mock —— cashier_info(收银台摘要) + mock_pay(模拟支付,S0→S2)
// 红线: 金额一律"分"整数,前端只做展示换算; 支付资格/状态/幂等全部由后端裁决
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    order: null,
    scene: null,
    // 金额：分 → 元(仅展示)
    serviceFee: '0.00',    // 服务费 = 应付总额(保险0元平台承担,AA不入支付)
    insuranceFee: '0.00',  // 保险费 = 0（平台承担）
    aaFeeText: '线下自理',  // AA不进入支付
    totalFee: '0.00',       // 合计
    totalFen: 0,
    unitPriceYuan: '0.00',  // 单价(分/小时 → 元/小时)
    needAaPromise: false,   // 非 0-50 元档需勾选承诺书(后端强制)
    aaChecked: false,
    paying: false,
    loading: false,
    loadError: false,
    loadErrorMsg: '',
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    arriveDays: CONFIG.WITHDRAW.arriveDays
  },

  fetchData(options) {
    const orderId = (options && options.orderId) || this.__orderId || '';
    if (!/^[a-f0-9]{32}$/i.test(orderId)) {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '缺少有效订单 ID,请从正确入口进入' });
      return;
    }
    this.__orderId = orderId;
    this.setData({ loading: true, loadError: false });
    callCloud('payment-mock', { action: 'cashier_info', order_id: orderId }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true, loadErrorMsg: r.msg || '加载失败' });
        return;
      }
      const d = r.data;
      const st = Number(d.start_time) || 0;
      const dt = st ? new Date(st) : null;
      const hours = d.duration_h || 1;
      const totalFen = d.total_fen || 0;
      this.setData({
        loading: false,
        order: {
          order_no: d.order_no,
          status: d.status,
          service_date: dt ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` : '',
          service_time: dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '',
          location: d.location || {},
          duration_hours: hours
        },
        scene: { code: d.scene_code },
        serviceFee: (totalFen / 100).toFixed(2),
        unitPriceYuan: (totalFen / hours / 100).toFixed(2),
        totalFee: (totalFen / 100).toFixed(2),
        totalFen: totalFen,
        needAaPromise: !!d.need_aa_promise,
        aaChecked: false
      });
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请重试' });
    });
  },

  onLoad(options) {
    this.fetchData(options);
  },

  reload() {
    this.fetchData({});
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  toggleAa() {
    this.setData({ aaChecked: !this.data.aaChecked });
  },

  onPay() {
    if (this.data.paying) return;
    const order = this.data.order;
    if (!order) return;
    if (order.status !== 'S0') {
      wx.showToast({ title: '订单当前状态不可支付', icon: 'none' });
      return;
    }
    if (this.data.needAaPromise && !this.data.aaChecked) {
      wx.showToast({ title: '请先勾选AA承诺书', icon: 'none' });
      return;
    }
    this.setData({ paying: true });
    wx.showLoading({ title: '支付中…', mask: true });
    callCloud('payment-mock', {
      action: 'mock_pay',
      order_id: this.__orderId,
      aa_promise_checked: !!this.data.aaChecked
    }).then((r) => {
      wx.hideLoading();
      if (!r.ok) {
        this.setData({ paying: false });
        wx.showModal({ title: '支付失败', content: r.msg || '请稍后重试', showCancel: false });
        return;
      }
      wx.showToast({ title: '支付成功·保险已生效', icon: 'success', duration: 1800 });
      // 返回聊天页(轮询会自动刷新出 S2 状态)
      setTimeout(() => { wx.navigateBack({ fail: () => {} }); }, 1500);
    }).catch(() => {
      wx.hideLoading();
      this.setData({ paying: false });
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  },

  openAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement', fail: () => wx.showToast({ title: '协议页待接入', icon: 'none' }) });
  }
});
