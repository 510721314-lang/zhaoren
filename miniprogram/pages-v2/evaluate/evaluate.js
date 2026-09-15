// PRD章节: 3.5.5 评价 / 3.5.2 S5→S8 状态流转 / 18-22岁双向匿名
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { SCENES } = require('../../config/enums.js');
const { findOrder } = require('../../mock/orders.js');

Page({
  data: {
    order: null,
    scene: null,
    stars: 0,
    // 快捷标签三组
    goodTags: ['准时到达', '服务专业', '态度热情', '值得推荐', '沟通顺畅'],
    midTags: ['基本满意', '可再改进'],
    badTags: ['迟到', '态度一般', '服务不佳', '不推荐'],
    selectedTags: [],
    content: '',
    contentCount: 0,
    countdownSec: CONFIG.ORDER.evalWindowH * 3600,
    countdownText: '',
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    evalTextMax: CONFIG.ORDER.evalTextMax,
    evalRewardYuan: CONFIG.ORDER.evalRewardYuan
  },

  onLoad(options) {
    this.fetchData(options);
  },

  fetchData(options) {
    this.__lastOptions = options || {};
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        const order = findOrder(options.orderId) || findOrder('o_s5_004');
        if (!order) {
          this.setData({ loading: false, order: null });
          return;
        }
        const scene = SCENES.find((s) => s.code === order.scene_code);
        this.setData({ order, scene, loading: false });
        this.startCountdown();
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

  // 星级选择
  onStarTap(e) {
    const star = Number(e.currentTarget.dataset.star);
    this.setData({ stars: star });
    // 自动建议标签
    let autoSelected = [];
    if (star >= 4) autoSelected = [this.data.goodTags[0]];
    else if (star === 3) autoSelected = [this.data.midTags[0]];
    else autoSelected = [this.data.badTags[0]];
    this.setData({ selectedTags: autoSelected });
  },

  // 标签切换
  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    const selected = this.data.selectedTags.slice();
    const idx = selected.indexOf(tag);
    if (idx > -1) selected.splice(idx, 1);
    else selected.push(tag);
    this.setData({ selectedTags: selected });
  },

  onContentInput(e) {
    const v = (e.detail.value || '').slice(0, CONFIG.ORDER.evalTextMax);
    this.setData({ content: v, contentCount: v.length });
  },

  onSubmit() {
    if (this.data.stars === 0) {
      wx.showToast({ title: '请选择星级', icon: 'none' });
      return;
    }
    // 更新订单 S5→S8
    const order = this.data.order;
    order.status = 'S8';
    order.evaluated = true;
    order.evaluation = {
      stars: this.data.stars,
      tags: this.data.selectedTags,
      content: this.data.content,
      at: new Date().toISOString()
    };
    this.clearTimers();
    wx.showToast({ title: `评价成功！${CONFIG.ORDER.evalRewardYuan}元优惠券已到账`, icon: 'none', duration: 2000 });
    setTimeout(() => {
      wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages-v2/order-detail/order-detail?orderId=' + order._id }) });
    }, 1500);
  }
});
