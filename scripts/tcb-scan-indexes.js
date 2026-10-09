// 云端实际索引全量扫描(2026-10-09): tcb listIndexes 逐集合执行 → 摘要 + JSON 落盘
// 用法: node scripts/tcb-scan-indexes.js [输出json路径]
// 对照: node scripts/dump-index-ledger.js 产出「设计级」台账; 本脚本产出「云端实际」; 两者差异即缺失清单。
// 建索引: 见 scripts/tcb-exec.js 与 skill(cloud-backup-restore)「索引核对与创建(tcb 直连)」小节。
const fs = require('fs');
const path = require('path');
const { execTcbCommands } = require('./tcb-exec');

const COLLECTIONS = [
  'user_account', 'partner_profile', 'demand', 'demand_draft', 'order_main',
  'order_status_log', 'order_confirmations', 'pay_transaction', 'settlement',
  'im_conversation', 'im_message', 'evaluation', 'withdraw_record', 'safety_report',
  'system_notice', 'audit_log', 'admin_accounts', 'no_show_report', 'credit_score_log',
  'admin_config', 'admin_web_sessions', 'platform_event', 'disclaimer_signature',
  'blog_post', 'blog_like', 'blog_comment', 'emergency_contact', 'user_profile',
  'partner_exam', 'partner_apply', 'dispute', 'withdraw_request', 'credit_log',
  'insurance_record', 'report', 'sms_log', 'device_bind', 'exam_bank', 'config_history'
];
const outFile = process.argv[2] || path.join(__dirname, '..', '.tmp-tcb', 'indexes-actual.json');

const result = {};
for (const col of COLLECTIONS) {
  const r = execTcbCommands(
    [{ TableName: col, CommandType: 'COMMAND', Command: JSON.stringify({ listIndexes: col }) }],
    ['--json']
  );
  let parsed = r.parsed;
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.data)) parsed = parsed.data;
  result[col] = parsed;
  const n = Array.isArray(parsed) ? parsed.length : 'ERR';
  if (n === 'ERR') {
    const tail = (r.stdout || '').replace(/\s+/g, ' ').slice(-160) || (r.stderr || '').replace(/\s+/g, ' ').slice(-160);
    console.log(`${col}: ERR ${tail}`);
  } else {
    console.log(`${col}: ${n} 个索引`);
  }
}

try {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log('\n已落盘: ' + outFile);
} catch (e) { console.error('落盘失败: ' + e.message); }

console.log('\n===== 实际索引明细(不含 _id_) =====');
for (const col of COLLECTIONS) {
  const arr = result[col];
  if (!Array.isArray(arr)) continue;
  for (const idx of arr) {
    if (!idx || idx.name === '_id_') continue;
    const keyStr = Object.entries(idx.key || {}).map(([k, v]) => k + ':' + (v && v.$numberInt ? v.$numberInt : v)).join(', ');
    console.log(`${col} | ${idx.name} | ${keyStr}${idx.unique ? ' | UNIQUE' : ''}`);
  }
}