// scripts/check-require-scope.js · 跨目录 require 物理拦截(2026-10-19 事故后新增; 2026-10-19 双专家评审 F2 修正)
// 事故背景: CloudBase 按「单函数目录」打包上传, cloudfunctions/_shared/ 不随包上传。
//   任何 require('../...') 在云端必然 MODULE_NOT_FOUND → FUNCTIONS_INVOCATION_FAILED(整函数不可用)。
// 本闸门: 扫描每个可部署函数目录下所有 .js 的「代码态」require, 命中跨目录即拦截。
//   - 逐字符状态机解析: 注释(行/块)与字符串/模板串内容一律不参与匹配
//     (F2 修正: 旧实现"先剥注释再正则"会命中字符串字面量内部的 require('../x'), 造成误报);
//   - 仅识别「代码态 require 标识符 + 紧随的字符串字面量参数」; 动态参数(require(变量)/模板表达式) 单列为 WARN, 不阻断(F3 技术债)。
// 运行: node scripts/check-require-scope.js (CI / 本地 / predeploy 门禁; 已并入 npm run verify:offline)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const isWord = (c) => !!c && /[A-Za-z0-9_$]/.test(c);

// 扫描源码, 返回 { cross: [{line, path}], dynamic: [{line}] }
function scan(src) {
  const cross = [];
  const dynamic = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let state = 0; // 0=code 1=行注释 2=块注释 3='...' 4="..." 5=`...`
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '\n') line++;
    if (state === 0) {
      if (c === '/' && d === '/') { state = 1; i += 2; continue; }
      if (c === '/' && d === '*') { state = 2; i += 2; continue; }
      if (c === "'") { state = 3; i++; continue; }
      if (c === '"') { state = 4; i++; continue; }
      if (c === '`') { state = 5; i++; continue; }
      // 代码态识别 require 标识符(前后非标识符字符, 防 myrequire / requireX)
      if (src.startsWith('require', i) && !isWord(src[i - 1]) && !isWord(src[i + 7])) {
        const atLine = line;
        let j = i + 7;
        // 跳过空白与注释, 定位 '('
        for (;;) {
          while (j < n && /\s/.test(src[j])) { if (src[j] === '\n') line++; j++; }
          if (src[j] === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
          if (src[j] === '/' && src[j + 1] === '*') {
            j += 2;
            while (j < n && !(src[j] === '*' && src[j + 1] === '/')) { if (src[j] === '\n') line++; j++; }
            j += 2; continue;
          }
          break;
        }
        if (src[j] === '(') {
          let k = j + 1;
          while (k < n && /\s/.test(src[k])) k++;
          const q = src[k];
          if (q === "'" || q === '"' || q === '`') {
            let m = k + 1;
            let buf = '';
            let closed = false;
            while (m < n) {
              if (src[m] === '\\') { buf += src[m + 1] || ''; m += 2; continue; }
              if (src[m] === q) { closed = true; break; }
              if (q === '`' && src[m] === '$' && src[m + 1] === '{') break; // 模板串含表达式 → 动态
              buf += src[m];
              m++;
            }
            if (!closed) dynamic.push({ line: atLine });
            else if (buf.startsWith('..')) cross.push({ line: atLine, path: buf });
          } else {
            dynamic.push({ line: atLine }); // 动态参数, 无法静态判定
          }
        }
        i += 7;
        continue;
      }
      i++;
      continue;
    }
    if (state === 1) { if (c === '\n') state = 0; i++; continue; }
    if (state === 2) { if (c === '*' && d === '/') { state = 0; i += 2; continue; } i++; continue; }
    // 字符串/模板串态: 只消费, 不匹配
    if (c === '\\') { i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === '`')) { state = 0; i++; continue; }
    i++;
  }
  return { cross, dynamic };
}

// 只在「可部署函数目录」(含 index.js) 内扫描: 这些目录就是实际上传的包, 必须自包含
const fnDirs = fs.readdirSync(CF).filter((d) => {
  const p = path.join(CF, d);
  return fs.statSync(p).isDirectory() && d !== '_shared' && fs.existsSync(path.join(p, 'index.js'));
});

let fail = 0;
let dyn = 0;
for (const fn of fnDirs) {
  const dir = path.join(CF, fn);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const r = scan(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const h of r.cross) {
      console.error(`[CROSS-DIR REQUIRE] cloudfunctions/${fn}/${f}:${h.line}  require('${h.path}')`);
      console.error(`                    云端按单目录打包, '${h.path}' 在函数包内不存在 → MODULE_NOT_FOUND(整函数不可用)`);
      fail++;
    }
    for (const h of r.dynamic) {
      console.warn(`[DYNAMIC REQUIRE WARN] cloudfunctions/${fn}/${f}:${h.line}  动态 require 参数, 无法静态判定是否跨目录, 请人工确认`);
      dyn++;
    }
  }
}

if (dyn) console.warn(`DYNAMIC REQUIRE (warn, non-blocking): ${dyn} 处 — 兜底能力见 F3 技术债`);
if (fail) {
  console.error(`REQUIRE SCOPE CHECK FAILED: ${fail} cross-directory require(s). 共享代码必须走 sync-*.ps1 复制成本地副本后 require('./xxx')`);
  process.exit(1);
}
console.log(`REQUIRE SCOPE ALL OK (${fnDirs.length} function dirs scanned)`);
