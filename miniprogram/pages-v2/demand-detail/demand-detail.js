// PRD章节: 2.2 需求详情 / 3.3 发布流程 / R9 场景认证校验
const redline = require('../../utils/redline.js');
const { getScene } = redline;
const CONFIG = require('../../config/index.js');
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
    confirmTimeoutMin: CONFIG.ORDER.confirmTimeoutMin,
    loadErrMsg: ''
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
          const scene = getScene(demand.scene_code);
          this.setData({
            demand,
            scene,
            isOwner: !!demand.is_owner,
            role: demand.is_owner ? 'user' : 'partner',
            loading: false
          });
          this.__scheduleOwnerWatch(demand);
        } else {
          this.setData({ loading: false, loadError: true, loadErrMsg: (r.msg || r.code || '详情加载失败') });
        }
      },
      fail: (err) => {
        this.setData({ loading: false, loadError: true, loadErrMsg: (err && err.errMsg) || '详情加载失败' });
      }
    });
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  // 发布者端接单感知: 停留详情页期间耍伴接单 → 自动跳转确认页(用 detail_light 轮询, 不自增浏览)
  __scheduleOwnerWatch(demand) {
    const owner = !!(demand && demand.is_owner);
    if (!owner || this.__ownerPrompted || this.__ownerPoll) return;
    this.__ownerPollLaunch = Date.now();
    this.__ownerPoll = setInterval(() => { this.__pollOwnerLight(); }, 5000);
    this.__pollOwnerLight();
  },
  __pollOwnerLight() {
    if (this.__ownerPrompted) return;
    const id = this.__lastOptions && this.__lastOptions.id;
    if (!id) return;
    wx.cloud.callFunction({
      name: 'demand-publish',
      data: { action: 'detail_light', demand_id: id },
      success: (res) => {
        const d = (res.result && res.result.ok && res.result.data) || null;
        if (!d || !d.is_owner) { this.stopOwnerPoll(); return; }
        if (d.status && d.status !== 'matching') {
          this.stopOwnerPoll();
          if (d.order_id && !this.__ownerPrompted) {
            this.__ownerPrompted = true;
            wx.showModal({
              title: '👥 已有人接单',
              content: '耍伴已接单并发起确认，是否前往核对确认？',
              confirmText: '去确认',
              cancelText: '稍后',
              confirmColor: '#07C160',
              success: (res) => {
                if (res.confirm) {
                  wx.redirectTo({
                    url: `/pages-v2/chat/chat?orderId=${d.order_id}`,
                    fail: () => { this.__ownerPrompted = false; }
                  });
                }
                // 点"稍后": 停轮询, 留在详情页, 不反复弹; 需求发布者之后可从订单/消息进入
              },
              fail: () => { this.__ownerPrompted = false; }
            });
          }
        } else if (this.__ownerPollLaunch && Date.now() - this.__ownerPollLaunch > 90000) {
          this.stopOwnerPoll();
        }
      },
      fail: () => {}
    });
  },
  stopOwnerPoll() {
    if (this.__ownerPoll) { clearInterval(this.__ownerPoll); this.__ownerPoll = null; }
  },

  onShareAppMessage() {
    const d = this.data.demand || {};
    const scene = this.data.scene || {};
    const title = d.title || d.remark || d.project_name || (scene.name ? `${scene.name}帮忙需求` : '找个人帮忙');
    const id = d._id || (this.__lastOptions && this.__lastOptions.id) || '';
    return {
      title: String(title).slice(0, 30),
      path: `/pages-v2/demand-detail/demand-detail?id=${id}`,
      imageUrl: ''
    };
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    // 编辑需求/其他页返回时刷新详情(P1-o: 原 onShow 不刷数据导致编辑后看到旧内容)
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    this.reload();
  },

  onHide() { this.stopOwnerPoll(); },
  onUnload() { this.stopOwnerPoll(); },

  onGrab(e) {
    if (this.data.isRedline) {
      wx.showToast({ title: `夜间${redline.DISPLAY_CLOSE}-${CONFIG.TIME_REDLINE.open}暂停接单`, icon: 'none' });
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
      fail: () => wx.showToast({ title: '修改功能暂不可用', icon: 'none' })
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
  onReserve() { require('../../utils/redline.js').reserveNotice(); }
});
