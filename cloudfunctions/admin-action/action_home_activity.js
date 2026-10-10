// admin-action · 首页活动管理（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

function home_activity_list(ctx) {
  const { config, ok } = ctx;
  const list = (config.home_activities || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return ok({ list });
}

async function home_activity_create(ctx) {
  const { event, config, now, openid, col, logEvent, ok, fail } = ctx;
  const a = event.activity || {};
  if (!a.title || String(a.title).length > 30) return fail('act_bad_title', '活动标题须为 1-30 字');
  if (!a.type || !['banner', 'card', 'both'].includes(a.type)) return fail('act_bad_type', 'type 须为 banner/card/both');
  if (!a.jump_to || !['demand_publish', 'scene_list', 'webview', 'activity_detail'].includes(a.jump_to)) {
    return fail('act_bad_jump', 'jump_to 不合法');
  }
  if (a.start_at && a.end_at && a.start_at >= a.end_at) return fail('act_bad_time', '开始时间必须早于结束时间');
  const c = a.content || {};
  if (c && (!Array.isArray(c.rules) || c.rules.some((x) => typeof x !== 'string'))) {
    return fail('act_bad_content', 'content.rules 须为字符串数组');
  }
  const list = config.home_activities || [];
  const id = 'A' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const newAct = {
    id,
    title: String(a.title).trim(),
    subtitle: String(a.subtitle || '').trim().slice(0, 60),
    banner_image: String(a.banner_image || '').trim(),
    cover_image: String(a.cover_image || '').trim(),
    type: a.type,
    jump_to: a.jump_to,
    jump_param: a.jump_param || {},
    start_at: a.start_at || now,
    end_at: a.end_at || (now + 30 * 86400000),
    status: a.status || 'active',
    priority: Number(a.priority) || 0,
    scene_code: a.scene_code || '',
    content: {
      time_text: String(c.time_text || '').trim().slice(0, 60),
      location: String(c.location || '').trim().slice(0, 60),
      rules: Array.isArray(c.rules) ? c.rules.map((r) => String(r).trim().slice(0, 60)).filter(Boolean).slice(0, 10) : [],
      body: String(c.body || '').trim().slice(0, 500),
      cta_text: String(c.cta_text || '').trim().slice(0, 12)
    },
    created_at: now,
    created_by: openid
  };
  list.push(newAct);
  await col('admin_config').where({ _id: 'global' }).update({ data: { home_activities: list, updated_at: now } });
  await logEvent('P2', 'home_activity_create', openid, { id, title: newAct.title });
  return ok({ activity: newAct });
}

async function home_activity_update(ctx) {
  const { event, config, now, openid, col, logEvent, ok, fail } = ctx;
  const { id, patch } = event;
  if (!id) return fail('act_bad_id', '活动 id 必填');
  const list = config.home_activities || [];
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return fail('act_not_found', '活动不存在');
  const allowed = ['title', 'subtitle', 'banner_image', 'cover_image', 'type', 'jump_to', 'jump_param', 'start_at', 'end_at', 'status', 'priority', 'scene_code', 'content'];
  const updated = Object.assign({}, list[idx]);
  for (const k of allowed) {
    if (patch[k] !== undefined) updated[k] = patch[k];
  }
  if (updated.content && (!Array.isArray(updated.content.rules) || updated.content.rules.some((x) => typeof x !== 'string'))) {
    return fail('act_bad_content', 'content.rules 须为字符串数组');
  }
  if (updated.start_at && updated.end_at && updated.start_at >= updated.end_at) {
    return fail('act_bad_time', '开始时间必须早于结束时间');
  }
  updated.updated_at = now;
  updated.updated_by = openid;
  list[idx] = updated;
  await col('admin_config').where({ _id: 'global' }).update({ data: { home_activities: list, updated_at: now } });
  await logEvent('P2', 'home_activity_update', openid, { id, patch });
  return ok({ activity: updated });
}

async function home_activity_delete(ctx) {
  const { event, config, now, openid, col, logEvent, ok, fail } = ctx;
  const { id } = event;
  if (!id) return fail('act_bad_id', '活动 id 必填');
  const list = config.home_activities || [];
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return fail('act_not_found', '活动不存在');
  list.splice(idx, 1);
  await col('admin_config').where({ _id: 'global' }).update({ data: { home_activities: list, updated_at: now } });
  await logEvent('P2', 'home_activity_delete', openid, { id });
  return ok({ deleted: id });
}

module.exports = {
  home_activity_list, home_activity_create, home_activity_update, home_activity_delete
};
