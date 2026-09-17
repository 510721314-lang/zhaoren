const callCloud = (name, data) => wx.cloud.callFunction({ name, data }).then((r) => r.result || {});

function fmtAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  const dt = new Date(ts);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

Page({
  data: { list: [], unread: 0, loading: true, empty: false },

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
