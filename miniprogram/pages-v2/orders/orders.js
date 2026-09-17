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

// 状态键一律使用下划线(经 normalizeStatus 归一化云端点号字面量)
const TAB_STATUS = {
  pay: ['S0'],
  doing: ['S1', 'S2', 'S2_5', 'S3', 'S3_5'],
  eval: ['S5'],
  after: ['S6', 'S7', 'S9', 'S10', 'S10_5']
};

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
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
    loaded: false
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
    this.applyFilter();
  },

  switchRole(e) {
    const role = e.currentTarget.dataset.role;
    if (role === this.data.role) return;
    this.setData({ role, orders: [], loaded: false });
    this.loadOrders();
  },

  loadOrders(done) {
    this.setData({ loading: true });
    callCloud('order-action', { action: 'my_orders', role: this.data.role }).then((r) => {
      const list = (r.ok && r.data && r.data.list) || [];
      this._all = list.map((o) => this.decorate(o));
      this.applyFilter();
      this.setData({ loading: false, loaded: true });
    }).catch(() => {
      this.setData({ loading: false, loaded: true });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }).then(() => { if (done) done(); });
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

  applyFilter() {
    const all = this._all || [];
    const tab = this.data.activeTab;
    if (tab === 'all') {
      this.setData({ orders: all });
      return;
    }
    const allow = TAB_STATUS[tab] || [];
    // 待接单需求(PENDING) 归入"进行中"
    this.setData({
      orders: all.filter((o) => o.status === 'PENDING' ? tab === 'doing' : allow.indexOf(o.status) >= 0)
    });
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
