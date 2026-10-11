// admin-action · 审计初始化 / 审计记录查询（audit_init / audit_query，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function audit_init(ctx) {
  const { db, col, log, logEvent, openid, ok } = ctx;
  let created = false;
  try {
    await db.createCollection('audit_log');
    created = true;
  } catch (e) {
    log.d(`audit_init createCollection: ${(e && e.message) || e}`);
  }
  let index = { created: false, note: '' };
  try {
    await col('audit_log').createIndex({ name: 'idx_openid_at', keys: { openid: 1, at: -1 } });
    index = { created: true, note: '' };
  } catch (e) {
    index = { created: false, note: String((e && e.errMsg) || (e && e.message) || e).slice(0, 200) };
  }
  const cnt = await col('audit_log').count().catch(() => ({ total: 0 }));
  await logEvent('P2', 'audit_init', openid, { created, index, total: cnt.total || 0 });
  return ok({ created, index, total: cnt.total || 0 });
}

async function audit_query(ctx) {
  const { event, pager, isOpenid, fail, _, col, maskIp, ok } = ctx;
  const pg = pager(event);
  const q = {};
  if (event.openid) {
    if (!isOpenid(String(event.openid))) return fail('aq_bad_openid', 'openid 格式不正确');
    q.openid = String(event.openid);
  }
  if (event.action_name) q.action = String(event.action_name);
  if (event.category) q.category = String(event.category);
  if (event.result) q.result = String(event.result);
  if (event.target_id) q.target_id = String(event.target_id);
  const win = [];
  const s = parseInt(event.start_ts, 10);
  const e2 = parseInt(event.end_ts, 10);
  if (Number.isInteger(s)) win.push({ at: _.gte(s) });
  if (Number.isInteger(e2)) win.push({ at: _.lte(e2) });
  const where = win.length ? _.and([q].concat(win)) : q;
  const cnt = await col('audit_log').where(where).count().catch(() => ({ total: 0 }));
  const r = await col('audit_log').where(where).orderBy('at', 'desc')
    .skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }));
  return ok({
    total: cnt.total || 0, page: pg.page, size: pg.size,
    list: (r.data || []).map((x) => ({
      _id: x._id, openid: x.openid || '', role: x.role || '',
      category: x.category || '', action: x.action || '',
      target_type: x.target_type || '', target_id: x.target_id || '',
      detail: x.detail || {}, evidence_id: x.evidence_id || '', doc_hash: x.doc_hash || '',
      result: x.result || 'ok', code: x.code || '',
      client_ip: maskIp(x.client_ip), device: x.device || '', platform: x.platform || '',
      at: x.at, prev_hash: x.prev_hash || '', chain_hash: x.chain_hash || ''
    }))
  });
}

module.exports = { audit_init, audit_query };
