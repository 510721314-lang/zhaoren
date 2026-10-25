// admin-action · 法律文档版本管理（legal_doc_list / legal_doc_publish / legal_doc_rollback / legal_doc_seed）
// 设计依据: docs/legal-compliance-redesign-20261025.md §3.1/§3.2
// 实施授权: docs/legal-compliance-1a-authorization-20261025.md（批 1a，2026-10-25 用户批准）
// 纪律: 纯新增——不改既有 config_get/config_set 行为; 发布时双写回 admin_config.legal_*，
//       使 user-login 实名签署链路（读 config 旧字段）立即生效，无需 C 端改动。

// 文档类型白名单（与设计稿 §3.1 一致）
const DOC_TYPES = ['service_agreement', 'privacy_policy', 'disclaimer', 'aa_promise', 'pet_authorization'];

// doc_type → admin_config 兼容字段（双写映射，口径同 action_config_read.js legal 块）
const CONFIG_FIELD = {
  service_agreement: 'legal_service_agreement',
  privacy_policy: 'legal_privacy_policy',
  disclaimer: 'legal_disclaimer_text',
  aa_promise: 'legal_aa_promise',
  pet_authorization: 'legal_pet_authorization'
};

// 长度上限沿用 action_config_set.js:367-373 既有口径，避免两套标准
const MAX_LEN = {
  service_agreement: 20000,
  privacy_policy: 20000,
  disclaimer: 8000,
  aa_promise: 8000,
  pet_authorization: 8000
};

function badType(fail) {
  return fail('legal_bad_type', `doc_type 须为 ${DOC_TYPES.join('/')}`);
}

// 集合幂等创建（add 不自动建集合，缺集合报 -502005；云函数管理权限可 createCollection）
async function ensureLegalColl(db) {
  try { await db.createCollection('legal_doc'); } catch (e) { /* 已存在则忽略 */ }
}

