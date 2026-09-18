// pages/blog/blog.js - 耍伴服务动态信息流(推荐广场 / 我的动态)
const { timeAgo } = require('../../utils/util.js');
const { SCENE_LIST, BLOG_TOPICS } = require('../../utils/constants.js');
const app = getApp();

const SCENE_MAP = {};
SCENE_LIST.forEach((s) => { SCENE_MAP[s.code] = s; });
const SCENE_OPTS = [{ code: '', name: '全部' }].concat(
  SCENE_LIST.map((s) => ({ code: s.code, name: s.icon + ' ' + s.name }))
);
const TOPIC_OPTS = [{ val: '', name: '全部' }].concat(
  BLOG_TOPICS.map((t) => ({ val: t.name, name: '#' + t.name }))
);
const TOPIC_NAMES = BLOG_TOPICS.map((t) => t.name);
const MAX_IMAGES = 9;

Page({
  data: {
    scope: 'feed',        // feed=广场 / my=我的动态
    sceneOpts: SCENE_OPTS,
    topicOpts: TOPIC_OPTS,
    activeScene: '',
    activeTopic: '',
    list: [],
    page: 1,
    hasMore: false,
    loading: true,
    loadingMore: false,
    showEmpty: false
  },

  onLoad(opts) {
    const scope = opts && opts.scope === 'my' ? 'my' : 'feed';
    // 从详情话题标签跳入时预设话题筛选
    let topic = '';
    if (opts && opts.tag && TOPIC_NAMES.indexOf(opts.tag) >= 0) topic = opts.tag;
    this.setData({ scope, activeTopic: topic });
  },

  onShow() {
    // 从发布页返回时刷新第一页
    this.loadList(true);
  },

  onPullDownRefresh() {
    this.loadList(true, () => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadList(false);
    }
  },

  switchScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    this.setData({ scope, activeScene: '', activeTopic: '', list: [], page: 1, showEmpty: false, loading: true });
    this.loadList(true);
  },

  switchScene(e) {
    const code = e.currentTarget.dataset.code || '';
    if (code === this.data.activeScene) return;
    this.setData({ activeScene: code, list: [], page: 1, showEmpty: false, loading: true });
    this.loadList(true);
  },

  switchTopic(e) {
    const val = e.currentTarget.dataset.val || '';
    if (val === this.data.activeTopic) return;
    this.setData({ activeTopic: val, list: [], page: 1, showEmpty: false, loading: true });
    this.loadList(true);
  },

  // reset=true 回到第 1 页(注意: 不能直接用事件对象当布尔)
  loadList(reset, cb) {
    const doReset = reset === true;
    const nextPage = doReset ? 1 : this.data.page + 1;
    if (!doReset) this.setData({ loadingMore: true });
    else this.setData({ loading: true });

    const action = this.data.scope === 'my' ? 'my_list' : 'feed_list';
    const data = { action, page: nextPage };
    if (this.data.scope === 'feed') {
      if (this.data.activeScene) data.scene = this.data.activeScene;
      if (this.data.activeTopic) data.tag = this.data.activeTopic;
    }

    wx.cloud.callFunction({
      name: 'blog-action',
      data,
      success: (res) => {
        const r = res.result;
        if (r && r.ok) {
          const rows = (r.data.list || []).map((p) => this.decorate(p));
          const list = doReset ? rows : this.data.list.concat(rows);
          this.setData({
            list, page: nextPage, hasMore: !!r.data.has_more,
            loading: false, loadingMore: false, showEmpty: list.length === 0
          });
        } else {
          this.setData({ loading: false, loadingMore: false, showEmpty: this.data.list.length === 0 });
          wx.showToast({ title: (r && r.msg) || '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ loading: false, loadingMore: false, showEmpty: this.data.list.length === 0 });
        wx.showToast({ title: '网络异常,请稍后重试', icon: 'none' });
      },
      complete: () => { if (typeof cb === 'function') cb(); }
    });
  },

  // WXML 只做属性访问/三元: 时间、场景名、图片布局、点赞 class 全部在此预处理
  decorate(p) {
    const scene = SCENE_MAP[p.scene];
    const imgCount = (p.images || []).length;
    return {
      _id: p._id,
      authorOpenid: p.author_openid || '',
      author_nickname: p.author_nickname || '微信用户',
      author_avatar: p.author_avatar || '',
      hasAvatar: !!p.author_avatar,
      isPartner: !!p.is_partner,
      sceneName: scene ? scene.icon + ' ' + scene.name : '',
      hasScene: !!scene,
      content: p.content,
      images: p.images || [],
      tags: p.tags || [],
      hasTags: (p.tags || []).length > 0,
      imgCount,
      single: imgCount === 1,
      multi: imgCount > 1,
      likeCount: p.like_count || 0,
      commentCount: p.comment_count || 0,
      liked: !!p.liked,
      likeCls: p.liked ? 'like-on' : '',
      timeText: timeAgo(p.created_at),
      offline: p.status === 'offline'
    };
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/blog-detail/blog-detail?post_id=' + id });
  },

  // 作者头像/昵称 → 耍伴公开主页(catchtap 阻止冒泡到卡片 goDetail)
  goAuthor(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) return;
    wx.navigateTo({ url: '/pages/partner-home/partner-home?openid=' + openid });
  },

  previewImage(e) {
    const { urls, current } = e.currentTarget.dataset;
    wx.previewImage({ current, urls });
  },

  goPublish() {
    // v2 登录态检查: login.js 登录成功后写 v2_login_ok=true, profile.js 退出登录时删除
    if (!wx.getStorageSync('v2_login_ok')) {
      wx.showModal({
        title: '需要先登录',
        content: '发布动态前请先授权登录',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages-v2/login/login' });
          }
        }
      });
      return;
    }
    wx.navigateTo({ url: '/pages/blog-publish/blog-publish' });
  }
});
