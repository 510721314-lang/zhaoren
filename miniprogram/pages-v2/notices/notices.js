const callCloud = (name, data) => wx.cloud.callFunction({ name, data }).then((r) => r.result || {});

// 时间戳: 输出 ISO 8601 本地时区格式 YYYY-MM-DDTHH:MM:SS±HH:MM
function fmtAgo(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const offMin = -d.getTimezoneOffset(); // 东八区 = 480 -> +08:00
  const sign = offMin >= 0 ? '+' : '-';
  const offAbs = Math.abs(offMin);
  const oz = `${sign}${pad(Math.floor(offAbs / 60))}:${pad(offAbs % 60)}`;
  return `${y}-${mo}-${day}T${h}:${mi}:${s}${oz}`;
}

Page({
  data: { list: [], unread: 0, loading: true, empty: false },

  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },

  onShow() { this.loadList(); },
  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh());
  },

  async loadList() {
    this.setData({ loading: true });
    const r = await callCloud('order-action', { action: 'notice_list', limit: 50 });
    if (r && r.ok && r.data) {
      const list = (r.data.list || []).map((n) => ({ ...n, time_ago: fmtAgo(n.created_at) }));
      this.setData({ list, unread: r.data.unread || 0, empty: list.length === 0, loading: false });
    } else {
      this.setData({ loading: false });
    }
  },

  // 点单条: 标记已读 + 根据 action_key 跳转
  async onTapItem(e) {
    const n = e.currentTarget.dataset.notice;
    if (!n) return;
    // 标记已读
    callCloud('order-action', { action: 'notice_read', notice_id: n._id }).catch(() => {});
    // 更新本地
    this.setData({
      list: this.data.list.map((x) => x._id === n._id ? { ...x, read: true } : x),
      unread: Math.max(0, this.data.unread - 1)
    });
    // 跳转
    const key = n.action_key;
    const payload = n.action_payload || {};
    if (key === 'jump_order' || key === 'jump_accept_modify') {
      wx.navigateTo({ url: `/pages-v2/order-detail/order-detail?orderId=${payload.order_id || n.order_id}`, fail: () => {} });
    } else if (key === 'jump_pay') {
      wx.navigateTo({ url: `/pages-v2/pay/pay?orderId=${payload.order_id || n.order_id}`, fail: () => {} });
    } else if (key === 'jump_evaluate') {
      wx.navigateTo({ url: `/pages-v2/order-detail/order-detail?orderId=${payload.order_id || n.order_id}`, fail: () => {} });
    } else if (key === 'jump_wallet') {
      wx.switchTab({ url: '/pages-v2/profile/profile', fail: () => {} });
    } else if (key === 'jump_demand') {
      wx.navigateTo({ url: `/pages-v2/demand-detail/demand-detail?id=${payload.demand_id || ''}`, fail: () => {} });
    }
  },

  // 全部标已读
  async onMarkAll() {
    callCloud('order-action', { action: 'notice_read' }).catch(() => {});
    this.setData({
      list: this.data.list.map((x) => ({ ...x, read: true })),
      unread: 0
    });
    wx.showToast({ title: '已全部标记', icon: 'none' });
  }
});
