// pages/blog-publish/blog-publish.js - 发布服务动态(文字 + ≤9 图 + 服务场景 + 话题)
const { SCENE_LIST, BLOG_TOPICS } = require('../../utils/constants.js');
const app = getApp();

const MAX_IMAGES = 9;
const CONTENT_MAX = 1000;
const MAX_TAGS = 3;

Page({
  data: {
    sceneOpts: SCENE_LIST,
    topicChks: BLOG_TOPICS.map((t) => ({ name: t.name, icon: t.icon, on: false })),
    tagCount: 0,
    content: '',
    contentLen: 0,
    images: [],          // [{ fid: 云文件ID(上传成功才有), path: 本地预览路径, uploading }]
    uploadingCount: 0,
    canAddMore: true,
    sceneCode: '',
    submitting: false
  },

  onContentInput(e) {
    const v = e.detail.value || '';
    this.setData({ content: v, contentLen: v.length });
  },

  pickScene(e) {
    const code = e.currentTarget.dataset.code;
    this.setData({ sceneCode: this.data.sceneCode === code ? '' : code });
  },

  // 话题多选(≤3), 选中态预生成 on 布尔供 WXML 直接用
  pickTopic(e) {
    const name = e.currentTarget.dataset.name;
    let hitLimit = false;
    const topicChks = this.data.topicChks.map((t) => {
      if (t.name !== name) return t;
      if (!t.on && this.data.tagCount >= MAX_TAGS) { hitLimit = true; return t; }
      return Object.assign({}, t, { on: !t.on });
    });
    if (hitLimit) { wx.showToast({ title: '最多选 ' + MAX_TAGS + ' 个话题', icon: 'none' }); return; }
    const tagCount = topicChks.filter((t) => t.on).length;
    this.setData({ topicChks, tagCount });
  },

  // 选图并立即上传云存储(首次调用由微信官方隐私弹窗自动处理授权)
  chooseImage() {
    const remain = MAX_IMAGES - this.data.images.length;
    if (remain <= 0) { wx.showToast({ title: '最多 ' + MAX_IMAGES + ' 张', icon: 'none' }); return; }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map((f) => ({ fid: '', path: f.tempFilePath, uploading: true }));
        const newImages = this.data.images.concat(files);
        this.setData({ images: newImages, uploadingCount: this.data.uploadingCount + files.length, canAddMore: newImages.length < MAX_IMAGES });
        files.forEach((item) => this.uploadOne(item));
      }
    });
  },

  uploadOne(item) {
    const rand = Math.random().toString(36).slice(2, 8);
    const cloudPath = 'blog/' + Date.now() + '_' + rand + '.jpg';
    wx.cloud.uploadFile({
      cloudPath,
      filePath: item.path,
      success: (up) => {
        const images = this.data.images.map((x) => x.path === item.path ? { fid: up.fileID, path: item.path, uploading: false } : x);
        this.setData({ images, uploadingCount: Math.max(0, this.data.uploadingCount - 1), canAddMore: images.length < MAX_IMAGES });
      },
      fail: () => {
        const images = this.data.images.filter((x) => x.path !== item.path);
        this.setData({ images, uploadingCount: Math.max(0, this.data.uploadingCount - 1), canAddMore: images.length < MAX_IMAGES });
        wx.showToast({ title: '部分图片上传失败', icon: 'none' });
      }
    });
  },

  removeImage(e) {
    const path = e.currentTarget.dataset.path;
    const images = this.data.images.filter((x) => x.path !== path);
    this.setData({ images, canAddMore: true });
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.path;
    const urls = this.data.images.map((x) => x.path);
    wx.previewImage({ current, urls });
  },

  onSubmit() {
    const content = (this.data.content || '').trim();
    if (content.length < 2) { wx.showToast({ title: '说点什么再发布吧', icon: 'none' }); return; }
    if (content.length > CONTENT_MAX) { wx.showToast({ title: '正文不能超过 ' + CONTENT_MAX + ' 字', icon: 'none' }); return; }
    if (this.data.uploadingCount > 0) { wx.showToast({ title: '图片还在上传中', icon: 'none' }); return; }
    const fileIds = this.data.images.filter((x) => x.fid).map((x) => x.fid);
    const tags = this.data.topicChks.filter((t) => t.on).map((t) => t.name);
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '发布中', mask: true });
    wx.cloud.callFunction({
      name: 'blog-action',
      data: { action: 'publish', content, images: fileIds, scene: this.data.sceneCode, tags },
      success: (res) => {
        wx.hideLoading();
        this.setData({ submitting: false });
        const r = res.result;
        if (r && r.ok) {
          wx.showToast({ title: '发布成功', icon: 'success' });
          setTimeout(() => wx.navigateBack({ delta: 1 }), 700);
        } else {
          wx.showToast({ title: (r && r.msg) || '发布失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '网络异常,请稍后重试', icon: 'none' });
      }
    });
  }
});
