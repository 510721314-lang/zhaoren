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
  if (r.status !== 0) throw new Error('tcb write failed: ' + ((r.stderr || '') + ' | OUT: ' + (r.stdout || '').slice(-300)));
  return r;
}
// 2026-11-06 加固：未知参数不再静默丢弃（曾因 `cleanup --only DBG` 的 --only 被忽略而执行全量删除）
// 值项=1 表示必须跟值；cleanup 无任何参数，传任何 --xxx 一律报错，避免"以为只删一类实则删全部"
const SPEC = { create: { status: 1, suffix: 1, 'start-hours': 1, 'from-order': 1 }, cleanup: {} };
function parseArgs(action) {
  const spec = SPEC[action] || {};
  const argv = process.argv.slice(3);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) throw new Error('多余参数 ' + t + '（只接受 --key value 形式）');
    const k = t.slice(2);
    if (!(k in spec)) throw new Error('未知参数 --' + k + '；' + action + ' 支持: ' + (Object.keys(spec).join(' ') || '无参数'));
    const v = argv[i + 1];
    if (spec[k] && (v === undefined || v.startsWith('--'))) throw new Error('--' + k + ' 缺值');
    if (v === undefined) { out[k] = true; continue; }
    out[k] = v;
    i++;
  }
  return out;
}

function create() {
  const a = parseArgs('create');
  const status = a.status || 'S2';
  const suffix = a.suffix || 'X';
  const hours = a['start-hours'] !== undefined ? Number(a['start-hours']) : 3;
  if (!['S1', 'S2'].includes(status)) throw new Error('status 仅支持 S1/S2');
  if (!Number.isFinite(hours)) throw new Error('--start-hours 必须是数字（小时，可为负）');
  const NOW = Date.now();

  // 模板：--from-order 指定时按 _id 克隆（用于让夹具参与方与登录账号一致）；
  //       否则优先同状态真实单，再取最近任意真实单
  let tpl = null;
  if (a['from-order']) {
    tpl = find({ find: 'order_main', filter: { _id: a['from-order'] }, limit: 1 })[0];
    if (!tpl) throw new Error('--from-order 指定的订单不存在: ' + a['from-order']);
  }
  if (!tpl) tpl = find({ find: 'order_main', filter: { status, is_test: { $ne: true }, is_deleted: { $ne: true } }, sort: { created_at: -1 }, limit: 1 })[0];
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
  // 2026-11-06 加固：不再只信本地变量，回读断言落库结果（§31/§38）
  const back = find({ find: 'order_main', filter: { _id: o._id }, projection: { status: 1, order_no: 1 }, limit: 1 })[0];
  if (!back || back.status !== status) throw new Error('回读校验失败：期望 status=' + status + '，实得 ' + JSON.stringify(back || null));
  console.log(JSON.stringify({
    order_no: o.order_no, _id: o._id, status, start: dtOf(o.start_time),
    start_hours: hours, confirm_all: okAll, template: tpl.order_no, conf_template: confTpl ? confTpl._id : null
  }, null, 2));
  if (status === 'S1') console.log('S1 窗口约 15 分钟后自动转 S6：' + dtOf(NOW + 15 * 60000));
}

function cleanup() {
  parseArgs('cleanup'); // 无任何合法参数：传 --only/--bogus 等一律拒绝，杜绝"以为只删一类实则全量"
  const NOW = Date.now();
  // 计数口径与更新条件对齐（原 L91 未带 is_test，导致 cleaned 报数与实际删除集合不一致）
  const rows = find({ find: 'order_main', filter: { order_no: { $regex: '^' + PREFIX }, is_test: true, is_deleted: false }, projection: { _id: 1 } });
  const ids = rows.map((r) => r._id);
  write({ update: 'order_main', updates: [{ q: { order_no: { $regex: '^' + PREFIX }, is_test: true }, u: { $set: { is_deleted: true, updated_at: NOW } }, multi: true }] });
  if (ids.length) write({ update: 'order_confirmations', updates: [{ q: { order_id: { $in: ids } }, u: { $set: { is_deleted: true, updated_at: NOW } }, multi: true }] });
  const left = find({ find: 'order_main', filter: { order_no: { $regex: '^' + PREFIX }, is_deleted: false }, projection: { _id: 1 } });
  console.log('cleaned=' + ids.length + ' remaining=' + left.length);
}

const action = process.argv[2];
try {
  if (action === 'create') create();
  else if (action === 'cleanup') cleanup();
  else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n')); process.exit(1); }
} catch (e) {
  console.error('ERROR: ' + (e && e.message ? e.message : e));
  process.exit(1);
}
