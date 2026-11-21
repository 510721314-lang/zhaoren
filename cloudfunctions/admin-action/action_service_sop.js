// admin-action · 服务项目与 SOP 管理（批1，feature-plan-service-sop-20261121 D2/D6 已批）
// 独立集合 service_sop：sop_project_list / sop_project_save / sop_project_delete / sop_project_status
// scene_code 服务端校验 ∈ config.scene_list 白名单（zhaoren-config-sync 口径）；
// 写操作 gatedLog 留痕（logEvent P2）；删除走软删 is_deleted（§24 口径）；纯新增不改既有逻辑。
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

// 集合幂等创建（add 不自动建集合，缺集合报 -502005；云函数管理权限可 createCollection）
async function ensureSopColl(db) {
  try { await db.createCollection('service_sop'); } catch (e) { /* 已存在则忽略 */ }
}

function sceneWhitelist(config) {
  return ((config && config.scene_list) || []).map((s) => String(s.code || '').toUpperCase());
}

// 富文本口径：去掉 HTML 标签与实体，返回纯文本（用于字数统计/校验，标签不计入）
function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 列表：可按 scene_code 过滤；仅返回未软删；按 scene_code + sort 排序；下发正文供后台编辑回填
async function sop_project_list(ctx) {
  const { event, ok, col } = ctx;
  const q = { is_deleted: false };
  if (event.scene_code !== undefined && event.scene_code !== '') {
    q.scene_code = String(event.scene_code).toUpperCase();
  }
  const r = await col('service_sop').where(q)
    .orderBy('scene_code', 'asc').orderBy('sort', 'asc').limit(500).get()
    .catch(() => ({ data: [] }));
  return ok({
    list: (r.data || []).map((d) => ({
      _id: d._id,
      scene_code: d.scene_code || '',
      name: d.name || '',
      brief: d.brief || '',
      sop_content: d.sop_content || '',
      sop_content_len: stripTags(d.sop_content || '').length,
      cover_fileid: d.cover_fileid || '',
      sort: Number(d.sort) || 0,
      status: d.status || 'offline',
      created_at: d.created_at || 0,
      updated_at: d.updated_at || 0
    }))
  });
}

// 新增/编辑共用：有 _id → 更新，无 _id → 新增
async function sop_project_save(ctx) {
  const { event, now, openid, col, db, log, logEvent, ok, fail, config } = ctx;
  await ensureSopColl(db);
  const wl = sceneWhitelist(config);
  const sceneCode = String(event.scene_code || '').trim().toUpperCase();
  if (!sceneCode) return fail('sop_bad_scene', 'scene_code 必填');
  if (wl.indexOf(sceneCode) < 0) return fail('sop_scene_not_found', `场景不在白名单: ${sceneCode}`);
  const name = String(event.name || '').trim();
  if (!name || name.length > 30) return fail('sop_bad_name', '项目名须为 1-30 字');
  const brief = String(event.brief || '').trim().slice(0, 100);
  const sopContent = String(event.sop_content || '');
  // 富文本口径：按去标签后的纯文本字数限 20000（HTML 标签/实体不计入）
  if (stripTags(sopContent).length > 20000) return fail('sop_bad_content', 'SOP 正文纯文本不得超过 20000 字');
  const coverFileid = String(event.cover_fileid || '').trim().slice(0, 200);
  const status = event.status === 'offline' ? 'offline' : 'online';
  const sortRaw = parseInt(event.sort, 10);
  const sort = Number.isInteger(sortRaw) ? sortRaw : 0;

  const id = String(event._id || '').trim();
  if (id) {
    // 更新：先校验存在且未软删
    const cur = await col('service_sop').doc(id).get().then((r) => r.data).catch(() => null);
    if (!cur) return fail('sop_not_found', '服务项目不存在');
    if (cur.is_deleted) return fail('sop_deleted', '服务项目已删除');
    const patch = {
      scene_code: sceneCode, name, brief, sop_content: sopContent,
      cover_fileid: coverFileid, sort, status, updated_at: now, updated_by: openid
    };
    await col('service_sop').doc(id).update({ data: patch });
    await logEvent('P2', 'sop_project_update', openid, { _id: id, scene_code: sceneCode, name });
    return ok({ _id: id, updated: true });
  }
  // 新增
  const data = {
    scene_code: sceneCode, name, brief, sop_content: sopContent,
    cover_fileid: coverFileid, sort, status,
    created_at: now, updated_at: now, created_by: openid, is_deleted: false
  };
  let r;
  try {
    r = await col('service_sop').add({ data });
  } catch (e) {
    log.e('[SOP_ADD_FAIL] ' + (e && e.message));
    return fail('sop_add_fail', '服务项目写入失败，请重试');
  }
  await logEvent('P2', 'sop_project_create', openid, { _id: r._id, scene_code: sceneCode, name });
  return ok({ _id: r._id, created: true });
}

// 删除：软删（§24 口径），不物理删除
async function sop_project_delete(ctx) {
  const { event, now, openid, col, logEvent, ok, fail } = ctx;
  const id = String(event._id || '').trim();
  if (!id) return fail('sop_bad_id', '_id 必填');
  const cur = await col('service_sop').doc(id).get().then((r) => r.data).catch(() => null);
  if (!cur) return fail('sop_not_found', '服务项目不存在');
  if (cur.is_deleted) return fail('sop_deleted', '服务项目已删除');
  await col('service_sop').doc(id).update({ data: { is_deleted: true, updated_at: now, updated_by: openid } });
  await logEvent('P2', 'sop_project_delete', openid, { _id: id, scene_code: cur.scene_code, name: cur.name });
  return ok({ _id: id, deleted: true });
}

// 上下架：online / offline 切换
async function sop_project_status(ctx) {
  const { event, now, openid, col, logEvent, ok, fail } = ctx;
  const id = String(event._id || '').trim();
  if (!id) return fail('sop_bad_id', '_id 必填');
  const status = String(event.status || '');
  if (status !== 'online' && status !== 'offline') return fail('sop_bad_status', 'status 仅支持 online/offline');
  const cur = await col('service_sop').doc(id).get().then((r) => r.data).catch(() => null);
  if (!cur) return fail('sop_not_found', '服务项目不存在');
  if (cur.is_deleted) return fail('sop_deleted', '服务项目已删除');
  await col('service_sop').doc(id).update({ data: { status, updated_at: now, updated_by: openid } });
  await logEvent('P2', 'sop_project_status', openid, { _id: id, status, scene_code: cur.scene_code });
  return ok({ _id: id, status });
}

module.exports = { sop_project_list, sop_project_save, sop_project_delete, sop_project_status };
