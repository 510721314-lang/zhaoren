// admin-action · 通知群发 notice_send（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function notice_send(ctx) {
  const { event, fail, isOpenid, col, _, now, openid, logEvent, ok } = ctx;
  const t = String(event.title || '').trim();
  const b = String(event.body || '').trim();
  const audience = event.audience;
  if (!t || t.length > 30) return fail('notice_bad_title', '标题必填且不超过30字');
  if (!b || b.length > 500) return fail('notice_bad_body', '内容必填且不超过500字');
  if (['all', 'partner', 'user', 'one'].indexOf(audience) < 0) {
    return fail('notice_bad_audience', '群发对象不合法');
  }
  let targets = [];
  if (audience === 'one') {
    if (!isOpenid(event.target_openid)) return fail('notice_bad_openid', 'openid 格式不正确');
    targets = [event.target_openid];
  } else {
    const q = { is_deleted: _.neq(true) };
    if (audience === 'partner') q.roles = 'partner';
    else if (audience === 'user') q.roles = _.neq('partner');
    const ur = await col('user_account').where(q).field({ openid: true }).limit(1000).get()
      .catch(() => ({ data: [] }));
    targets = (ur.data || []).map((d) => d.openid).filter(Boolean);
  }
  if (targets.length === 0) return fail('notice_no_target', '没有可发送的目标用户');
  if (targets.length > 1) {
    const recent = await col('platform_event').where({
      type: 'notice_send', openid, created_at: _.gte(now - 10 * 60 * 1000)
    }).count().catch(() => ({ total: 0 }));
    if ((recent.total || 0) > 0) return fail('notice_too_frequent', '群发10分钟内仅可1次');
  }
  const cap = Math.min(targets.length, 1000);
  const docs = targets.slice(0, cap).map((to) => ({
    to_openid: to, type: 'broadcast', title: t, body: b,
    action_key: '', action_payload: {}, read: false,
    created_at: now, updated_at: now, is_deleted: false
  }));
  for (let i = 0; i < docs.length; i += 100) {
    await col('system_notice').add({ data: docs.slice(i, i + 100) });
  }
  await logEvent('P2', 'notice_send', openid, { audience, count: docs.length, total_targets: targets.length, title: t });
  return ok({ sent: docs.length, total_targets: targets.length, cap: 1000 });
}

module.exports = { notice_send };
