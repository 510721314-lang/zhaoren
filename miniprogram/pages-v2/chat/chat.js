// PRD章节: 3.4 IM聊天 / 3.4.1.1 模板消息四确认 / 3.4.2 限制规则 / 3.4.4 消息留存
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { findOrder } = require('../../mock/orders.js');
const { SCENES, TM_TEMPLATES, CONFIRM_ITEMS } = require('../../config/enums.js');

Page({
  data: {
    statusBarHeight: 20,
    order: null,
    scene: null,
    counterpart: '',
    messages: [],
    progress: { time: false, location: false, content: false, fee: false },
    confirmedCount: 0,
    unlocked: false,   // 四确认4/4后解锁
    // C5 模板快捷键
    quickKeys: [
      { id: 'TM1', icon: '🕐', name: '时间' },
      { id: 'TM2', icon: '📍', name: '地点' },
      { id: 'TM3', icon: '📋', name: '内容' },
      { id: 'TM4', icon: '💰', name: '费用' },
      { id: 'TM5', icon: '✨', name: '其他' }
    ],
    otherUsedCount: 0,
    // C6 输入
    inputText: '',
    // C5 「其他」弹窗
    otherSheetVisible: false,
    otherText: '',
    otherCount: 0,
    // 客服介入弹窗
    kefuSheetVisible: false,
    // 滚动锚点
    scrollToView: '',
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    otherLimit: TM_TEMPLATES.TM5.otherLimit,
    kefuResponseMin: CONFIG.IM.kefuResponseMin
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
    this.fetchData(options);
  },

  fetchData(options) {
    this.__lastOptions = options || {};
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        const order = findOrder(options.orderId || 'o_s1_001') || findOrder('o_s1_001');
        if (!order) {
          this.setData({ loading: false, order: null });
          return;
        }
        const scene = SCENES.find((s) => s.code === order.scene_code);
        this.setData({
          order,
          scene,
          counterpart: order.partner_name,
          messages: (order.messages || []).map((m) => Object.assign({}, m)),
          progress: Object.assign({}, order.confirm_progress),
          loading: false
        }, () => {
          this.updateConfirmedCount();
          this.scrollBottom();
        });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  // ── C2 进度 ──
  updateConfirmedCount() {
    const p = this.data.progress;
    const count = [p.time, p.location, p.content, p.fee].filter(Boolean).length;
    const unlocked = count >= 4;
    this.setData({ confirmedCount: count, unlocked });
  },

  // ── C4 模板卡选项点击 ──
  onTmOption(e) {
    const { tm_id, option, msg_id } = e.detail;
    // 更新消息状态
    const messages = this.data.messages.map((m) => {
      if (m._id === msg_id) {
        return Object.assign({}, m, {
          picked: option,
          status: tm_id === 'TM4' ? 'confirmed' : 'replied'
        });
      }
      return m;
    });
    // 更新进度
    const progress = Object.assign({}, this.data.progress);
    const keyMap = { TM1: 'time', TM2: 'location', TM3: 'content', TM4: 'fee' };
    const key = keyMap[tm_id];
    if (key) progress[key] = true;
    this.setData({ messages, progress }, () => {
      this.updateConfirmedCount();
      this.scrollBottom();
      // 四确认完成 → 解锁 toast
      if (this.data.unlocked && key === 'fee') {
        wx.showToast({ title: '已解锁自由沟通，请遵守平台规则', icon: 'none', duration: 2000 });
      }
    });
  },

  // ── C5 模板快捷键 ──
  onQuickKey(e) {
    const tmId = e.currentTarget.dataset.id;
    if (tmId === 'TM5') {
      // 其他 → bottom-sheet textarea
      this.setData({ otherSheetVisible: true, otherText: '', otherCount: 0 });
      return;
    }
    // 发送对应 TM 模板消息卡
    this.sendTmCard(tmId);
  },

  sendTmCard(tmId) {
    const tm = TM_TEMPLATES[tmId];
    if (!tm) return;
    const newMsg = {
      _id: 'm_' + Date.now(),
      msg_type: 'template',
      tm_id: tmId,
      direction: 'out',
      question: tm.question,
      picked: '',
      status: 'pending',
      created_at: this.nowTime()
    };
    this.setData({ messages: this.data.messages.concat([newMsg]) }, () => this.scrollBottom());
  },

  // ── C5 「其他」 ──
  onOtherInput(e) {
    const v = (e.detail.value || '').slice(0, TM_TEMPLATES.TM5.otherLimit);
    this.setData({ otherText: v, otherCount: v.length });
  },
  sendOther() {
    const text = this.data.otherText.trim();
    if (!text) return;
    // 发送为 TM5 模板卡
    const newMsg = {
      _id: 'm_' + Date.now(),
      msg_type: 'template',
      tm_id: 'TM5',
      direction: 'out',
      question: text,
      picked: '',
      status: 'pending',
      created_at: this.nowTime()
    };
    const otherUsedCount = this.data.otherUsedCount + 1;
    this.setData({
      messages: this.data.messages.concat([newMsg]),
      otherUsedCount,
      otherSheetVisible: false
    }, () => {
      this.scrollBottom();
      // 达到配置阈值 → 弹客服介入
      if (otherUsedCount >= CONFIG.IM.otherKefuThreshold) {
        this.setData({ kefuSheetVisible: true });
      }
    });
  },
  closeOtherSheet() {
    this.setData({ otherSheetVisible: false });
  },

  // ── 客服介入 ──
  closeKefuSheet() {
    this.setData({ kefuSheetVisible: false });
  },
  requestKefu() {
    this.setData({ kefuSheetVisible: false });
    wx.showToast({ title: `已申请客服介入，将在${CONFIG.IM.kefuResponseMin}分钟内接入`, icon: 'none' });
  },

  // ── C6 自由输入（四确认后） ──
  onTextInput(e) {
    this.setData({ inputText: e.detail.value });
  },
  sendText() {
    const text = this.data.inputText.trim();
    if (!text || !this.data.unlocked) return;
    const newMsg = {
      _id: 'm_' + Date.now(),
      msg_type: 'text',
      direction: 'out',
      content: text,
      is_read: false,
      created_at: this.nowTime()
    };
    this.setData({
      messages: this.data.messages.concat([newMsg]),
      inputText: ''
    }, () => this.scrollBottom());
  },

  // ── C1 订单卡片入口 ──
  goOrderDetail() {
    if (!this.data.order) return;
    wx.navigateTo({
      url: `/pages-v2/order-detail/order-detail?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '订单详情将在批次3上线', icon: 'none' })
    });
  },

  // ── C7 订单卡片消息点击 ──
  onOrderCardTap() {
    this.goOrderDetail();
  },

  // ── 工具 ──
  nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  scrollBottom() {
    setTimeout(() => {
      const last = this.data.messages[this.data.messages.length - 1];
      this.setData({ scrollToView: last ? last._id : '' });
    }, 50);
  }
});
