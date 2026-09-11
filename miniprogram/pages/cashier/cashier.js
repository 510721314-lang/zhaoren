// pages/cashier/cashier.js - 收银台(模拟支付 · 对应 PRD 3.5.1)
const { formatMoney } = require('../../utils/util.js');
const { AA_TIERS } = require('../../utils/constants.js');

// 档位值转中文文案(兼容旧数据直接存中文文案的情况)
function aaTierText(tier) {
  if (!tier) return '无';
  const hit = AA_TIERS.find((t) => t.value === tier);
  return hit ? hit.label : tier;
}

Page({
  data: {
    orderId: '',
    info: null,
    sceneName: '',
    startTimeText: '',
    durationText: '',
    contentText: '',
    locationName: '',
    aaTierText: '',
    totalText: '0.00',
    aaPromiseChecked: false,
    paying: false,
    loaded: false,
    paymentVisible: true
  },

  onShow() {
    // 读取审核开关: payment_visible=false 隐藏支付入口(被拒后可快速隐藏二次提审)
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'global_config' },
      success: (r) => {
        if (r.result && r.result.ok) {
          this.setData({ paymentVisible: r.result.data.payment_visible !== false });
        }
      }
    });
  },

  onLoad(opts) {
    if (!opts || !opts.order_id) {
      wx.showToast({ title: '缺少订单参数', icon: 'none' });
      return;
    }
    this.setData({ orderId: opts.order_id });
    this.loadInfo();
  },

  loadInfo() {
    wx.showLoading({ title: '加载中', mask: true });
    wx.cloud.callFunction({
      name: 'payment-mock',
      data: { action: 'cashier_info', order_id: this.data.orderId },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.ok) {
          const d = res.result.data;
          // 展示字段全部在 JS 预处理(WXML 不支持方法调用)
          this.setData({
            info: d,
            sceneName: d.scene_name,
            startTimeText: this.formatTime(d.start_time),
            durationText: d.duration_h + ' 小时',
            contentText: (d.content_options || []).join('、') || '无',
            locationName: (d.location && d.location.name) || '待确认',
            aaTierText: aaTierText(d.aa_tier),
            totalText: formatMoney(d.total_fen),
            loaded: true
          });
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '订单加载失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  onPromiseToggle() {
    this.setData({ aaPromiseChecked: !this.data.aaPromiseChecked });
  },

  // 模拟支付
  doPay() {
    const { info, aaPromiseChecked, orderId } = this.data;
    if (!info) return;
    if (info.need_aa_promise && !aaPromiseChecked) {
      wx.showToast({ title: '请先勾选《线下费用自理承诺书》', icon: 'none' });
      return;
    }
    this.setData({ paying: true });
    wx.showLoading({ title: '支付中', mask: true });
    wx.cloud.callFunction({
      name: 'payment-mock',
      data: {
        action: 'mock_pay',
        order_id: orderId,
        aa_promise_checked: aaPromiseChecked
      },
      success: (res) => {
        wx.hideLoading();
        this.setData({ paying: false });
        if (res.result && res.result.ok) {
          wx.showToast({ title: '模拟支付成功', icon: 'success' });
          setTimeout(() => {
            // 跳订单详情(详情页为占位页,后续模块完善)
            wx.redirectTo({ url: `/pages/order-detail/order-detail?order_id=${orderId}` });
          }, 1000);
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '支付失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ paying: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  }
});
