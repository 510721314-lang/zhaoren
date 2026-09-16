// PRD章节: 2.2 需求详情 / 3.3 发布流程 / R9 场景认证校验
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');

// ── 内联: redline.isInRedline() ──
function isInRedline() {
  const now = new Date();
  const h = now.getHours();
  const close = parseInt((CONFIG.TIME_REDLINE.close || '23:00').split(':')[0], 10);
  const open = parseInt((CONFIG.TIME_REDLINE.open || '06:00').split(':')[0], 10);
  // 夜间区间: close(23) → open(6), 跨午夜
  return h >= close || h < open;
}

// ── 内联: take-order.js takeOrder() ──
function takeOrder(demand, callbacks) {
  const disclaimer = '免责声明: 平台仅提供信息撮合, 实际服务由双方自愿达成。接单后请遵守平台规则, 保障服务质量与安全。';
  wx.showModal({
    title: '接单前确认',
    content: disclaimer,
    confirmText: '同意并接单',
    cancelText: '再想想',
    success: (res) => {
      if (!res.confirm) return;
      // 定位
      wx.getLocation({
        type: 'gcj02',
        success: (loc) => {
          wx.showLoading({ title: '正在建单...', mask: true });
          wx.cloud.callFunction({
            name: 'order-action',
            data: {
              action: 'create_from_take',
              demand_id: demand._id,
              scene_code: demand.scene_code,
              pickup: { latitude: loc.latitude, longitude: loc.longitude }
            },
            success: (r) => {
              wx.hideLoading();
              const result = r.result || {};
              if (result.ok && result.data) {
                callbacks.onSuccess && callbacks.onSuccess(result.data);
              } else {
                callbacks.onError && callbacks.onError({ code: result.code, msg: result.msg });
              }
            },
            fail: (err) => {
              wx.hideLoading();
              callbacks.onError && callbacks.onError({ code: 'network', msg: '网络错误' });
            }
          });
        },
        fail: () => {
          wx.showToast({ title: '需要定位权限才能接单', icon: 'none' });
        }
      });
    }
  });
}

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
    this.setData({ isRedline: isInRedline() });
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
    const p = (e.detail && e.detail.partner) || {};
    const openid = p.openid;
    if (!openid) {
      wx.showToast({ title: '耍伴数据异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/partner-detail/partner-detail?partnerOpenid=${openid}`,
      fail: () => wx.showToast({ title: '耍伴详情打开失败', icon: 'none' })
    });
  }
});
