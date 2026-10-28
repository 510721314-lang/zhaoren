// pkg-low/study · 学习中心(耍伴端): 科目竖排; 点击科目才拉该科章节(列表接口已按 subject 过滤), 点击章节才拉正文
// 2026-10-28 优化: 页面加载零云调用(不再 onLoad 拉全量章节), 科目列表改竖排
// 数据源: partner-action study_list(subject 可选) / study_detail(仅 status=published)
const { callCloud } = require('../../../utils/cloud.js');

// 科目静态清单(线上已发布科目; 后台新增科目需同步此清单)
const SUBJECTS = [
  { code: 'base', name: '基础考试', desc: '全体耍伴接单前置' },
  { code: 'W1', name: '陪诊', desc: '就医陪诊专项' },
  { code: 'OUTDOOR', name: '线下户外陪伴', desc: '户外陪伴专项' },
  { code: 'PEIZHEN', name: '陪诊陪伴', desc: '陪诊陪伴专项' },
  { code: 'ONLINE', name: '线上陪伴', desc: '线上陪伴专项' }
];

const SUBJECT_TITLES = {};
SUBJECTS.forEach((s) => { SUBJECT_TITLES[s.code] = s.name; });

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
    subjects: SUBJECTS.slice(),
    activeSubject: '',
    picked: false,        // 是否已选科目
    groups: [],
    openKey: '',
    blocks: [],
    listLoading: false,
    listError: false,
    detailLoading: false
  },

  // 2026-10-28: onLoad 不发云调用(科目静态渲染), 首次点科目才加载
  onLoad() {
    this._baseSubjects = SUBJECTS.slice();   // 原始顺序(取消选中时还原)
  },

  // 选中科目置顶、其余科目保持原顺序紧凑排列 —— 章节内容随之上移(2026-10-28 二改)
  pinSubject(code) {
    const base = this._baseSubjects || SUBJECTS;
    const sel = base.filter((s) => s.code === code);
    const rest = base.filter((s) => s.code !== code);
    return sel.concat(rest);
  },

  // 点科目: 已选则收起(恢复完整列表); 未选/换科则重排置顶并拉该科章节
  onSubjectTap(e) {
    const code = e.currentTarget.dataset.code || '';
    if (!code) return;
    if (this.data.picked && this.data.activeSubject === code) {
      this.setData({
        picked: false,
        activeSubject: '',
        subjects: (this._baseSubjects || SUBJECTS).slice(),
        groups: [],
        openKey: '',
        blocks: [],
        listError: false
      });
      return;
    }
    this.fetchChapters(code);
  },

  fetchChapters(code) {
    this.setData({
      picked: true,
      activeSubject: code,
      subjects: this.pinSubject(code),
      listLoading: true,
      listError: false,
      groups: [],
      openKey: '',
      blocks: []
    });
    return callCloud('partner-action', { action: 'study_list', subject: code }).then((r) => {
      if (!(r.ok && r.data)) {
        this.setData({ listLoading: false, listError: true });
        return;
      }
      this.setData({ listLoading: false, groups: this.buildGroups(r.data.list || []), openKey: '', blocks: [] });
    }).catch(() => this.setData({ listLoading: false, listError: true }));
  },

  // 按模块分组(章节自带 key, 供 wxml 判断展开态)
  buildGroups(list) {
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
    return order.map((k) => map[k]);
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
    this.fetchChapters(this.data.activeSubject);
  }
});
