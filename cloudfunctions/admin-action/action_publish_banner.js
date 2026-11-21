// admin-action · 发布页顶部 Banner 管理（镜像 action_home_activity.js 模式）
// 读写 admin_config 集合 global 文档的 publish_banners 字段；P2 审计留痕。
// 共享符号通过 ctx 注入，禁止反向 require('./index')。
// 链接口径：仅允许小程序内部路径（以 / 开头），外部 URL 不在本期范围（无 web-view 承载页 + 未配业务域名）。

function publish_banner_list(ctx) {
  const { config, ok } = ctx;
  const list = (config.publish_banners || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  return ok({ list });
}

async function publish_banner_create(ctx) {
  const { event, config, now, openid, col, logEvent, ok, fail } = ctx;
  const b = event.banner || {};
  const image = String(b.image || '').trim();
  if (!image) return fail('pb_bad_image', 'banner 图片必填');
  const link = String(b.link || '').trim();
  if (!link || link.charAt(0) !== '/') return fail('pb_bad_link', '链接须为小程序内部路径（以 / 开头）');
  const list = config.publish_banners || [];
  const id = 'PB' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const newBanner = {
    id,
    image,
    link: link.slice(0, 300),
    sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : 0,
    enabled: b.enabled !== false,  // 默认启用
    created_at: now,
    created_by: openid
  };
  list.push(newBanner);
  await col('admin_config').where({ _id: 'global' }).update({ data: { publish_banners: list, updated_at: now } });
  await logEvent('P2', 'publish_banner_create', openid, { id });
  return ok({ banner: newBanner });
}

async function publish_banner_update(ctx) {
  const { event, config, now, openid, col, logEvent, ok, fail } = ctx;
  const { id, patch } = event;
  if (!id) return fail('pb_bad_id', 'banner id 必填');
  const list = config.publish_banners || [];
  const idx = list.findIndex((b) => b.id === id);
  if (idx < 0) return fail('pb_not_found', 'banner 不存在');
  const allowed = ['image', 'link', 'sort', 'enabled'];
  const updated = Object.assign({}, list[idx]);
  for (const k of allowed) {
    if (patch[k] !== undefined) updated[k] = patch[k];
  }
  if (patch.image !== undefined) {
    updated.image = String(updated.image || '').trim();
    if (!updated.image) return fail('pb_bad_image', 'banner 图片必填');
  }
  if (patch.link !== undefined) {
    updated.link = String(updated.link || '').trim();
    if (!updated.link || updated.link.charAt(0) !== '/') return fail('pb_bad_link', '链接须为小程序内部路径（以 / 开头）');
    updated.link = updated.link.slice(0, 300);
  }
  if (patch.sort !== undefined) updated.sort = Number.isFinite(Number(updated.sort)) ? Number(updated.sort) : 0;
  updated.updated_at = now;
  updated.updated_by = openid;
  list[idx] = updated;
  await col('admin_config').where({ _id: 'global' }).update({ data: { publish_banners: list, updated_at: now } });
  await logEvent('P2', 'publish_banner_update', openid, { id, patch });
  return ok({ banner: updated });
}

async function publish_banner_delete(ctx) {
  const { event, config, now, openid, col, logEvent, ok, fail } = ctx;
  const { id } = event;
  if (!id) return fail('pb_bad_id', 'banner id 必填');
  const list = config.publish_banners || [];
  const idx = list.findIndex((b) => b.id === id);
  if (idx < 0) return fail('pb_not_found', 'banner 不存在');
  list.splice(idx, 1);
  await col('admin_config').where({ _id: 'global' }).update({ data: { publish_banners: list, updated_at: now } });
  await logEvent('P2', 'publish_banner_delete', openid, { id });
  return ok({ deleted: id });
}

module.exports = {
  publish_banner_list, publish_banner_create, publish_banner_update, publish_banner_delete
};
