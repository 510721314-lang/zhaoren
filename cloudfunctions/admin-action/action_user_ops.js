// admin-action · 用户冻结/解冻 + 信用分人工调整（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function user_freeze_unfreeze(ctx) {
  const { event, action, now, openid, isOpenid, col, logEvent, ok, fail } = ctx;
  const { target_openid, reason } = event;
  if (!isOpenid(target_openid)) return fail('freeze_bad_openid', 'openid 格式不正确');
  const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
  if (!ur.data || !ur.data[0]) return fail('user_not_found', '用户不存在');
  const freeze = action === 'user_freeze';
  const patch = { status: freeze ? 'frozen' : 'normal', updated_at: now };
  if (freeze) { patch.frozen_reason = reason || ''; patch.frozen_at = now; patch.frozen_by = openid; }
  await col('user_account').doc(ur.data[0]._id).update({ data: patch });
  if (freeze) {
    await col('partner_profile').where({ openid: target_openid }).update({ data: { accept_switch: false, updated_at: now } }).catch(() => {});
  }
  await logEvent('P2', freeze ? 'user_frozen' : 'user_unfrozen', openid, {
    target_openid, reason: reason || '', before: ur.data[0].status, after: patch.status
  });
  return ok({ openid: target_openid, status: patch.status });
}

async function user_credit_adjust(ctx) {
  const { event, now, openid, isOpenid, col, logEvent, ok, fail } = ctx;
  const { target_openid, score_type, delta, reason } = event;
  if (!isOpenid(target_openid)) return fail('credit_bad_openid', 'openid 格式不正确');
  const d = parseInt(delta, 10);
  if (!Number.isInteger(d) || d === 0) return fail('credit_bad_delta', '调整分值须为非零整数');
  if (d < -100 || d > 100) return fail('credit_bad_delta', '单次调整范围 -100 ~ 100');
  if (!reason || !String(reason).trim()) return fail('credit_no_reason', '请填写调整原因');
  if (score_type !== 'user' && score_type !== 'partner') return fail('credit_bad_type', 'score_type 须为 user/partner');
  const ur = await col('user_account').where({ openid: target_openid }).limit(1).get();
  if (!ur.data || !ur.data[0]) return fail('user_not_found', '用户不存在');
  const u = ur.data[0];
  const field = score_type === 'partner' ? 'partner_credit_score' : 'user_credit_score';
  const before = u[field] || 800;
  const after = Math.max(0, Math.min(1000, before + d));
  await col('user_account').doc(u._id).update({ data: { [field]: after, updated_at: now } });
  try {
    await col('credit_score_log').add({ data: {
      openid: target_openid, type: 'admin_adjust', score_type,
      delta: d, score: after, reason: String(reason).trim(),
      order_id: null, is_system: false, admin_openid: openid,
      created_at: now, updated_at: now, is_deleted: false
    }});
  } catch (e) {}
  await logEvent('P2', 'credit_adjust', openid, {
    target_openid, score_type, before, after, delta: d, reason: String(reason).trim()
  });
  return ok({ openid: target_openid, score_type, before, after });
}

module.exports = {
  user_freeze: user_freeze_unfreeze,
  user_unfreeze: user_freeze_unfreeze,
  user_credit_adjust
};
