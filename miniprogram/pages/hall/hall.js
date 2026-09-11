// pages/hall/hall.js - 大厅(耍伴=接单大厅 / 发单人=发布需求与找人)
const app = getApp();
const { formatMoney, timeAgo } = require('../../utils/util.js');
const { aaTierLabel, ORDER_STATUS } = require('../../utils/constants.js');
// 模拟器兜底坐标(仅 devtools;Windows 系统定位关闭时保证接单自测链路不中断),真机不允许兜底
const DEFAULT_LOC = { latitude: 30.572815, longitude: 104.066801 };
// "system permission denied" 含 denied 但属系统级错误,必须先于 auth 判断
function classifyLocError(err) {
  const msg = (err && err.errMsg) || '';
  if (/system permission/i.test(msg)) return 'system';
  if (/auth|deny|scope/i.test(msg)) return 'auth';
  return 'other';
}

Page({
  data: {
    activeRole: 'user',    // 当前界面身份(由全局决定)
    list: [],              // 耍伴模式: 可接需求
    myOrders: [],          // 耍伴模式: 我接的单(进行中/历史订单)
    myDemands: [],         // 发单人模式: 我发布的待接单需求
    loading: true,
    taking: false,
    takingId: ''
  },

  onShow() {
    app.syncTabBar();
    const activeRole = app.getActiveRole();
    this.setData({ activeRole });
    wx.setNavigationBarTitle({ title: activeRole === 'partner' ? '接单大厅' : '需求大厅' });
    if (activeRole === 'partner') {
      this.loadList();
      this.loadMyOrders();
    } else {
      this.loadMyDemands();
    }
  },

  onPullDownRefresh() {
    let pending = 1;
    const done = () => { if (--pending <= 0) wx.stopPullDownRefresh(); };
    if (this.data.activeRole === 'partner') {
      pending = 2;
      this.loadList(done);
      this.loadMyOrders(done);
    } else {
      this.loadMyDemands(done);
    }
  },

  // ───────── 耍伴模式: 我接的单 ─────────
  loadMyOrders(cb) {
    wx.cloud.callFunction({
      name: 'order-action',
      data: { action: 'my_orders', role: 'partner' },
      success: (res) => {
        const all = (res.result && res.result.ok && res.result.data.list) || [];
        const statusList = Object.keys(ORDER_STATUS).map((k) => ORDER_STATUS[k]);
        const myOrders = all
          .filter((o) => o.item_type === 'order')
          .map((o) => {
            const st = statusList.find((s) => s.code === o.status) || { name: o.status, color: 'muted' };
            const d = new Date(o.start_time);
            const pad = (n) => n < 10 ? '0' + n : '' + n;
            return {
              order_id: o.order_id,
              order_no: o.order_no,
              scene_name: o.scene_name,
              status_name: st.name,
              status_color: st.color,
              contentText: (o.content_options || []).join('、'),
              location_name: o.location_name,
              timeText: `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`,
              duration_h: o.duration_h,
              totalText: formatMoney(o.total_fen)
            };
          });
        this.setData({ myOrders });
      },
      complete: () => { if (typeof cb === 'function') cb(); }
    });
  },

  // 耍伴: 点我接的单 → 订单详情
  onMyOrderTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/order-detail?order_id=${id}` });
  },

  // ───────── 耍伴模式: 接单大厅 ─────────
  loadList(cb) {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'demand-match',
      data: { action: 'hall_list' },
      success: (res) => {
        this.setData({ loading: false });
        if (res.result && res.result.ok) {
          const list = (res.result.data.list || []).map(item => ({
            ...item,
            aa_tier: aaTierLabel(item.aa_tier),
            totalText: formatMoney(item.total_fen),
            rateText: formatMoney(item.rate_fen),
            contentText: (item.content_options || []).join('、') || '未填写',
            timeText: this.formatTime(item.start_time),
            agoText: timeAgo(item.created_at)
          }));
          this.setData({ list });
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      },
      complete: () => { if (typeof cb === 'function') cb(); }
    });
  },

  // ───────── 发单人模式: 我的待接单需求 ─────────
  loadMyDemands(cb) {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'order-action',
      data: { action: 'my_orders', role: 'user' },
      success: (res) => {
        const all = (res.result && res.result.ok && res.result.data.list) || [];
        const myDemands = all
          .filter((o) => o.item_type === 'demand')
          .map((item) => ({
            ...item,
            totalText: formatMoney(item.total_fen),
            contentText: (item.content_options || []).join('、') || '未填写',
            timeText: this.formatTime(item.start_time)
          }));
        this.setData({ myDemands, loading: false });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      },
      complete: () => { if (typeof cb === 'function') cb(); }
    });
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 发单人: 去首页发布需求
  goPublish() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  // 发单人: 点自己的需求 → 匹配页(候选耍伴/邀约/广播)
  onMyDemandTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/match/match?demand_id=${id}` });
  },

  // 去「我的」切换身份
  goSwitchRole() {
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  // 接单
  onTake(e) {
    const demandId = e.currentTarget.dataset.id;
    const isMine = e.currentTarget.dataset.mine;
    if (isMine) {
      wx.showToast({ title: '不能接自己发布的需求', icon: 'none' });
      return;
    }
    if (this.data.taking) return;

    wx.showModal({
      title: '确认接单',
      content: '接单后将进入四确认流程,确认接单吗?',
      success: async (r) => {
        if (!r.confirm) return;
        const ok = await getApp().requirePrivacyAuth();
        if (!ok) return;
        this.setData({ taking: true, takingId: demandId });
        // 接单需校验当前位置与履约地点距离(≤50公里), 先取实时GPS
        wx.showLoading({ title: '定位中', mask: true });
        wx.getLocation({
          type: 'gcj02',
          success: (loc) => this.doTake(demandId, { latitude: loc.latitude, longitude: loc.longitude }),
          fail: (err) => {
            const kind = classifyLocError(err);
            // 仅模拟器:系统定位/权限不可用时用成都坐标继续(服务端仍做 50km 校验);真机无此分支
            let platform = '';
            try { platform = wx.getSystemInfoSync().platform; } catch (e) {}
            if (platform === 'devtools') {
              this.doTake(demandId, { latitude: DEFAULT_LOC.latitude, longitude: DEFAULT_LOC.longitude });
              return;
            }
            wx.hideLoading();
            this.setData({ taking: false, takingId: '' });
            if (kind === 'auth') {
              wx.showModal({
                title: '需要位置权限',
                content: '接单需校验你当前位置与履约地点的距离（不超过 50 公里），请在设置中允许使用位置信息',
                confirmText: '去设置',
                success: (m) => { if (m.confirm) wx.openSetting(); }
              });
            } else if (kind === 'system') {
              wx.showModal({
                title: '请开启系统定位服务',
                content: '微信已获得位置权限，但系统定位服务未开启。请在手机「设置→隐私与安全→定位服务」中打开，并允许微信获取位置后重试',
                showCancel: false
              });
            } else {
              wx.showModal({
                title: '定位失败',
                content: '请检查网络或 GPS 信号后重试接单',
                showCancel: false
              });
            }
          }
        });
      }
    });
  },

  // 实际接单(带上接单时实时位置)
  doTake(demandId, partnerLocation) {
    wx.showLoading({ title: '接单中', mask: true });
    wx.cloud.callFunction({
      name: 'order-create',
      data: { action: 'create_from_take', demand_id: demandId, partner_location: partnerLocation },
      success: (res) => {
        wx.hideLoading();
        this.setData({ taking: false, takingId: '' });
        if (res.result && res.result.ok) {
          wx.showToast({ title: '接单成功', icon: 'success' });
          const orderId = res.result.data.order_id;
          setTimeout(() => {
            wx.navigateTo({ url: `/pages/order-detail/order-detail?order_id=${orderId}` });
          }, 800);
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '接单失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ taking: false, takingId: '' });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  }
});
