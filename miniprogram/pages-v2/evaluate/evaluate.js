// PRD章节: 3.5.5 评价 / 3.5.2 S5→S8 状态流转 / 18-22岁双向匿名
// P1: 接云端 order-action detail + evaluation-submit, 删 mock findOrder 依赖
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

function buildTagList(arr, selected) {
  return arr.map(function(t) {
    return { name: t, selected: selected.indexOf(t) > -1 };
  });
}

Page({
  data: {
    order: null,
    scene: null,
    stars: 0,
    goodTags: buildTagList(['准时到达', '服务专业', '态度热情', '值得推荐', '沟通顺畅'], []),
    midTags: buildTagList(['基本满意', '可再改进'], []),
    badTags: buildTagList(['迟到', '态度一般', '服务不佳', '不推荐'], []),
    selectedTags: [],
    content: '',
    contentCount: 0,
    countdownSec: CONFIG.ORDER.evalWindowH * 3600,
    countdownText: '',
    loading: false,
    loadError: false,
    loadErrorMsg: '',
    isRedline: false,
    evalTextMax: CONFIG.ORDER.evalTextMax,
    evalRewardYuan: CONFIG.ORDER.evalRewardYuan,
    submitting: false
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
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
      const d = r.data;
      const scene = SCENES.find((s) => s.code === d.scene) || null;
      const order = {
        _id: d.order_id,
        order_id: d.order_id,
        order_no: d.order_no,
        status: d.status,
        scene_code: d.scene,
        start_time: d.start_time,
        duration_hours: d.duration_h,
        amount_fen: d.total_fen
      };
      this.setData({ order, scene, loading: false });
      this.startCountdown();
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请重试' });
    });
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onUnload() { this.clearTimers(); },
  onHide() { this.clearTimers(); },

  clearTimers() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  startCountdown() {
    const update = () => {
      const s = this.data.countdownSec;
      if (s <= 0) {
        this.setData({ countdownText: '已超时' });
        this.clearTimers();
        return;
      }
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      this.setData({
        countdownText: `${h}时${m}分${sec}秒`,
        countdownSec: s - 1
      });
    };
    update();
    this._timer = setInterval(update, 1000);
  },

  onStarTap(e) {
    const star = Number(e.currentTarget.dataset.star);
    let autoSelected = [];
    if (star >= 4) autoSelected = [this.data.goodTags[0].name];
    else if (star === 3) autoSelected = [this.data.midTags[0].name];
    else autoSelected = [this.data.badTags[0].name];
    this.setData({
      stars: star,
      selectedTags: autoSelected,
      goodTags: buildTagList(['准时到达', '服务专业', '态度热情', '值得推荐', '沟通顺畅'], autoSelected),
      midTags: buildTagList(['基本满意', '可再改进'], autoSelected),
      badTags: buildTagList(['迟到', '态度一般', '服务不佳', '不推荐'], autoSelected)
    });
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    const selected = this.data.selectedTags.slice();
    const idx = selected.indexOf(tag);
    if (idx > -1) selected.splice(idx, 1);
    else selected.push(tag);
    this.setData({
      selectedTags: selected,
      goodTags: buildTagList(['准时到达', '服务专业', '态度热情', '值得推荐', '沟通顺畅'], selected),
      midTags: buildTagList(['基本满意', '可再改进'], selected),
      badTags: buildTagList(['迟到', '态度一般', '服务不佳', '不推荐'], selected)
    });
  },

  onContentInput(e) {
    const v = (e.detail.value || '').slice(0, CONFIG.ORDER.evalTextMax);
    this.setData({ content: v, contentCount: v.length });
  },

  onSubmit() {
    if (this.data.submitting) return;
    if (this.data.stars === 0) {
      wx.showToast({ title: '请选择星级', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中…', mask: true });
    callCloud('evaluation-submit', {
      action: 'submit',
      order_id: this.__orderId,
      star: this.data.stars,
      tags: this.data.selectedTags,
      content: this.data.content
    }).then((r) => {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (!r.ok) {
        wx.showModal({ title: '评价失败', content: r.msg || '请稍后重试', showCancel: false });
        return;
      }
      this.clearTimers();
      wx.showToast({ title: `评价成功！${CONFIG.ORDER.evalRewardYuan}元优惠券已到账`, icon: 'none', duration: 2000 });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages-v2/order-detail/order-detail?orderId=' + this.__orderId, fail: () => wx.navigateBack({ fail: () => {} }) });
      }, 1500);
    }).catch(() => {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
