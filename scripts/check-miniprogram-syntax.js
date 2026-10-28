// scripts/check-miniprogram-syntax.js · 对 miniprogram/**/*.js 做 node --check(仅解析不执行)
// 背景(tech-debt P3-19): verify:offline 的 SYNTAX 段只覆盖 cloudfunctions/，前端语法错误会门禁全绿、上传才报 Syntax Error
// 用法: node scripts/check-miniprogram-syntax.js (已双挂载 verify:offline + .trae/predeploy.ps1)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm']);

if (!fs.existsSync(MP)) {
  console.error('miniprogram dir not found: ' + MP);
  process.exit(1);
}

const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p);
      continue;
    }
    if (name.endsWith('.js')) files.push(p);
  }
}
walk(MP);
files.sort();

let fail = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`[MINIPROGRAM SYNTAX FAIL] ${path.relative(ROOT, f)}\n${r.stderr}`);
    fail++;
  }
}
if (fail) {
  console.error(`MINIPROGRAM SYNTAX CHECK FAILED: ${fail} file(s)`);
  process.exit(1);
}
console.log(`MINIPROGRAM SYNTAX ALL OK (${files.length} files)`);
