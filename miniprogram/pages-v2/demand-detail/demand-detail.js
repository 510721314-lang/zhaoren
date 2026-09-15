// PRD章节: 2.2 需求详情 / 3.3 发布流程 / R9 场景认证校验
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { takeOrder } = require('../../utils/take-order.js');

Page({
  data: {
    demand: null,
    scene: null,
    role: 'partner',
    certified: true,   // 接单方场景签署在后端(create_from_take 强校验), 前端不灰态拦截
    recommendPartners: [],
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
    if (this.data.isRedline) {
      wx.showToast({ title: `夜间${CONFIG.TIME_REDLINE.close}-${CONFIG.TIME_REDLINE.open}暂停接单`, icon: 'none' });
      return;
    }
    const demand = this.data.demand;
    if (!demand) return;
    // 直接进接单链路: 免责声明 modal(同意并接单) → 定位 → 建单
    // 不用 bottom-sheet 二次确认(真机渲染不可靠, 与免责声明根治同一方案)
    takeOrder(demand, {
      onSuccess: (data) => {
        wx.showToast({ title: '接单成功,已进入待确认(S1)', icon: 'success', duration: 1500 });
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages-v2/chat/chat?orderId=${data.order_id}`,
            fail: () => wx.showToast({ title: '聊天页打开失败', icon: 'none' })
          });
        }, 700);
      },
      onError: (r) => {
        // 需求已被抢/过期 → 刷新详情同步状态
        if (r && (r.code === 'order_demand_closed' || r.code === 'order_demand_expired')) {
          this.reload();
        }
      }
    });
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
