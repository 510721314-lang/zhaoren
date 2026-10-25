// admin-action · 法律文档版本管理
//   legal_doc_list / legal_doc_publish / legal_doc_rollback / legal_doc_retire / legal_doc_seed
// 设计依据: docs/legal-compliance-redesign-20261025.md §3.1/§3.2
//           docs/req-legal-ui-20261025.md R2（场景免责版本化，D2=复用 legal_doc + scope）
// 实施授权: docs/legal-compliance-1a-authorization-20261025.md（批 1a）
//           docs/legal-compliance-u2-authorization-20261025.md（U2：scope + retire）
// 纪律: 纯新增——不改既有 config_get/config_set 行为; 发布时双写回 admin_config 兼容字段，
//       使 user-login 实名签署链路与 home-action/order-create/demand-publish 三处场景免责消费者
//       零改动即可继续工作，无需 C 端改动。

// 文档类型白名单
const DOC_TYPES = ['service_agreement', 'privacy_policy', 'disclaimer', 'aa_promise', 'pet_authorization', 'scene_disclaimer'];

// 带 scope 的类型（每条场景免责独立版本线，scope = 场景 code）
const SCOPED_TYPES = ['scene_disclaimer'];

// doc_type → admin_config 兼容字段（双写映射，口径同 action_config_read.js legal 块）
// scene_disclaimer 例外：不是单标量字段，而是写入 legal_scene_disclaimers[scope]
const CONFIG_FIELD = {
  service_agreement: 'legal_service_agreement',
  privacy_policy: 'legal_privacy_policy',
  disclaimer: 'legal_disclaimer_text',
  aa_promise: 'legal_aa_promise',
  pet_authorization: 'legal_pet_authorization'
};

// 长度上限沿用 action_config_set.js:367-373 既有口径；场景免责沿用 config_set 单场景 4000 字上限
const MAX_LEN = {
  service_agreement: 20000,
  privacy_policy: 20000,
  disclaimer: 8000,
  aa_promise: 8000,
  pet_authorization: 8000,
  scene_disclaimer: 4000
};

const SCENE_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

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

// 解析并校验 doc_type + scope（只读类也复用，避免两套口径）
function resolveTarget(event, fail) {
  const doc_type = String(event.doc_type || '');
  if (DOC_TYPES.indexOf(doc_type) < 0) return { error: badType(fail) };
  const scoped = SCOPED_TYPES.indexOf(doc_type) >= 0;
  const scope = String(event.scope || '');
  if (scoped) {
    if (!SCENE_CODE_RE.test(scope)) {
      return { error: fail('legal_bad_scope', `${doc_type} 必须提供合法 scope（场景 code，字母数字下划线连字符，1-32 位）`) };
    }
  } else if (scope) {
    return { error: fail('legal_bad_scope', `${doc_type} 不支持 scope`) };
  }
  return { doc_type, scope };
}

