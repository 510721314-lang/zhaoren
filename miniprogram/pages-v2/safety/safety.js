// PRD章节: 3.6 安全报备 / V15 SAFETY配置 / 1.7.1 18-22岁保护
// P1: 接云端 order-action detail, 删 mock findOrder 依赖
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    order: null,
    redirect: false,
    // A1 报备状态
    checkinStartedAt: 0,
    elapsedSec: 0,
    // A3 打卡
    lastCheckin: '',
    nextCheckinSec: CONFIG.SAFETY.checkinMin * 60,
    // A4 一键求助（长按时长取 CONFIG.SAFETY.oneKeyPressSec）
    sosProgress: 0,            // 0-360 度
    sosLongPressing: false,
    sosActive: false,          // 已发出
    // A4 静默求助
    silentCountdownSec: 0,
    silentActive: false,
    // 撤销二次确认
    cancelConfirmVisible: false,
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    gpsPrecisionText: CONFIG.SAFETY.gpsPrecisionText,
    checkinMin: CONFIG.SAFETY.checkinMin,
    oneKeyPressSec: CONFIG.SAFETY.oneKeyPressSec,
    sosCountdownSec: CONFIG.SAFETY.sosCountdownSec
  },

  onLoad(options) {
    this.fetchData(options);
  },

  fetchData(options) {
    this.__orderId = (options && options.orderId) || '';
    this.__lastOptions = options || {};
    if (!/^[a-f0-9]{32}$/i.test(this.__orderId)) {
      this.setData({ loading: false, loadError: true });
      return;
    }
    this.setData({ loading: true, loadError: false });
    callCloud('order-action', { action: 'detail', order_id: this.__orderId }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true });
        return;
      }
      const d = r.data;
      const order = {
        _id: d.order_id,
        order_id: d.order_id,
        order_no: d.order_no,
        status: d.status,
        scene_code: d.scene,
        safety: {
          last_checkin: (d.safety && d.safety.checkins && d.safety.checkins[0])
            ? new Date(d.safety.checkins[0].created_at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
            : null
        }
      };
      if (order.status !== 'S3') {
        this.setData({ loading: false, order, redirect: true });
        wx.redirectTo({
          url: '/pages-v2/order-detail/order-detail?orderId=' + order._id,
          fail: () => wx.showToast({ title: '订单状态不允许安全报备', icon: 'none' })
        });
        return;
      }
      this.setData({
        order,
        redirect: false,
        checkinStartedAt: Date.now(),
        lastCheckin: order.safety.last_checkin || '--:--',
        loading: false
      });
      this.startTimers();
    }).catch(() => {
      this.setData({ loading: false, loadError: true });
    });
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onUnload() { this.clearTimers(); },
  onHide() { this.clearTimers(); },

  clearTimers() {
    if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
    if (this._checkinTimer) { clearInterval(this._checkinTimer); this._checkinTimer = null; }
    if (this._sosTimer) { clearInterval(this._sosTimer); this._sosTimer = null; }
    if (this._silentTimer) { clearInterval(this._silentTimer); this._silentTimer = null; }
  },

  startTimers() {
    // A1 已报备时长
    this._elapsedTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - this.data.checkinStartedAt) / 1000);
      this.setData({ elapsedSec: sec });
    }, 1000);

    // A3 下次打卡倒计时
    this._checkinTimer = setInterval(() => {
      let next = this.data.nextCheckinSec;
      if (next > 0) next--;
      this.setData({ nextCheckinSec: next });
    }, 1000);
  },

  // A3 手动打卡
  onManualCheckin() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    this.setData({
      lastCheckin: `${h}:${m}`,
      nextCheckinSec: CONFIG.SAFETY.checkinMin * 60
    });
    wx.showToast({ title: '打卡成功', icon: 'success' });
  },

  // A4 一键求助：长按
  onSosTouchStart() {
    if (this.data.sosActive) return;
    this.setData({ sosLongPressing: true, sosProgress: 0 });
    const duration = CONFIG.SAFETY.oneKeyPressSec * 1000; // 3秒
    const step = 30; // 30ms 间隔
    const stepDeg = (360 * step) / duration;
    let progress = 0;
    try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
    this._sosTimer = setInterval(() => {
      if (!this.data.sosLongPressing) {
        clearInterval(this._sosTimer);
        return;
      }
      progress += stepDeg;
      if (progress >= 360) {
        progress = 360;
        clearInterval(this._sosTimer);
        this.triggerSos();
        return;
      }
      this.setData({ sosProgress: progress });
      // 持续震动
      if (Math.floor(progress) % 60 === 0) {
        try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
      }
    }, step);
  },

  onSosTouchEnd() {
    if (this.data.sosActive) return;
    if (this.data.sosLongPressing && this.data.sosProgress < 360) {
      clearInterval(this._sosTimer);
      this.setData({ sosLongPressing: false, sosProgress: 0 });
      wx.showToast({ title: '已取消', icon: 'none' });
    }
  },

  triggerSos() {
    this.setData({ sosActive: true, sosLongPressing: false, sosProgress: 360 });
    try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
    wx.showToast({ title: '求助已发出', icon: 'none' });
  },

  // A4 静默求助
  onSilentStart() {
    if (this.data.silentActive || this.data.silentCountdownSec > 0) return;
    const total = CONFIG.SAFETY.sosCountdownSec; // 10秒
    this.setData({ silentCountdownSec: total });
    this._silentTimer = setInterval(() => {
      let s = this.data.silentCountdownSec - 1;
      if (s <= 0) {
        clearInterval(this._silentTimer);
        this.setData({ silentCountdownSec: 0, silentActive: true });
        this.triggerSos();
        return;
      }
      this.setData({ silentCountdownSec: s });
    }, 1000);
  },

  // 撤销静默求助
  onSilentCancel() {
    this.setData({ cancelConfirmVisible: true });
  },

  confirmCancelSilent() {
    clearInterval(this._silentTimer);
    this.setData({
      silentCountdownSec: 0,
      cancelConfirmVisible: false
    });
    wx.showToast({ title: '已撤销静默求助', icon: 'none' });
  },

  closeCancelConfirm() { this.setData({ cancelConfirmVisible: false }); },

  // 客服模拟解除
  onKefuResolve() {
    this.setData({ sosActive: false, silentActive: false });
    wx.showToast({ title: '客服已介入并解除', icon: 'none' });
  },

  noop() {}
});
