// PRD章节: 3.10 耍伴专区 · 接单考试认证查询
// 接 partner-action my_profile: 展示 exam_scores 通过状态, 未通过可跳考试页
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

// 科目定义(SSOT 与 partner-action EXAM_THRESHOLD 一致)
const SUBJECTS = [
  { key: 'base', title: '耍伴基础考试', desc: '全体耍伴接单前置，满分 100 分通过', passLine: 100 },
  { key: 'W1', title: '陪诊提升考试', desc: '就医陪诊场景专项，满分 100 分通过；需先通过基础考试', passLine: 100 }
];

Page({
  data: {
    loading: true,
    loadError: false,
    noProfile: false,   // 非耍伴: 展示引导成为耍伴
    subjects: []
  },

  onLoad() {
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
    const scores = (r.data.profile && r.data.profile.exam_scores) || {};
    const baseScore = Number(scores.base) || 0;
    const basePassed = baseScore >= 100;
    const subjects = SUBJECTS.map((s) => {
      const raw = scores[s.key];
      const hasScore = raw !== undefined && raw !== null;
      const score = Number(raw) || 0;
      // 提升科目(陪诊考试)前置: 基础考试须满分通过
      const locked = s.key !== 'base' && !basePassed;
      const passed = hasScore && score >= s.passLine && !locked;
      return Object.assign({}, s, {
        score, hasScore, passed, locked,
        statusText: locked ? '待解锁' : (passed ? '已通过' : (hasScore ? '未通过' : '未参加')),
        btnText: passed ? '重新考试' : (locked ? '待解锁' : '去考试')
      });
    });
    this.setData({ loading: false, loadError: false, noProfile: false, subjects });
    return true;
  },

  onGoExam(e) {
    const subject = e.currentTarget.dataset.subject;
    const item = this.data.subjects.find((s) => s.key === subject);
    // 锁定态点击给提示(陪诊考试需先通过基础考试)
    if (item && item.locked) {
      wx.showToast({ title: '需先通过基础考试（满分），方可参加陪诊考试', icon: 'none', duration: 2500 });
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
