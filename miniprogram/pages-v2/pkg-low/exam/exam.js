// pkg-low/exam · 耍伴接单考试页(云端判分, 防作弊)
// subject: 任意科目 code(base=基础科目, W1=陪诊提升科目, 后台可增)
// 流程: get_exam_questions 拉题(无答案) → 本地作答 → submit_exam 云端判分 → 结果展示(通过/失败可重考)
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => {
    console.error('[cloud]', name, e && e.message);
    return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' };
  });
}

Page({
  data: {
    subject: 'base',
    title: '基础科目 · 耍伴考试',
    passLine: 60,
    bankVer: 0,          // 拉题时的题库版本, 提交时回传防改题判分错位
    prereq: null,        // 前置科目未通过 { code, msg }(拉题被门禁拦截时)
    questions: [],       // [{ question, options[] }]
    answers: [],         // 用户作答索引(未答为 -1)
    loading: true,
    loadError: false,
    submitting: false,
    done: false,         // 已交卷
    result: null         // { score, passed, pass_line }
  },

  onLoad(opt) {
    const subject = (opt && opt.subject) ? String(opt.subject).trim() : 'base';
    this.setData({ subject });
    this.fetchQuestions();
  },

  fetchQuestions() {
    callCloud('partner-action', { action: 'get_exam_questions', subject: this.data.subject }).then((r) => {
      if (r.ok && r.data) {
        const questions = r.data.questions || [];
        this.setData({
          questions,
          answers: questions.map(() => -1),
          passLine: r.data.pass_line || 100,
          bankVer: r.data.bank_ver || 0,
          title: r.data.title || this.data.title,
          prereq: null,
          loading: false,
          loadError: false
        });
      } else {
        // 前置科目未通过: 专属提示 + 引导去考前置科目
        if (r.code === 'pa_exam_prereq_not_passed' || r.code === 'pa_exam_base_not_passed') {
          this.setData({
            loading: false,
            loadError: false,
            prereq: { code: (r.data && r.data.requires && r.data.requires[0]) || 'base', msg: r.msg || '需先通过前置考试' }
          });
          return;
        }
        this.setData({ loading: false, loadError: true });
        wx.showToast({ title: r.msg || '题目加载失败', icon: 'none' });
      }
    });
  },

  reload() { this.setData({ loading: true, loadError: false, prereq: null }); this.fetchQuestions(); },

  // 去考前置科目
  onGoPrereq() {
    const code = this.data.prereq ? this.data.prereq.code : 'base';
    wx.navigateTo({ url: '/pages-v2/pkg-low/exam/exam?subject=' + code, fail: () => {} });
  },

  // 选择答案
  onChoose(e) {
    const { q, i } = e.currentTarget.dataset;
    this.setData({ [`answers[${q}]`]: Number(i) });
  },

  // 提交答卷(云端判分)
  onSubmit() {
    const { answers, questions, submitting, bankVer } = this.data;
    if (submitting) return;
    const unanswered = answers.indexOf(-1);
    if (unanswered >= 0) {
      wx.showToast({ title: `请完成第 ${unanswered + 1} 题`, icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    callCloud('partner-action', {
      action: 'submit_exam',
      subject: this.data.subject,
      bank_ver: bankVer,
      answers
    }).then((r) => {
      this.setData({ submitting: false });
      if (r.ok && r.data) {
        this.setData({ done: true, result: r.data });
      } else if (r.code === 'pa_exam_bank_changed') {
        // 题库已更新: 提示后自动重拉
        wx.showToast({ title: r.msg || '题库已更新', icon: 'none', duration: 1500 });
        setTimeout(() => this.onRetry(), 1200);
      } else if (r.code === 'pa_exam_prereq_not_passed') {
        this.setData({ prereq: { code: 'base', msg: r.msg || '需先通过前置考试' }, done: false });
        wx.showToast({ title: r.msg || '需先通过前置考试', icon: 'none' });
      } else {
        wx.showToast({ title: r.msg || '提交失败', icon: 'none' });
      }
    });
  },

  // 通过后返回上一页(接单配置)
  onBack() {
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages-v2/pkg-low/accept-config/accept-config' }) });
  },

  // 失败重考: 重新拉题作答
  onRetry() {
    this.setData({ done: false, result: null, answers: [], submitting: false, prereq: null });
    this.fetchQuestions();
  }
});
