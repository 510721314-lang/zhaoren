// 附近可接需求列表: 复用 home-action nearby(按发布时间倒序), 每页20条, 下拉刷新 + 触底加载更多
const callCloud = (name, data) => wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });

Page({
  data: {
    list: [],
    page: 0,           // 已加载到的页码
    pageSize: 20,
    hasMore: true,
    loading: false,
    loaded: false,
    empty: false
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙 · 附近可接',
      path: '/pages-v2/index/index'
    };
  },

  onLoad() {
    // onLoad 已拉首屏, 首次 onShow 跳过避免双拉
    this.__skipNextShow = true;
    this.loadMore();
  },

  onShow() {
    if (this.__skipNextShow) { this.__skipNextShow = false; return; }
    // 发布/编辑返回: 重置并重新拉第一页, 保证新需求出现在顶部
    this.resetLoadMore();
  },

  onReachBottom() {
    this.loadMore();
  },

  onPullDownRefresh() {
    this.resetLoadMore(() => wx.stopPullDownRefresh());
  },

  resetLoadMore(done) {
    this.setData({ list: [], page: 0, hasMore: true, loaded: false, empty: false });
    this.loadMore(done);
  },

  // 按 page 递增加载 nearby(created_at 降序), page_size 20
  loadMore(done) {
    if (this.data.loading) { if (done) done(); return; }
    if (!this.data.hasMore) { if (done) done(); return; }
    this.setData({ loading: true });
    const page = this.data.page + 1;
    callCloud('home-action', { action: 'nearby', page, page_size: this.data.pageSize }).then((r) => {
      if (r.ok && r.data) {
        const list = (this.data.list || []).concat(r.data.list || []);
        this.setData({
          list,
          page,
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
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
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
  }
});