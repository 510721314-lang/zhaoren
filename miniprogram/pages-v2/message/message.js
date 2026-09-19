// PRD章节: 3.4 消息体系 / 3.5.2 订单状态 / 3.4.4 留存规则
// P0-5: 接云端 im-conv my_convs, 删除 mock conversations 依赖
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    retentionText: `未成单记录保留${CONFIG.MESSAGE_RETENTION.unDealDays}天 · 成单后保留至订单完成${CONFIG.MESSAGE_RETENTION.dealtDays}天`,
    orderList: [],
    entries: { system: null, kefu: null },
    isRedline: false,
    loading: false,
    loadError: false,
    loadErrorMsg: ''
  },

  onLoad() {
    this.fetchData();
  },

  fetchData() {
    this.setData({ loading: true, loadError: false });
    callCloud('im-conv', { action: 'my_convs' }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true, loadErrorMsg: r.msg || '加载失败' });
        return;
      }
      this.buildList((r.data && r.data.list) || []);
      this.setData({ loading: false });
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请重试' });
    });
  },

  reload() {
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    // 每次进入消息列表刷新未读数
    if (!this.data.loading) this.fetchData();
  },

  buildList(list) {
    const decorated = list.map((c) => {
      const peer = c.peer || {};
      const sceneName = c.scene_name || '';
      const peerName = peer.nickname || '';
      const lastText = c.last_msg_text || '';
      return Object.assign({}, c, {
        _id: c.conv_id,     // WXML 列表 key
        counterpart: peerName,
        avatar: (peer.avatar && /^https?:/.test(peer.avatar)) ? peer.avatar : '',
        order_status: c.status || '',
        sceneName,
        displayTitle: peerName && sceneName ? `${peerName} · ${sceneName}` : (peerName || sceneName || '会话'),
        summary: lastText,
        unread_count: c.unread || 0,
        pinned: false,
        is_read: !c.unread
      });
    });
    this.setData({
      orderList: decorated,
      entries: { system: null, kefu: null } // 系统通知/客服入口后续接
    });
  },

  // M1 长按：置顶 / 删除
  onLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.orderList.find((c) => c._id === id);
    if (!target) return;
    wx.showActionSheet({
      itemList: ['置顶', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showToast({ title: '置顶功能待后端支持', icon: 'none' });
        } else {
          this.setData({ orderList: this.data.orderList.filter((c) => c._id !== id) });
          wx.showToast({ title: '已删除(本地)', icon: 'none' });
        }
      }
    });
  },

  onConvTap(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.orderList.find((c) => c._id === id);
    if (!target) return;
    // 本地立即清未读数
    const orderList = this.data.orderList.map((c) => c._id === id ? Object.assign({}, c, { unread_count: 0, is_read: true }) : c);
    this.setData({ orderList });
    wx.navigateTo({
      url: `/pages-v2/chat/chat?orderId=${target.order_id || ''}`,
      fail: () => wx.showToast({ title: '跳转失败', icon: 'none' })
    });
  },

  // M2 固定入口
  onSystemTap() {
    wx.showToast({ title: '系统通知列表待接入', icon: 'none' });
  },
  onKefuTap() {
    wx.showToast({ title: '平台客服7×24小时接入中', icon: 'none' });
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
