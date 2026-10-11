// admin-action · 审计证据链校验 audit_verify（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function audit_verify(ctx) {
  const { event, isOpenid, fail, _, col, now, ok } = ctx;
  const target = String(event.openid || '').trim();
  if (!isOpenid(target)) return fail('av_bad_openid', 'openid 格式不正确');
  const crypto = require('crypto');
  const recs = [];
  const BATCH = 100;
  let cursorAt = null;
  let cursorId = null;
  for (let guard = 0; guard < 500; guard++) {
    const where = cursorAt === null
      ? { openid: target }
      : _.and([
        { openid: target },
        _.or([
          { at: _.gt(cursorAt) },
          { at: _.eq(cursorAt), _id: _.gt(cursorId) }
        ])
      ]);
    const r = await col('audit_log').where(where)
      .orderBy('at', 'asc').orderBy('_id', 'asc').limit(BATCH).get().catch(() => ({ data: [] }));
    const rows = r.data || [];
    for (const x of rows) recs.push(x);
    if (rows.length < BATCH) break;
    const last = rows[rows.length - 1];
    cursorAt = last.at;
    cursorId = last._id;
  }
  let broken = null;
  const noise = [];
  let prevChain = '';
  for (let i = 0; i < recs.length; i++) {
    const x = recs[i];
    const expect = crypto.createHash('sha256').update([
      x.prev_hash || '', x.openid || '', x.action || '', x.target_id || '', x.at,
      JSON.stringify(x.detail || {})
    ].join('|'), 'utf8').digest('hex');
    const mismatch = expect !== (x.chain_hash || '');
    const linkBreak = i > 0 && (x.prev_hash || '') !== prevChain;
    if (mismatch) {
      broken = {
        index: i, record_id: x._id, action: x.action, at: x.at,
        reason: 'chain_hash_mismatch'
      };
      break;
    }
    if (linkBreak) {
      noise.push({ index: i, record_id: x._id, action: x.action, at: x.at, reason: 'prev_hash_link_break' });
    }
    prevChain = x.chain_hash || '';
  }
  const verdict = broken ? 'tampered' : (noise.length ? 'fork_noise' : 'ok');
  return ok({
    openid: target, total: recs.length,
    ok: !broken && noise.length === 0,
    verdict,
    first_ts: recs.length ? recs[0].at : 0,
    last_ts: recs.length ? recs[recs.length - 1].at : 0,
    broken,
    noise,
    note: noise.length
      ? '存在分叉/排序噪声(同毫秒多条或并发写入), 未发现内容篡改; 如需消除分叉需引入 audit_chain_head 事务链头'
      : '',
    checked_at: now
  });
}

module.exports = { audit_verify };
