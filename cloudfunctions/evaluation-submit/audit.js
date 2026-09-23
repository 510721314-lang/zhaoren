// audit.js · 用户行为审计留痕(证据链)
// 设计: 每个用户(openid)一条哈希链 —— 新记录带 prev_hash(上一条 chain_hash) + chain_hash(本条内容摘要);
//       事后任何篡改/删除都会在 admin-action audit_verify 校验时暴露断链。
// 记录不含敏感明文(证件号/手机号等一律不写入, 只写掩码或摘要)。
// 说明: 各云函数自包含副本(与 openid.js/logger.js 同惯例), 修改时须同步所有副本。
const crypto = require('crypto');

function sha256hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// 写入一条审计记录(尽力而为: 失败只记日志, 绝不阻断业务)
// o: { openid, role, category(auth|consent|business|account|security), action, target_type, target_id,
//      detail{}, evidence_id, doc_hash, result('ok'|'fail'), code, client_ip, device, platform, at }
async function writeAudit(db, log, o) {
  try {
    const col = (n) => db.collection(n);
    const at = o.at || Date.now();
    const detail = o.detail || {};
    let prev = '';
    try {
      const last = await col('audit_log').where({ openid: o.openid || '', is_deleted: false })
        .orderBy('at', 'desc').limit(1).get();
      if (last.data && last.data[0]) prev = last.data[0].chain_hash || '';
    } catch (e) { /* 链上一条取不到: prev 留空(链校验会标记为链起点或异常) */ }
    const chain = sha256hex([
      prev, o.openid || '', o.action || '', o.target_id || '', at, JSON.stringify(detail)
    ].join('|'));
    await col('audit_log').add({ data: {
      openid: o.openid || '',
      role: o.role || 'user',
      category: o.category || 'business',
      action: o.action || '',
      target_type: o.target_type || '',
      target_id: o.target_id || '',
      detail,
      evidence_id: o.evidence_id || '',
      doc_hash: o.doc_hash || '',
      result: o.result || 'ok',
      code: o.code || '',
      client_ip: o.client_ip || '',
      device: String(o.device || '').slice(0, 200),
      platform: o.platform || 'wx-miniprogram',
      at,
      prev_hash: prev,
      chain_hash: chain,
      created_at: at, updated_at: at, is_deleted: false
    }});
    return chain;
  } catch (e) {
    try { log.d(`audit write fail: ${(e && e.message) || e}`); } catch (_) {}
    return '';
  }
}

module.exports = { writeAudit, sha256hex };