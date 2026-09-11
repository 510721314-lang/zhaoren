// pages/match/match.js - 匹配页(发布后展示 top5 候选耍伴 / 定向邀约 / 广场广播 / 等待接单轮询)
const { formatMoney } = require('../../utils/util.js');
const { aaTierLabel } = require('../../utils/constants.js');

const POLL_INTERVAL = 15000;   // 需求状态轮询间隔 15 秒

Page({
  data: {
    demandId: '',
    loading: true,
    loadError: '',
    demand: null,        // 需求摘要
    candidates: [],      // 候选耍伴(已预处理颜色/等级/单数)
    invitedCount: 0,     // 已定向邀约人数(上限 3)
    broadcasted: false,  // 是否已广场广播
    waiting: false,      // 等待接单态(广播后)
    demandStatus: 'matching',
    acting: false,
    cancelling: false
  },

  onLoad(options) {
    const demandId = (options && options.demand_id) || '';
    if (!demandId) {
      wx.showToast({ title: '缺少需求信息', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ demandId });
    this.loadCandidates();
  },

  onShow() {
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  onPullDownRefresh() {
    this.loadCandidates(() => wx.stopPullDownRefresh());
  },

  // ───────── 数据加载 ─────────
  // 拉 top5 候选(demand-match 会同时回写 demand.match_candidates)
  loadCandidates(cb) {
    this.setData({ loading: true, loadError: '' });
    wx.cloud.callFunction({
      name: 'demand-match',
      data: { action: 'top5', demand_id: this.data.demandId },
      success: (res) => {
        if (res.result && res.result.ok) {
          const d = res.result.data.demand || {};
          const invited = d.invited || [];
          const candidates = (res.result.data.candidates || []).map((c) => ({
            ...c,
            rateText: formatMoney(c.rate_fen),
            initial: (c.nickname || '耍').charAt(0),
            // 信用分颜色: >=800 绿色 / 600-799 橙色(<600 云端已过滤不展示)
            creditColor: c.credit >= 800 ? 'success' : 'warn',
            levelText: `${c.level_code || 'L1'} ${c.level_name || '新手耍伴'}`,
            ordersText: `累计履约 ${c.completed_orders || 0} 单`,
            invited: invited.indexOf(c.openid) >= 0
          }));
          this.setData({
            loading: false,
            demandStatus: d.status || 'matching',
            broadcasted: !!d.broadcast,
            waiting: !!d.broadcast,
            demand: {
              scene_name: d.scene_name || '陪诊服务',
              contentText: (d.content_options || []).join('、') || '陪诊服务',
              timeText: this.formatTime(d.start_time),
              duration_h: d.duration_h,
              location_name: d.location_name || '地点待确认',
              totalText: formatMoney(d.total_fen),
              aa_tier: aaTierLabel(d.aa_tier)
            },
            candidates,
            invitedCount: invited.length
          });
          // 已被接单(极少见:进页瞬间成单)直接跳 IM
          if (d.status === 'matched') this.pollOnce();
        } else {
          this.setData({ loading: false });
          // 需求已关闭(极可能已被接单): 转状态轮询, matched 会自动跳 IM
          if (res.result && res.result.code === 'match_demand_closed') {
            this.pollOnce();
          } else {
            this.setData({ loadError: (res.result && res.result.msg) || '匹配失败，请下拉重试' });
          }
        }
      },
      fail: () => {
        this.setData({ loading: false, loadError: '网络异常，请下拉重试' });
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

  // ───────── 状态轮询(每 15 秒; 有人接单 → 跳 IM 聊天页) ─────────
  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(() => this.pollOnce(), POLL_INTERVAL);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  pollOnce() {
    if (!this.data.demandId || this._polling) return;
    this._polling = true;
    wx.cloud.callFunction({
      name: 'demand-match',
      data: { action: 'status', demand_id: this.data.demandId },
      success: (res) => {
        this._polling = false;
        const data = res.result && res.result.ok && res.result.data;
        if (!data) return;
        this.setData({
          demandStatus: data.status,
          broadcasted: !!data.broadcast || this.data.broadcasted,
          waiting: (!!data.broadcast || this.data.broadcasted) && data.status === 'matching'
        });
        // 已被接单 → 跳订单 IM 聊天页
        if (data.status === 'matched' && data.order_id) {
          this.stopPolling();
          wx.showToast({ title: '已匹配成功，请在 IM 完成四确认', icon: 'none', duration: 2500 });
          setTimeout(() => {
            wx.redirectTo({ url: `/pages/chat-detail/chat-detail?order_id=${data.order_id}` });
          }, 1200);
        }
      },
      fail: () => { this._polling = false; }
    });
  },

  // ───────── 候选操作 ─────────
  // 定向邀约单人(累计上限 3 人)
  onInvite(e) {
    const { openid, nickname } = e.currentTarget.dataset;
    if (this.data.acting) return;
    if (this.data.candidates.find((c) => c.openid === openid && c.invited)) return;
    if (this.data.invitedCount >= 3) {
      wx.showToast({ title: '最多定向邀约 3 位耍伴', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '定向邀约',
      content: `确定向「${nickname || '耍伴'}」发送邀约吗？TA 接单后即可进入确认流程。`,
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ acting: true });
        wx.showLoading({ title: '邀约中', mask: true });
        wx.cloud.callFunction({
          name: 'demand-match',
          data: { action: 'invite', demand_id: this.data.demandId, partner_openids: [openid] },
          success: (res) => {
            wx.hideLoading();
            this.setData({ acting: false });
            if (res.result && res.result.ok) {
              const idx = this.data.candidates.findIndex((c) => c.openid === openid);
              const patch = { invitedCount: this.data.invitedCount + 1 };
              if (idx >= 0) patch[`candidates[${idx}].invited`] = true;
              this.setData(patch);
              wx.showToast({ title: '已发出邀约，对方接单后会立即开始沟通', icon: 'none', duration: 2500 });
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '邀约失败', icon: 'none' });
            }
          },
          fail: () => {
            wx.hideLoading();
            this.setData({ acting: false });
            wx.showToast({ title: '网络异常', icon: 'none' });
          }
        });
      }
    });
  },

  // 查看耍伴主页(占位)
  onViewProfile() {
    wx.showToast({ title: '耍伴主页升级中，敬请期待', icon: 'none' });
  },

  // ───────── 广场广播 ─────────
  onBroadcast() {
    if (this.data.broadcasted || this.data.acting) return;
    wx.showModal({
      title: '广场广播',
      content: '广播后，所有在线耍伴都能在「接单」大厅看到你的需求并主动接单，是否继续？',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ acting: true });
        wx.showLoading({ title: '广播中', mask: true });
        wx.cloud.callFunction({
          name: 'demand-match',
          data: { action: 'broadcast', demand_id: this.data.demandId },
          success: (res) => {
            wx.hideLoading();
            this.setData({ acting: false });
            if (res.result && res.result.ok) {
              this.setData({ broadcasted: true, waiting: true });
              wx.showToast({ title: '已广播到大厅', icon: 'success' });
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '广播失败', icon: 'none' });
            }
          },
          fail: () => {
            wx.hideLoading();
            this.setData({ acting: false });
            wx.showToast({ title: '网络异常', icon: 'none' });
          }
        });
      }
    });
  },

  // ───────── 撤销需求 ─────────
  onCancelDemand() {
    if (this.data.cancelling) return;
    wx.showModal({
      title: '撤销需求',
      content: '撤销后该需求将从接单大厅和邀约列表移除，确定撤销吗？',
      confirmText: '确定撤销',
      confirmColor: '#d9534f',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ cancelling: true });
        wx.showLoading({ title: '撤销中', mask: true });
        wx.cloud.callFunction({
          name: 'demand-publish',
          data: { action: 'cancel', demand_id: this.data.demandId },
          success: (res) => {
            wx.hideLoading();
            this.setData({ cancelling: false });
            if (res.result && res.result.ok) {
              this.stopPolling();
              wx.showToast({ title: '需求已撤销', icon: 'success' });
              setTimeout(() => wx.navigateBack(), 800);
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '撤销失败', icon: 'none' });
            }
          },
          fail: () => {
            wx.hideLoading();
            this.setData({ cancelling: false });
            wx.showToast({ title: '网络异常', icon: 'none' });
          }
        });
      }
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goOrders() {
    wx.switchTab({ url: '/pages/order/order' });
  }
});
