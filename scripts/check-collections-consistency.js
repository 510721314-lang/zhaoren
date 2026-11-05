// 集合名单一致性门禁（2026-11-05，负债 B-3）
// 规范源：scripts/collections-canonical.json
// 校验 5 处消费方名单集合完全一致：raw-export / manual-backup / backup.ps1 / admin-action export / import
// 纪律：新增/下线集合必须先改 canonical，再同步五处；本门禁 FAIL 即阻断 verify:offline。
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const quoted = (block) => Array.from(block.matchAll(/'([^']+)'/g)).map((m) => m[1]);

const sources = [
  { name: 'raw-export.js', file: 'scripts/raw-export.js', re: /const COLLECTIONS_ALL = \[([\s\S]*?)\];/ },
  { name: 'manual-backup.ps1', file: '.predeploy/manual-backup.ps1', re: /\$COLLECTIONS = @\(([\s\S]*?)\n\)/ },
  { name: 'backup.ps1', file: '.predeploy/backup.ps1', re: /\$COLLECTIONS = @\(([\s\S]*?)\n\)/ },
  { name: 'admin-action/action_export.js', file: 'cloudfunctions/admin-action/action_export.js', re: /const EXPORT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/ },
  { name: 'admin-action/action_import.js', file: 'cloudfunctions/admin-action/action_import.js', re: /const IMPORT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/ }
];

let canonical;
try {
  canonical = JSON.parse(read('scripts/collections-canonical.json'));
} catch (e) {
  console.error(`FAIL [CANONICAL] 无法解析 scripts/collections-canonical.json：${e.message}`);
  process.exit(1);
}
if (!Array.isArray(canonical) || !canonical.length) {
  console.error('FAIL [CANONICAL] 规范源必须是非空数组');
  process.exit(1);
}
const canonSet = new Set(canonical);
if (canonSet.size !== canonical.length) {
  console.error('FAIL [CANONICAL] 规范源存在重复项');
  process.exit(1);
}

let fails = 0;
for (const s of sources) {
  let text;
  try { text = read(s.file); } catch (e) {
    console.error(`FAIL [${s.name}] 文件不可读：${s.file}`);
    fails++;
    continue;
  }
  const m = text.match(s.re);
  if (!m) {
    console.error(`FAIL [${s.name}] 未找到集合名单块（正则不匹配，可能被改名/重构）`);
    fails++;
    continue;
  }
  const list = quoted(m[1]);
  const set = new Set(list);
  const missing = canonical.filter((c) => !set.has(c));
  const extra = list.filter((c) => !canonSet.has(c));
  if (missing.length || extra.length) {
    fails++;
    console.error(`FAIL [${s.name}] 与规范源不一致`);
    if (missing.length) console.error(`  缺失(${missing.length}): ${missing.join(', ')}`);
    if (extra.length) console.error(`  多余(${extra.length}): ${extra.join(', ')}`);
  } else {
    console.log(`OK   [${s.name}] ${list.length} 集合，与规范源一致`);
  }
}

if (fails) {
  console.error(`\nCOLLECTIONS CONSISTENCY FAILED: ${fails} 处不一致（先改 scripts/collections-canonical.json，再同步五处）`);
  process.exit(1);
}
console.log(`COLLECTIONS CONSISTENCY OK: ${canonical.length} 集合 × 5 处全部一致`);
