// 最近操作订单列表（只读）：列出某耍伴最近 N 小时内被更新过的订单，用于确认「刚真机测的是哪一单」
// 用法：node scripts/tcb-list-recent-orders.js --partner <OPENID> [小时数，默认 24]
//   拿 openid 的办法：node scripts/tcb-query-order.js --order <ORDER_ID> 的输出 resolved.partner_openid
// 纪律对齐：$numberLong/$numberInt 统一解码（规则 §31）；本脚本只读，无写操作。
const { execTcbCommands } = require('./tcb-exec');

const argv = process.argv.slice(2);
function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] || '') : '';
}
const partner = argOf('--partner') || (argv[0] && argv[0].indexOf('--') !== 0 ? argv[0] : '');
if (!partner) {
  console.error('usage: node scripts/tcb-list-recent-orders.js --partner <OPENID> [hours=24]');
  process.exit(1);
}
const hours = Number(process.argv[process.argv.length - 1]) > 0 ? Number(process.argv[process.argv.length - 1]) : 24;
const since = Date.now() - hours * 3600 * 1000;

function dec(v) {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    if (v.$numberLong !== undefined) return Number(v.$numberLong);
    if (v.$numberInt !== undefined) return Number(v.$numberInt);
    if (v.$date !== undefined) return v.$date;
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = dec(v[k]); });
    return o;
  }
  return v;
}

const r = execTcbCommands([{
  TableName: 'order_main',
  CommandType: 'COMMAND',
  Command: JSON.stringify({
    find: 'order_main',
    filter: { partner_openid: { $in: [partner] }, updated_at: { $gte: since } },
    projection: { _id: 1, order_no: 1, status: 1, updated_at: 1, demand_id: 1 },
    limit: 20
  })
}]);

if (!r.parsed) {
  console.error('[warn] order_main 取数失败 exit=' + r.status + ' ' + (r.stderr || r.stdout || '').slice(-200));
  process.exit(2);
}
const rows = dec(Array.isArray(r.parsed) ? r.parsed : []).map((o) => {
  const t = Number(o.updated_at);
  return Object.assign({}, o, { updated_at: Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : o.updated_at });
});
rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
console.log(JSON.stringify({ since: new Date(since).toISOString(), hours, partner, rows }, null, 1));
