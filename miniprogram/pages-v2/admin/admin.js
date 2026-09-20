// 管理后台首页: 数据看板 + 模块导航
// 鉴权: onLoad 调 admin-action.admin_list, 非管理员直接 redirectTo 首页
const app = getApp();

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常' }; });
}

Page({
  data: {
    isAdmin: false,
    loading: true,
    stats: {},
    trend: { days: [], users: [], demands: [], orders: [], gmv_fen: [] },
    todo: {},
    finance: {},
    gmvYuan: '0.00'
  },

  onLoad() {
    this.checkAdmin();
  },

  onShow() {
    if (this.data.isAdmin) this.loadDashboard();
  },

  checkAdmin() {
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) {
        wx.showToast({ title: '无管理员权限', icon: 'none' });
        setTimeout(() => wx.redirectTo({ url: '/pages-v2/index/index' }), 800);
        return;
      }
      this.setData({ isAdmin: true });
      this.loadDashboard();
    });
  },

  loadDashboard() {
    this.setData({ loading: true });
    callCloud('admin-action', { action: 'dashboard' }).then((r) => {
      if (!r.ok) { this.setData({ loading: false }); return; }
      const d = r.data;
      const gmv = (d.finance && d.finance.gmv_fen) || (d.gmv_fen) || 0;
      this.setData({
        stats: {
          user_count: d.user_count,
          partner_count: d.partner_count,
          today_demand_count: d.today_demand_count,
          active_order_count: d.active_order_count,
          pending_review_count: d.pending_review_count,
          dispute_count: d.dispute_count
        },
        trend: d.trend || { days: [], users: [], demands: [], orders: [], gmv_fen: [] },
        todo: d.todo || {},
        finance: d.finance || {},
        gmvYuan: (gmv / 100).toFixed(2),
        loading: false
      });
    });
  },

  goUsers() { wx.navigateTo({ url: '/pages-v2/admin/users' }); },
  goPartners() { wx.navigateTo({ url: '/pages-v2/admin/partners' }); },
  goDemands() { wx.navigateTo({ url: '/pages-v2/admin/demands' }); },
  goOrders() { wx.navigateTo({ url: '/pages-v2/admin/orders' }); },
  goFinance() { wx.navigateTo({ url: '/pages-v2/admin/finance' }); },
  goConfig() { wx.navigateTo({ url: '/pages-v2/admin/config' }); },

  onShareAppMessage() { return { title: '管理后台', path: '/pages-v2/index/index' }; }
});
