// 场景需求更多列表: 每页50条, 底部醒目「加载更多」按钮无限翻页
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    sceneCode: '',
    sceneName: '',
    sceneIcon: '',
    list: [],
    skip: 0,
    hasMore: true,
    loading: false,
    loaded: false,
    empty: false
  },

  onLoad(options) {
    // onLoad 已拉首页, 首次 onShow 跳过; 从发布页返回时重置到第一页刷新
    this.__skipNextShow = true;
    const code = options.scene || '';
    const scene = SCENES.find((s) => s.code === code);
    const name = decodeURIComponent(options.name || '') || (scene && scene.name) || '需求列表';
    wx.setNavigationBarTitle({ title: name });
    this.setData({ sceneCode: code, sceneName: name, sceneIcon: (scene && scene.icon) || '' });
    this.loadMore();
  },

  onShow() {
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    // 发布/编辑返回: 重置翻页并重新拉第一页, 保证新需求出现在顶部
    this.setData({ list: [], skip: 0, hasMore: true, loaded: false, empty: false });
    this.loadMore();
  },

  onPullDownRefresh() {
    this.setData({ list: [], skip: 0, hasMore: true, loaded: false, empty: false });
    this.loadMore(() => wx.stopPullDownRefresh());
  },

  loadMore(done) {
    if (this.data.loading) { if (done) done(); return; }
    if (!this.data.hasMore) { if (done) done(); return; }
    this.setData({ loading: true });
    callCloud('home-action', {
      action: 'scene_list',
      scene_code: this.data.sceneCode,
      skip: this.data.skip
    }).then((r) => {
      if (r.ok && r.data) {
        const list = (this.data.list || []).concat(r.data.list || []);
        this.setData({
          list,
          skip: r.data.next_skip,
          hasMore: !!r.data.has_more,
          empty: list.length === 0,
          loaded: true,
          loading: false
        });
      } else {
        this.setData({ loading: false, loaded: true });
        wx.showToast({ title: r.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false, loaded: true });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }).then(() => { if (done) done(); });
  },

  onMoreTap() {
    this.loadMore();
  },

  onDemandTap(e) {
    const demand = (e.detail && e.detail.demand) || {};
    if (!demand._id) {
      wx.showToast({ title: '需求数据异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/demand-detail/demand-detail?id=${demand._id}`,
      fail: () => wx.showToast({ title: '详情页打开失败', icon: 'none' })
    });
  },

  onPublishTap() {
    wx.navigateTo({
      url: `/pages-v2/publish/publish?sceneCode=${this.data.sceneCode}`,
      fail: () => wx.showToast({ title: '发布页打开失败', icon: 'none' })
    });
  }
});
