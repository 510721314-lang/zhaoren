// PRD章节: 2.2 需求详情 / 3.3 发布流程 / R9 场景认证校验
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');

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
    const id = options && options.id;
    if (!id) {
      this.setData({ loading: false, loadError: true });
      return;
    }
    this.setData({ loading: true, loadError: false });
    wx.cloud.callFunction({
      name: 'demand-publish',
      data: { action: 'detail', demand_id: id },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          const demand = r.data;
          const scene = SCENES.find((s) => s.code === demand.scene_code) || null;
          this.setData({
            demand,
            scene,
            isOwner: !!demand.is_owner,
            role: demand.is_owner ? 'user' : 'partner',
            loading: false
          });
        } else {
          this.setData({ loading: false, loadError: true });
        }
      },
      fail: () => {
        this.setData({ loading: false, loadError: true });
      }
    });
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onGrab(e) {
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
          wx.cloud.callFunction({
            name: 'demand-publish',
            data: { action: 'cancel', demand_id: this.data.demand._id },
            success: (r) => {
              const rr = r.result || {};
              if (rr.ok) {
                wx.showToast({ title: '需求已取消', icon: 'none' });
                setTimeout(() => wx.navigateBack(), 800);
              } else {
                wx.showToast({ title: rr.msg || '取消失败', icon: 'none' });
              }
            },
            fail: () => wx.showToast({ title: '网络异常', icon: 'none' })
          });
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
