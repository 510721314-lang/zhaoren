// 活动详情页: 运营 banner/卡片 jump_to=activity_detail 落地页
// 数据源: home-action.activity_detail(按 id 取 active 且时间窗内的活动全量, 含 content)
Page({
  data: {
    loading: true,
    fail: false,
    actId: '',
    act: null,
    content: {}
  },

  onLoad(options) {
    const id = options && options.id;
    if (!id) {
      this.setData({ loading: false, fail: true });
      wx.showToast({ title: '活动参数缺失', icon: 'none' });
      return;
    }
    this.setData({ actId: id });
    const app = getApp();
    app.cloudCall('home-action', { action: 'activity_detail', id }).then((r) => {
      if (r.ok && r.data) {
        this.setData({
          loading: false,
          act: r.data,
          content: r.data.content || {}
        });
        if (r.data.title) wx.setNavigationBarTitle({ title: r.data.title });
      } else {
        this.setData({ loading: false, fail: true });
        wx.showToast({ title: (r && r.msg) || '活动不存在或已结束', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false, fail: true });
      wx.showToast({ title: '加载失败,请稍后重试', icon: 'none' });
    });
  },

  // CTA: 发布需求即报名, 复用需求发布页
  onCtaTap() {
    wx.navigateTo({ url: '/pages-v2/publish/publish' });
  },

  onRetry() {
    this.setData({ loading: true, fail: false });
    this.onLoad({ id: this.data.actId });
  }
});
