// PRD章节: 3.5 订单生命周期 / 3.5.2 13态状态机 / 3.5.3 改期 / 3.5.4 取消梯度退款 / 3.7 保险 / R1时间红线
// P0-4: 接云端 order-action detail, 删除 mock findOrder 依赖
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { SCENES, ORDER_STATUS } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

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
    loadErrorMsg: '',
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
    this.__orderId = (options && options.orderId) || '';
    this.__lastOptions = options || {};
    if (!/^[a-f0-9]{32}$/i.test(this.__orderId)) {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '缺少有效订单 ID' });
      return;
    }
    this.setData({ loading: true, loadError: false });
    callCloud('order-action', { action: 'detail', order_id: this.__orderId }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true, loadErrorMsg: r.msg || '加载失败' });
        return;
      }
      this.refreshOrder(r.data);
      this.setData({ loading: false });
      this.startCountdown();
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请重试' });
    });
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (this.data.order && this.data.order.order_id) {
      this.fetchData({ orderId: this.data.order.order_id });
    }
  },

  onUnload() { this.clearTimers(); },
  onHide() { this.clearTimers(); },

  refreshOrder(d) {
    // detail 返回字段 → WXML 绑定字段
    const st = Number(d.start_time) || 0;
    const dt = st ? new Date(st) : null;
    // milestone: { current:0-3, confirmed:[bool,bool,bool], evidence:[...] }
    const ms = d.milestone || { current: 0, confirmed: [false, false, false], evidence: [] };
    const milestoneSteps = [
      { idx: 1, label: '30%', done: ms.current >= 1 },
      { idx: 2, label: '60%', done: ms.current >= 2 },
      { idx: 3, label: '100%', done: ms.current >= 3 }
    ];
    // 下一节点百分比: nextIdx 1→30%, 2→60%, 3→100%
    const nextPercent = ms.current >= 3 ? null : [30, 60, 100][ms.current];
    const order = {
      _id: d.order_id,
      order_id: d.order_id,
      order_no: d.order_no,
      status: d.status,
      scene_code: d.scene,
      partner_name: d.partner_nickname,
      location: d.location || {},
      service_date: dt ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` : '',
      service_time: dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '',
      duration_hours: d.duration_h || 0,
      amount_fen: d.total_fen || 0,
      insurance: null, // detail 暂未返回保险, 先隐藏保险卡
      confirm: d.confirm,
      evaluation: d.evaluation,
      pay_expire_at: d.pay_expire_at,
      milestone: ms,
      milestoneSteps,
      nextPercent,
      canFinishService: ms.current >= 3
    };
    const scene = SCENES.find((s) => s.code === d.scene) || null;
    const statusInfo = ORDER_STATUS[order.status] || ORDER_STATUS.S1;
    const modifyUsedUp = false; // detail 暂未返回 modify_count, 后续补
    // 取消档位: detail 返回 start_time, 按 CONFIG.CANCEL_LEAD_HOURS 计算
    const serviceStart = new Date(st);
    const hoursLeft = (serviceStart - new Date()) / 3600000;
    let currentCancelIdx = 0;
    const [leadH1, leadH2] = CONFIG.CANCEL_LEAD_HOURS || [24, 2];
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
    const that = this;
    wx.showModal({
      title: '确认开始履约',
      content: '开始履约后进入安全保障期',
      confirmText: '开始',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'start_service', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已开始履约', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  onSafety() {
    wx.navigateTo({
      url: `/pages-v2/safety/safety?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '安全报备页待接入', icon: 'none' })
    });
  },

  // 里程碑提交: 耍伴在 S3 履约中逐步提交 30%→60%→100%
  onMilestoneSubmit() {
    const order = this.data.order;
    const next = (order.milestone && order.milestone.current || 0) + 1;
    if (next > 3) {
      wx.showToast({ title: '已提交到100%', icon: 'none' });
      return;
    }
    const that = this;
    wx.showModal({
      title: `提交履约进度 ${next * 30}%`,
      content: '提交后用户会收到通知，双方可继续履约',
      confirmText: '提交',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中', mask: true });
        callCloud('order-action', {
          action: 'milestone_submit',
          order_id: that.data.order._id,
          note: ''
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '提交失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: `已提交${r.data.label}`, icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
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
    const that = this;
    wx.showModal({
      title: '确认履约完成',
      content: '完成后订单进入评价期',
      confirmText: '完成',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'complete_service', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: `履约完成，${CONFIG.ORDER.evalWindowH}小时内可评价`, icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
          setTimeout(() => {
            wx.navigateTo({ url: `/pages-v2/evaluate/evaluate?orderId=${that.data.order._id}`, fail: () => {} });
          }, 1000);
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
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
