// action_service.js — 服务项目与 SOP 只读公开接口(小程序端浏览)
// 与首页概览同口径: 不登录/不留痕/短 TTL 缓存; 仅下发 online 且未软删的记录
// 共享符号经 ctx 注入, 禁 require('./index')

const TTL_SOP_LIST = 60 * 1000;  // 列表短缓存: 运营改配置后 1 分钟内生效

// 卡片字段(列表不下发 sop_content 大文本)
function toCard(d) {
  return {
    _id: d._id,
    scene_code: d.scene_code,
    name: d.name,
    brief: d.brief || '',
    cover_fileid: d.cover_fileid || '',
    sort: d.sort === undefined ? 0 : Number(d.sort) || 0
  };
}

// ───────── 服务项目列表(按 scene_code 过滤 online; 空 scene 返回全部 online) ─────────
async function serviceListAction(ctx) {
  const { event, col, _, loadSceneList, memSet, memGet } = ctx;
  const sceneCode = String(event.scene_code || '').trim();

  // 传了 scene_code 则校验白名单(与首页分组同源 admin_config.scene_list)
  if (sceneCode) {
    const { scenes } = await loadSceneList();
    const sceneDef = scenes.find((s) => s.code === sceneCode);
    if (!sceneDef) {
      return { ok: false, code: 'home_bad_scene', msg: '场景不存在或已隐藏' };
    }
  }

  const cacheKey = 'home_sop_list_' + (sceneCode || 'all');
  const cached = memGet(cacheKey);
  if (cached && Array.isArray(cached.list)) {
    return { ok: true, data: { scene_code: sceneCode || null, list: cached.list } };
  }

  const where = { is_deleted: _.neq(true), status: 'online' };
  if (sceneCode) where.scene_code = sceneCode;
  const r = await col('service_sop')
    .where(where)
    .orderBy('scene_code', 'asc')
    .orderBy('sort', 'asc')
    .limit(500)
    .get()
    .catch(() => ({ data: [] }));
  const list = (r.data || []).map(toCard);
  memSet(cacheKey, { list }, TTL_SOP_LIST);
  return { ok: true, data: { scene_code: sceneCode || null, list } };
}

// ───────── 单条 SOP 详情(含 sop_content 正文) ─────────
async function serviceDetailAction(ctx) {
  const { event, col } = ctx;
  const id = String(event.id || '').trim();
  if (!id) return { ok: false, code: 'home_bad_param', msg: '缺少 id' };

  const data = await col('service_sop').doc(id).get()
    .then((r) => r && r.data)
    .catch(() => null);
  if (!data || data.is_deleted === true || data.status !== 'online') {
    return { ok: false, code: 'home_not_found', msg: '服务项目不存在或已下架' };
  }
  return {
    ok: true,
    data: {
      _id: data._id,
      scene_code: data.scene_code,
      name: data.name,
      brief: data.brief || '',
      sop_content: data.sop_content || '',
      cover_fileid: data.cover_fileid || '',
      sort: data.sort === undefined ? 0 : Number(data.sort) || 0
    }
  };
}

module.exports = {
  service_list: serviceListAction,
  service_detail: serviceDetailAction,
};
