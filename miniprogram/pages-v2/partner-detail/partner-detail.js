// PRD章节: 3.2.3 耍伴详情 / 3.1.4 认证标识
// 接 partner-action 云函数: detail
const redline = require('../../utils/redline.js');
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
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
    isRedline: false
  },

  onLoad(options) {
    this.fetchData(options);
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
    } catch (e) {
      this.setData({ loading: false, loadError: true });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  toggleExpand() {
    this.setData({ expanded: !this.data.expanded });
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  onConsult() {
    // 跳到发单页预填对方
    wx.showToast({ title: '定向咨询开发中', icon: 'none' });
  },

  onInvite() {
    const openid = this.data.partner && this.data.partner.openid;
    if (!openid) return;
    wx.navigateTo({
      url: `/pages-v2/publish/publish?invitePartnerOpenid=${openid}`,
      fail: () => wx.showToast({ title: '跳转失败', icon: 'none' })
    });
  },

  // 时薪展示(分→元)
  getRateYuan(code) {
    const fen = this.data.sceneRatesMap && this.data.sceneRatesMap[code];
    return fen ? (fen / 100) + '元/小时' : '面议';
  }
});
