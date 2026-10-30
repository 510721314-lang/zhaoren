const { callCloud } = require('../../../utils/cloud.js');

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

  onShow() {
    this.loadList(true);
    // 2026-10-30(提示滞后批4): 停留期间轮询, 新通知不再需要退出重进才能看到
    this.startNoticePoll();
  },
  onHide() { this.stopNoticePoll(); },
  onUnload() { this.stopNoticePoll(); },
  onPullDownRefresh() {
    this.loadList(true).then(() => wx.stopPullDownRefresh());
  },
  onReachBottom() { this.loadList(false); },

  // 2026-10-30(提示滞后批4): 通知页停留轮询 —— 每 15s 静默比对「首条 _id+created_at 与未读数」,
  // 有变化才 setData; 不闪 loading、失败静默、已分页时只同步未读不重排列表(防分页重复/漏条)
  startNoticePoll() {
    this.stopNoticePoll();
    this._noticeTimer = setInterval(() => this.pollNoticeOnce(), 15000);
  },
  stopNoticePoll() {
    if (this._noticeTimer) { clearInterval(this._noticeTimer); this._noticeTimer = null; }
  },
  async pollNoticeOnce() {
    // 在飞门锁 + 首屏/触底加载中跳过(单次最长 12s, 与 15s 周期可能叠加)
    if (this.__polling || this.data.loading || this.data.loadingMore) return;
    this.__polling = true;
    const r = await callCloud('order-action', { action: 'notice_list', limit: this.data.pageSize + 1 }, { timeout: 12000 }).catch(() => null);
    this.__polling = false;
    if (!r || !r.ok || !r.data) return;   // 失败静默, 不复用 loadList 的失败 toast
    const fetched = (r.data.list || []).map((n) => ({ ...n, time_ago: fmtAgo(n.created_at) }));
    const hasMore = fetched.length > this.data.pageSize;
    const page = hasMore ? fetched.slice(0, this.data.pageSize) : fetched;
    // 本地刚点过已读时 10s 内不回写未读(防服务端延迟导致角标数字回弹)
    const unreadNext = (this.__localReadAt && Date.now() - this.__localReadAt < 10000)
      ? this.data.unread : (r.data.unread || 0);
    const sig = (x) => ((x && x._id) ? `${x._id}|${x.created_at || 0}` : '');
    const changed = sig(page[0]) !== sig((this.data.list || [])[0]);
    const paged = this.data.hasMore || (this.data.list || []).length > this.data.pageSize;
    if (changed && !paged) {
      this.setData({ list: page, unread: unreadNext, empty: page.length === 0, hasMore });
    } else if (unreadNext !== this.data.unread) {
      this.setData({ unread: unreadNext });
    }
  },

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
    // 通知列表含联表装饰, 冷启动可能 >6s; 单独放宽到 12s, 避免默认 6s 超时误判失败
    const r = await callCloud('order-action', { action: 'notice_list', limit: this.data.pageSize + 1, skip }, { timeout: 12000 });
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
      // 失败不再静默: 给用户可操作提示, 并保留 console 便于排障
      const msg = (r && r.msg) || '加载失败，请下拉重试';
      console.error('[notices] load fail', (r && r.code) || '', msg);
      this.setData({ loading: false, loadingMore: false });
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

  // 点单条: 标记已读 + 根据 action_key 跳转
  async onTapItem(e) {
    const n = e.currentTarget.dataset.notice;
    if (!n) return;
    // 标记已读
    callCloud('order-action', { action: 'notice_read', notice_id: n._id }).catch(() => {});
    // 2026-10-30: 通知首页刷新角标(首页 onShow 见脏标记才走实时未读查询)
    try { wx.setStorageSync('notice_unread_dirty', 1); } catch (e) {}
    // 更新本地
    this.__localReadAt = Date.now();   // 2026-10-30: 10s 内轮询不回写未读, 防数字回弹
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
    } else if (key === 'jump_accept_config') {
      // 2026-10-30: 订阅额度用尽通知 → 直达「接单配置」重新开启催办提醒
      wx.navigateTo({ url: '/pages-v2/pkg-low/accept-config/accept-config', fail: () => {} });
    }
  },

  // 全部标已读
  async onMarkAll() {
    callCloud('order-action', { action: 'notice_read' }).catch(() => {});
    // 2026-10-30: 通知首页刷新角标(同上, 走 Storage 脏标记)
    try { wx.setStorageSync('notice_unread_dirty', 1); } catch (e) {}
    this.__localReadAt = Date.now();   // 2026-10-30: 10s 内轮询不回写未读, 防数字回弹
    this.setData({
      list: this.data.list.map((x) => ({ ...x, read: true })),
      unread: 0
    });
    wx.showToast({ title: '已全部标记', icon: 'none' });
  }
});
