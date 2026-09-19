const SCENE_MAP = {
  W1: '就医陪诊', W2: '学习陪伴', W8: '生活协助', W10: '出行陪伴', W11: '线上陪伴'
};

Page({
  data: {
    openid: '',
    loading: true,
    profile: null,
    stats: { post_count: 0 },
    posts: [],
    postEmpty: false,
    page: 1,
    hasMore: true,
    loadingMore: false
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad(opts) {
    const oid = opts.openid || '';
    if (!oid) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    this.setData({ openid: oid });
    this.loadHome();
  },

  loadHome() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'home-action',
      data: { action: 'user_home', openid: this.data.openid }
    }).then((res) => {
      const r = res.result || {};
      if (r.ok) {
        const d = r.data;
        const profile = d.profile || {};
        const stats = d.stats || { post_count: 0 };
        const posts = (d.posts || []).map((p) => {
          const rawImgs = Array.isArray(p.images) ? p.images : (p.cover ? [p.cover] : []);
          const imgs = rawImgs.filter((u) => typeof u === 'string' && u.indexOf('cloud://') === 0).slice(0, 4);
          const fallbackCover = p.cover && p.cover.indexOf('cloud://') === 0 ? p.cover : '';
          const single = imgs.length === 1 ? imgs[0] : (imgs.length === 0 ? fallbackCover : '');
          return Object.assign(p, {
            scene_name: SCENE_MAP[p.scene] || '',
            images: imgs,
            hasCover: !!single,
            cover: single,
            hasGrid: imgs.length > 1,
            hasTags: !!(p.tags && p.tags.length > 0),
            likeText: p.like_count > 0 ? p.like_count + '' : '',
            commentText: p.comment_count > 0 ? p.comment_count + '' : ''
          });
        });
        this.setData({
          loading: false,
          profile: profile,
          stats: stats,
          posts: posts,
          postEmpty: posts.length === 0,
          hasMore: posts.length >= 15
        });
      } else {
        this.setData({ loading: false });
        if (r.code === 'home_user_gone') {
          wx.showToast({ title: '该用户不存在或已注销', icon: 'none' });
        } else {
          wx.showToast({ title: r.msg || '加载失败', icon: 'none' });
        }
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    // 与 partner-home / pages/blog / pages/index 保持一致: blog-detail 读 opts.post_id
    if (id) wx.navigateTo({ url: '/pages/blog-detail/blog-detail?post_id=' + id });
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

  onReachBottom() {
    // 动态不分页, 一次15条, 暂不加载更多
  },

  onPullDownRefresh() {
    this.loadHome();
    setTimeout(() => wx.stopPullDownRefresh(), 1000);
  }
});
