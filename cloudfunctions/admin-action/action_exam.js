// admin-action · 认证考试管理（exam_subject_* / exam_bank_seed，从 index.js 物理抽出，行为逐字不变）
// validateExamSubject / examSubjectMeta 随 handler 一并内联；EXAM_BANK_FALLBACK 引 './exam-fallback' 本地副本(由 sync-exam-fallback.ps1 维护)；共享符号通过 ctx 注入，禁止反向 require('./index')。

const { EXAM_BANK_FALLBACK } = require('./exam-fallback');

const examSubjectMeta = (s) => ({
  code: s.code, title: s.title, desc: s.desc || '', pass_line: s.pass_line,
  requires: s.requires || [], enabled: !!s.enabled,
  question_count: Array.isArray(s.questions) ? s.questions.length : 0,
  updated_at: s.updated_at || 0
});

function validateExamSubject(d, existingCodes, allowCode, fail) {
  const code = String(d.code || '').trim();
  if (!/^[A-Za-z0-9_]{1,20}$/.test(code)) return fail('exam_bad_code', '科目 code 须为 1-20 位字母/数字/下划线');
  const title = String(d.title || '').trim();
  if (!title || title.length > 20) return fail('exam_bad_title', '科目标题须为 1-20 字');
  if (d.desc !== undefined && String(d.desc).length > 100) return fail('exam_bad_desc', '科目说明不超过 100 字');
  const passLine = Number(d.pass_line);
  if (!Number.isInteger(passLine) || passLine < 0 || passLine > 100) return fail('exam_bad_pass_line', '通过线须为 0-100 整数');
  if (!Array.isArray(d.requires)) return fail('exam_bad_requires', 'requires 须为数组');
  for (const r of d.requires) {
    if (!existingCodes.includes(r)) return fail('exam_bad_require_ref', `前置科目 ${r} 不存在`);
    if (r === code) return fail('exam_bad_require_self', '科目不能前置自身');
  }
  const qs = d.questions;
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 60) return fail('exam_bad_qcount', '题目须为 1-60 条');
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (!q || typeof q !== 'object') return fail('exam_bad_q', `第 ${i + 1} 题格式错误`);
    const text = String(q.question || '').trim();
    if (!text || text.length > 500) return fail('exam_bad_q_text', `第 ${i + 1} 题题干须为 1-500 字`);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return fail('exam_bad_q_opts', `第 ${i + 1} 题须 2-6 个选项`);
    for (let j = 0; j < q.options.length; j++) {
      const o = String(q.options[j] || '').trim();
      if (!o || o.length > 50) return fail('exam_bad_q_opt', `第 ${i + 1} 题第 ${j + 1} 个选项须为 1-50 字`);
    }
    const ai = Number(q.answer_idx);
    if (!Number.isInteger(ai) || ai < 0 || ai >= q.options.length) return fail('exam_bad_q_ans', `第 ${i + 1} 题答案索引不合法`);
  }
  return null;
}

async function exam_subject_list(ctx) {
  const { ensureAdminColls, col, _, ok } = ctx;
  await ensureAdminColls();
  const r = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const list = (r.data || []).sort((a, b) => (a.code === 'base' ? 0 : 1) - (b.code === 'base' ? 0 : 1) || (a.created_at || 0) - (b.created_at || 0));
  return ok({ list: list.map(examSubjectMeta) });
}

async function exam_subject_detail(ctx) {
  const { event, ensureAdminColls, col, _, ok, fail } = ctx;
  await ensureAdminColls();
  const code = String(event.code || '').trim();
  if (!code) return fail('exam_bad_code', '科目 code 必填');
  const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const s = (r.data && r.data[0]) || null;
  if (!s) return fail('exam_not_found', '科目不存在');
  return ok({ subject: examSubjectMeta(s), questions: s.questions || [] });
}

