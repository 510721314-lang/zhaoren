// PRD章节: 3.5 订单生命周期 / 3.5.2 13态状态机 / 3.5.3 改期 / 3.5.4 取消梯度退款 / 3.7 保险 / R1时间红线
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { SCENES, ORDER_STATUS } = require('../../config/enums.js');
const { findOrder } = require('../../mock/orders.js');

Page({
  data: {
    order: null,
    scene: null,
    statusInfo: null,
    countdownText: '',
    modifySheetVisible: false,
    cancelSheetVisible: false,
    modifyUsedUp: false,
    cancelTiers: CONFIG.CANCEL_REFUND,
    currentCancelIdx: 0,
    newModifyTime: '',
    timeMaxRange: '',
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: CONFIG.TIME_REDLINE.close,
    modifyRuleText: `规则：提前${CONFIG.MODIFY.minLeadHours}小时以上/最多${CONFIG.MODIFY.maxTimes}次/${CONFIG.MODIFY.freeFirst ? '首次免费/' : ''}第二次收${CONFIG.MODIFY.secondFeeRate * 100}%手续费/幅度≤${CONFIG.MODIFY.maxSpanH}小时`,
    s35ResponseMin: CONFIG.SAFETY.s35ResponseMin,
    modifyConfirmH: CONFIG.MODIFY.confirmHours,
    insuranceWan: '',
    afterSaleDays: CONFIG.ORDER.afterSaleDays
  },

  onLoad(options) {
    this.fetchData(options);
  },

  fetchData(options) {
    this.__lastOptions = options || {};
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        const order = findOrder(options.orderId) || findOrder('o_s3_003');
        if (!order) {
          this.setData({ loading: false, order: null });
          return;
        }
        this.refreshOrder(order);
        this.startCountdown();
        this.setData({ loading: false });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onUnload() { this.clearTimers(); },
  onHide() { this.clearTimers(); },

  refreshOrder(order) {
    const scene = SCENES.find((s) => s.code === order.scene_code);
    const statusInfo = ORDER_STATUS[order.status] || ORDER_STATUS.S1;
    const modifyUsedUp = (order.modify_count || 0) >= CONFIG.MODIFY.maxTimes;
    // 计算取消档位
    const serviceStart = new Date(`${order.service_date}T${order.service_time.split('-')[0]}:00`);
    const hoursLeft = (serviceStart - new Date()) / 3600000;
    let currentCancelIdx = 0;
    const [leadH1, leadH2] = CONFIG.CANCEL_LEAD_HOURS;
    if (hoursLeft > leadH1) currentCancelIdx = 0;
    else if (hoursLeft > leadH2) currentCancelIdx = 1;
    else currentCancelIdx = 2;
    this.setData({
      order,
      scene,
      statusInfo,
      modifyUsedUp,
      currentCancelIdx,
      amountYuan: ((order.amount_fen || 0) / 100).toFixed(2),
      insuranceWan: order.insurance && order.insurance.coverage ? (order.insurance.coverage / 10000) : '',
      timeMaxRange: this.fmtDate(new Date(Date.now() + CONFIG.MODIFY.maxSpanH * 3600000))
    });
  },

  clearTimers() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  startCountdown() {
    this.clearTimers();
    this._timer = setInterval(() => {
      const o = this.data.order;
      if (!o) return;
      // PRD 3.5.2：倒计时文案以 ORDER_STATUS.timeoutText 为唯一 SSOT
      const st = ORDER_STATUS[o.status];
      this.setData({ countdownText: st ? st.timeoutText : '' });
    }, 1000);
  },

  fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // O3 操作区
  onStartService() {
    const order = this.data.order;
    order.status = 'S3';
    order.started_at = new Date().toISOString();
    this.refreshOrder(order);
    wx.showToast({ title: '已开始履约', icon: 'success' });
  },

  onSafety() {
    wx.navigateTo({
      url: `/pages-v2/safety/safety?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '安全报备页待接入', icon: 'none' })
    });
  },

  onAddTime() { wx.showToast({ title: '加时申请功能建设中', icon: 'none' }); },

  onModify() {
    if (this.data.modifyUsedUp) {
      wx.showToast({ title: '修改次数已用完', icon: 'none' });
      return;
    }
    this.setData({ modifySheetVisible: true, newModifyTime: '' });
  },

  onModifyTimeChange(e) {
    const time = e.detail.value;
    // R1 校验：可服务区间以 CONFIG.TIME_REDLINE 为准
    if (!redline.isServiceTimeAllowed(time)) {
      wx.showToast({ title: `须满足时间红线${CONFIG.TIME_REDLINE.close}-${CONFIG.TIME_REDLINE.open}`, icon: 'none' });
      return;
    }
    this.setData({ newModifyTime: time });
  },

  confirmModify() {
    if (!this.data.newModifyTime) {
      wx.showToast({ title: '请选择新时间', icon: 'none' });
      return;
    }
    const order = this.data.order;
    order.modify_count = (order.modify_count || 0) + 1;
    order.service_time = this.data.newModifyTime;
    order.status = 'S2_5'; // 改期处理中
    this.setData({ modifySheetVisible: false });
    this.refreshOrder(order);
    wx.showToast({ title: '改期申请已提交', icon: 'success' });
  },

  closeModifySheet() { this.setData({ modifySheetVisible: false }); },

  onFinishService() {
    const order = this.data.order;
    order.status = 'S5';
    order.ended_at = new Date().toISOString();
    this.refreshOrder(order);
    wx.showToast({ title: `履约完成，${CONFIG.ORDER.evalWindowH}小时内可评价`, icon: 'success' });
    setTimeout(() => {
      wx.navigateTo({ url: `/pages-v2/evaluate/evaluate?orderId=${order._id}`, fail: () => {} });
    }, 1000);
  },

  // S3.5 履约中断（PRD 3.5.2 nextActions: resume / confirm）
  onResumeService() {
    const order = this.data.order;
    order.status = 'S3'; // resume：恢复履约
    this.refreshOrder(order);
    wx.showToast({ title: '已恢复履约', icon: 'success' });
  },
  onToPartial() {
    const order = this.data.order;
    order.status = 'S4'; // confirm：转部分完成裁定
    this.refreshOrder(order);
    wx.showToast({ title: '已转部分完成裁定', icon: 'none' });
  },

  // S4 比例确认
  onRatioConfirm() {
    const order = this.data.order;
    order.status = 'S5';
    this.refreshOrder(order);
    wx.showToast({ title: '比例已确认', icon: 'success' });
  },

  // S5 评价
  onEvaluate() {
    wx.navigateTo({
      url: `/pages-v2/evaluate/evaluate?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '评价页待接入', icon: 'none' })
    });
  },

  // S8 售后
  onComplaint() {
    const order = this.data.order;
    order.status = 'S10_5';
    this.refreshOrder(order);
    wx.showToast({ title: '已进入争议处理', icon: 'none' });
  },

  // O5 取消
  onCancel() {
    this.setData({ cancelSheetVisible: true });
  },
  closeCancelSheet() { this.setData({ cancelSheetVisible: false }); },

  confirmCancel() {
    const order = this.data.order;
    const tier = this.data.cancelTiers[this.data.currentCancelIdx];
    order.status = 'S7';
    order.refund_rate = tier.rate;
    this.setData({ cancelSheetVisible: false });
    this.refreshOrder(order);
    wx.showToast({ title: `已取消·退款${tier.label}`, icon: 'none', duration: 2000 });
    setTimeout(() => wx.navigateBack({ fail: () => {} }), 1500);
  },

  // 跳支付
  goPay() {
    wx.navigateTo({
      url: `/pages-v2/pay/pay?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '支付页待接入', icon: 'none' })
    });
  },

  // 跳聊天
  goChat() {
    wx.navigateTo({
      url: `/pages-v2/chat/chat?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '聊天页待接入', icon: 'none' })
    });
  }
});
