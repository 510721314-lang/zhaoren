// scripts/check-syntax.js · 对所有云函数入口与共享模块做 node --check(仅解析不执行)
// 运行: node scripts/check-syntax.js (CI / 本地均可; 回归门禁之一)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const files = [];
for (const d of fs.readdirSync(CF)) {
  const p = path.join(CF, d);
  if (!fs.statSync(p).isDirectory()) continue;
  const idx = path.join(p, 'index.js');
  if (fs.existsSync(idx)) files.push(idx);
  for (const f of fs.readdirSync(p)) {
    if (f.endsWith('.js') && f !== 'index.js') files.push(path.join(p, f));
  }
}
let fail = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`[SYNTAX FAIL] ${path.relative(ROOT, f)}\n${r.stderr}`);
    fail++;
  }
}
if (fail) { console.error(`SYNTAX CHECK FAILED: ${fail} file(s)`); process.exit(1); }
console.log(`SYNTAX ALL OK (${files.length} files)`);
