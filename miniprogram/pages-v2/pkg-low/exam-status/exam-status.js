// PRD章节: 3.10 耍伴专区 · 接单考试认证查询
// 接 partner-action my_profile(分数) + exam_subjects(科目配置, 后台可增可改): 展示各科通过状态
const { callCloud } = require('../../../utils/cloud.js');

Page({
  data: {
    chainBar: null,     // 批3c: 入驻链条(第 x/8 步); 非链内进入为 null
    loading: true,
    loadError: false,
    noProfile: false,   // 非耍伴: 展示引导成为耍伴
    subjects: []
  },

  onLoad(query) {
    // 批3c(2026-10-23): 从入驻链进入时展示步骤条(第 6/8 步)
    const chain = require('../../../utils/onboard-chain.js');
    this.setData({ chainBar: chain.barOf('exam', (query && query.from) || '') });
    if ((query && query.from) === 'chain') chain.ensureDraft();
    this.fetchStatus();
  },

  // 考完试返回本页自动刷新状态
  onShow() {
    if (!this.data.loading) this.fetchStatus();
  },

  onPullDownRefresh() {
    this.fetchStatus().then(() => wx.stopPullDownRefresh());
  },

  async fetchStatus() {
    const r = await callCloud('partner-action', { action: 'my_profile' });
    if (!r.ok) {
      if (r.code === 'pa_no_profile') {
        this.setData({ loading: false, loadError: false, noProfile: true });
        return true;
      }
      this.setData({ loading: false, loadError: true });
      return false;
    }
    // 科目配置: 优先 exam_subjects(后台动态), 失败用内置兜底(base/W1 与云端 seed 同源)
    const cfg = await callCloud('partner-action', { action: 'exam_subjects' });
    const defs = (cfg && cfg.ok && cfg.data && cfg.data.list && cfg.data.list.length > 0)
      ? cfg.data.list
      : [
          { code: 'base', title: '耍伴基础考试', desc: '全体耍伴接单前置，满分 100 分通过', pass_line: 100, requires: [] },
          { code: 'W1', title: '陪诊提升考试', desc: '就医陪诊场景专项，满分 100 分通过；需先通过基础考试', pass_line: 100, requires: ['base'] }
        ];
    const scores = (r.data.profile && r.data.profile.exam_scores) || {};
    const passedOf = (code) => Number(scores[code] || 0) >= (defs.find((d) => d.code === code) ? defs.find((d) => d.code === code).pass_line : 100);
    const subjects = defs.map((s) => {
      const raw = scores[s.code];
      const hasScore = raw !== undefined && raw !== null;
      const score = Number(raw) || 0;
      // 前置门禁(通用): 逐 requires 检查前置科目是否通过
      const prereqBlocked = (s.requires || []).some((r) => !passedOf(r));
      const locked = prereqBlocked;
      const passed = hasScore && score >= s.pass_line && !locked;
      return Object.assign({}, s, {
        key: s.code,
        passLine: s.pass_line,
        score, hasScore, passed, locked,
        statusText: locked ? '待解锁' : (passed ? '已通过' : (hasScore ? '未通过' : '未参加')),
        btnText: passed ? '重新考试' : (locked ? '待解锁' : '去考试')
      });
    });
    this.setData({
      loading: false, loadError: false, noProfile: false, subjects,
      passedCount: subjects.filter((s) => s.passed).length   // 2026-10-28 UI: 顶部进度概览
    });
    // 批3c(2026-10-23): 链内且所有科目已通过 → 自动进下一步(提交申请), 仅触发一次
    if (this.data.chainBar && subjects.length > 0 && subjects.every((s) => s.passed) && !this._chainJumped) {
      this._chainJumped = true;
      setTimeout(() => require('../../../utils/onboard-chain.js').next('exam'), 600);
    }
    return true;
  },

  onGoExam(e) {
    const subject = e.currentTarget.dataset.subject;
    const item = this.data.subjects.find((s) => s.key === subject);
    // 锁定态点击给提示(需先通过前置考试)
    if (item && item.locked) {
      const reqNames = (item.requires || []).map((r) => {
        const d = this.data.subjects.find((s) => s.key === r);
        return d ? d.title : r;
      }).join('、');
      wx.showToast({ title: `需先通过「${reqNames}」，方可参加${item.title}`, icon: 'none', duration: 2500 });
      return;
    }
    wx.navigateTo({
      url: '/pages-v2/pkg-low/exam/exam?subject=' + subject,
      fail: () => wx.showToast({ title: '考试页打开失败', icon: 'none' })
    });
  },

  onGoApply() {
    wx.navigateTo({
      url: '/pages-v2/pkg-low/partner-apply/partner-apply',
      fail: () => wx.showToast({ title: '申请页打开失败', icon: 'none' })
    });
  }
});
