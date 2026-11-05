// 测试单工具（2026-11-05 N-6 入库）：替代 .tmp-tcb 一次性脚本
// 用法：
//   node scripts/test-order-tool.js create --status S2 --suffix L --start-hours 3
//   node scripts/test-order-tool.js create --status S1 --suffix M --start-hours 2.5
//   node scripts/test-order-tool.js cleanup
// 约束（§38 R5）：只造 is_test:true 单；克隆最近真实单结构；_id 必须 32 位字符串（小程序按字符串查）；
//   S2 四确认置双方已确认（真实 S2 语义 8/8），S1 置全未确认；fee 使用订单总额 total_fen。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execTcbCommands } = require('./tcb-exec');

const PREFIX = 'TEST840710820';
const netId = () => crypto.randomBytes(16).toString('hex');
const pad = (n) => String(n).padStart(2, '0');
const dtOf = (ts) => {
  const d = new Date(ts + 8 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

function find(cmd) {
  const r = execTcbCommands([{ TableName: cmd.find, CommandType: 'COMMAND', Command: JSON.stringify(cmd) }]);
  if (r.status !== 0) throw new Error('tcb find failed: ' + (r.stderr || ''));
  return (r.parsed || []);
}
function write(cmd) {
  const r = execTcbCommands([{ TableName: cmd.insert || cmd.update, CommandType: 'COMMAND', Command: JSON.stringify(cmd) }]);
  if (r.status !== 0) throw new Error('tcb write failed: ' + (r.stderr || ''));
  return r;
}
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function create() {
  const status = arg('status', 'S2');
  const suffix = arg('suffix', 'X');
  const hours = Number(arg('start-hours', '3'));
  if (!['S1', 'S2'].includes(status)) throw new Error('status 仅支持 S1/S2');
  const NOW = Date.now();

  // 模板：优先同状态真实单，否则取最近任意真实单
  let tpl = find({ find: 'order_main', filter: { status, is_test: { $ne: true }, is_deleted: { $ne: true } }, sort: { created_at: -1 }, limit: 1 })[0];
  if (!tpl) tpl = find({ find: 'order_main', filter: { is_test: { $ne: true }, is_deleted: { $ne: true } }, sort: { created_at: -1 }, limit: 1 })[0];
  if (!tpl) throw new Error('找不到可克隆的真实订单');
  const confTpl = find({ find: 'order_confirmations', filter: { order_id: tpl._id }, limit: 1 })[0];

  const o = Object.assign({}, tpl);
  delete o._id;
  ['pending_change', 'pending_modify', 'pending_extend', 'change_counts',
    'change_last_rejected_at', 'change_auto_rejected_at', 's2_change_counts',
    's2_change_applied_at', 's2_change_auto_rejected_at', 'sub_msg_send_logs'].forEach((k) => delete o[k]);
  o._id = netId();
  o.order_no = PREFIX + suffix;
  o.status = status;
  o.start_time = NOW + hours * 3600000;
  o.created_at = NOW;
  o.updated_at = NOW;
  o.is_test = true;
  o.is_deleted = false;
  o.pay_expire_at = null;
  o.help_flag = false;

  const okAll = status === 'S2';
  const c = {
    _id: netId(),
    order_id: o._id,
    items: {
      time: { value: o.start_time, user_ok: okAll, partner_ok: okAll },
      location: { value: o.location, user_ok: okAll, partner_ok: okAll },
      content: { value: o.content_options, user_ok: okAll, partner_ok: okAll },
      fee: { value: o.total_fen, user_ok: okAll, partner_ok: okAll }
    },
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    is_deleted: false
  };
  write({ insert: 'order_main', documents: [o] });
  write({ insert: 'order_confirmations', documents: [c] });
  console.log(JSON.stringify({
    order_no: o.order_no, _id: o._id, status, start: dtOf(o.start_time),
    start_hours: hours, confirm_all: okAll, template: tpl.order_no, conf_template: confTpl ? confTpl._id : null
  }, null, 2));
  if (status === 'S1') console.log('S1 窗口约 15 分钟后自动转 S6：' + dtOf(NOW + 15 * 60000));
}

function cleanup() {
  const NOW = Date.now();
  const rows = find({ find: 'order_main', filter: { order_no: { $regex: '^' + PREFIX }, is_deleted: false }, projection: { _id: 1 } });
  const ids = rows.map((r) => r._id);
  write({ update: 'order_main', updates: [{ q: { order_no: { $regex: '^' + PREFIX }, is_test: true }, u: { $set: { is_deleted: true, updated_at: NOW } }, multi: true }] });
  if (ids.length) write({ update: 'order_confirmations', updates: [{ q: { order_id: { $in: ids } }, u: { $set: { is_deleted: true, updated_at: NOW } }, multi: true }] });
  const left = find({ find: 'order_main', filter: { order_no: { $regex: '^' + PREFIX }, is_deleted: false }, projection: { _id: 1 } });
  console.log('cleaned=' + ids.length + ' remaining=' + left.length);
}

const action = process.argv[2];
if (action === 'create') create();
else if (action === 'cleanup') cleanup();
else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n')); process.exit(1); }
