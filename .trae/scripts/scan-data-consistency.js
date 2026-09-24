// zhaoren scan-data-consistency.js
// 小程序 data/WXML 一致性扫描(无第三方依赖, 纯 node)
// 检查:
//   1) JS 侧 this.data.foo / setData 引用 是否在 data/properties 中定义
//   2) WXML 侧 {{foo}} 顶层绑定(排除 wx:for 循环变量/嵌套字段/字面量) 是否在 data/properties 中定义
// 用法: node scan-data-consistency.js [miniprogramRoot]
// 退出码: 0 = 无未定义引用 / 1 = 存在(供 predeploy 门禁调用)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || (__dirname + '/../../../miniprogram'));

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'miniprogram_npm' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(js|wxml)$/.test(ent.name)) out.push(p);
  }
  return out;
}

// 提取对象块顶层 key(data / properties)
function blockKeys(code, labelRe) {
  const keys = new Set();
  const m = new RegExp(labelRe + '\\s*:\\s*\\{').exec(code);
  if (!m) return keys;
  let start = m.index + m[0].length - 1;
  let depth = 0, i = start;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const body = code.slice(start + 1, i);
  const re = /([A-Za-z_$][\w$]*)\s*:/g;
  let mm;
  while ((mm = re.exec(body))) keys.add(mm[1]);
  return keys;
}

// 定义源: data + properties(组件)
function extractDefined(code) {
  const keys = new Set();
  blockKeys(code, '\\bdata').forEach((k) => keys.add(k));
  const pm = /\bproperties\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(code);
  if (pm) {
    const re = /([A-Za-z_$][\w$]*)\s*:/g;
    let mm;
    while ((mm = re.exec(pm[1]))) keys.add(mm[1]);
  }
  return keys;
}

// JS 引用: 读取 this.data.foo 与 写入 this.setData('a.b', ...)
// 写入会动态创建字段(setData 语义), 不视为未定义; getTabBar().setData 操作组件 data, 也排除
function collectJsRefs(code) {
  const reads = new Set();   // this.data.foo 读取(需已定义或曾有写入)
  const writes = new Set();  // this.setData 写入(动态创建字段, 合法)
  const r1 = /this\.data\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = r1.exec(code))) reads.add(m[1]);
  // this.setData({ a, b:1, 'c.d':2 }) → 捕获对象内所有顶层 key(含展开变量名与简写属性)
  const r2 = /this\.setData\(\s*\{([\s\S]*?)\}\s*\)/g;
  while ((m = r2.exec(code))) {
    const objBody = m[1];
    // key: 标识符后跟 ':' (显式键) 或 标识符后跟 ',' / '}' 且不是已有表达式(近似简写属性)
    const kr = /([A-Za-z_$][\w$]*)(?=\s*[:\},])/g;
    let km;
    while ((km = kr.exec(objBody))) writes.add(km[1]);
  }
  return { reads, writes };
}

// WXML 顶层裸绑定(排除嵌套 item.xxx / 比较 / 字面量 / 循环变量)
function collectWxmlRefs(wxml) {
  const refs = new Set();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(wxml))) {
    let expr = m[1].trim();
    expr = expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '');
    for (const clause of expr.split(',')) {
      let t = clause.trim();
      let id = t;
      if (/^!+/.test(t)) id = t.replace(/^!+/, '').trim();
      else if (/^-/.test(t)) id = t.replace(/^-/, '').trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(id)) continue;
      if (/^(true|false|null|undefined|item|index|idx)$/.test(id)) continue;
      refs.add(id);
    }
  }
  const loops = new Set();
  const lr = /wx:for-item\s*=\s*["']([\w$]+)["']|wx:for\s*=\s*["']\{?\{?\s*([\w$]+)/g;
  let lm;
  while ((lm = lr.exec(wxml))) {
    const v = lm[1] || lm[2];
    if (v) loops.add(v);
  }
  return { refs, loops };
}

const files = walk(root);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const wxmlFiles = files.filter((f) => f.endsWith('.wxml'));

// 已知无害白名单(经人工核实: 代码有防御/动态语义, 非真实缺失)
// 格式: "相对路径::字段" (JS 侧) / "相对路径::{{字段}}" (WXML 侧)
const KNOWN_OK = new Set([
  // workbench 一键报警: orders 未加载时用 todayOrders 兜底(2026-09-24 修复), currentOrderId 预留
  'pages-v2/workbench/workbench.js::orders',
  'pages-v2/workbench/workbench.js::currentOrderId',
  // order-detail nextStep: setData 简写属性写入(L324), 正则嵌套对象限制误报
  'pages-v2/order-detail/order-detail.js::nextStep',
  'pages-v2/order-detail/order-detail.wxml::{{nextStep}}'
]);

const reportSet = new Set();
const jsMiss = [];
for (const f of jsFiles) {
  const code = fs.readFileSync(f, 'utf8');
  if (!/Page\(/.test(code) && !/Component\(/.test(code) && !/App\(/.test(code)) continue;
  const defined = extractDefined(code);
  if (!defined.size) continue;
  const { reads, writes } = collectJsRefs(code);
  const rel = path.relative(root, f).replace(/\\/g, '/');
  for (const r of reads) {
    if (!defined.has(r) && !writes.has(r) && !KNOWN_OK.has(`${rel}::${r}`)) {
      const sig = `${path.relative(root, f)}::${r}`;
      if (!reportSet.has(sig)) { reportSet.add(sig); jsMiss.push(`${sig}: data.${r} 未定义(且无 this.setData 写入)`); }
    }
  }
}

const wxmlMiss = [];
for (const w of wxmlFiles) {
  const dir = path.dirname(w);
  const base = path.basename(w, '.wxml');
  const jsPath = path.join(dir, base + '.js');
  if (!fs.existsSync(jsPath)) continue;
  const code = fs.readFileSync(jsPath, 'utf8');
  const defined = extractDefined(code);
  if (!defined.size) continue;
  const { reads, writes } = collectJsRefs(code);
  void reads;
  const { refs, loops } = collectWxmlRefs(fs.readFileSync(w, 'utf8'));
  const rel = path.relative(root, w).replace(/\\/g, '/');
  for (const r of refs) {
    if (!defined.has(r) && !loops.has(r) && !writes.has(r) && !KNOWN_OK.has(`${rel}::{{${r}}}`)) {
      const sig = `${path.relative(root, w)}::{{${r}}}`;
      if (!reportSet.has(sig)) { reportSet.add(sig); wxmlMiss.push(`${sig} 未定义(且无 this.setData 写入)`); }
    }
  }
}

console.log('==== JS this.data 引用未定义 ====');
jsMiss.forEach((x) => console.log(' ' + x));
console.log('==== WXML 绑定未定义 ====');
wxmlMiss.forEach((x) => console.log(' ' + x));
const total = jsMiss.length + wxmlMiss.length;
console.log(`\n[data-consistency] ${total === 0 ? 'PASS' : 'FAIL'}  js=${jsMiss.length} wxml=${wxmlMiss.length} (jsFiles=${jsFiles.length} wxmlFiles=${wxmlFiles.length})`);
process.exit(total === 0 ? 0 : 1);
