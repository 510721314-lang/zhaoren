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
  data: {
    list: [],
    unread: 0,
    loading: true,
    empty: false,
    pageSize: 5,        // 产品定版: 消息通知一次加载 5 条
    hasMore: false,     // 是否还有下一页(limit+1 法精确判断)
    loadingMore: false
  },

  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },

  onShow() { this.loadList(true); },
  onPullDownRefresh() {
    this.loadList(true).then(() => wx.stopPullDownRefresh());
  },
  onReachBottom() { this.loadList(false); },

  // reset=true: 首屏/返回页面/下拉刷新, 从头拉第一页替换; reset=false: 触底/更多追加下一页
  // limit+1 技巧: 请求 pageSize+1 条, 实际回满则判定有下一页, 只展示前 pageSize 条;
  // 无需后端改 hasMore, 也不会在总数恰为页数倍数时多发一次空请求
  async loadList(reset) {
    if (reset) {
      this.setData({ loading: true });
    } else {
      if (this.data.loadingMore || !this.data.hasMore || this.data.loading) return;
      this.setData({ loadingMore: true });
    }
    const skip = reset ? 0 : this.data.list.length;
    const r = await callCloud('order-action', { action: 'notice_list', limit: this.data.pageSize + 1, skip });
    if (r && r.ok && r.data) {
      const fetched = (r.data.list || []).map((n) => ({ ...n, time_ago: fmtAgo(n.created_at) }));
      const hasMore = fetched.length > this.data.pageSize;
      const page = hasMore ? fetched.slice(0, this.data.pageSize) : fetched;
      const list = reset ? page : this.data.list.concat(page);
      this.setData({
        list,
        unread: r.data.unread || 0,
        empty: reset && list.length === 0,
        loading: false,
        loadingMore: false,
        hasMore
      });
    } else {
      this.setData({ loading: false, loadingMore: false });
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
    if (key === 'jump_chat') {
      wx.navigateTo({ url: `/pages-v2/chat/chat?orderId=${payload.order_id || n.order_id}`, fail: () => {} });
    } else if (key === 'jump_order' || key === 'jump_accept_modify') {
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
