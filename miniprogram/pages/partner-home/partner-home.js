// pages/partner-home/partner-home.js - 耍伴公开主页(资料 + 接单统计 + TA 的服务动态)
const { timeAgo } = require('../../utils/util.js');
const { SCENE_LIST } = require('../../utils/constants.js');

const SCENE_MAP = {};
SCENE_LIST.forEach((s) => { SCENE_MAP[s.code] = s; });

Page({
  data: {
    openid: '',
    loading: true,
    profile: null,
    stats: null,
    sceneNames: [],
    cityText: '',
    posts: [],
    page: 1,
    hasMore: false,
    loadingMore: false,
    postEmpty: false
  },

  onLoad(opts) {
    const openid = (opts && opts.openid) || '';
    this.setData({ openid });
    if (!openid) { this.setData({ loading: false }); return; }
    this.loadHome();
    this.loadPosts(true);
  },

  loadHome() {
    wx.cloud.callFunction({
      name: 'blog-action',
      data: { action: 'author_home', author_openid: this.data.openid },
      success: (res) => {
        const r = res.result;
        if (r && r.ok) {
          const p = r.data.profile;
          const s = r.data.stats;
          const sceneNames = (p.accept_scenes || []).map((code) => {
            const sc = SCENE_MAP[code];
            return sc ? sc.icon + ' ' + sc.name : code;
          });
          this.setData({
            profile: {
              nickname: p.nickname, avatar: p.avatar,
              isPartner: !!p.is_partner, isSelf: !!p.is_self, abnormal: !!p.abnormal,
              creditScore: p.partner_credit_score || 0,
              hasAvatar: !!p.avatar
            },
            stats: {
              totalOrders: s.total_orders, doneOrders: s.done_orders,
              evalCount: s.eval_count, avgStar: s.avg_star, postCount: s.post_count,
              starText: s.avg_star ? s.avg_star.toFixed(1) : '暂无'
            },
            sceneNames,
            cityText: (p.city || []).join('、'),
            loading: false
          });
          wx.setNavigationBarTitle({ title: p.nickname + ' 的主页' });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: (r && r.msg) || '用户不存在', icon: 'none' });
        }
      },
      fail: () => { this.setData({ loading: false }); wx.showToast({ title: '网络异常', icon: 'none' }); }
    });
  },

  loadPosts(reset) {
    const doReset = reset === true;
    const page = doReset ? 1 : this.data.page + 1;
    if (!doReset) this.setData({ loadingMore: true });
    wx.cloud.callFunction({
      name: 'blog-action',
      data: { action: 'feed_list', author_openid: this.data.openid, page },
      success: (res) => {
        const r = res.result;
        if (r && r.ok) {
          const rows = (r.data.list || []).map(this.decorate.bind(this));
          const posts = doReset ? rows : this.data.posts.concat(rows);
          this.setData({ posts, page, hasMore: !!r.data.has_more, loadingMore: false, postEmpty: posts.length === 0 });
        } else this.setData({ loadingMore: false });
      },
      fail: () => this.setData({ loadingMore: false })
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadPosts(false);
  },

  decorate(p) {
    const imgCount = (p.images || []).length;
    return {
      _id: p._id, content: p.content, images: p.images || [],
      tags: p.tags || [], hasTags: (p.tags || []).length > 0,
      imgCount, single: imgCount === 1, multi: imgCount > 1,
      likeCount: p.like_count || 0, commentCount: p.comment_count || 0,
      timeText: timeAgo(p.created_at)
    };
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/blog-detail/blog-detail?post_id=' + e.currentTarget.dataset.id });
  },

  previewImage(e) {
    const { urls, current } = e.currentTarget.dataset;
    wx.previewImage({ current, urls });
  }
});
