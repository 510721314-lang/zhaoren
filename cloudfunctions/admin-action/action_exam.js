// admin-action · 认证考试科目只读（原 exam_subject_* / exam_bank_seed，从 index.js 物理抽出）
// 2026-10-26 S4：题目写入口已迁至 questions（见 action_question.js），本模块仅保留科目只读；
// 旧写动作 exam_subject_create/update/delete 与 exam_bank_seed 一律返回 exam_write_retired。
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

const RETIRED_MSG = '该入口已退役：题目请用题库管理（questions），科目元数据请用 exam_subject_meta_update';

const examSubjectMeta = (s) => ({
  code: s.code, title: s.title, desc: s.desc || '', pass_line: s.pass_line,
  requires: s.requires || [], enabled: !!s.enabled,
  question_count: Array.isArray(s.questions) ? s.questions.length : 0,
  updated_at: s.updated_at || 0
});

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
  // questions 字段已退役（S4），兼容返回空数组；题目请走 question_list
  return ok({ subject: examSubjectMeta(s), questions: [] });
}

async function exam_write_retired(ctx) {
  const { fail } = ctx;
  return fail('exam_write_retired', RETIRED_MSG);
}

module.exports = {
  exam_subject_list,
  exam_subject_detail,
  exam_subject_create: exam_write_retired,
  exam_subject_update: exam_write_retired,
  exam_subject_delete: exam_write_retired,
  exam_bank_seed: exam_write_retired
};
