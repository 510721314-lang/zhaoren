// scripts/check-index-ledger.js · 校验设计索引台账(init-db INDEXES) vs 最近一次云端扫描缓存(indexes-actual.json)
// 防「台账被改但云端未建」漂移。属【离线静态比对】: 不联网, 只读本地缓存。
// 缓存新鲜度由 scan 负责(改台账/补建索引后须跑 `node scripts/tcb-scan-indexes.js` 刷新; manual-backup L7 亦会导出)。
// 决策:
//   - actual 缓存不存在  → WARN(exit 0, 提示刷新), 不阻塞日常提交(索引核对是联网/时效性操作, 硬塞会误报)
//   - 台账索引所在集合在云端不存在(幽灵集合/设计超前) → WARN(不阻塞)
//   - 集合存在但该索引未建/同名不同键 → FAIL(exit 1): 台账被改却未建索引, 强制阻断
// 用法: node scripts/check-index-ledger.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEDGER = path.join(ROOT, '.tmp-tcb', 'index_ledger.json');
const ACTUAL_CANDIDATES = [
  path.join(ROOT, '.tmp-tcb', 'indexes-actual.json'),
  'C:\\zhaoren-bak\\tmp-tcb\\indexes-actual.json', // manual-backup L7 备份缓存
];

function normKey(keyObj) {
  if (!keyObj) return '';
  return Object.entries(keyObj)
    .filter(([k]) => k !== '_id')
    .map(([k, v]) => k + ':' + (v && v.$numberInt ? v.$numberInt : v))
    .join(',');
}

if (!fs.existsSync(LEDGER)) {
  console.error('[WARN] index_ledger.json 不存在, 跳过索引对照(先跑 node scripts/dump-index-ledger.js)');
  process.exit(0);
}

const actualFile = ACTUAL_CANDIDATES.find((f) => fs.existsSync(f));
if (!actualFile) {
  console.log('[WARN] 无 indexes-actual.json 缓存, 跳过索引对照(改索引/提审前请跑 node scripts/tcb-scan-indexes.js 刷新)');
  process.exit(0);
}

const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const actual = JSON.parse(fs.readFileSync(actualFile, 'utf8'));
const designIndexes = Array.isArray(ledger.indexes) ? ledger.indexes : [];

const actualMap = {};
for (const [col, arr] of Object.entries(actual)) {
  actualMap[col] = (Array.isArray(arr) ? arr : []).filter((x) => x && x.name);
}

const failList = [];
const warnList = [];
for (const di of designIndexes) {
  const col = di.coll;
  const keyStr = normKey(di.keys);
  const list = actualMap[col];
  if (!list) { warnList.push(`${col} | ${di.name} | 集合不存在(设计超前/幽灵)`); continue; }
  const hit = list.find((x) => x.name === di.name && normKey(x.key) === keyStr);
  const nameOnly = list.find((x) => x.name === di.name);
  if (hit) continue;
  if (nameOnly) failList.push(`${col} | ${di.name} | 同名不同键(台账 ${keyStr})`);
  else failList.push(`${col} | ${di.name} | 未建(${keyStr})${di.unique ? ' UNIQUE' : ''}`);
}

for (const w of warnList) console.log('[WARN] ' + w);
if (failList.length) {
  console.error(`INDEX LEDGER CHECK FAILED: ${failList.length} 条设计索引未在云端实际索引中:`);
  for (const f of failList) console.error('  [MISS] ' + f);
  console.error('  修复: ①改台账勿忘建索引(可 tcb-diff-indexes 生成命令→tcb-exec) ②或该索引已废弃请同步清理台账');
  process.exit(1);
}
console.log(`INDEX LEDGER OK: 台账 ${designIndexes.length} 条全部在云端实际索引中(缓存 ${path.basename(actualFile)})${warnList.length ? `, ${warnList.length} 条 WARN` : ''}`);
process.exit(0);