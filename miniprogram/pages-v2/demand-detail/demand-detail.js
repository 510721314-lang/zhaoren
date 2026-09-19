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
    // onLoad 已拉首屏, 首次 onShow 跳过; 之后 onShow(编辑/接单返回)静默刷新
    this.__skipNextShow = true;
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
    // 编辑需求/其他页返回时刷新详情(P1-o: 原 onShow 不刷数据导致编辑后看到旧内容)
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.reload();
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
    // 只有 matching(待匹配) 状态可编辑, 进入 publish 页 edit 模式
    const s = this.data.demand && this.data.demand.status;
    if (s !== 'matching') {
      wx.showModal({
        title: '当前状态不可编辑',
        content: '仅待匹配状态的需求可编辑',
        showCancel: false
      });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/publish/publish?mode=edit&demand_id=${this.data.demand._id}`,
      fail: () => wx.showToast({ title: '编辑功能暂不可用', icon: 'none' })
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
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
