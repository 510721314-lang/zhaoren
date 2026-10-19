// raw-export.js — tcb 直连数据库原值全量导出（B 通道：真正可恢复的灾备数据，不经网关不脱敏）
// 背景(2026-10-19): export_collection 网关通道为展示级脱敏(手机号/证件/姓名打码)，恢复后敏感原值无法找回；
//   本脚本用已打通的 tcb 直连(tcb-exec.js)逐集合分页 find(sort _id) 拉原值 → JSONL(extended JSON 原样保留 $numberLong)。
// 用法: node scripts/raw-export.js --collections a,b,c --outdir <dir> [--manifest <path>]
//       --collections 省略 = 37 表全集(权威口径 = admin-action EXPORT_COLLECTIONS，两处名单须同步维护)
// 分页: limit 500/批，最后一批 < 500 即止(不依赖 count，规避 MgoQuery count 响应结构不确定性)
// 幽灵集合(云端 NamespaceNotFound)记为 ghost 空集，不算失败；其他查询错误记 failed 继续其余集合
const { execTcbCommands } = require('./tcb-exec');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BATCH = 500;
const COLLECTIONS_37 = [
  'admin_config', 'admin_web_sessions',
  'user_account', 'partner_profile',
  'demand', 'demand_draft',
  'order_main', 'order_status_log', 'order_confirmations',
  'emergency_contact', 'credit_score_log', 'platform_event', 'audit_log',
  'system_notice', 'disclaimer_signature', 'evaluation',
  'blog_post', 'blog_like', 'blog_comment',
  'safety_report',
  'im_conversation', 'im_message',
  'withdraw_record',
  'user_profile', 'partner_exam', 'partner_apply',
  'dispute', 'withdraw_request', 'credit_log',
  'insurance_record', 'report', 'sms_log', 'device_bind',
  'exam_bank',
  'config_history',
  'no_show_report',
  'complaint'
];
const HOT_COLLECTIONS = ['audit_log', 'order_main', 'order_status_log', 'platform_event', 'im_message'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--collections') out.collections = argv[++i];
    else if (argv[i] === '--outdir') out.outdir = argv[++i];
    else if (argv[i] === '--manifest') out.manifest = argv[++i];
    else if (argv[i] === '--hot') out.hot = true;
  }
  return out;
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

async function exportOne(coll, outDir) {
  const file = path.join(outDir, coll + '.jsonl');
  const fd = fs.openSync(file, 'w');
  let skip = 0, docs = 0, batch = 0, err = '', ghost = false;
  try {
    while (true) {
      batch++;
      const cmd = [{ TableName: coll, CommandType: 'QUERY', Command: JSON.stringify({ find: coll, sort: { _id: 1 }, limit: BATCH, skip }) }];
      const r = execTcbCommands(cmd);
      if (r.status !== 0) {
        err = (r.stderr || r.stdout || 'tcb exit ' + r.status).slice(0, 300);
        if (/NamespaceNotFound|ns not found|does not exist/i.test(err)) { ghost = true; err = ''; }
        break;
      }
      const rows = Array.isArray(r.parsed) ? r.parsed : null;
      if (rows === null) { err = 'parse fail: no [...] in output'; break; }
      for (const doc of rows) { fs.writeSync(fd, JSON.stringify(doc) + '\n'); docs++; }
      if (rows.length < BATCH) break;
      skip += BATCH;
    }
  } finally { fs.closeSync(fd); }
  return { name: coll, docs, file, sha256: sha256File(file), status: ghost ? 'ghost' : (err ? 'failed' : 'ok'), error: err };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const outDir = a.outdir || path.join(__dirname, '..', '.tmp-tcb', 'raw-export');
  fs.mkdirSync(outDir, { recursive: true });
  let colls;
  if (a.hot) colls = HOT_COLLECTIONS;
  else if (a.collections) colls = a.collections.split(',').map(s => s.trim()).filter(Boolean);
  else colls = COLLECTIONS_37;
  const results = [];
  for (const c of colls) {
    process.stdout.write('[export] ' + c + ' ... ');
    const r = await exportOne(c, outDir);
    console.log(r.status + ' docs=' + r.docs + (r.error ? ' err=' + r.error : ''));
    results.push(r);
  }
  const manifest = {
    exported_at: new Date().toISOString(),
    batch_size: BATCH,
    channel: 'tcb-direct-raw',
    collections: results,
    total_docs: results.reduce((s, r) => s + r.docs, 0),
    failed: results.filter(r => r.status === 'failed').map(r => r.name),
    ghost: results.filter(r => r.status === 'ghost').map(r => r.name)
  };
  const mfPath = a.manifest || path.join(outDir, '..', 'raw-manifest.json');
  fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 2));
  console.log('[manifest] ' + mfPath + ' total_docs=' + manifest.total_docs + ' failed=' + manifest.failed.length + ' ghost=' + manifest.ghost.length);
  if (manifest.failed.length) process.exit(3);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
