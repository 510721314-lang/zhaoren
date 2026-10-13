// action_exam.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 5.1 下发题库(剥离答案): subject=任意科目 code, 返回题目+通过线+前置规则
async function getExamQuestionsAction(ctx) {
  const { event, openid, clientIp, device, getExamBank, examRequiresGate, getProfile } = ctx;
      const subject = event.subject;
      const bank = await getExamBank();
      const sub = bank[subject];
      if (!sub) return { ok: false, code: 'pa_exam_bad_subject', msg: '科目不存在' };
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      // 前置门禁(通用): 逐 requires 查 exam_scores, 防止绕过前端锁定直接进考试页
      const gate = examRequiresGate(profile, sub, bank);
      if (gate.locked) return { ok: false, code: gate.code, msg: gate.msg };
      const questions = sub.questions.map((q) => ({ question: q.question, options: q.options }));
      return {
        ok: true,
        data: {
          subject,
          title: sub.title || subject,
          desc: sub.desc || '',
          pass_line: sub.pass_line,
          requires: sub.requires || [],
          bank_ver: sub.bank_ver || 0,
          questions
        }
      };
}

    // 5.2 提交答卷云端判分: answers=[0..n] 选项索引, 与题库顺序一一对应
async function submitExamAction(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, getExamBank, examRequiresGate, getProfile } = ctx;
      const subject = event.subject;
      const bank = await getExamBank();
      const sub = bank[subject];
      if (!sub) return { ok: false, code: 'pa_exam_bad_subject', msg: '科目不存在' };
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      // 前置门禁(通用)
      const gate = examRequiresGate(profile, sub, bank);
      if (gate.locked) return { ok: false, code: gate.code, msg: gate.msg };
      // 考试中途改题防护: 拉题时返回 bank_ver, 提交时不一致说明题库已更新, 判分作废
      if (event.bank_ver !== undefined && Number(event.bank_ver) !== 0 && sub.bank_ver !== undefined && Number(sub.bank_ver) !== 0 && Number(event.bank_ver) !== Number(sub.bank_ver)) {
        return { ok: false, code: 'pa_exam_bank_changed', msg: '题库已更新，请重新作答' };
      }
      const answers = Array.isArray(event.answers) ? event.answers : [];
      if (answers.length !== sub.questions.length) {
        return { ok: false, code: 'pa_exam_incomplete', msg: '请完成全部题目再提交' };
      }
      // 判分
      let correct = 0;
      sub.questions.forEach((q, i) => {
        const a = Number(answers[i]);
        if (Number.isInteger(a) && a === q.answer_idx) correct += 1;
      });
      const score = Math.round((correct / sub.questions.length) * 100);
      const passed = score >= sub.pass_line;
      // 写回 partner_profile.exam_scores / exam_at
      const patch = {
        ['exam_scores.' + subject]: score,
        ['exam_at.' + subject]: Date.now(),
        updated_at: Date.now()
      };
      await col('partner_profile').doc(profile._id).update({ data: patch }).catch(() => {});
      writeAudit(db, log, {
        openid, role: 'partner', category: 'exam', action: 'submit_exam',
        target_type: 'partner_profile', target_id: profile._id || '',
        detail: { subject, score, passed }, result: passed ? 'ok' : 'fail'
      }).catch(() => {});
      return { ok: true, data: { subject, score, passed, pass_line: sub.pass_line } };
}

    // 5.3 科目配置(供前端考试认证页/接单配置页/我的页角标): 不含答案
async function examSubjectsAction(ctx) {
  const { event, openid, clientIp, device, getExamBank } = ctx;
      const bank = await getExamBank();
      const list = Object.keys(bank).map((code) => {
        const s = bank[code];
        return { code, title: s.title || code, desc: s.desc || '', pass_line: s.pass_line, requires: s.requires || [] };
      });
      return { ok: true, data: { list } };
}

module.exports = {
  get_exam_questions: getExamQuestionsAction,
  submit_exam: submitExamAction,
  exam_subjects: examSubjectsAction,
};
