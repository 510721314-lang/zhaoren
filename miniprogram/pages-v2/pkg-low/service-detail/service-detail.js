// pages-v2/pkg-low/service-detail/service-detail · SOP 详情（只读浏览 + 去预约）
// 数据源：home-action.service_detail（含 sop_content）；去预约跳发布页并预选场景（publish.js L299 原生支持 sceneCode）
const { callCloud } = require('../../../utils/cloud.js');

// HTML 实体反转义（后台误把 HTML 文档源码存成 <pre><code> 代码块时，内容是 &lt; 转义的）
function decodeHtmlEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
// 从完整 HTML 文档中提取 <body> 内容，剥离 doctype/html/head/style/script
function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (m) return m[1];
  return html.replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}
// 提取 HTML 中所有 <style> 块的文本（mp-html style 插件会把这些样式内联到匹配元素）
function extractStyles(html) {
  const styles = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) styles.push(m[1]);
  return styles.join('\n');
}
// 暗色模式覆盖样式：对齐 styles/tokens.wxss 暗色变量；作为第二个 <style> 块追加，由 mp-html style 插件内联覆盖原文亮色
const DARK_OVERRIDE_CSS = `.container,.main-wrap{background:#1E2126!important;color:#C8CCD1!important;box-shadow:0 2rpx 12rpx rgba(0,0,0,.3)!important;border-color:#33373F!important}h1{color:#7AA8FF!important}.subtitle,.doc-subtitle{color:#9097A0!important}h2{color:#7AA8FF!important;border-left:4px solid #4d8aff!important}h3{color:#F0F1F3!important}p,li,td,th,div,span{color:#C8CCD1!important}.green-card{background:rgba(7,193,96,.12)!important;border-color:rgba(7,193,96,.35)!important}.red-card{background:rgba(250,81,81,.12)!important;border-color:rgba(250,81,81,.35)!important}.tip-box,.yellow-tip{background:rgba(255,143,60,.12)!important;border-color:rgba(255,143,60,.35)!important}.blue-note,.flow-box,.flow-container{background:rgba(77,138,255,.12)!important;border-color:rgba(77,138,255,.35)!important}.flow-item,.flow-step{background:#2b65cc!important;color:#fff!important}.flow-arrow{color:#7AA8FF!important}table{background:transparent!important}table th,th{background:rgba(77,138,255,.12)!important}table th,table td,th,td{border-color:#33373F!important}.warn-text{color:#FA8080!important}strong,b{color:#F0F1F3!important}a{color:#7AA8FF!important}`;
// 归一化 SOP：输出「<style>原文CSS</style>[+<style>暗色覆盖]</style> + body 正文」，交 mp-html（含 style 插件）自动内联样式渲染
// 兼容：①正常富文本片段 ②<pre><code> 包裹的实体转义完整 HTML 文档 ③纯文本
function prepareSopHtml(raw, isDark) {
  if (!raw) return '';
  let s = String(raw).trim();
  // ② 被 <pre><code> 包裹的实体转义源码 → 先反转义
  const pre = s.match(/^<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/i);
  if (pre) s = decodeHtmlEntities(pre[1]);
  // 提取 <style>（必须在剥 head 之前，否则会丢掉）
  const styles = extractStyles(s);
  // 提取 body 正文（完整文档取 <body>；否则剥外层结构）
  let body = s;
  const bm = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bm) body = bm[1];
  else body = body.replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.trim();
  // 暗色覆盖块必须放在原文 style 之后（style 插件按顺序解析，后定义的同属性覆盖先定义的）
  const darkBlock = isDark ? `<style>${DARK_OVERRIDE_CSS}</style>` : '';
  if (styles) return `<style>${styles}</style>${darkBlock}${body}`;
  return darkBlock ? `${darkBlock}${body}` : body;
}

Page({
  data: {
    loading: true,
    detail: null,
    notFound: false,
    sopHtml: ''
  },

  onLoad(options) {
    const id = options && options.id;
    if (!id) {
      wx.showToast({ title: '缺少服务标识', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    this.sopId = id;
    // 跟随系统主题切换：亮↔暗时实时重渲染 SOP（否则切主题后卡片样式不刷新）
    this._onThemeChange = () => {
      if (this.data.detail && this.data.detail.sop_content) {
        this.renderSop(this.data.detail.sop_content);
      }
    };
    wx.onThemeChange(this._onThemeChange);
    this.fetchDetail();
  },

  onUnload() {
    if (this._onThemeChange) wx.offThemeChange(this._onThemeChange);
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

  // 渲染 SOP：归一化为 <style>[+暗色覆盖]+body 交 mp-html（含 style 插件）渲染，样式自动内联、图片/表格原生支持
  renderSop(html) {
    const isDark = (wx.getSystemInfoSync() || {}).theme === 'dark';
    this.setData({ sopHtml: prepareSopHtml(html, isDark) });
  }
});