function sha256hex(crypto, s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// 列版本史（默认全部类型；指定 doc_type 时仅该类型）。含 content 供后台预览/回滚。
async function legal_doc_list(ctx) {
  const { event, ok, fail, col } = ctx;
  const q = {};
  if (event.doc_type !== undefined) {
    const t = String(event.doc_type);
    if (DOC_TYPES.indexOf(t) < 0) return badType(fail);
    q.doc_type = t;
  }
  const r = await col('legal_doc').where(q)
    .orderBy('doc_type', 'asc').orderBy('version', 'desc').limit(200).get()
    .catch(() => ({ data: [] }));
  return ok({
    doc_types: DOC_TYPES,
    list: (r.data || []).map((d) => ({
      _id: d._id,
      doc_type: d.doc_type,
      version: d.version,
      status: d.status,
      title: d.title || '',
      remark: d.remark || '',
      effective_at: d.effective_at || 0,
      created_at: d.created_at || 0,
      created_by: d.created_by || '',
      rolled_back_from: d.rolled_back_from || 0,
      content: d.content || ''
    }))
  });
}

// 发布新版本：旧 published 转 archived，写入新版本，并双写回 admin_config 旧字段。
async function legal_doc_publish(ctx) {
  const { event, ok, fail, col, db, log, logEvent, crypto, openid, operatorAccount, now } = ctx;
  const doc_type = String(event.doc_type || '');
  if (DOC_TYPES.indexOf(doc_type) < 0) return badType(fail);
  const content = String(event.content || '');
  if (!content.trim()) return fail('legal_empty_content', '协议内容不能为空');
  if (content.length > MAX_LEN[doc_type]) {
    return fail('legal_too_long', `${doc_type} 不得超过 ${MAX_LEN[doc_type]} 字`);
  }
  const title = String(event.title || '').slice(0, 60);
  const remark = String(event.remark || '').slice(0, 100);

  await ensureLegalColl(db);
  // 版本号单调递增（含 archived 一起取 max，保证回滚也不复用版本号）
  const lastR = await col('legal_doc').where({ doc_type }).orderBy('version', 'desc').limit(1).get()
    .catch(() => ({ data: [] }));
  const prevMax = (lastR.data && lastR.data[0] && Number(lastR.data[0].version)) || 0;
  const version = prevMax + 1;

  // 旧 published → archived（保留历史，不删除）
  await col('legal_doc').where({ doc_type, status: 'published' })
    .update({ data: { status: 'archived', updated_at: now } })
    .catch((e) => log.d(`legal_doc archive fail: ${e.message}`));

  const r = await col('legal_doc').add({ data: {
    doc_type,
    version,
    content,
    title,
    remark,
    status: 'published',
    effective_at: now,
    created_at: now,
    updated_at: now,
    created_by: operatorAccount || openid || '',
    rolled_back_from: Number(event.rolled_back_from) || 0,
    is_deleted: false
  }});

  // 双写兼容：回写 admin_config 旧字段 + 版本号快照（config_public 读它对外暴露 version）
  const field = CONFIG_FIELD[doc_type];
  const versions = Object.assign({}, (ctx.config && ctx.config.legal_versions) || {}, { [doc_type]: version });
  await col('admin_config').where({ _id: 'global' })
    .update({ data: { [field]: content, legal_versions: versions, updated_at: now } });

  // 审计：platform_event（与 config_set 同口径）+ config_history 留底
  await logEvent('P2', 'legal_doc_publish', openid, {
    doc_type,
    version,
    content_sha256: sha256hex(crypto, content),
    content_len: content.length,
    remark,
    operated_by: operatorAccount || openid || ''
  });
  try {
    await db.createCollection('config_history').catch(() => {});
    await col('config_history').add({ data: {
      keys: [field],
      before: {},
      after: { [field]: `[legal_doc ${doc_type} v${version}]` },
      reason: remark || `发布 ${doc_type} v${version}`,
      operator: operatorAccount || openid || '',
      at: now,
      created_at: now,
      updated_at: now,
      is_deleted: false
    }});
  } catch (e) { log.d(`config_history write fail: ${e.message}`); }

  return ok({ _id: r._id, doc_type, version, status: 'published', effective_at: now });
}

// 回滚：以历史版本内容生成一个新版本（不删历史、不复用版本号）。
async function legal_doc_rollback(ctx) {
  const { event, ok, fail, col } = ctx;
  const doc_type = String(event.doc_type || '');
  if (DOC_TYPES.indexOf(doc_type) < 0) return badType(fail);
  const version = parseInt(event.version, 10);
  if (!version || version < 1) return fail('legal_bad_version', 'version 须为正整数');

  const r = await col('legal_doc').where({ doc_type, version }).limit(1).get()
    .catch(() => ({ data: [] }));
  const src = (r.data && r.data[0]) || null;
  if (!src) return fail('legal_version_not_found', `${doc_type} v${version} 不存在`);

  return legal_doc_publish(Object.assign({}, ctx, { event: {
    doc_type,
    content: src.content || '',
    title: src.title || '',
    remark: `回滚至 v${version}`,
    rolled_back_from: version
  }}));
}

// 存量初始化：把 admin_config.legal_* 现有文案补成各类型 v1（已存在版本的类型跳过，幂等）。
async function legal_doc_seed(ctx) {
  const { event, ok, col, db, config } = ctx;
  const only = event.doc_type !== undefined ? String(event.doc_type) : '';
  const seeded = [];
  const skipped = [];
  await ensureLegalColl(db);
  for (const doc_type of DOC_TYPES) {
    if (only && doc_type !== only) continue;
    const cnt = await col('legal_doc').where({ doc_type }).count().catch(() => ({ total: 0 }));
    if ((cnt.total || 0) > 0) { skipped.push(doc_type); continue; }
    const content = String(config[CONFIG_FIELD[doc_type]] || '');
    if (!content.trim()) { skipped.push(doc_type); continue; }
    const sub = await legal_doc_publish(Object.assign({}, ctx, { event: {
      doc_type, content, title: '', remark: '存量迁移 v1'
    }}));
    if (sub && sub.ok) seeded.push({ doc_type, version: sub.data.version });
    else skipped.push(doc_type);
  }
  return ok({ seeded, skipped });
}

module.exports = { legal_doc_list, legal_doc_publish, legal_doc_rollback, legal_doc_seed };
