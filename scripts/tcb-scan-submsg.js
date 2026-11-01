// 订阅消息发送结果扫描器（只读）：近 N 天 order_main.sub_msg_send_logs 中 demand_urge / confirm_comm 的发送结果
// 用途：P0-5 ②「订阅消息实际送达」的服务端旁证（status:'ok' = 服务端已受理；fail + errCode 43101 = 一次性额度用尽）
// 用法：node scripts/tcb-scan-submsg.js [天数，默认 3]
// 纪律对齐：$numberLong/$numberInt 统一解码（规则 §31）；本脚本只读，无写操作。
const { execTcbCommands } = require('./tcb-exec');

const days = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 3;
const since = Date.now() - days * 24 * 3600 * 1000;

function dec(v) {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    if (v.$numberLong !== undefined) return Number(v.$numberLong);
    if (v.$numberInt !== undefined) return Number(v.$numberInt);
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = dec(v[k]); });
    return o;
  }
  return v;
}

function docs(table, query) {
  const r = execTcbCommands([{ TableName: table, CommandType: 'COMMAND', Command: JSON.stringify(query) }]);
  if (!r.parsed) {
    console.error('[warn] ' + table + ' exit=' + r.status + ' ' + (r.stderr || r.stdout || '').slice(-200));
    return [];
  }
  const d = dec(r.parsed);
  return Array.isArray(d) ? d : [];
}

// 注意：不能用下标条件（TCB 对子文档数组路径只做存在/比较，数组内过滤在前端做），故取回后本地筛
const rows = docs('order_main', {
  find: 'order_main',
  filter: { 'sub_msg_send_logs.at': { $gte: since } },
  projection: { _id: 1, order_no: 1, status: 1, sub_msg_send_logs: 1 },
  limit: 20
});

const summary = { since: new Date(since).toISOString(), days, scanned: rows.length, entries: [] };
rows.forEach((o) => {
  (o.sub_msg_send_logs || []).forEach((e) => {
    const at = Number(e && e.at);
    if (!Number.isFinite(at) || at < since) return;
    summary.entries.push({
      order: o.order_no || o._id, order_status: o.status, key: e.key, status: e.status,
      errCode: e.errCode || '', at: new Date(at).toISOString()
    });
  });
});
summary.entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));

// 按 key + status 聚合，便于直接判「送达通路是否通」
summary.by_key = {};
summary.entries.forEach((e) => {
  const k = (e.key || 'unknown') + '/' + (e.status || 'unknown');
  summary.by_key[k] = (summary.by_key[k] || 0) + 1;
});

console.log(JSON.stringify(summary, null, 1));
