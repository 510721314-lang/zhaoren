// admin-action · 云端备份导出（export_admin_config / export_collection，从 index.js 物理抽出，行为逐字不变）
// EXPORT_COLLECTIONS 白名单随 handler 一同内联；共享符号通过 ctx 注入，禁止反向 require('./index')。

const EXPORT_COLLECTIONS = new Set([
  'admin_config', 'admin_web_sessions',
  'user_account', 'partner_profile',
  'demand', 'demand_draft',
  'order_main', 'order_status_log', 'order_confirmations',
  'emergency_contact', 'credit_score_log', 'platform_event', 'audit_log',
  'system_notice', 'disclaimer_signature', 'evaluation',
  'blog_post', 'blog_like', 'blog_comment',
  'safety_report',
  'im_conversation', 'im_message',
  'withdraw_record',
  'exam_bank',
  'config_history',
  'no_show_report',
  'complaint',
  'user_profile', 'partner_exam', 'partner_apply',
  'dispute', 'withdraw_request', 'credit_log',
  'insurance_record', 'report', 'sms_log', 'device_bind'
]);

async function export_admin_config(ctx) {
  const { event, col, maskDocDeep, openid, logEvent, now, ok, fail } = ctx;
  if (event.confirm !== true) return fail('export_need_confirm', '敏感导出需 confirm:true 二次确认');
  const cfgR = await col('admin_config').doc('global').get();
  const cfg = (cfgR.data) || {};
  const safe = maskDocDeep(cfg);
  if (safe.idcard_aes_key !== undefined) safe.idcard_aes_key_set = !!safe.idcard_aes_key;
  delete safe.idcard_aes_key;
  if (safe.admin_web_key !== undefined) safe.admin_web_key_set = !!safe.admin_web_key;
  delete safe.admin_web_key;
  await logEvent('P2', 'export_admin_config', openid, { size: JSON.stringify(safe).length });
  return ok({ config: safe, exported_at: now });
}

async function export_collection(ctx) {
  const { event, col, maskDocDeep, openid, logEvent, ok, fail } = ctx;
  if (event.confirm !== true) return fail('export_need_confirm', '敏感导出需 confirm:true 二次确认');
  const collection = String(event.collection || '').trim();
  if (!EXPORT_COLLECTIONS.has(collection)) {
    return fail('export_bad_collection', `不在导出白名单: ${collection}`);
  }
  const page = Math.max(1, parseInt(event.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(event.page_size, 10) || 100));
  const skip = (page - 1) * pageSize;
  const limit = Math.min(10000, skip + pageSize);
  const totalR = await col(collection).count().catch(() => ({ total: 0 }));
  const total = totalR.total || 0;
  const docs = await col(collection).skip(skip).limit(pageSize).get().catch(() => ({ data: [] }));
  const list = (docs.data || []).map(maskDocDeep);
  await logEvent('P2', 'export_collection', openid, { collection, page, pageSize, count: list.length });
  return ok({
    collection,
    page,
    page_size: pageSize,
    total,
    has_more: (page * pageSize) < total && (page * pageSize) < 10000,
    truncated: total > 10000,
    list
  });
}

module.exports = { export_admin_config, export_collection };
