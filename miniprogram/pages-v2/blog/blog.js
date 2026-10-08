// pages-v2/blog/blog.js · 服务动态信息流(推荐广场 / 我的动态 / TA的动态)
// 数据源: blog-action feed_list / my_list(TA的动态走 feed_list + author_openid 过滤)
const { timeAgo } = require('../../utils/util.js');
const { getScene } = require('../../utils/redline.js');
const { BLOG_TOPICS } = require('../../utils/constants.js');
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

const SCENE_OPTS = [{ code: '', name: '全部' }].concat(
  SCENES.map((s) => ({ code: s.code, name: s.icon + ' ' + s.name }))
);
const TOPIC_OPTS = [{ val: '', name: '全部' }].concat(
  BLOG_TOPICS.map((t) => ({ val: t.name, name: '#' + t.name }))
);
const TOPIC_NAMES = BLOG_TOPICS.map((t) => t.name);

Page({
  data: {
    scope: 'feed',        // feed=推荐广场 / my=我的动态 / author=TA的动态
    authorOpenid: '',
    navTitle: '动态',
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

  onShareAppMessage() {
    return { title: '找个人帮忙 · 动态', path: '/pages-v2/blog/blog' };
  },
  onShareTimeline() {
    return { title: '找个人帮忙 · 动态' };
  },

  onLoad(opts) {
    let scope = 'feed';
    let authorOpenid = '';
    if (opts && opts.scope === 'my') scope = 'my';
    else if (opts && opts.scope === 'author' && opts.authorOpenid) { scope = 'author'; authorOpenid = opts.authorOpenid; }
    // 从详情话题标签跳入时预设话题筛选(参数可能被编码)
    let topic = '';
    if (opts && opts.tag) {
      let tag = opts.tag;
      try { tag = decodeURIComponent(opts.tag); } catch (e) { tag = opts.tag; }
      if (TOPIC_NAMES.indexOf(tag) >= 0) topic = tag;
    }
    this.setData({ scope, authorOpenid, activeTopic: topic, navTitle: this.titleOf(scope) });
  },

  titleOf(scope) {
    return scope === 'my' ? '我的动态' : scope === 'author' ? 'TA的动态' : '动态';
  },

  onShow() {
    // 从发布页返回时刷新第一页
    this.loadList(true);
  },

  onPullDownRefresh() {
    this.loadList(true, () => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadList(false);
  },

  switchScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    // 从 TA的动态 切回广场/我的时清除作者过滤
    this.setData({ scope, authorOpenid: '', activeScene: '', activeTopic: '', list: [], page: 1, showEmpty: false, loading: true, navTitle: this.titleOf(scope) });
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

  // reset=true 回到第 1 页(不可直接用事件对象当布尔)
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
    } else if (this.data.scope === 'author' && this.data.authorOpenid) {
      data.author_openid = this.data.authorOpenid;
    }

    callCloud('blog-action', data).then((r) => {
      if (r && r.ok) {
        const rows = ((r.data && r.data.list) || []).map((p) => this.decorate(p));
        const list = doReset ? rows : this.data.list.concat(rows);
        this.setData({
          list, page: nextPage, hasMore: !!(r.data && r.data.has_more),
          loading: false, loadingMore: false, showEmpty: list.length === 0
        });
      } else {
        this.setData({ loading: false, loadingMore: false, showEmpty: this.data.list.length === 0 });
        wx.showToast({ title: (r && r.msg) || '加载失败', icon: 'none' });
      }
    }).then(() => { if (typeof cb === 'function') cb(); });
  },

  onLoadMore() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadList(false);
  },

  // WXML 只做属性访问: 时间、场景名、图片布局、点赞 class 全部在此预处理
  decorate(p) {
    const scene = getScene(p.scene);
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
      gridCols: imgCount >= 3 ? 3 : 2,
      likeCount: p.like_count || 0,
      commentCount: p.comment_count || 0,
      liked: !!p.liked,
      likeCls: p.liked ? 'bl__foot-item--on' : '',
      timeText: timeAgo(p.created_at),
      offline: p.status === 'offline'
    };
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages-v2/blog-detail/blog-detail?post_id=' + id });
  },

  // 作者头像/昵称 → 耍伴公开主页(catchtap 阻止冒泡到卡片 goDetail)
  goAuthor(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) return;
    wx.navigateTo({ url: '/pages-v2/partner-detail/partner-detail?partnerOpenid=' + openid, fail: () => wx.showToast({ title: '主页暂不可用', icon: 'none' }) });
  },

  goTopic(e) {
    const tag = e.currentTarget.dataset.tag;
    if (tag) wx.navigateTo({ url: '/pages-v2/blog/blog?tag=' + encodeURIComponent(tag) });
  },

  previewImage(e) {
    const { urls, current } = e.currentTarget.dataset;
    wx.previewImage({ current, urls });
  },

  goPublish() {
    // v2 登录态检查: login.js 登录成功后写 v2_login_ok, profile.js 退出时删除
    if (!wx.getStorageSync('v2_login_ok')) {
      wx.showModal({
        title: '需要先登录',
        content: '发布动态前请先授权登录',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages-v2/login/login' });
        }
      });
      return;
    }
    wx.navigateTo({ url: '/pages-v2/blog-publish/blog-publish' });
  }
});