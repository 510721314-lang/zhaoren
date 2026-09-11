// pages/chat-detail/chat-detail.js - 订单会话(IM)
// 规则:四确认完成前仅可发送系统模板消息(8 条);完成后开放自由文本(云端逐条 msgSecCheck)
const POLL_INTERVAL = 4000;

Page({
  data: {
    orderId: '',
    convId: '',
    role: '',
    peer: null,
    sceneName: '',
    orderNo: '',
    status: '',
    freeChat: false,
    chatBlocked: false,
    templates: [],
    messages: [],
    inputVal: '',
    sending: false,
    loading: true,
    scrollToId: ''
  },

  onLoad(opts) {
    if (!opts || !opts.order_id) {
      wx.showToast({ title: '缺少订单参数', icon: 'none' });
      return;
    }
    this.setData({ orderId: opts.order_id });
    this.openConv();
  },

  onShow() {
    // 从详情页/支付返回后恢复轮询并刷新
    if (this.data.convId) {
      this.loadMessages(true);
      this.startPoll();
    }
  },

  onHide() {
    this.stopPoll();
  },

  onUnload() {
    this.stopPoll();
  },

  startPoll() {
    this.stopPoll();
    this.pollTimer = setInterval(() => this.loadMessages(true), POLL_INTERVAL);
  },

  stopPoll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  // ───────── 打开会话(懒创建 + 清零未读) ─────────
  openConv() {
    wx.showLoading({ title: '加载中', mask: true });
    wx.cloud.callFunction({
      name: 'im-conv',
      data: { action: 'open', order_id: this.data.orderId },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.ok) {
          const d = res.result.data;
          this.setData({
            convId: d.conv_id,
            role: d.role,
            peer: d.peer,
            sceneName: d.scene_name,
            orderNo: d.order_no,
            status: d.status,
            freeChat: !!d.free_chat,
            chatBlocked: !!d.chat_blocked,
            templates: d.templates || [],
            loading: false
          });
          if (d.peer && d.peer.nickname) {
            wx.setNavigationBarTitle({ title: d.peer.nickname });
          }
          this.loadMessages(false);
          this.startPoll();
        } else {
          wx.showModal({
            title: '无法打开会话',
            content: (res.result && res.result.msg) || '请稍后重试',
            showCancel: false,
            success: () => wx.navigateBack()
          });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  // ───────── 拉取消息 ─────────
  loadMessages(silent, done) {
    if (!this.data.convId) return;
    wx.cloud.callFunction({
      name: 'im-conv',
      data: { action: 'messages', conv_id: this.data.convId },
      success: (res) => {
        if (res.result && res.result.ok) {
          const messages = this.decorate(res.result.data.messages || []);
          const last = messages[messages.length - 1];
          this.setData({
            messages,
            scrollToId: last ? last.anchor : ''
          });
        }
      },
      complete: () => { if (done) done(); }
    });
  },

  onPullDownRefresh() {
    this.loadMessages(true, () => wx.stopPullDownRefresh());
  },

  // 预处理:时间锚点/时间分隔条(WXML 不支持方法调用)
  decorate(list) {
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    let lastTime = 0;
    return list.map((m) => {
      const d = new Date(m.created_at);
      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const showTime = !lastTime || (m.created_at - lastTime) > 5 * 60 * 1000;
      lastTime = m.created_at;
      return Object.assign({}, m, {
        anchor: 'm' + m.msg_id,
        time_str: timeStr,
        show_time: showTime
      });
    });
  },

  // ───────── 发送模板消息 ─────────
  sendTemplate(e) {
    const tplId = e.currentTarget.dataset.id;
    if (!tplId || this.data.sending || this.data.chatBlocked) return;
    this.setData({ sending: true });
    wx.cloud.callFunction({
      name: 'im-send',
      data: { action: 'send_template', order_id: this.data.orderId, template_id: tplId },
      success: (res) => {
        this.setData({ sending: false });
        if (res.result && res.result.ok) {
          this.setData({ freeChat: !!res.result.data.free_chat });
          this.loadMessages(true);
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '发送失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ sending: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  // ───────── 发送自由文本 ─────────
  onInput(e) {
    this.setData({ inputVal: e.detail.value });
  },

  sendText() {
    const text = (this.data.inputVal || '').trim();
    if (!text || this.data.sending) return;
    if (this.data.chatBlocked) {
      wx.showToast({ title: '订单已关闭，无法发送', icon: 'none' });
      return;
    }
    if (!this.data.freeChat) {
      wx.showToast({ title: '四项确认完成后可自由聊天', icon: 'none' });
      return;
    }
    this.setData({ sending: true });
    wx.cloud.callFunction({
      name: 'im-send',
      data: { action: 'send_text', order_id: this.data.orderId, text },
      success: (res) => {
        this.setData({ sending: false });
        if (res.result && res.result.ok) {
          this.setData({ inputVal: '' });
          this.loadMessages(true);
        } else {
          wx.showModal({
            title: '发送失败',
            content: (res.result && res.result.msg) || '请稍后重试',
            showCancel: false
          });
        }
      },
      fail: () => {
        this.setData({ sending: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  }
});
