// pages/order/order.js - 订单列表(我接的单/我发的单)
const app = getApp();
const { ORDER_STATUS } = require('../../utils/constants.js');
const { formatMoney, haversineKm, estimateCommute } = require('../../utils/util.js');

// 待履约状态(需要导航到履约地点)
const NAV_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

Page({
  data: {
    role: 'user',          // partner=我接的单 / user=我发的单(跟随全局身份)
    orders: [],
    loading: false,
    loaded: false,
    hasLocation: false,
    locationTried: false
  },

  onShow() {
    app.syncTabBar();
    // 「我的需求」入口预选「我发的单」(tab 页无法接参, 走 globalData)
    const preset = app.globalData && app.globalData.orderTabRole;
    if (preset === 'user' || preset === 'partner') {
      app.setActiveRole(preset);
      app.globalData.orderTabRole = '';
    }
    // 跟随「我的」页的身份切换
    const role = app.getActiveRole();
    if (role !== this.data.role) this.setData({ role, loaded: false });
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders(() => wx.stopPullDownRefresh());
  },

  // 页内切换视角 = 切换全局身份(与「我的」页保持一致)
  switchRole(e) {
    const role = e.currentTarget.dataset.role;
    if (role === this.data.role) return;
    app.setActiveRole(role);
    this.setData({ role, loaded: false });
    this.loadOrders();
  },

  loadOrders(done) {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'order-action',
      data: { action: 'my_orders', role: this.data.role },
      success: (res) => {
        const list = (res.result && res.result.ok && res.result.data.list) || [];
        const orders = list.map((o) => this.decorate(o));
        this.setData({ orders, loading: false, loaded: true });
        // 耍伴视角:获取当前位置,计算到各履约地点的通勤
        if (this.data.role === 'partner') {
          this.calcToSite(orders);
        }
      },
      fail: () => {
        this.setData({ loading: false, loaded: true });
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => { if (done) done(); }
    });
  },

  // 基础展示字段
  decorate(o) {
    const statusList = Object.keys(ORDER_STATUS).map((k) => ORDER_STATUS[k]);
    // 待接单需求(尚未生成订单)
    const st = o.status === 'PENDING'
      ? { name: '待接单', color: 'warn' }
      : (statusList.find((s) => s.code === o.status) || { name: o.status, color: 'muted' });
    const d = new Date(o.start_time);
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    return {
      ...o,
      status_name: st.name,
      status_color: st.color,
      total_yuan: formatMoney(o.total_fen),
      time_str: `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      content_str: (o.content_options || []).join('、'),
      commute_str: o.commute ? this.fmtCommute(o.commute) : '',
      to_site: null          // 当前位置→履约地点通勤(异步填充)
    };
  },

  fmtCommute(c) {
    return `距下一单${c.distance_km}公里 · 🚶${c.walk_min}分 🚲${c.bike_min}分 🚌${c.bus_min}分 🚗${c.drive_min}分`;
  },

  // 获取当前位置 → 计算待履约订单的通勤
  async calcToSite(orders) {
    const ok = await getApp().requirePrivacyAuth();
    if (!ok) { this.setData({ orders }); return; }
    wx.getLocation({
      type: 'gcj02',
      success: (loc) => {
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;
        const updated = orders.map((o) => {
          // 仅待履约且有履约地点坐标的订单计算
          if (NAV_STATUS.indexOf(o.status) < 0 || !o.location_lat || !o.location_lng) return o;
          const km = haversineKm(loc.latitude, loc.longitude, o.location_lat, o.location_lng);
          const est = estimateCommute(km);
          // 未到服务时间:按最快方式(驾车)倒推建议最晚出发时间
          if (o.start_time > now) {
            const depart = new Date(o.start_time - est.drive_min * 60000);
            est.depart_str = `${pad(depart.getHours())}:${pad(depart.getMinutes())}`;
          }
          return { ...o, to_site: est };
        });
        this.setData({ orders: updated, hasLocation: true, locationTried: true });
      },
      fail: () => {
        // 用户拒绝授权或获取失败:显示引导条,不阻断列表
        this.setData({ hasLocation: false, locationTried: true });
      }
    });
  },

  // 引导用户到设置页开启定位
  openLocationSetting() {
    wx.openSetting({
      success: (res) => {
        if (res.authSetting && res.authSetting['scope.userLocation']) {
          this.calcToSite(this.data.orders);
        }
      }
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    const type = e.currentTarget.dataset.type;
    if (type === 'demand') {
      // 待接单需求 → 匹配页(看候选耍伴/邀约/广播状态)
      wx.navigateTo({ url: `/pages/match/match?demand_id=${id}` });
    } else {
      wx.navigateTo({ url: `/pages/order-detail/order-detail?order_id=${id}` });
    }
  },

  // 空态: 去首页发布需求
  goPublish() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
