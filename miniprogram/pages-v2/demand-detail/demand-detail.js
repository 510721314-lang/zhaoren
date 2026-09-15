// PRD章节: 2.2 需求详情 / 3.3 发布流程 / R9 场景认证校验
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { demands } = require('../../mock/demands.js');
const { partners, CURRENT_USER } = require('../../mock/users.js');

Page({
  data: {
    demand: null,
    scene: null,
    role: 'partner',
    certified: false,
    recommendPartners: [],
    sheetVisible: false,
    isOwner: false,
    loading: false,
    loadError: false,
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    confirmTimeoutMin: CONFIG.ORDER.confirmTimeoutMin
  },

  onLoad(options) {
    this.fetchData(options);
  },

  fetchData(options) {
    this.__lastOptions = options || {};
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        const demand = demands.find((d) => d._id === options.id) || demands[0];
        const scene = SCENES.find((s) => s.code === demand.scene_code);
        const isOwner = demand.publisher && demand.publisher.surname === '张';
        const certified = (CURRENT_USER.certified_scenes || []).indexOf(demand.scene_code) > -1;
        // 推荐耍伴（按场景匹配）
        const recPartners = partners.filter((p) => (p.scenes || []).indexOf(demand.scene_code) > -1);
        this.setData({
          demand,
          scene,
          isOwner,
          certified,
          recommendPartners: recPartners.length > 0 ? recPartners : partners,
          role: isOwner ? 'user' : 'partner',
          loading: false
        });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onGrab(e) {
    const demand = e.detail ? e.detail.demand : this.data.demand;
    if (!this.data.certified) {
      wx.showToast({ title: `需先完成${this.data.scene ? this.data.scene.cert : '场景认证'}`, icon: 'none' });
      return;
    }
    this.setData({ sheetVisible: true });
  },

  closeSheet() {
    this.setData({ sheetVisible: false });
  },

  confirmGrab() {
    this.setData({ sheetVisible: false });
    wx.showToast({ title: '抢单成功，已创建S1订单', icon: 'none', duration: 1800 });
    setTimeout(() => {
      wx.navigateTo({
        url: '/pages-v2/chat/chat?orderId=o_s1_001',
        fail: () => wx.showToast({ title: '聊天页已上线', icon: 'none' })
      });
    }, 800);
  },

  onEdit() {
    wx.navigateTo({
      url: `/pages-v2/publish/publish?sceneCode=${this.data.demand.scene_code}`,
      fail: () => wx.showToast({ title: '编辑功能待接入', icon: 'none' })
    });
  },

  onCancel() {
    wx.showModal({
      title: '取消需求',
      content: '取消后需求将下架，确定取消吗？',
      confirmColor: '#fa5151',
      success: (res) => {
        if (res.confirm) {
          wx.showToast({ title: '需求已取消', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 800);
        }
      }
    });
  },

  onPartnerTap(e) {
    wx.navigateTo({
      url: '/pages-v2/partner-detail/partner-detail',
      fail: () => wx.showToast({ title: '耍伴详情已上线', icon: 'none' })
    });
  }
});
