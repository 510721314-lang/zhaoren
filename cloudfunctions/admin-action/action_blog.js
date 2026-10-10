// admin-action · 服务动态(blog)管理（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function blog_list(ctx) {
  const { event, pager, col, ok } = ctx;
  const status = ['normal', 'offline', 'deleted'].indexOf(event.status) >= 0 ? event.status : '';
  const { page, size, skip } = pager(event);
  const where = status ? { status } : {};
  const countAll = await col('blog_post').where(where).count();
  const r = await col('blog_post').where(where).orderBy('created_at', 'desc')
    .skip(skip).limit(size + 1).get();
  const rows = r.data || [];
  const has_more = rows.length > size;
  const list = (has_more ? rows.slice(0, size) : rows).map((p) => ({
    _id: p._id, author_openid: p.author_openid,
    author_nickname: p.author_nickname || '微信用户',
    scene: p.scene || '', content: p.content, image_count: (p.images || []).length,
    like_count: p.like_count || 0, comment_count: p.comment_count || 0,
    view_count: p.view_count || 0, status: p.status || 'normal', created_at: p.created_at
  }));
  return ok({ list, has_more, page, total: countAll.total });
}

async function blog_offline(ctx) {
  const { event, openid, isDocId, col, now, logEvent, ok, fail } = ctx;
  const { post_id, note } = event;
  if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
  if (!note || !String(note).trim()) return fail('blog_note_required', '请填写下架原因');
  const doc = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
  if (!doc) return fail('blog_gone', '动态不存在');
  if (doc.status === 'offline') return fail('blog_already_offline', '该动态已下架');
  await col('blog_post').doc(post_id).update({ data: { status: 'offline', offline_by: openid, offline_note: String(note).trim(), updated_at: now } });
  await logEvent('P2', 'blog_offline', openid, { post_id, author_openid: doc.author_openid, note: String(note).trim() });
  return ok({ msg: '已下架' });
}

async function blog_restore(ctx) {
  const { event, openid, isDocId, col, now, logEvent, ok, fail } = ctx;
  const { post_id } = event;
  if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
  const doc = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
  if (!doc) return fail('blog_gone', '动态不存在');
  if (doc.status !== 'offline') return fail('blog_not_offline', '仅已下架动态可恢复');
  await col('blog_post').doc(post_id).update({ data: { status: 'normal', updated_at: now } });
  await logEvent('P2', 'blog_restore', openid, { post_id });
  return ok({ msg: '已恢复' });
}

async function blog_delete(ctx) {
  const { event, openid, isDocId, col, now, logEvent, ok, fail } = ctx;
  const { post_id, note } = event;
  if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
  if (!note || !String(note).trim()) return fail('blog_note_required', '请填写删除原因');
  const doc = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
  if (!doc || doc.is_deleted) return fail('blog_gone', '动态不存在');
  await col('blog_post').doc(post_id).update({ data: { status: 'deleted', is_deleted: true, delete_by: openid, delete_note: String(note).trim(), updated_at: now } });
  await logEvent('P2', 'blog_delete', openid, { post_id, author_openid: doc.author_openid, note: String(note).trim() });
  return ok({ msg: '已删除' });
}

async function blog_comment_list(ctx) {
  const { event, isDocId, pager, col, ok, fail } = ctx;
  const { post_id } = event;
  if (!isDocId(post_id)) return fail('blog_bad_id', '动态 ID 格式不正确');
  const { page, size, skip } = pager(event);
  const r = await col('blog_comment').where({ post_id }).orderBy('created_at', 'desc')
    .skip(skip).limit(size + 1).get();
  const rows = r.data || [];
  const has_more = rows.length > size;
  const list = (has_more ? rows.slice(0, size) : rows).map((c) => ({
    _id: c._id, author_openid: c.author_openid, author_nickname: c.author_nickname || '微信用户',
    content: c.content, status: c.status || 'normal', created_at: c.created_at
  }));
  return ok({ list, has_more, page });
}

async function blog_comment_delete(ctx) {
  const { event, openid, isDocId, col, db, now, logEvent, ok, fail } = ctx;
  const { comment_id, note } = event;
  if (!isDocId(comment_id)) return fail('blog_bad_comment_id', '评论 ID 格式不正确');
  if (!note || !String(note).trim()) return fail('blog_note_required', '请填写删除原因');
  const cdoc = await col('blog_comment').doc(comment_id).get().then((r) => r.data).catch(() => null);
  if (!cdoc || cdoc.is_deleted) return fail('blog_comment_gone', '评论不存在');
  await col('blog_comment').doc(comment_id).update({ data: { status: 'deleted', is_deleted: true, delete_by: openid, updated_at: now } });
  if (cdoc.status !== 'deleted') {
    await col('blog_post').doc(cdoc.post_id).update({ data: { comment_count: db.command.inc(-1) } }).catch(() => {});
  }
  await logEvent('P2', 'blog_comment_delete', openid, { comment_id, post_id: cdoc.post_id, note: String(note).trim() });
  return ok({ msg: '评论已删除' });
}

module.exports = {
  blog_list, blog_offline, blog_restore, blog_delete, blog_comment_list, blog_comment_delete
};
