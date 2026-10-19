// scripts/check-require-scope.js · 跨目录 require 物理拦截(2026-10-19 事故后新增)
// 事故背景: CloudBase 按「单函数目录」打包上传, cloudfunctions/_shared/ 不随包上传。
//   任何 require('../...') 在云端必然 MODULE_NOT_FOUND → FUNCTIONS_INVOCATION_FAILED(整函数不可用)。
// 本闸门: 扫描每个可部署函数目录下所有 .js 的「非注释代码」, 命中 require('..') 即拦截。
// 注意: 必须剥离注释再匹配 —— 仓库内多处注释本身就含 "require('../_shared/')" 字样(警示文字), 否则大量误报。
// 运行: node scripts/check-require-scope.js (CI / 本地均可; 已并入 npm run verify:offline)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');

// 剥离注释: 逐字符状态机(保留字符串/模板串内容, 丢弃行注释与块注释), 避免注释中的字样造成误报
function stripComments(src) {
  let out = '';
  let state = 0; // 0=code 1=line 2=block 3='...' 4="..." 5=`...`
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 0) {
      if (c === '/' && d === '/') { state = 1; i++; continue; }
      if (c === '/' && d === '*') { state = 2; i++; continue; }
      if (c === "'") state = 3; else if (c === '"') state = 4; else if (c === '`') state = 5;
      out += c; continue;
    }
    if (state === 1) { if (c === '\n') { state = 0; out += c; } continue; }
    if (state === 2) { if (c === '*' && d === '/') { state = 0; i++; } continue; }
    // 字符串态: 逐字保留(含转义), 遇未转义终止符回 code
    out += c;
    if (c === '\\') { if (d !== undefined) { out += d; i++; } continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === '`')) state = 0;
  }
  return out;
}

// 只在「可部署函数目录」(含 index.js) 内扫描: 这些目录就是实际上传的包, 必须自包含
const fnDirs = fs.readdirSync(CF).filter((d) => {
  const p = path.join(CF, d);
  return fs.statSync(p).isDirectory() && d !== '_shared' && fs.existsSync(path.join(p, 'index.js'));
});

let fail = 0;
const RE_REQUIRE = /\brequire\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g;

for (const fn of fnDirs) {
  const dir = path.join(CF, fn);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const abs = path.join(dir, f);
    const code = stripComments(fs.readFileSync(abs, 'utf8'));
    let m;
    RE_REQUIRE.lastIndex = 0;
    while ((m = RE_REQUIRE.exec(code)) !== null) {
      const req = m[2];
      if (req.startsWith('..')) {
        const line = code.slice(0, m.index).split('\n').length;
        console.error(`[CROSS-DIR REQUIRE] cloudfunctions/${fn}/${f}:${line}  require('${req}')`);
        console.error(`                    云端按单目录打包, '${req}' 在函数包内不存在 → MODULE_NOT_FOUND(整函数不可用)`);
        fail++;
      }
    }
  }
}

if (fail) {
  console.error(`REQUIRE SCOPE CHECK FAILED: ${fail} cross-directory require(s). 共享代码必须走 sync-*.ps1 复制成本地副本后 require('./xxx')`);
  process.exit(1);
}
console.log(`REQUIRE SCOPE ALL OK (${fnDirs.length} function dirs scanned)`);
