// PRD章节: 3.5 订单生命周期 / 3.5.2 13态状态机 / 3.5.3 改期 / 3.5.4 取消梯度退款 / 3.7 保险 / R1时间红线
// P0-4: 接云端 order-action detail, 删除 mock findOrder 依赖
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { SCENES, ORDER_STATUS, normalizeStatus } = require('../../config/enums.js');

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
    modifyPanelVisible: false,
    modifyUsedUp: false,
    cancelTiers: CONFIG.CANCEL_REFUND,
    currentCancelIdx: 0,
    modifyDate: '',
    modifyTime: '',
    modifyDateMin: '',
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
    // C1 改期在途申请(云端点号状态经 normalizeStatus 归一化为下划线)
    const pm = d.pending_modify || null;
    let pendingModify = null;
    if (pm && pm.new_start_time) {
      const pdt = new Date(pm.new_start_time);
      pendingModify = {
        new_date: `${pdt.getFullYear()}-${pad(pdt.getMonth() + 1)}-${pad(pdt.getDate())}`,
        new_time: `${pad(pdt.getHours())}:${pad(pdt.getMinutes())}`,
        by_role: pm.by_role || '',
        reason: pm.reason || '',
        expire_at: pm.expire_at || 0,
        // 仅对方(非发起人)显示同意/拒绝按钮
        can_respond: !!d.role && !!pm.by_role && d.role !== pm.by_role
      };
    }
    const order = {
      _id: d.order_id,
      order_id: d.order_id,
      order_no: d.order_no,
      status: normalizeStatus(d.status),
      my_role: d.role || '',
      modify_count: d.modify_count || 0,
      pending_modify: pendingModify,
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
    // 改期次数以 detail 返回的 modify_count 为准
    const modifyUsedUp = (d.modify_count || 0) >= CONFIG.MODIFY.maxTimes;
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
      modifyDateMin: this.fmtDate(new Date()),
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

  // O4 改期: 内联卡(原生 date/time picker) + showModal 二次确认, 替代 bottom-sheet
  onModify() {
    if (this.data.modifyUsedUp) {
      wx.showToast({ title: '修改次数已用完', icon: 'none' });
      return;
    }
    // 默认带出订单原服务日期与时间
    this.setData({
      modifyPanelVisible: true,
      modifyDate: this.data.order.service_date || '',
      modifyTime: this.data.order.service_time || ''
    });
  },

  closeModifyPanel() { this.setData({ modifyPanelVisible: false }); },

  onModifyDateChange(e) {
    this.setData({ modifyDate: e.detail.value });
  },

  onModifyTimeChange(e) {
    const time = e.detail.value;
    // R1 校验：可服务区间以 CONFIG.TIME_REDLINE 为准
    if (!redline.isServiceTimeAllowed(time)) {
      wx.showToast({ title: `须满足时间红线${CONFIG.TIME_REDLINE.close}-${CONFIG.TIME_REDLINE.open}`, icon: 'none' });
      return;
    }
    this.setData({ modifyTime: time });
  },

  // 组合 picker 的日期+时分 → 本地时间戳
  buildModifyTs() {
    const { modifyDate, modifyTime } = this.data;
    if (!modifyDate || !modifyTime) return 0;
    const dy = modifyDate.split('-').map(Number);
    const hm = modifyTime.split(':').map(Number);
    if (dy.length !== 3 || dy.some(isNaN) || hm.length !== 2 || hm.some(isNaN)) return 0;
    return new Date(dy[0], dy[1] - 1, dy[2], hm[0], hm[1], 0, 0).getTime();
  },

  submitModify() {
    const that = this;
    const { modifyDate, modifyTime } = this.data;
    if (!modifyDate || !modifyTime) {
      wx.showToast({ title: '请选择新的日期和时间', icon: 'none' });
      return;
    }
    const ts = this.buildModifyTs();
    if (!ts || isNaN(ts) || ts <= Date.now()) {
      wx.showToast({ title: '新时间无效', icon: 'none' });
      return;
    }
    if (ts - Date.now() < CONFIG.MODIFY.minLeadHours * 3600000) {
      wx.showToast({ title: `须提前${CONFIG.MODIFY.minLeadHours}小时申请改期`, icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认提交改期',
      content: `新服务时间：${modifyDate} ${modifyTime}\n提交后需耍伴${CONFIG.MODIFY.confirmHours}小时内确认`,
      confirmText: '确认',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        that.setData({ modifyPanelVisible: false });
        wx.showLoading({ title: '提交改期', mask: true });
        callCloud('order-action', {
          action: 'modify',
          order_id: that.data.order._id,
          new_start_time: ts,
          reason: ''
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '改期失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '改期申请已提交', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // S2_5 对方同意改期(云端校验仅非发起人可调)
  onModifyConfirm() {
    const that = this;
    const pm = this.data.order && this.data.order.pending_modify;
    wx.showModal({
      title: '同意改期',
      content: pm ? `确认将服务时间改为 ${pm.new_date} ${pm.new_time}？` : '确认同意本次改期？',
      confirmText: '同意',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'modify_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已同意改期', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // S2_5 对方拒绝改期 → 回原状态, 服务时间不变
  onModifyReject() {
    const that = this;
    wx.showModal({
      title: '拒绝改期',
      content: '拒绝后服务时间保持不变',
      confirmText: '拒绝',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'modify_reject', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已拒绝改期', icon: 'none' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

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
          // 刷新后由 WXML 根据 order.status===S5 渲染"去评价"按钮
          // partner 完成后不自动跳评价, 只有 user 视角进 S5 才能点评价
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // S3.5 履约中断（PRD 3.5.2 nextActions: resume / confirm）
  onResumeService() {
    const that = this;
    wx.showLoading({ title: '处理中', mask: true });
    callCloud('order-action', { action: 'resume_service', order_id: this.data.order._id }).then((r) => {
      wx.hideLoading();
      if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
      wx.showToast({ title: '已恢复履约', icon: 'success' });
      that.fetchData({ orderId: that.data.order._id });
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
  },
  onToPartial() {
    const that = this;
    wx.showModal({
      title: '确认转部分完成',
      content: '转部分完成后将按实际比例结算',
      confirmText: '确认',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'partial_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已转部分完成裁定', icon: 'none' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // S4 比例确认
  onRatioConfirm() {
    const that = this;
    wx.showModal({
      title: '确认费用比例',
      content: '确认后订单进入评价期',
      confirmText: '确认',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'ratio_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '比例已确认', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
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
    const that = this;
    wx.showModal({
      title: '发起争议',
      content: '争议将提交管理员仲裁',
      confirmText: '提交',
      editable: true,
      placeholderText: '请简要说明争议原因',
      success(res) {
        if (!res.confirm) return;
        const reason = (res.content || '').trim();
        wx.showLoading({ title: '提交中', mask: true });
        callCloud('order-action', {
          action: 'complaint',
          order_id: that.data.order._id,
          reason
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '提交失败', icon: 'none' }); return; }
          wx.showToast({ title: '已进入争议处理', icon: 'none' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // O5 取消(wx.showModal 展示梯度退款规则, 替代 bottom-sheet)
  onCancel() {
    const that = this;
    const tier = this.data.cancelTiers[this.data.currentCancelIdx];
    const ruleLines = this.data.cancelTiers.map((t) => `· ${t.label}：退款${t.rate * 100}%`).join('\n');
    wx.showModal({
      title: '取消订单',
      content: `退款规则：\n${ruleLines}\n\n当前适用：${tier.label}，退款${tier.rate * 100}%`,
      confirmText: '确认取消',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '取消中', mask: true });
        callCloud('order-action', {
          action: 'cancel',
          order_id: that.data.order._id,
          reason: tier ? `按${tier.label}梯度退款` : ''
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '取消失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: tier ? `已取消·退款${tier.label}` : '已取消', icon: 'none', duration: 2000 });
          setTimeout(() => wx.navigateBack({ fail: () => {} }), 1500);
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
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
