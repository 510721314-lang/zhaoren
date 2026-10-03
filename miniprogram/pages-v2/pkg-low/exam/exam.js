// pkg-low/exam · 耍伴接单考试页(云端判分, 防作弊)
// subject: base=基础科目(耍伴考试, 全员接单前置) / W1=提升科目(陪诊考试)
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
    questions: [],       // [{ question, options[] }]
    answers: [],         // 用户作答索引(未答为 -1)
    loading: true,
    loadError: false,
    submitting: false,
    done: false,         // 已交卷
    result: null         // { score, passed, pass_line }
  },

  onLoad(opt) {
    const subject = (opt && opt.subject === 'W1') ? 'W1' : 'base';
    this.setData({ subject, title: subject === 'W1' ? '提升科目 · 陪诊考试' : '基础科目 · 耍伴考试' });
    this.fetchQuestions();
  },

  fetchQuestions() {
    callCloud('partner-action', { action: 'get_exam_questions', subject: this.data.subject }).then((r) => {
      if (r.ok && r.data) {
        const questions = r.data.questions || [];
        this.setData({
          questions,
          answers: questions.map(() => -1),
          passLine: r.data.pass_line || 60,
          title: r.data.title || this.data.title,
          loading: false
        });
      } else {
        this.setData({ loading: false, loadError: true });
        wx.showToast({ title: r.msg || '题目加载失败', icon: 'none' });
      }
    });
  },

  reload() { this.setData({ loading: true, loadError: false }); this.fetchQuestions(); },

  // 选择答案
  onChoose(e) {
    const { q, i } = e.currentTarget.dataset;
    this.setData({ [`answers[${q}]`]: Number(i) });
  },

  // 提交答卷(云端判分)
  onSubmit() {
    const { answers, questions, submitting } = this.data;
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
      answers
    }).then((r) => {
      this.setData({ submitting: false });
      if (r.ok && r.data) {
        this.setData({ done: true, result: r.data });
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
    this.setData({ done: false, result: null, answers: [], submitting: false });
    this.fetchQuestions();
  }
});
