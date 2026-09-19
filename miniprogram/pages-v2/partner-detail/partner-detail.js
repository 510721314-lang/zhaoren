// PRD章节: 3.2.3 耍伴详情 / 3.1.4 认证标识
// 接 partner-action 云函数: detail
const redline = require('../../utils/redline.js');
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

Page({
  data: {
    partner: null,
    sceneList: [],
    sceneRatesMap: {},
    evaluations: [],
    stats: { total_orders: 0, completed_orders: 0 },
    showStats: true,
    expanded: false,
    activeTab: 'intro',
    loading: false,
    loadError: false,
    isRedline: false,
    route: null,          // { distanceText, modes:[{icon,label,text,est}] }
    routeLoading: false,
    locDenied: false
  },

  onLoad(options) {
    this.fetchData(options);
  },

  onShareAppMessage() {
    const p = this.data.partner || {};
    const scenes = (this.data.sceneList || []).map((s) => s.name).filter(Boolean).join('/');
    const title = p.nickname ? `${p.nickname} · 找个人帮忙` : (scenes ? `${scenes}耍伴` : '找个人帮忙');
    const openid = p.openid || (this.__lastOptions && this.__lastOptions.partnerOpenid) || '';
    return {
      title: String(title).slice(0, 30),
      path: `/pages-v2/partner-detail/partner-detail?partnerOpenid=${openid}`,
      imageUrl: ''
    };
  },

  async fetchData(options) {
    this.__lastOptions = options || {};
    const partnerOpenid = options && options.partnerOpenid;
    if (!partnerOpenid) {
      this.setData({ loadError: true });
      return;
    }

    this.setData({ loading: true, loadError: false });
    try {
      const r = await callCloud('partner-action', {
        action: 'detail',
        partner_openid: partnerOpenid
      });
      if (!r.ok) {
        wx.showToast({ title: r.msg || '加载失败', icon: 'none' });
        this.setData({ loading: false, loadError: true });
        return;
      }
      const { partner, stats, evaluations } = r.data;
      const sceneList = (partner.accept_scenes || [])
        .map((code) => SCENES.find((s) => s.code === code))
        .filter(Boolean);

      // avatar 正则校验 (后端可能返回 openid)
      let avatar = partner.avatar || '';
      if (avatar && !/^https?:/.test(avatar)) avatar = '';

      this.setData({
        partner: { ...partner, avatar },
        sceneList,
        sceneRatesMap: partner.scene_rates || {},
        evaluations: evaluations || [],
        stats: stats || {},
        showStats: (stats.completed_orders || 0) >= 3,
        loading: false
      });

      // 耍伴设置了日常位置: 取浏览者定位 → 云端路线规划
      if (partner.home_location && partner.home_location.latitude) {
        this.fetchRoute();
      }
    } catch (e) {
      this.setData({ loading: false, loadError: true });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  // 取浏览者当前位置(gcj02) → 云端算路（耍伴日常位置 → 浏览者）
  fetchRoute() {
    const partner = this.data.partner;
    if (!partner || !partner.openid) return;
    this.setData({ routeLoading: true, locDenied: false, route: null });
    wx.getLocation({
      type: 'gcj02',
      success: async (loc) => {
        try {
          const r = await callCloud('partner-action', {
            action: 'route_plan',
            partner_openid: partner.openid,
            latitude: loc.latitude,
            longitude: loc.longitude
          });
          if (r.ok) {
            this.setData({ route: this.buildRouteView(r.data), routeLoading: false });
          } else {
            this.setData({ routeLoading: false });
            console.warn('[partner-detail] route_plan fail:', r.code, r.msg);
          }
        } catch (e) {
          this.setData({ routeLoading: false });
          console.error('[partner-detail] route_plan error:', e);
        }
      },
      fail: (err) => {
        this.setData({ routeLoading: false, locDenied: true });
        console.warn('[partner-detail] getLocation fail:', err);
      }
    });
  },

  // 云端数值 → 页面展示文案（WXML 不能做复杂运算，全部预算好）
  buildRouteView(d) {
    const fmtDist = (m) => {
      if (m < 1000) return m + '米';
      return (Math.round(m / 100) / 10) + '公里';
    };
    const fmtMin = (min) => {
      if (min < 60) return min + '分钟';
      const h = Math.floor(min / 60);
      const rest = min % 60;
      return h + '小时' + (rest ? rest + '分' : '');
    };
    const defs = [
      { key: 'drive', icon: '🚗', label: '驾车' },
      { key: 'transit', icon: '🚇', label: '公交/地铁' },
      { key: 'bike', icon: '🚴', label: '骑行' }
    ];
    const modes = defs
      .filter((def) => d.modes && d.modes[def.key] && d.modes[def.key].minutes)
      .map((def) => ({
        key: def.key,
        icon: def.icon,
        label: def.label,
        text: fmtMin(d.modes[def.key].minutes),
        est: d.modes[def.key].source === 'estimate'
      }));
    return { distanceText: fmtDist(d.distance_m || d.straight_m || 0), modes };
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  toggleExpand() {
    this.setData({ expanded: !this.data.expanded });
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  // 咨询: 成单前 IM 仅对订单参与方开放, 复用定向发布链路
  // (说明后跳发布页, TA 会收到定向邀约通知 = "咨询/邀TA接单")
  onConsult() {
    const openid = this.data.partner && this.data.partner.openid;
    if (!openid) {
      wx.showToast({ title: '耍伴信息加载中，请稍后', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '咨询TA',
      content: '成单前暂不支持私聊。你可以定向发布一条需求，TA 会立即收到邀约通知并可直接接单。',
      confirmText: '去发布',
      cancelText: '再看看',
      success: (res) => {
        if (!res.confirm) return;
        const name = encodeURIComponent(this.data.partner.nickname || '');
        wx.navigateTo({
          url: `/pages-v2/publish/publish?invitePartnerOpenid=${openid}&invitePartnerName=${name}`,
          fail: () => wx.showToast({ title: '跳转失败', icon: 'none' })
        });
      }
    });
  },

  onInvite() {
    const openid = this.data.partner && this.data.partner.openid;
    if (!openid) return;
    const name = encodeURIComponent(this.data.partner.nickname || '');
    wx.navigateTo({
      url: `/pages-v2/publish/publish?invitePartnerOpenid=${openid}&invitePartnerName=${name}`,
      fail: () => wx.showToast({ title: '跳转失败', icon: 'none' })
    });
  },

  // 时薪展示(分→元)
  getRateYuan(code) {
    const fen = this.data.sceneRatesMap && this.data.sceneRatesMap[code];
    return fen ? (fen / 100) + '元/小时' : '面议';
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
