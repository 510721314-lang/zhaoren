// pkg-low/study · 学习中心(耍伴端): 已发布课程章节列表, 点击行内展开正文
// 数据源: partner-action study_list / study_detail(仅 status=published)
const { callCloud } = require('../../../utils/cloud.js');

const SUBJECT_TITLES = {
  base: '基础考试',
  W1: '陪诊',
  OUTDOOR: '线下户外陪伴',
  PEIZHEN: '陪诊陪伴',
  ONLINE: '线上陪伴'
};

// 极简 markdown 渲染: 标题行({#}/##)、列表行(-/*)、其余按段落; 去掉 ** 加粗标记
function mdToBlocks(md) {
  const blocks = [];
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) {
      blocks.push({ type: 'h', text: line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '') });
    } else if (/^[-*]\s+/.test(line)) {
      blocks.push({ type: 'li', text: line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '') });
    } else {
      blocks.push({ type: 'p', text: line.replace(/\*\*/g, '') });
    }
  }
  return blocks;
}

Page({
  data: {
    loading: true,
    error: false,
    subjects: [],
    activeSubject: '',
    groups: [],
    openKey: '',
    blocks: [],
    detailLoading: false
  },

  onLoad() {
    this.fetchList();
  },

  fetchList() {
    this.setData({ loading: true, error: false });
    callCloud('partner-action', { action: 'study_list' }).then((r) => {
      if (!(r.ok && r.data)) {
        this.setData({ loading: false, error: true });
        return;
      }
      const list = r.data.list || [];
      const codes = [];
      list.forEach((x) => { if (codes.indexOf(x.subject) === -1) codes.push(x.subject); });
      codes.sort((a, b) => (a === 'base' ? -1 : b === 'base' ? 1 : a.localeCompare(b)));
      this.all = list;
      this.setData({
        loading: false,
        subjects: codes.map((c) => ({ code: c, name: SUBJECT_TITLES[c] || c }))
      });
      this.applyFilter('');
    }).catch(() => this.setData({ loading: false, error: true }));
  },

  // 按科目过滤 + 按模块分组(章节自带 key, 供 wxml 判断展开态)
  applyFilter(code) {
    const list = (this.all || []).filter((x) => !code || x.subject === code);
    const map = {};
    const order = [];
    list.forEach((x) => {
      const gk = x.subject + '|' + x.module_id;
      if (!map[gk]) {
        map[gk] = {
          key: gk,
          subjectName: SUBJECT_TITLES[x.subject] || x.subject,
          module_id: x.module_id,
          chapters: []
        };
        order.push(gk);
      }
      map[gk].chapters.push(Object.assign({ key: x.subject + '|' + x.chapter_id }, x));
    });
    this.setData({
      activeSubject: code,
      groups: order.map((k) => map[k]),
      openKey: '',
      blocks: []
    });
  },

  onSubjectTap(e) {
    this.applyFilter(e.currentTarget.dataset.code || '');
  },

  // 点击章节: 展开/收起; 展开时按需拉正文(单展开)
  onChapterTap(e) {
    const { subject, module, chapter, key } = e.currentTarget.dataset;
    if (this.data.openKey === key) {
      this.setData({ openKey: '', blocks: [] });
      return;
    }
    this.setData({ openKey: key, blocks: [], detailLoading: true });
    callCloud('partner-action', {
      action: 'study_detail', subject, module_id: module, chapter_id: chapter
    }).then((r) => {
      if (!(r.ok && r.data && r.data.content)) {
        this.setData({ detailLoading: false });
        wx.showToast({ title: r.msg || '加载失败', icon: 'none' });
        return;
      }
      this.setData({ detailLoading: false, blocks: mdToBlocks(r.data.content.body_md) });
    }).catch(() => {
      this.setData({ detailLoading: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  onRetry() {
    this.fetchList();
  }
});