// 列版本史（可按 doc_type / scope 过滤）。含 content 供后台预览/回滚。
async function legal_doc_list(ctx) {
  const { event, ok, fail, col } = ctx;
  const q = {};
  if (event.doc_type !== undefined) {
    const t = String(event.doc_type);
    if (DOC_TYPES.indexOf(t) < 0) return badType(fail);
    q.doc_type = t;
  }
  if (event.scope !== undefined) {
    const s = String(event.scope);
    if (!SCENE_CODE_RE.test(s)) return fail('legal_bad_scope', 'scope 须为场景 code');
    q.scope = s;
  }
  const r = await col('legal_doc').where(q)
    .orderBy('doc_type', 'asc').orderBy('version', 'desc').limit(200).get()
    .catch(() => ({ data: [] }));
  return ok({
    doc_types: DOC_TYPES,
    list: (r.data || []).map((d) => ({
      _id: d._id,
      doc_type: d.doc_type,
      scope: d.scope || '',
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

// 写新版本（publish / rollback / retire 共用）。status: 'published' | 'retired'
async function writeVersion(ctx, opt) {
  const { ok, col, db, log, logEvent, crypto, openid, operatorAccount, now, config } = ctx;
  const { doc_type, scope, content, title, remark, rolled_back_from, status } = opt;

  await ensureLegalColl(db);
  // 2026-10-25 修正: 非 scoped 类型不能带 scope:'' 查询——历史记录（批1a 写入）无 scope 字段，
  // Mongo 语义下 {scope:''} 不匹配缺失字段，会把既有版本全部「查不到」导致回滚失效。故按需拼键。
  const key = scope ? { doc_type, scope } : { doc_type };
  // 版本号单调递增（含 archived/retired 一起取 max，保证回滚也不复用版本号）
  const lastR = await col('legal_doc').where(key).orderBy('version', 'desc').limit(1).get()
    .catch(() => ({ data: [] }));
  const prevMax = (lastR.data && lastR.data[0] && Number(lastR.data[0].version)) || 0;
  const version = prevMax + 1;

  // 旧 published → archived（保留历史，不删除）
  await col('legal_doc').where(Object.assign({}, key, { status: 'published' }))
    .update({ data: { status: 'archived', updated_at: now } })
    .catch((e) => log.d(`legal_doc archive fail: ${e.message}`));

  const r = await col('legal_doc').add({ data: {
    doc_type,
    scope,
    version,
    content,
    title,
    remark,
    status,
    effective_at: now,
    created_at: now,
    updated_at: now,
    created_by: operatorAccount || openid || '',
    rolled_back_from: rolled_back_from || 0,
    is_deleted: false
  }});

  // ── 双写兼容层 ──
  const cfgData = { updated_at: now };
  if (doc_type === 'scene_disclaimer') {
    // 场景免责：合并写入 legal_scene_disclaimers[scope]（停用时移除该 key）
    const prevMap = (config && config.legal_scene_disclaimers) || {};
    const nextMap = Object.assign({}, prevMap);
    if (status === 'retired' || !content) delete nextMap[scope];
    else nextMap[scope] = content;
    cfgData.legal_scene_disclaimers = nextMap;
    // 场景版本号快照（后台/前端可读，不影响既有消费者）
    cfgData.legal_scene_versions = Object.assign({}, (config && config.legal_scene_versions) || {},
      status === 'retired' ? {} : { [scope]: version });
    if (status === 'retired') delete cfgData.legal_scene_versions[scope];
  } else {
    const field = CONFIG_FIELD[doc_type];
    cfgData[field] = content;
    cfgData.legal_versions = Object.assign({}, (config && config.legal_versions) || {}, { [doc_type]: version });
  }
  await col('admin_config').where({ _id: 'global' }).update({ data: cfgData });

  // ── 审计：platform_event + config_history ──
  const auditPayload = {
    doc_type,
    version,
    content_sha256: sha256hex(crypto, content),
    content_len: content.length,
    remark,
    operated_by: operatorAccount || openid || ''
  };
  if (scope) auditPayload.scope = scope;
  await logEvent('P2', status === 'retired' ? 'legal_doc_retire' : 'legal_doc_publish', openid, auditPayload);

  const histKey = doc_type === 'scene_disclaimer'
    ? `legal_scene_disclaimers.${scope}`
    : CONFIG_FIELD[doc_type];
  try {
    await db.createCollection('config_history').catch(() => {});
    await col('config_history').add({ data: {
      keys: [histKey],
      before: {},
      after: { [histKey]: status === 'retired' ? '[retired]' : `[legal_doc ${doc_type}${scope ? ':' + scope : ''} v${version}]` },
      reason: remark || `${status === 'retired' ? '停用' : '发布'} ${doc_type}${scope ? ':' + scope : ''} v${version}`,
      operator: operatorAccount || openid || '',
      at: now,
      created_at: now,
      updated_at: now,
      is_deleted: false
    }});
  } catch (e) { log.d(`config_history write fail: ${e.message}`); }

  return ok({ _id: r._id, doc_type, scope, version, status, effective_at: now });
}

// 发布新版本
async function legal_doc_publish(ctx) {
  const { event, fail } = ctx;
  const t = resolveTarget(event, fail);
  if (t.error) return t.error;
  const content = String(event.content || '');
  if (!content.trim()) return fail('legal_empty_content', '协议内容不能为空');
  if (content.length > MAX_LEN[t.doc_type]) {
    return fail('legal_too_long', `${t.doc_type} 不得超过 ${MAX_LEN[t.doc_type]} 字`);
  }
  return writeVersion(ctx, {
    doc_type: t.doc_type,
    scope: t.scope,
    content,
    title: String(event.title || '').slice(0, 60),
    remark: String(event.remark || '').slice(0, 100),
    rolled_back_from: Number(event.rolled_back_from) || 0,
    status: 'published'
  });
}

// 回滚：以历史版本内容生成一个新版本（不删历史、不复用版本号）。
async function legal_doc_rollback(ctx) {
  const { event, ok, fail, col } = ctx;
  const t = resolveTarget(event, fail);
  if (t.error) return t.error;
  const version = parseInt(event.version, 10);
  if (!version || version < 1) return fail('legal_bad_version', 'version 须为正整数');

  const r = await col('legal_doc').where(Object.assign({ doc_type: t.doc_type }, t.scope ? { scope: t.scope } : {}, { version })).limit(1).get()
    .catch(() => ({ data: [] }));
  const src = (r.data && r.data[0]) || null;
  if (!src) return fail('legal_version_not_found', `${t.doc_type}${t.scope ? ':' + t.scope : ''} v${version} 不存在`);
  if (!String(src.content || '').trim()) return fail('legal_version_retired', '该版本已停用（内容为空），不能回滚');

  return writeVersion(ctx, {
    doc_type: t.doc_type,
    scope: t.scope,
    content: src.content,
    title: src.title || '',
    remark: `回滚至 v${version}`,
    rolled_back_from: version,
    status: 'published'
  });
}

// 停用：写入一个空内容版本并置 retired，同时从 admin_config 映射中移除（仅限 scoped 类型）
async function legal_doc_retire(ctx) {
  const { event, fail } = ctx;
  const t = resolveTarget(event, fail);
  if (t.error) return t.error;
  if (SCOPED_TYPES.indexOf(t.doc_type) < 0) {
    return fail('legal_retire_unsupported', `${t.doc_type} 不支持停用（请发布空版本以外的方式下线）`);
  }
  return writeVersion(ctx, {
    doc_type: t.doc_type,
    scope: t.scope,
    content: '',
    title: '',
    remark: String(event.remark || '').slice(0, 100) || '停用',
    rolled_back_from: 0,
    status: 'retired'
  });
}

// 存量初始化：把现有文案补成 v1（已存在版本的目标跳过，幂等）。
//  - 非 scoped 类型：从 admin_config.legal_* 补
//  - scene_disclaimer：从 admin_config.legal_scene_disclaimers 的每个 key 各补一条
async function legal_doc_seed(ctx) {
  const { event, ok, col, db, config } = ctx;
  const only = event.doc_type !== undefined ? String(event.doc_type) : '';
  const seeded = [];
  const skipped = [];
  await ensureLegalColl(db);

  for (const doc_type of DOC_TYPES) {
    if (only && doc_type !== only) continue;
    if (doc_type === 'scene_disclaimer') {
      const map = (config && config.legal_scene_disclaimers) || {};
      for (const [code, text] of Object.entries(map)) {
        if (!SCENE_CODE_RE.test(code) || !String(text || '').trim()) { skipped.push(`${doc_type}:${code}`); continue; }
        const existR = await col('legal_doc').where({ doc_type, scope: code }).limit(1).get()
          .catch(() => ({ data: [] }));
        if (existR.data && existR.data.length) { skipped.push(`${doc_type}:${code}`); continue; }
        const sub = await legal_doc_publish(Object.assign({}, ctx, { event: {
          doc_type, scope: code, content: text, title: '', remark: '存量迁移 v1'
        }}));
        if (sub && sub.ok) seeded.push({ doc_type, scope: code, version: sub.data.version });
        else skipped.push(`${doc_type}:${code}`);
      }
      continue;
    }
    const existR = await col('legal_doc').where({ doc_type }).limit(1).get().catch(() => ({ data: [] }));
    if (existR.data && existR.data.length) { skipped.push(doc_type); continue; }
    const content = String(config[CONFIG_FIELD[doc_type]] || '');
    if (!content.trim()) { skipped.push(doc_type); continue; }
    const sub = await legal_doc_publish(Object.assign({}, ctx, { event: {
      doc_type, scope: '', content, title: '', remark: '存量迁移 v1'
    }}));
    if (sub && sub.ok) seeded.push({ doc_type, version: sub.data.version });
    else skipped.push(doc_type);
  }
  return ok({ seeded, skipped });
}

module.exports = { legal_doc_list, legal_doc_publish, legal_doc_rollback, legal_doc_retire, legal_doc_seed };