async function exam_subject_write(ctx) {
  const { event, action, ensureAdminColls, col, _, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const isCreate = action === 'exam_subject_create';
  const code = String(event.code || '').trim();
  const allR = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const existingCodes = (allR.data || []).map((s) => s.code);
  if (isCreate && existingCodes.includes(code)) return fail('exam_exists', `科目 ${code} 已存在, 请用编辑`);
  if (!isCreate && !existingCodes.includes(code)) return fail('exam_not_found', '科目不存在');
  const v = validateExamSubject({ code, title: event.title, desc: event.desc, pass_line: event.pass_line, requires: event.requires, questions: event.questions }, existingCodes, code, fail);
  if (v) return v;
  const cleanQs = (event.questions || []).map((q) => ({
    question: String(q.question || '').trim().slice(0, 500),
    options: q.options.map((o) => String(o || '').trim().slice(0, 50)),
    answer_idx: Number(q.answer_idx)
  }));
  if (isCreate) {
    const doc = {
      code, title: String(event.title).trim(), desc: String(event.desc || '').trim().slice(0, 100),
      pass_line: Number(event.pass_line), requires: (event.requires || []).filter((r) => existingCodes.includes(r)),
      enabled: event.enabled !== false, questions: cleanQs,
      is_deleted: false, created_at: now, updated_at: now, created_by: openid, updated_by: openid
    };
    await col('exam_bank').add({ data: doc });
    await logEvent('P2', 'exam_subject_create', openid, { code, title: doc.title, qcount: cleanQs.length, pass_line: doc.pass_line });
    return ok({ subject: examSubjectMeta(doc) });
  }
  const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const cur = (r.data && r.data[0]) || null;
  if (!cur) return fail('exam_not_found', '科目不存在');
  const patch = {
    title: String(event.title).trim(), desc: String(event.desc || '').trim().slice(0, 100),
    pass_line: Number(event.pass_line), requires: (event.requires || []).filter((r) => existingCodes.includes(r)),
    enabled: event.enabled !== false, questions: cleanQs,
    updated_at: now, updated_by: openid
  };
  await col('exam_bank').doc(cur._id).update({ data: patch });
  await logEvent('P2', 'exam_subject_update', openid, { code, title: patch.title, qcount: cleanQs.length, pass_line: patch.pass_line });
  return ok({ subject: examSubjectMeta(Object.assign({}, cur, patch)) });
}

async function exam_subject_delete(ctx) {
  const { event, ensureAdminColls, col, _, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const code = String(event.code || '').trim();
  if (!code) return fail('exam_bad_code', '科目 code 必填');
  const allR = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const refs = (allR.data || []).filter((s) => (s.requires || []).includes(code)).map((s) => s.code);
  if (refs.length > 0) return fail('exam_in_use', `科目被 ${refs.join('/')} 前置引用, 不可删除`);
  const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const cur = (r.data && r.data[0]) || null;
  if (!cur) return fail('exam_not_found', '科目不存在');
  await col('exam_bank').doc(cur._id).update({ data: { is_deleted: true, updated_at: now, updated_by: openid } });
  await logEvent('P2', 'exam_subject_delete', openid, { code });
  return ok({ deleted: code });
}

async function exam_bank_seed(ctx) {
  const { ensureAdminColls, col, _, now, openid, logEvent, ok } = ctx;
  await ensureAdminColls();
  const r = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const existingCodes = (r.data || []).map((s) => s.code);
  const created = [];
  const skipped = [];
  for (const [code, def] of Object.entries(EXAM_BANK_FALLBACK)) {
    if (existingCodes.includes(code)) { skipped.push(code); continue; }
    const doc = {
      code, title: def.title, desc: def.desc, pass_line: def.pass_line, requires: def.requires,
      enabled: true, questions: def.questions, is_deleted: false,
      created_at: now, updated_at: now, created_by: openid, updated_by: openid
    };
    await col('exam_bank').add({ data: doc });
    created.push(code);
  }
  await logEvent('P2', 'exam_bank_seed', openid, { created, skipped });
  return ok({ created, skipped });
}

module.exports = {
  exam_subject_list,
  exam_subject_detail,
  exam_subject_create: exam_subject_write,
  exam_subject_update: exam_subject_write,
  exam_subject_delete,
  exam_bank_seed
};
