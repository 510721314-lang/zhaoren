// pages-v2/pkg-low/service-detail/service-detail · SOP 详情（只读浏览 + 去预约）
// 数据源：home-action.service_detail（含 sop_content）；去预约跳发布页并预选场景（publish.js L299 原生支持 sceneCode）
const { callCloud } = require('../../../utils/cloud.js');

// 把富文本 HTML 拆成 [文本/图片/视频] 片段；cloud:// 资源在 renderSop 中转临时链接后再渲染
function parseSegments(html) {
  const segs = [];
  const re = /(<video[\s\S]*?<\/video>|<img[^>]*>)/gi;
  let last = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) segs.push({ type: 'text', html: html.slice(last, m.index) });
    const tag = m[0];
    const src = (tag.match(/src="([^"]+)"/i) || [])[1] || '';
    segs.push({ type: /^<video/i.test(tag) ? 'video' : 'image', src });
    last = re.lastIndex;
  }
  if (last < html.length) segs.push({ type: 'text', html: html.slice(last) });
  return segs;
}

Page({
  data: {
    loading: true,
    detail: null,
    notFound: false,
    segments: [],
    imageList: []
  },

  onLoad(options) {
    const id = options && options.id;
    if (!id) {
      wx.showToast({ title: '缺少服务标识', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    this.sopId = id;
    this.fetchDetail();
  },

  fetchDetail() {
    this.setData({ loading: true });
    callCloud('home-action', { action: 'service_detail', id: this.sopId })
      .then((r) => {
        if (r && r.ok && r.data) {
          this.renderSop(r.data.sop_content || '');
          this.setData({ detail: r.data, notFound: false });
        } else {
          this.setData({ notFound: true });
          wx.showToast({ title: (r && r.msg) || '服务项目不存在或已下架', icon: 'none' });
        }
      })
      .catch(() => {
        this.setData({ notFound: true });
        wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      })
      .then(() => this.setData({ loading: false }));
  },

  onGoReserve() {
    const d = this.data.detail;
    // publish.js 原生支持 options.sceneCode 预选中场景；缺场景时直接进发布页
    const url = d && d.scene_code
      ? `/pages-v2/publish/publish?sceneCode=${d.scene_code}`
      : '/pages-v2/publish/publish';
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '发布页暂不可用', icon: 'none' })
    });
  },

  // 渲染富媒体 SOP：文本走 rich-text，图片/视频抽出来用原生组件（rich-text 不支持 video / cloud://）
  async renderSop(html) {
    if (!html) { this.setData({ segments: [], imageList: [] }); return; }
    const segs = parseSegments(html);
    const cloudIds = [];
    segs.forEach((s) => {
      if ((s.type === 'image' || s.type === 'video') && /^cloud:\/\//i.test(s.src) && cloudIds.indexOf(s.src) < 0) {
        cloudIds.push(s.src);
      }
    });
    const urlMap = {};
    if (cloudIds.length > 0) {
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: cloudIds });
        (res.fileList || []).forEach((f) => { if (f && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch (e) {
        // 转链失败：保留原 src，图片可能不显示但不阻断正文浏览（getTempFileURL 失败不应白屏）
        console.warn('[service-detail] getTempFileURL failed:', e && e.errMsg);
      }
    }
    const imageList = [];
    segs.forEach((s) => {
      if (s.type === 'image' || s.type === 'video') s.src = urlMap[s.src] || s.src;
      if (s.type === 'image') imageList.push(s.src);
    });
    // 过滤纯空白文本片段，避免多余空行
    const filtered = segs.filter((s) => s.type !== 'text' || (s.html && String(s.html).trim() !== ''));
    this.setData({ segments: filtered, imageList });
  },

  onPreviewImage(e) {
    const src = e.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ current: src, urls: this.data.imageList });
  }
});
