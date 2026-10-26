// action_exam.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')
// 证书/判分共享逻辑(2026-10-26 S2): 规范源 _shared/cert_state.js(修改后跑 sync-cert-state.ps1)
const { readCertConfig, activeCertOf, loadCerts, buildCertRecord } = require('./cert_state');

// 多选判定: 题库显式 type='multi' 或 answer_idx 为数组即按多选(兼容存量单选题库)
function isMultiQuestion(q) {
  return !!q && (q.type === 'multi' || Array.isArray(q.answer_idx));
}

// 选项索引归一: 数字化 → 去重 → 升序(非整数一律丢弃)
function normAnswerIdx(v) {
  const arr = Array.isArray(v) ? v : [v];
  const out = [];
  for (const x of arr) {
    const n = Number(x);
    if (Number.isInteger(n) && n >= 0) out.push(n);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

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

    // 5.2 提交答卷云端判分: answers=[0..n] 选项索引, 与题库顺序一一对应; multi 题传数组
    // 2026-10-26 S2: 多选全对才得分(D7) + exam_sessions 留痕 + 通过发证
async function submitExamAction(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, getExamBank, examRequiresGate, getProfile, getConfig } = ctx;
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
      // 判分: 单选全等; 多选先升序去重再全等(漏选/错选/多选均 0 分, D7)
      let correct = 0;
      sub.questions.forEach((q, i) => {
        if (isMultiQuestion(q)) {
          const expected = normAnswerIdx(q.answer_idx);
          const got = normAnswerIdx(answers[i]);
          if (expected.length > 0 && expected.length === got.length && expected.every((v, k) => v === got[k])) correct += 1;
        } else {
          const a = Number(answers[i]);
          if (Number.isInteger(a) && a === Number(q.answer_idx)) correct += 1;
        }
      });
      const score = Math.round((correct / sub.questions.length) * 100);
      const passed = score >= sub.pass_line;
      const now = Date.now();
      const bankVer = Number(sub.bank_ver) || 0;

      // 考试留痕(每次提交一条; 写入失败不阻断判分结果返回)
      let sessionId = '';
      try {
        const storedAnswers = sub.questions.map((q, i) => (isMultiQuestion(q) ? normAnswerIdx(answers[i]) : (Number.isInteger(Number(answers[i])) ? Number(answers[i]) : null)));
        const dur = Number(event.duration_ms);
        const add = await col('exam_sessions').add({ data: {
          openid, subject, bank_ver: bankVer,
          answers: storedAnswers,
          score, passed, pass_line: sub.pass_line,
          duration_ms: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 0,
          screen_switch_count: 0,
          auto_submit: false,
          cheat_flags: [],
          status: 'submitted',
          is_deleted: false,
          created_at: now,
          submitted_at: now
        } });
        sessionId = (add && add._id) || '';
      } catch (e) {
        log.d(`exam session write fail: ${openid} ${subject} ${e && e.message}`);
      }

      // 写回 partner_profile.exam_scores / exam_at
      const patch = {
        ['exam_scores.' + subject]: score,
        ['exam_at.' + subject]: now,
        updated_at: now
      };
      await col('partner_profile').doc(profile._id).update({ data: patch }).catch(() => {});

      // 通过发证: 已有有效证书则复用(幂等), 否则按 base 永久 / 其他科目 N 天新发一张
      let cert = null;
      if (passed) {
        try {
          const certCfg = readCertConfig(await getConfig());
          const certs = await loadCerts(col, openid);
          const active = activeCertOf(certs, subject, now);
          if (active) {
            cert = active;
          } else {
            const rec = buildCertRecord({
              openid, subject, score,
              sessionId,
              contentVersion: bankVer ? String(bankVer) : '',
              now,
              validDays: certCfg.w1CertValidDays,
              basePermanent: certCfg.baseCertPermanent
            });
            const add = await col('certificates').add({ data: rec });
            cert = Object.assign({ _id: (add && add._id) || '' }, rec);
          }
        } catch (e) {
          log.d(`exam cert issue fail: ${openid} ${subject} ${e && e.message}`);
        }
      }

      writeAudit(db, log, {
        openid, role: 'partner', category: 'exam', action: 'submit_exam',
        target_type: 'partner_profile', target_id: profile._id || '',
        detail: { subject, score, passed, session_id: sessionId }, result: passed ? 'ok' : 'fail'
      }).catch(() => {});
      return { ok: true, data: {
        subject, score, passed, pass_line: sub.pass_line,
        session_id: sessionId,
        cert_expires_at: cert ? cert.expires_at : 0,
        cert_issued: !!cert
      } };
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
