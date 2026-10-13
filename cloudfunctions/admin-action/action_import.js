// admin-action · 云端恢复导入（config_restore / import_collection）
// 用途: 配合 .predeploy/restore.ps1 从三层备份回灌云端数据（此前 restore.ps1 仅能恢复 admin_config）。
// 安全: ① 两个 action 均需 confirm:true 二次确认; ② import_collection 仅接受白名单集合;
//       ③ 未在 ROLE_GRANTS 声明 → 默认仅 R1 超管可执行; ④ 全部写入 P1 审计事件。
// ⚠️ 破坏性: import_collection 默认 mode='replace'，会先清空目标集合再回灌，慎用。
// 注: 备份为「展示级脱敏」产物，回灌的是脱敏值；admin_config 含密钥，请走 config_restore 且用未脱敏快照。

// 与 action_export.js 的 EXPORT_COLLECTIONS 保持同一白名单（37 集合）
const IMPORT_COLLECTIONS = new Set([
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

const INSERT_CHUNK = 500; // 云端单次 add 批量上限内

async function config_restore(ctx) {
  const { event, col, openid, logEvent, ok, fail } = ctx;
  if (event.confirm !== true) return fail('restore_need_confirm', '恢复需 confirm:true 二次确认');
  const src = event.config;
  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    return fail('restore_bad_config', 'config 缺失或非对象');
  }
  const data = Object.assign({}, src);
  delete data._id; // doc('global') 的 _id 由 set 固定，剔除避免冲突
  await col('admin_config').doc('global').set({ data });
  await logEvent('P1', 'config_restore', openid, { keys: Object.keys(data).length });
  return ok({ restored: true, keys: Object.keys(data).length });
}

async function import_collection(ctx) {
  const { event, col, _, openid, logEvent, ok, fail } = ctx;
  if (event.confirm !== true) return fail('restore_need_confirm', '恢复需 confirm:true 二次确认');
  const collection = String(event.collection || '').trim();
  if (!IMPORT_COLLECTIONS.has(collection)) {
    return fail('restore_bad_collection', `不在导入白名单: ${collection}`);
  }
  const docs = Array.isArray(event.docs) ? event.docs : null;
  if (!docs) return fail('restore_bad_docs', 'docs 必须为数组');
  const mode = event.mode === 'append' ? 'append' : 'replace';

  let removed = 0;
  if (mode === 'replace') {
    // 分页清空（每次 remove 有内部上限，循环至无可删）
    for (let i = 0; i < 200; i++) {
      const r = await col(collection).where({ _id: _.exists(true) }).remove();
      const n = (r && r.stats && r.stats.removed) || 0;
      removed += n;
      if (n === 0) break;
    }
  }

  let inserted = 0;
  for (let i = 0; i < docs.length; i += INSERT_CHUNK) {
    const chunk = docs.slice(i, i + INSERT_CHUNK).map((d) => Object.assign({}, d));
    await col(collection).add({ data: chunk });
    inserted += chunk.length;
  }

  await logEvent('P1', 'import_collection', openid, { collection, mode, removed, inserted });
  return ok({ collection, mode, removed, inserted });
}

module.exports = { config_restore, import_collection };