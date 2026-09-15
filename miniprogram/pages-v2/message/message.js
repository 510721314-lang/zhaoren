// PRD章节: 3.4 消息体系 / 3.5.2 订单状态 / 3.4.4 留存规则
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { conversations } = require('../../mock/conversations.js');

Page({
  data: {
    retentionText: `未成单记录保留${CONFIG.MESSAGE_RETENTION.unDealDays}天 · 成单后保留至订单完成${CONFIG.MESSAGE_RETENTION.dealtDays}天`,
    orderList: [],
    entries: { system: null, kefu: null },
    isRedline: false,
    loading: false,
    loadError: false
  },

  onLoad() {
    this.fetchData();
  },

  // mock 数据加载（含三态：loading → loaded / error）
  fetchData() {
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        this.buildList(conversations);
        this.setData({ loading: false });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  reload() {
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  buildList(source) {
    const decorated = source.map((c) => {
      const scene = SCENES.find((s) => s.code === c.scene_code);
      return Object.assign({}, c, {
        sceneName: scene ? scene.name : '',
        displayTitle: scene ? `${c.counterpart} · ${scene.name}` : c.counterpart,
        summary: c.last_msg_type === 'template' ? c.last_msg.replace(/^\[模板\]\s*/, '[模板] ') : c.last_msg
      });
    });
    this.setData({
      orderList: decorated.filter((c) => c.type === 'order').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)),
      entries: {
        system: decorated.find((c) => c.type === 'system'),
        kefu: decorated.find((c) => c.type === 'kefu')
      }
    });
  },

  // M1 长按：置顶 / 删除
  onLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.orderList.find((c) => c._id === id);
    if (!target) return;
    wx.showActionSheet({
      itemList: [target.pinned ? '取消置顶' : '置顶', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          const orderList = this.data.orderList.map((c) => c._id === id ? Object.assign({}, c, { pinned: !c.pinned }) : c)
            .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
          this.setData({ orderList });
          wx.showToast({ title: target.pinned ? '已取消置顶' : '已置顶', icon: 'none' });
        } else {
          this.setData({ orderList: this.data.orderList.filter((c) => c._id !== id) });
          wx.showToast({ title: '已删除', icon: 'none' });
        }
      }
    });
  },

  onConvTap(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.orderList.find((c) => c._id === id);
    // 标记已读
    const orderList = this.data.orderList.map((c) => c._id === id ? Object.assign({}, c, { unread_count: 0, is_read: true }) : c);
    this.setData({ orderList });
    wx.navigateTo({
      url: `/pages-v2/chat/chat?convId=${id}&orderId=${target.order_id || ''}`,
      fail: () => wx.showToast({ title: '聊天页将在批次2上线', icon: 'none' })
    });
  },

  // M2 固定入口
  onSystemTap() {
    wx.showToast({ title: '系统通知列表待接入', icon: 'none' });
  },
  onKefuTap() {
    wx.showToast({ title: '平台客服7×24小时接入中', icon: 'none' });
  }
});
