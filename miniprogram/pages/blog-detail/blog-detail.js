// pages/blog-detail/blog-detail.js - 动态详情(大图/点赞/评论/删除)
const { timeAgo } = require('../../utils/util.js');
const { SCENE_LIST } = require('../../utils/constants.js');
const app = getApp();

const SCENE_MAP = {};
SCENE_LIST.forEach((s) => { SCENE_MAP[s.code] = s; });

Page({
  data: {
    postId: '',
    post: null,
    comments: [],
    page: 1,
    hasMore: false,
    loading: true,
    commentText: '',
    sending: false,
    showCommentEmpty: false
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad(opts) {
    this.setData({ postId: (opts && opts.post_id) || '' });
    this.loadDetail();
    this.loadComments(true);
  },

  loadDetail() {
    if (!this.data.postId) return;
    wx.cloud.callFunction({
      name: 'blog-action',
      data: { action: 'detail', post_id: this.data.postId },
      success: (res) => {
        const r = res.result;
        if (r && r.ok) {
          this.setData({ post: this.decoratePost(r.data.post), loading: false });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: (r && r.msg) || '动态不存在', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  decoratePost(p) {
    const scene = SCENE_MAP[p.scene];
    return {
      _id: p._id,
      authorOpenid: p.author_openid || '',
      author_nickname: p.author_nickname || '微信用户',
      author_avatar: p.author_avatar || '',
      hasAvatar: !!p.author_avatar,
      isPartner: !!p.is_partner,
      isAuthor: !!p.is_author,
      sceneName: scene ? scene.icon + ' ' + scene.name : '',
      hasScene: !!scene,
      content: p.content,
      images: p.images || [],
      hasImages: (p.images || []).length > 0,
      tags: p.tags || [],
      hasTags: (p.tags || []).length > 0,
      likeCount: p.like_count || 0,
      commentCount: p.comment_count || 0,
      viewCount: p.view_count || 0,
      liked: !!p.liked,
      likeCls: p.liked ? 'like-on' : '',
      timeText: timeAgo(p.created_at)
    };
  },

  // → 作者公开主页
  goAuthor() {
    const oid = this.data.post && this.data.post.authorOpenid;
    if (oid) wx.navigateTo({ url: '/pages/partner-home/partner-home?openid=' + oid });
  },

  // 点话题 → 同话题信息流
  goTopic(e) {
    const tag = e.currentTarget.dataset.tag;
    if (tag) wx.navigateTo({ url: '/pages/blog/blog?tag=' + encodeURIComponent(tag) });
  },

  loadComments(reset) {
    const doReset = reset === true;
    const nextPage = doReset ? 1 : this.data.page + 1;
    wx.cloud.callFunction({
      name: 'blog-action',
      data: { action: 'comment_list', post_id: this.data.postId, page: nextPage },
      success: (res) => {
        const r = res.result;
        if (r && r.ok) {
          const rows = (r.data.list || []).map((c) => ({
            _id: c._id,
            author_nickname: c.author_nickname || '微信用户',
            author_avatar: c.author_avatar || '',
            content: c.content,
            isAuthor: !!c.is_author,
            timeText: timeAgo(c.created_at)
          }));
          const comments = doReset ? rows : this.data.comments.concat(rows);
          this.setData({
            comments, page: nextPage, hasMore: !!r.data.has_more,
            showCommentEmpty: comments.length === 0
          });
        }
      }
    });
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadComments(false);
  },

  previewImage(e) {
    const { urls, current } = e.currentTarget.dataset;
    wx.previewImage({ current, urls });
  },

  // 点赞 / 取消(乐观更新, 失败回滚)
  toggleLike() {
    const p = this.data.post;
    if (!p || this._liking) return;
    this._liking = true;
    const willLike = !p.liked;
    const prevLiked = p.liked;
    const prevCount = p.likeCount;
    this.setData({
      'post.liked': willLike,
      'post.likeCls': willLike ? 'like-on' : '',
      'post.likeCount': Math.max(0, prevCount + (willLike ? 1 : -1))
    });
    wx.cloud.callFunction({
      name: 'blog-action',
      data: { action: willLike ? 'like' : 'unlike', post_id: this.data.postId },
      success: (res) => {
        if (!(res.result && res.result.ok)) {
          this.setData({ 'post.liked': prevLiked, 'post.likeCls': prevLiked ? 'like-on' : '', 'post.likeCount': prevCount });
          wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ 'post.liked': prevLiked, 'post.likeCls': prevLiked ? 'like-on' : '', 'post.likeCount': prevCount });
        wx.showToast({ title: '网络异常', icon: 'none' });
      },
      complete: () => { this._liking = false; }
    });
  },

  onCommentInput(e) { this.setData({ commentText: e.detail.value }); },

  onSendComment() {
    const content = (this.data.commentText || '').trim();
    if (!content) { wx.showToast({ title: '说点什么吧', icon: 'none' }); return; }
    if (!app.globalData.userInfo) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    if (this.data.sending) return;
    this.setData({ sending: true });
    wx.showLoading({ title: '发送中', mask: true });
    wx.cloud.callFunction({
      name: 'blog-action',
      data: { action: 'comment_add', post_id: this.data.postId, content },
      success: (res) => {
        wx.hideLoading();
        this.setData({ sending: false });
        const r = res.result;
        if (r && r.ok) {
          this.setData({ commentText: '' });
          this.loadComments(true);
          this.setData({ 'post.commentCount': this.data.post.commentCount + 1, showCommentEmpty: false });
        } else {
          wx.showToast({ title: (r && r.msg) || '评论失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ sending: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  // 删除自己的动态(二次确认)
  onDeletePost() {
    wx.showModal({
      title: '删除动态',
      content: '删除后不可恢复，确定删除这条动态吗？',
      confirmText: '删除',
      confirmColor: '#B03A2E',
      success: (m) => {
        if (!m.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        wx.cloud.callFunction({
          name: 'blog-action',
          data: { action: 'delete_my', post_id: this.data.postId },
          success: (res) => {
            wx.hideLoading();
            if (res.result && res.result.ok) {
              wx.showToast({ title: '已删除', icon: 'success' });
              setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '删除失败', icon: 'none' });
            }
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); }
        });
      }
    });
  },

  // 删除自己的评论(二次确认)
  onDeleteComment(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除评论',
      content: '确定删除这条评论吗？',
      confirmText: '删除',
      confirmColor: '#B03A2E',
      success: (m) => {
        if (!m.confirm) return;
        wx.cloud.callFunction({
          name: 'blog-action',
          data: { action: 'comment_delete', comment_id: id },
          success: (res) => {
            if (res.result && res.result.ok) {
              const comments = this.data.comments.filter((c) => c._id !== id);
              this.setData({ comments, showCommentEmpty: comments.length === 0 });
              if (this.data.post) this.setData({ 'post.commentCount': Math.max(0, this.data.post.commentCount - 1) });
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '删除失败', icon: 'none' });
            }
          },
          fail: () => wx.showToast({ title: '网络异常', icon: 'none' })
        });
      }
    });
  }
});
