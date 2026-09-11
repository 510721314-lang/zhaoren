// pages/chat/chat.js - 消息(会话列表)
Page({
  data: {
    list: [],
    loading: true
  },

  onShow() {
    this.loadList(true);
  },

  onPullDownRefresh() {
    this.loadList(true, () => wx.stopPullDownRefresh());
  },

  loadList(silent, done) {
    if (!silent) wx.showLoading({ title: '加载中', mask: true });
    wx.cloud.callFunction({
      name: 'im-conv',
      data: { action: 'my_convs' },
      success: (res) => {
        if (res.result && res.result.ok) {
          const list = (res.result.data.list || []).map((c) => this.decorate(c));
          this.setData({ list, loading: false });
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '网络异常', icon: 'none' }),
      complete: () => { wx.hideLoading(); if (done) done(); }
    });
  },

  decorate(c) {
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    const ts = c.last_msg_at;
    let timeStr = '';
    if (ts) {
      const d = new Date(ts);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      timeStr = sameDay
        ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
        : `${d.getMonth() + 1}月${d.getDate()}日`;
    }
    return Object.assign({}, c, {
      time_str: timeStr,
      last_text: c.last_msg_text || '开始沟通吧',
      avatar_text: (c.peer.nickname || '?').charAt(0),
      role_label: c.peer.role === 'partner' ? '耍伴' : '发单人'
    });
  },

  openConv(e) {
    const orderId = e.currentTarget.dataset.orderId;
    wx.navigateTo({ url: `/pages/chat-detail/chat-detail?order_id=${orderId}` });
  },

  goHall() {
    wx.switchTab({ url: '/pages/hall/hall' });
  },

  goPublish() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
