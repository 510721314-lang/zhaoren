// PRD章节: 3.5.1 费用与支付 / 3.7 保险
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { findOrder } = require('../../mock/orders.js');

Page({
  data: {
    order: null,
    scene: null,
    // 金额：分 → 元
    serviceFee: '0.00',    // 服务费 = 单价 × 时长
    insuranceFee: '0.00',   // 保险费 = 0（平台承担）
    aaFeeText: '线下自理',  // AA不进入支付
    totalFee: '0.00',       // 合计 = 服务费
    totalFen: 0,
    paying: false,
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    arriveDays: CONFIG.WITHDRAW.arriveDays
  },

  fetchData(options) {
    this.setData({ loading: true, loadError: false });
    this.__lastOptions = options;
    setTimeout(() => {
      try {
        // 原 onLoad 逻辑
        const order = findOrder(options.orderId) || findOrder('o_s1_001');
        if (!order) {
          this.setData({ loading: false, order: null });
          return;
        }
        const scene = SCENES.find((s) => s.code === order.scene_code);
        // 金额计算（分单位，避免浮点）
        const unitFen = order.unit_price_fen || 0;
        const hours = order.duration_hours || 0;
        const serviceFen = unitFen * hours;
        const totalFen = serviceFen; // 保险0元，AA不入支付
        this.setData({
          order,
          scene,
          unitPriceYuan: (unitFen / 100).toFixed(2),
          serviceFee: (serviceFen / 100).toFixed(2),
          insuranceFee: '0.00',
          totalFee: (totalFen / 100).toFixed(2),
          totalFen: totalFen,
          loading: false
        });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  onLoad(options) {
    this.fetchData(options);
  },

  reload() {
    this.fetchData(this.__lastOptions || {});
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onPay() {
    if (this.data.paying) return;
    this.setData({ paying: true });
    // 模拟支付（1秒loading → 成功）
    wx.showLoading({ title: '支付中…', mask: true });
    setTimeout(() => {
      wx.hideLoading();
      this.setData({ paying: false });
      // 更新订单状态 S1→S2
      const order = this.data.order;
      order.status = 'S2';
      order.paid_at = new Date().toISOString();
      order.insurance = { policy_no: 'PI' + Date.now(), coverage: CONFIG.INSURANCE.accidentCoverage, status: 'insured' };
      wx.showToast({ title: '支付成功·保险已生效📋', icon: 'success', duration: 2000 });
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages-v2/order-detail/order-detail?orderId=${order._id}`,
          fail: () => wx.showToast({ title: '订单详情将在批次3上线', icon: 'none' })
        });
      }, 1200);
    }, 1000);
  },

  openAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement', fail: () => wx.showToast({ title: '协议页待接入', icon: 'none' }) });
  }
});
