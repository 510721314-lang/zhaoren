// scripts/backfill-phone-enc.js · 存量手机号就地加密回填(P0-3 整改收尾)
//
// 背景: 2026-10-12 手机号改「AES-256-GCM 密文 + HMAC 确定性查询键 + 掩码」存储, 新写入已加密;
//       存量 user_account 文档仍存明文 phone(靠登录惰性迁移, 未登录用户长期残留)。
//       本脚本一次性把存量明文就地加密, 并清除明文(含历史 11 位明文 sms_target)。
//
// 安全: ①先写 phone_enc/phone_hash/phone_mask, 校验齐全后**再** unset 明文(两阶段, 中断可重跑)
//       ②全程不打印任何手机号/密文原值, 只打印计数
//       ③幂等: 已加密文档(无明文 phone)不在处理范围
//
// 用法: node scripts/backfill-phone-enc.js            # dry-run(仅统计, 不写库)
//       node scripts/backfill-phone-enc.js --apply    # 执行回填
const crypto = require('crypto');
const { execTcbCommands } = require('./tcb-exec');
const pc = require('../cloudfunctions/_shared/phone_crypt');

const APPLY = process.argv.includes('--apply');
const PHONE_11 = /^1[3-9]\d{9}$/;

function run(cmds) {
  const r = execTcbCommands(cmds);
  if (r.status !== 0) throw new Error('tcb exec failed: ' + String(r.stderr || '').slice(0, 200));
  return r.parsed || [];
}

// ── 1) 取/建加密密钥(必须与线上一致, 否则回填的密文将无法解密) ──
function ensureKey() {
  const cfg = run([{ TableName: 'admin_config', CommandType: 'QUERY', Command: JSON.stringify({ find: 'admin_config', filter: { _id: 'global' }, limit: 1 }) }])[0] || null;
  if (!cfg) throw new Error('admin_config.global 不存在');
  if (pc.isHexKey(cfg.phone_aes_key)) { console.log('key: existed'); return cfg.phone_aes_key; }
  const key = crypto.randomBytes(32).toString('hex');
  if (!APPLY) { console.log('key: MISSING (dry-run 不生成)'); return key; }
  run([{
    TableName: 'admin_config', CommandType: 'UPDATE',
    Command: JSON.stringify({ update: 'admin_config', updates: [{ q: { _id: 'global' }, u: { $set: { phone_aes_key: key } } }] })
  }]);
  console.log('key: created & persisted');
  return key;
}

// ── 2) 取存量明文文档 ──
function findPlain() {
  return run([{
    TableName: 'user_account', CommandType: 'QUERY',
    Command: JSON.stringify({ find: 'user_account', filter: { phone: { $exists: true, $nin: ['', null] } }, limit: 500 })
  }]);
}

// 按字段存在性取文档(用于终校验)
function findDocsWith(field) {
  const f = {}; f[field] = { $exists: true };
  return run([{
    TableName: 'user_account', CommandType: 'QUERY',
    Command: JSON.stringify({ find: 'user_account', filter: f, limit: 500 })
  }]);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const key = ensureKey();
const docs = findPlain();
const targets = docs.filter((d) => d && d._id && typeof d.phone === 'string' && PHONE_11.test(d.phone));
const bad = docs.length - targets.length;

console.log(`scan: 明文文档=${docs.length} 可回填(11位手机号)=${targets.length} 跳过(非11位)=${bad}`);
const legacySms = targets.filter((d) => typeof d.sms_target === 'string' && d.sms_target === d.phone).length;
console.log(`其中含历史明文 sms_target=${legacySms}`);

if (!APPLY) { console.log('[DRY-RUN] 未写库。加 --apply 执行。'); process.exit(0); }
if (!targets.length) console.log('无明文 phone 需回填, 继续执行 sms_target 清理与终校验');

// ── 阶段1: 写密文三字段(+ 清除历史明文 sms_target) ──
let phase1 = 0;
for (const part of chunk(targets, 20)) {
  const updates = part.map((d) => {
    const patch = pc.phonePatch(d.phone, key);
    const u = { $set: { phone_enc: patch.phone_enc, phone_hash: patch.phone_hash, phone_mask: patch.phone_mask } };
    if (typeof d.sms_target === 'string' && d.sms_target === d.phone) u.$unset = { sms_target: '' };
    return { q: { _id: d._id }, u };
  });
  run([{ TableName: 'user_account', CommandType: 'UPDATE', Command: JSON.stringify({ update: 'user_account', updates }) }]);
  phase1 += part.length;
  console.log(`phase1: ${phase1}/${targets.length}`);
}

// ── 校验: 所有目标均已有 phone_enc ──
const after = findPlain();
const missing = after.filter((d) => d && d._id && PHONE_11.test(d.phone || '') && !d.phone_enc);
if (missing.length) {
  console.error(`ABORT: ${missing.length} 条仍未写入 phone_enc, 不执行阶段2(明文保留, 可重跑)`);
  process.exit(2);
}
console.log('verify: 全部目标已含 phone_enc');

// ── 阶段2: 清除明文 phone ──
let phase2 = 0;
for (const part of chunk(targets, 20)) {
  const updates = part.map((d) => ({ q: { _id: d._id }, u: { $unset: { phone: '' } } }));
  run([{ TableName: 'user_account', CommandType: 'UPDATE', Command: JSON.stringify({ update: 'user_account', updates }) }]);
  phase2 += part.length;
  console.log(`phase2: ${phase2}/${targets.length}`);
}

const finalPlain = findPlain().length;
console.log(`DONE: 回填=${targets.length} 剩余明文(应含 0 个 11 位)=${finalPlain}`);

// ── 阶段3: 清理历史明文 sms_target(11 位手机号形态; 新写入已是 HMAC) ──
function findLegacySms() {
  return run([{
    TableName: 'user_account', CommandType: 'QUERY',
    Command: JSON.stringify({ find: 'user_account', filter: { sms_target: { $exists: true, $nin: ['', null] } }, limit: 500 })
  }]);
}
const smsDocs = findLegacySms().filter((d) => d && d._id && typeof d.sms_target === 'string' && PHONE_11.test(d.sms_target));
let phase3 = 0;
for (const part of chunk(smsDocs, 20)) {
  const updates = part.map((d) => ({ q: { _id: d._id }, u: { $unset: { sms_target: '' } } }));
  run([{ TableName: 'user_account', CommandType: 'UPDATE', Command: JSON.stringify({ update: 'user_account', updates }) }]);
  phase3 += part.length;
}
console.log(`phase3: 清理历史明文 sms_target=${phase3}`);

// ── 终校验: 解密往返 + 哈希一致(不打印原值) ──
const check = findDocsWith('phone_enc');
let okRT = 0, badRT = 0;
for (const d of check) {
  try {
    const p = pc.decryptPhone(d.phone_enc, key);
    if (PHONE_11.test(p) && pc.phoneHash(p, key) === d.phone_hash && d.phone_mask === pc.maskPhone(p)) okRT++;
    else badRT++;
  } catch (e) { badRT++; }
}
console.log(`verify: 解密往返+哈希+掩码 一致=${okRT} 异常=${badRT}`);
console.log(`verify: 残留明文 phone=${findPlain().length} 残留明文 sms_target=${findLegacySms().filter((d) => PHONE_11.test(d.sms_target || '')).length}`);
if (badRT) process.exit(3);
