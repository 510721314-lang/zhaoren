// 真机回归「云端回执」采集器（只读）：一条命令采集一条订单/需求/收件人的全部证据，便于整段回贴判定
// 用法：
//   node scripts/tcb-query-order.js --order <ORDER_ID>
//   node scripts/tcb-query-order.js --order-no <ORD...>              # 只有业务单号时自动换出 _id
//   node scripts/tcb-query-order.js --notices <OPENID>               # 只查某人最近站内信（I 组幂等/角标项）
//   node scripts/tcb-query-order.js --order <ID> --demand <ID> --partner <OPENID>   # 手工补上下文
// 纪律对齐：_id 一律 $in（规则 §24）；$numberLong/$numberInt/$date 统一解码（规则 §31）；本脚本只读，无写操作。
// 依赖：scripts/tcb-exec.js（需 tcb 已授权；只读查询不产生写入）
const { execTcbCommands } = require('./tcb-exec');

const argv = process.argv.slice(2);
function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] || '') : '';
}
let orderId = argOf('--order');
const orderNo = argOf('--order-no');
let demandId = argOf('--demand');
let partnerOpenid = argOf('--partner');
const noticesOpenid = argOf('--notices');

if (!orderId && !orderNo && !demandId && !noticesOpenid) {
  console.error('usage: node scripts/tcb-query-order.js --order <ORDER_ID> | --order-no <ORD...> | --notices <OPENID>');
  process.exit(1);
}

// TCB CLI 返回的数字/日期是扩展 JSON 形态，统一还原成普通值
function dec(v) {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    if (v.$numberLong !== undefined) return Number(v.$numberLong);
    if (v.$numberInt !== undefined) return Number(v.$numberInt);
    if (v.$numberDouble !== undefined) return Number(v.$numberDouble);
    if (v.$date !== undefined) return v.$date;
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = dec(v[k]); });
    return o;
  }
  return v;
}

function iso(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : ms;
}

// 单条命令执行；失败只告警不中断（缺集合/无索引都应继续采集其余证据）
function docs(table, query) {
  const r = execTcbCommands([{ TableName: table, CommandType: 'COMMAND', Command: JSON.stringify(query) }]);
  if (!r.parsed) {
    console.error('[warn] ' + table + ' 取数失败 exit=' + r.status + ' ' + (r.stderr || r.stdout || '').slice(-200));
    return [];
  }
  const d = dec(r.parsed);
  return Array.isArray(d) ? d : [];
}

const out = { generated_at: new Date().toISOString(), query: { order: orderId, demand: demandId, partner: partnerOpenid, notices: noticesOpenid } };

// 只有业务单号（ORD...）时先换出文档 _id
if (!orderId && orderNo) {
  const r0 = docs('order_main', { find: 'order_main', filter: { order_no: { $in: [orderNo] } }, projection: { _id: 1 }, limit: 1 });
  orderId = (r0[0] && r0[0]._id) || '';
  if (!orderId) { console.error('未找到单号 ' + orderNo + ' 对应订单'); process.exit(2); }
}

// 1) 订单快照（其余 id 从订单自举）
let order = null;
if (orderId) {
  const rows = docs('order_main', {
    find: 'order_main',
    filter: { _id: { $in: [orderId] } },
    projection: {
      _id: 1, order_no: 1, status: 1, user_openid: 1, partner_openid: 1, demand_id: 1,
      start_time: 1, created_at: 1, pay_expire_at: 1, no_show_guide_at: 1, no_show_decided_at: 1,
      urge_count: 1, frozen: 1, sub_msg_send_logs: 1, is_deleted: 1
    },
    limit: 1
  });
  order = rows[0] || null;
}
if (order) {
  if (!demandId) demandId = order.demand_id || '';
  if (!partnerOpenid) partnerOpenid = order.partner_openid || '';
  order = Object.assign({}, order, {
    start_time: iso(order.start_time), created_at: iso(order.created_at),
    pay_expire_at: iso(order.pay_expire_at), no_show_guide_at: iso(order.no_show_guide_at),
    no_show_decided_at: iso(order.no_show_decided_at)
  });
  if (Array.isArray(order.sub_msg_send_logs)) {
    order.sub_msg_send_logs = order.sub_msg_send_logs.map((e) => Object.assign({}, e, { at: iso(e && e.at) }));
  }
}
out.order = order;
out.resolved = { demand_id: demandId, partner_openid: partnerOpenid };

