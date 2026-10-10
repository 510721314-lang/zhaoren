// admin-action · 用户封禁/解封 + 分级处罚（user_ban/user_unban/penalty，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function user_ban_unban(ctx) {
  const { event, action, now, openid, isOpenid, col, logEvent, ok, fail } = ctx;
  const { target_openid, reason } = event;
  if (!isOpenid(target_openid)) return fail('ban_bad_openid', 'openid 格式不正确');
  const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
  if (!ur.data || !ur.data[0]) return fail('ban_user_not_found', '用户不存在');
  const ban = action === 'user_ban';
  if (ban && (!reason || !String(reason).trim())) return fail('ban_no_reason', '请填写封禁原因');
  const patch = { status: ban ? 'banned' : 'normal', updated_at: now };
  if (ban) {
    patch.banned_reason = String(reason).trim();
    patch.banned_at = now; patch.banned_by = openid;
  } else {
    patch.unbanned_at = now; patch.unbanned_by = openid;
  }
  await col('user_account').doc(ur.data[0]._id).update({ data: patch });
  if (ban) {
    await col('partner_profile').where({ openid: target_openid }).update({
      data: { accept_switch: false, updated_at: now }
    }).catch(() => {});
  }
  await logEvent('P2', ban ? 'user_banned' : 'user_unbanned', openid, {
    target_openid, reason: reason || '', before: ur.data[0].status, after: patch.status
  });
  return ok({ openid: target_openid, status: patch.status });
}

async function penalty(ctx) {
  const { event, openid, isOpenid, col, logEvent, ok, fail } = ctx;
  const { target_openid, level, reason } = event;
  if (!isOpenid(target_openid)) return fail('pen_bad_openid', 'openid 格式不正确');
  if (!['warning', 'suspend_7d', 'ban'].includes(level)) {
    return fail('pen_bad_level', 'level 须为 warning/suspend_7d/ban');
  }
  if (!reason || !String(reason).trim()) return fail('pen_no_reason', '请填写处罚原因');
  const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
  if (!ur.data || !ur.data[0]) return fail('pen_user_not_found', '用户不存在');

  const now = Date.now();
  let patch = { updated_at: now };
  if (level === 'warning') {
    patch.status = 'normal';
    patch.last_warning = { reason: String(reason).trim(), at: now, by: openid };
  } else if (level === 'suspend_7d') {
    patch.status = 'suspended';
    patch.suspend_until = now + 7 * 24 * 3600 * 1000;
    patch.suspend_reason = String(reason).trim();
    patch.suspend_at = now; patch.suspend_by = openid;
  } else {
    patch.status = 'banned';
    patch.banned_reason = String(reason).trim();
    patch.banned_at = now; patch.banned_by = openid;
  }
  await col('user_account').doc(ur.data[0]._id).update({ data: patch });
  if (level !== 'warning') {
    await col('partner_profile').where({ openid: target_openid }).update({
      data: { accept_switch: false, updated_at: now }
    }).catch(() => {});
  }
  await logEvent('P1', `penalty_${level}`, openid, {
    target_openid, reason: reason, level
  });
  return ok({ openid: target_openid, level, status: patch.status });
}

module.exports = {
  user_ban: user_ban_unban,
  user_unban: user_ban_unban,
  penalty
};
