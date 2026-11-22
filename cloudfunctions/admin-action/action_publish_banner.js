// admin-action · 发布页顶部 Banner 管理（镜像 action_home_activity.js 模式）
// 读写 admin_config 集合 global 文档的 publish_banners 字段；P2 审计留痕。
// 共享符号通过 ctx 注入，禁止反向 require('./index')。
// 链接口径：仅允许小程序内部路径（以 / 开头），外部 URL 不在本期范围（无 web-view 承载页 + 未配业务域名）。
// 2026-11-22 多图改版：单条 Banner 支持 1~6 张图，每张图独立 link；旧数据 {image, link} 读取时兼容为 1 张。

const PB_MAX_IMAGES = 6;

// 兼容旧数据(单图 image/link) → images 数组；新数据直接读 images
function normalizeImages(b) {
  if (b && Array.isArray(b.images)) return b.images;
  if (b && b.image) return [{ image: b.image, link: b.link || '' }];
  return [];
}

// 校验 images：1~6 张，每张 image 必填、link 必填且以 / 开头
function validateImages(raw) {
  if (!Array.isArray(raw) || !raw.length) return { err: ['pb_bad_image', 'banner 图片必填'] };
  if (raw.length > PB_MAX_IMAGES) return { err: ['pb_too_many_images', '最多上传 ' + PB_MAX_IMAGES + ' 张图片'] };
  const images = [];
  for (const it of raw) {
    const image = String((it && it.image) || '').trim();
    if (!image) return { err: ['pb_bad_image', 'banner 图片必填'] };
    const link = String((it && it.link) || '').trim();
    if (!link || link.charAt(0) !== '/') return { err: ['pb_bad_link', '链接须为小程序内部路径（以 / 开头）'] };
    images.push({ image, link: link.slice(0, 300) });
  }
  return { images };
}

function publish_banner_list(ctx) {
  const { config, ok } = ctx;
  const list = (config.publish_banners || [])
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((b) => Object.assign({}, b, { images: normalizeImages(b) }));
  return ok({ list });
}

async function publish_banner_create(ctx) {
  const { event, config, now, openid, col, logEvent, ok, fail } = ctx;
  const b = event.banner || {};
  const checked = validateImages(b.images);
  if (checked.err) return fail(checked.err[0], checked.err[1]);
  const list = config.publish_banners || [];
  const id = 'PB' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const newBanner = {
    id,
    images: checked.images,
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
  const allowed = ['images', 'sort', 'enabled'];
  const updated = Object.assign({}, list[idx]);
  for (const k of allowed) {
    if (patch[k] !== undefined) updated[k] = patch[k];
  }
  if (patch.images !== undefined) {
    const checked = validateImages(updated.images);
    if (checked.err) return fail(checked.err[0], checked.err[1]);
    updated.images = checked.images;
    // 旧字段单图 image/link 迁移到 images 后删除，避免双源
    delete updated.image;
    delete updated.link;
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
