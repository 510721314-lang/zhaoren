// scripts/check-require-scope.js · 跨目录 require 物理拦截(2026-10-19 事故后新增; 同日晚 双专家评审 F2 修正 + F3/F4 扩面)
// 事故背景: CloudBase 按「单函数目录」打包上传, cloudfunctions/_shared/ 不随包上传。
//   任何 require('../...') 在云端必然 MODULE_NOT_FOUND → FUNCTIONS_INVOCATION_FAILED(整函数不可用)。
// 本闸门: 扫描每个可部署函数目录下所有代码文件的「代码态」require/import, 命中跨目录即拦截。
//   - 逐字符状态机 + 模板串模式栈: 行/块注释与字符串/模板串「字面量部分」不参与匹配;
//     模板串内 ${ ... } 表达式属代码态, 照常识别(用栈保存进入模板串前的状态, 支持嵌套);
//   - 覆盖三种静态可判的跨目录形态: require('..') / require.resolve('..') / import('..')  (F3-1/F3-2)
//     动态参数(require(变量)、模板串插值 begin) 单列为 WARN 非阻断 —— 残余 F3: 非字面量参数静态不可判;
//   - 递归遍历函数目录(跳过 node_modules)且覆盖 .js/.cjs/.mjs, 子目录同样扫描  (F4)
// 运行: node scripts/check-require-scope.js (CI / 本地 / predeploy 门禁; 已并入 npm run verify:offline)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const SCAN_EXT = /\.(js|cjs|mjs)$/;
const isWord = (c) => !!c && /[A-Za-z0-9_$]/.test(c);

// 扫描源码, 返回 { cross: [{line, path}], dynamic: [{line}] }
function scan(src) {
  const cross = [];
  const dynamic = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let state = 0; // 0=code 1=行注释 2=块注释 3='...' 4="..." 5=`...`
  let braceDepth = 0; // 模板串 ${} 表达式内的花括号深度
  const stack = []; // 进入模板串 / 模板表达式时保存的上层状态(支持嵌套)

  // 跳过空白与注释, 返回新位置
  // 注意: 此处不推进 line —— 被跳过的字符仍会被主循环重复扫到(require 分支仅 i+=7, 未越过该段),
  //       换行计数统一由主循环完成, 避免同一换行被计两次导致行号漂移(原 P2-6 ⑥)。
  function skipTrivia(p) {
    for (;;) {
      while (p < n && /\s/.test(src[p])) p++;
      if (src[p] === '/' && src[p + 1] === '/') { while (p < n && src[p] !== '\n') p++; continue; }
      if (src[p] === '/' && src[p + 1] === '*') {
        p += 2;
        while (p < n && !(src[p] === '*' && src[p + 1] === '/')) p++;
        p += 2; continue;
      }
      break;
    }
    return p;
  }

  // 解析 '(' 之后的实参: 字符串字面量 → cross/local; 其余 → dynamic
  function readArg(p) {
    const q = src[p];
    if (q !== "'" && q !== '"' && q !== '`') return { kind: 'dynamic' };
    let m = p + 1;
    let buf = '';
    let closed = false;
    while (m < n) {
      if (src[m] === '\\') { buf += src[m + 1] || ''; m += 2; continue; }
      if (src[m] === q) { closed = true; break; }
      if (q === '`' && src[m] === '$' && src[m + 1] === '{') break; // 模板串插值 → 动态
      buf += src[m];
      m++;
    }
    if (!closed) return { kind: 'dynamic' }; // 未闭合字面量
    return buf.startsWith('..') ? { kind: 'cross', value: buf } : { kind: 'local' };
  }

  // 记录一次 require/import 调用: 定位 '(' 并解析实参
  function recordCall(atLine, afterIdent) {
    const j = skipTrivia(afterIdent);
    if (src[j] !== '(') return;
    const r = readArg(skipTrivia(j + 1));
    if (r.kind === 'cross') cross.push({ line: atLine, path: r.value });
    else if (r.kind === 'dynamic') dynamic.push({ line: atLine });
  }

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '\n') line++;
    if (state === 0) {
      if (c === '/' && d === '/') { state = 1; i += 2; continue; }
      if (c === '/' && d === '*') { state = 2; i += 2; continue; }
      if (c === "'") { state = 3; i++; continue; }
      if (c === '"') { state = 4; i++; continue; }
      if (c === '`') { stack.push({ state: 0, braceDepth }); braceDepth = 0; state = 5; i++; continue; }
      if (c === '{') { braceDepth++; i++; continue; }
      if (c === '}') {
        if (braceDepth > 0) braceDepth--;
        else if (stack.length) { const t = stack.pop(); state = t.state; braceDepth = t.braceDepth; }
        i++;
        continue;
      }
      // require 标识符(允许 require.resolve 链, 允许 require 与 ( 之间换行/注释), 前后非标识符字符防 myrequire/requireX
      if (src.startsWith('require', i) && !isWord(src[i - 1]) && !isWord(src[i + 7])) {
        const atLine = line;
        let j = skipTrivia(i + 7);
        if (src.startsWith('.resolve', j)) j = skipTrivia(j + 8);
        recordCall(atLine, j);
        i += 7;
        continue;
      }
      // import 标识符(仅 import(...) 动态导入; import x from '...' 因后续非 '(' 自然跳过)
      if (src.startsWith('import', i) && !isWord(src[i - 1]) && !isWord(src[i + 6])) {
        recordCall(line, i + 6);
        i += 6;
        continue;
      }
      i++;
      continue;
    }
    if (state === 1) { if (c === '\n') state = 0; i++; continue; }
    if (state === 2) { if (c === '*' && d === '/') { state = 0; i += 2; continue; } i++; continue; }
    // 模板串态: ${ 进入代码态(压栈), 其余字面量部分只消费
    if (state === 5) {
      if (c === '$' && d === '{') { stack.push({ state: 5, braceDepth }); braceDepth = 0; state = 0; i += 2; continue; }
      if (c === '\\') { i += 2; continue; }
      if (c === '`') {
        if (stack.length) { const t = stack.pop(); state = t.state; braceDepth = t.braceDepth; }
        else state = 0;
        i++;
        continue;
      }
      i++;
      continue;
    }
    // 字符串态: 只消费, 不匹配
    if (c === '\\') { i += 2; continue; }
    if ((state === 3 && c === "'") || (state === 4 && c === '"')) { state = 0; i++; continue; }
    i++;
  }
  return { cross, dynamic };
}

