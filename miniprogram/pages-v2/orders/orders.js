// pages-v2/orders/orders.js · 我的订单列表
// 数据源: order-action my_orders(role=user 发单 / partner 接单)
// tab 过滤口径与 order-action my_counts 四宫格一致
const { ORDER_STATUS, normalizeStatus } = require('../../config/enums.js');

const TABS = [
  { key: 'all', name: '全部' },
  { key: 'pay', name: '待支付' },
  { key: 'doing', name: '进行中' },
  { key: 'eval', name: '待评价' },
  { key: 'after', name: '售后' }
];

// 状态过滤已下推服务端(my_orders 的 filter 参数, 点号字面量 S3.5/S10.5/S2.5) —— 本地不再二次过滤

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtTime(ts) {
  if (!ts) return '时间待定';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtFen(fen) {
  const v = Number(fen) || 0;
  return (v / 100).toFixed(v % 100 === 0 ? 0 : 2);
}

Page({
  data: {
    tabs: TABS,
    activeTab: 'all',
    role: 'user',
    orders: [],
    loading: false,
    loaded: false,
    // 分页「加载更多」: has_more=true 显示按钮
    hasMore: false,
    loadingMore: false
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad(options) {
    const tab = (options && TABS.some((t) => t.key === options.tab)) ? options.tab : 'all';
    const role = options && options.role === 'partner' ? 'partner' : 'user';
    this.setData({ activeTab: tab, role });
  },

  onShow() {
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    this.setData({ activeTab: key });
    this.loadOrders();
  },

  switchRole(e) {
    const role = e.currentTarget.dataset.role;
    if (role === this.data.role) return;
    this.setData({ role, orders: [], loaded: false });
    this.loadOrders();
  },

  // 每页 20(服务端上限 50); 直接传 filter 让服务端过滤, 本地不再二次过滤
  loadOrders(done) {
    this.__page = 1;
    this.setData({ loading: true, hasMore: false, loadingMore: false });
    callCloud('order-action', {
      action: 'my_orders',
      role: this.data.role,
      filter: this.data.activeTab,
      page: 1,
      page_size: 20
    }).then((r) => {
      const list = (r.ok && r.data && r.data.list) || [];
      this._all = list.map((o) => this.decorate(o));
      this.setData({
        orders: this._all,
        loading: false,
        loaded: true,
        hasMore: !!(r.data && r.data.has_more),
        loadingMore: false
      });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败,下拉重试', icon: 'none' });
    }).then(() => { if (done) done(); });
  },

  // 「加载更多」/ 触底: 下一页追加
  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    callCloud('order-action', {
      action: 'my_orders',
      role: this.data.role,
      filter: this.data.activeTab,
      page: (this.__page || 1) + 1,
      page_size: 20
    }).then((r) => {
      const extra = (r.ok && r.data && r.data.list) || [];
      this.__page = (this.__page || 1) + 1;
      const merged = [...this.data.orders, ...extra.map((o) => this.decorate(o))];
      this.setData({
        orders: merged,
        loadingMore: false,
        hasMore: !!(r.data && r.data.has_more)
      });
    }).catch(() => {
      this.setData({ loadingMore: false });
      wx.showToast({ title: '加载失败,请重试', icon: 'none' });
    });
  },

  onReachBottom() {
    this.loadMore();
  },

  decorate(o) {
    const rawStatus = o.status;
    const isPending = rawStatus === 'PENDING';
    const status = isPending ? rawStatus : normalizeStatus(rawStatus);
    const st = isPending
      ? { name: '待接单', colorTag: 'var(--func-warning)', bgTag: 'var(--func-warning-light)' }
      : (ORDER_STATUS[status] || { name: status, colorTag: 'var(--text-4)', bgTag: 'var(--bg-segment)' });
    return {
      ...o,
      status,
      status_name: st.name,
      status_color: st.colorTag,
      status_bg: st.bgTag,
      content_str: (o.content_options || []).join('、') || '服务内容待确认',
      time_str: fmtTime(o.start_time),
      total_yuan: fmtFen(o.total_fen)
    };
  },

  goItem(e) {
    const { id, type } = e.currentTarget.dataset;
    const url = type === 'demand'
      ? `/pages-v2/demand-detail/demand-detail?id=${id}`
      : `/pages-v2/order-detail/order-detail?orderId=${id}`;
    wx.navigateTo({ url, fail: () => wx.showToast({ title: '详情页暂不可用', icon: 'none' }) });
  },

  reload() {
    this.loadOrders();
  },

  goPublish() {
    wx.switchTab({ url: '/pages-v2/index/index' });
  }
});
