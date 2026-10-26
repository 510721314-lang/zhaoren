// action_study_content.js — 学习中心只读（C 端耍伴，2026-10-27）
// 内容写路径保持单一: docs/study-content/*.md → scripts/seed-study-content.js → study_content
// 只下发 status=published 的章节; 共享符号经 ctx 注入, 禁 require('./index')
function chapterOut(d) {
  return {
    subject: d.subject || '',
    module_id: d.module_id || '',
    chapter_id: d.chapter_id || '',
    sort: Number(d.sort) || 0,
    title: d.title || '',
    body_length: String(d.body_md || '').length,
    updated_at: Number(d.updated_at) || 0
  };
}

function sortChapters(list) {
  list.sort((a, b) => {
    const baseOrder = (a.subject === 'base' ? 0 : 1) - (b.subject === 'base' ? 0 : 1);
    if (baseOrder !== 0) return baseOrder;
    const s = String(a.subject || '').localeCompare(String(b.subject || ''));
    if (s !== 0) return s;
    const m = String(a.module_id || '').localeCompare(String(b.module_id || ''));
    if (m !== 0) return m;
    const so = (Number(a.sort) || 0) - (Number(b.sort) || 0);
    if (so !== 0) return so;
    return String(a.chapter_id || '').localeCompare(String(b.chapter_id || ''));
  });
  return list;
}

// 学习中心章节列表: 仅 published; 可按科目过滤
async function studyListAction(ctx) {
  const { event, col, _ } = ctx;
  const subject = String(event.subject || '').trim();
  const where = { is_deleted: _.neq(true), status: 'published' };
  if (subject) where.subject = subject;
  const r = await col('study_content').where(where).limit(500).get().catch(() => ({ data: [] }));
  const list = (r.data || []).filter((d) => d && d.subject && d.module_id && d.chapter_id);
  return { ok: true, data: { list: sortChapters(list).map(chapterOut) } };
}

// 学习中心章节正文: 仅 published; 自然键 subject+module_id+chapter_id
async function studyDetailAction(ctx) {
  const { event, col, _ } = ctx;
  const subject = String(event.subject || '').trim();
  const moduleId = String(event.module_id || '').trim();
  const chapterId = String(event.chapter_id || '').trim();
  if (!subject || !moduleId || !chapterId) {
    return { ok: false, code: 'study_bad_key', msg: 'subject/module_id/chapter_id 必填' };
  }
  const r = await col('study_content')
    .where({ subject, module_id: moduleId, chapter_id: chapterId, status: 'published', is_deleted: _.neq(true) })
    .limit(1).get().catch(() => ({ data: [] }));
  const d = (r.data || [])[0];
  if (!d) return { ok: false, code: 'study_not_found', msg: '章节不存在或未发布' };
  return {
    ok: true,
    data: {
      content: Object.assign(chapterOut(d), {
        body_md: String(d.body_md || '')
      })
    }
  };
}

module.exports = {
  study_list: studyListAction,
  study_detail: studyDetailAction
};