// 只在「可部署函数目录」(含 index.js) 内扫描: 这些目录就是实际上传的包, 必须自包含
const fnDirs = fs.readdirSync(CF).filter((d) => {
  const p = path.join(CF, d);
  return fs.statSync(p).isDirectory() && d !== '_shared' && fs.existsSync(path.join(p, 'index.js'));
});

// 递归收集函数目录下的代码文件(F4): 跳过 node_modules(依赖包 require 自身依赖属合法)
function collectFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, out);
    else if (SCAN_EXT.test(e.name)) out.push(p);
  }
  return out;
}

let fail = 0;
let dyn = 0;
for (const fn of fnDirs) {
  const files = collectFiles(path.join(CF, fn), []);
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const r = scan(fs.readFileSync(f, 'utf8'));
    for (const h of r.cross) {
      console.error(`[CROSS-DIR REQUIRE] ${rel}:${h.line}  require('${h.path}')`);
      console.error(`                    云端按单目录打包, '${h.path}' 在函数包内不存在 → MODULE_NOT_FOUND(整函数不可用)`);
      fail++;
    }
    for (const h of r.dynamic) {
      console.warn(`[DYNAMIC REQUIRE WARN] ${rel}:${h.line}  动态 require 参数, 无法静态判定是否跨目录, 请人工确认`);
      dyn++;
    }
  }
}

if (dyn) console.warn(`DYNAMIC REQUIRE (warn, non-blocking): ${dyn} 处 — 兜底能力见 F3 技术债`);
if (fail) {
  console.error(`REQUIRE SCOPE CHECK FAILED: ${fail} cross-directory require(s). 共享代码必须走 sync-*.ps1 复制成本地副本后 require('./xxx')`);
  process.exit(1);
}
console.log(`REQUIRE SCOPE ALL OK (${fnDirs.length} function dirs scanned, ext=js/cjs/mjs, recursive)`);
