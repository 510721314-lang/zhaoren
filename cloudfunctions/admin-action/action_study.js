// admin-action · 学习内容只读预览（S4）
// 内容写路径保持单一: docs/study-content/*.md → scripts/seed-study-content.js → study_content，
// 后台只提供列表/正文预览，避免出现第二个内容写入口（与题库迁移口径一致）。
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

function contentOut(d) {
  return {
    subject: d.subject || '',
    module_id: d.module_id || '',
    chapter_id: d.chapter_id || '',
    sort: Number(d.sort) || 0,
    title: d.title || '',
    status: d.status || 'draft',
    body_length: String(d.body_md || '').length,
    updated_at: Number(d.updated_at) || 0
  };
}

async function content_list(ctx) {
  const { event, col, _, ok } = ctx;
  const subject = String(event.subject || '').trim();
  const moduleId = String(event.module_id || '').trim();
  const status = String(event.status || '').trim();
  const keyword = String(event.keyword || '').trim().toLowerCase();
  const where = { is_deleted: _.neq(true) };
  if (subject) where.subject = subject;
  if (moduleId) where.module_id = moduleId;
  if (status) where.status = status;
  const r = await col('study_content').where(where).limit(500).get().catch(() => ({ data: [] }));
  let list = (r.data || []).filter((d) => d && d.subject && d.module_id && d.chapter_id);
  if (keyword) {
    list = list.filter((d) => String(d.title || '').toLowerCase().includes(keyword)
      || String(d.chapter_id || '').toLowerCase().includes(keyword));
  }
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
  return ok({ list: list.map(contentOut) });
}

async function content_detail(ctx) {
  const { event, col, _, ok, fail } = ctx;
  const subject = String(event.subject || '').trim();
  const moduleId = String(event.module_id || '').trim();
  const chapterId = String(event.chapter_id || '').trim();
  if (!subject || !moduleId || !chapterId) return fail('content_bad_key', 'subject/module_id/chapter_id 必填');
  const r = await col('study_content').where({ subject, module_id: moduleId, chapter_id: chapterId, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const d = (r.data || [])[0];
  if (!d) return fail('content_not_found', '章节不存在');
  return ok({
    content: Object.assign(contentOut(d), {
      body_md: String(d.body_md || ''),
      created_at: Number(d.created_at) || 0,
      updated_by: d.updated_by || ''
    })
  });
}

module.exports = {
  content_list,
  content_detail
};