// 2) 站内信：按订单（业务项）或按收件人（I 组幂等/角标项）
const noticeFilter = orderId ? { order_id: { $in: [orderId] } } : { to_openid: { $in: [noticesOpenid] } };
out.notices = docs('system_notice', {
  find: 'system_notice',
  filter: noticeFilter,
  projection: { _id: 1, type: 1, to_openid: 1, read: 1, title: 1, body: 1, action_key: 1, created_at: 1, updated_at: 1 },
  limit: 50
}).map((n) => Object.assign({}, n, { created_at: iso(n.created_at), updated_at: iso(n.updated_at) }))
  .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
out.notices_total = out.notices.length;

if (orderId) {
  // 3) 支付流水（B1/B2：#123 pay_no 前缀与去重）
  out.pay_transaction = docs('pay_transaction', {
    find: 'pay_transaction',
    filter: { order_id: { $in: [orderId] } },
    projection: { _id: 1, type: 1, pay_no: 1, status: 1, amount_fen: 1, created_at: 1 },
    limit: 30
  }).map((p) => Object.assign({}, p, { created_at: iso(p.created_at) }));

  // 4) 状态轴（#127 形态A / F 组履约链路 / C4 超时释放）
  out.order_status_log = docs('order_status_log', {
    find: 'order_status_log',
    filter: { order_id: { $in: [orderId] } },
    projection: { from_status: 1, to_status: 1, action: 1, created_at: 1, is_deleted: 1 },
    limit: 50
  }).map((s) => Object.assign({}, s, { created_at: iso(s.created_at) }))
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  // 5) 评价（#125/#126 星级与差评文案）
  out.evaluation = docs('evaluation', {
    find: 'evaluation',
    filter: { order_id: { $in: [orderId] }, is_deleted: { $ne: true } },
    projection: { _id: 1, star: 1, content: 1, from_openid: 1, to_openid: 1, created_at: 1 },
    limit: 5
  }).map((e) => Object.assign({}, e, { created_at: iso(e.created_at), content_len: (e.content || '').length }));
}

// 6) 需求（#117 接单提示判据 / C4 释放）
if (demandId) {
  out.demand = docs('demand', {
    find: 'demand',
    filter: { _id: { $in: [demandId] } },
    projection: { _id: 1, status: 1, matched_openid: 1, sub_msg_send_logs: 1, updated_at: 1 },
    limit: 1
  })[0] || null;
}

// 7) 耍伴档案（#105 draft/roles、#116 与 P0-5 的 sub_msgs 授权态）
if (partnerOpenid) {
  out.partner_profile = docs('partner_profile', {
    find: 'partner_profile',
    filter: { openid: { $in: [partnerOpenid] } },
    projection: { _id: 1, openid: 1, status: 1, roles: 1, sub_msgs: 1, updated_at: 1 },
    limit: 1
  })[0] || null;
}

// 8) 全局参数（A4 到点提醒延迟 / 催办上限 / 订阅模板是否配置；模板只留 id+state，避免回执过长）
const cfg = docs('admin_config', {
  find: 'admin_config',
  filter: { _id: { $in: ['global'] } },
  projection: { no_show_grace_min: 1, urge_max_count: 1, sub_msg_templates: 1 },
  limit: 1
})[0] || null;
if (cfg) {
  const tmpls = cfg.sub_msg_templates || {};
  const ids = {};
  Object.keys(tmpls).forEach((k) => {
    ids[k] = { tmpl_id: (tmpls[k] || {}).tmpl_id || '', state: (tmpls[k] || {}).miniprogram_state || '' };
  });
  out.admin_config = { no_show_grace_min: cfg.no_show_grace_min, urge_max_count: cfg.urge_max_count, sub_msg_tmpl_ids: ids };
} else {
  out.admin_config = null;
}

console.log(JSON.stringify(out, null, 1));
