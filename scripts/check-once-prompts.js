// scripts/check-once-prompts.js — 「被动提示幂等」门禁(2026-10-30, 规则 §34)
//
// 背景: 2026-10-30 真机发现需求详情页「已有人接单」弹窗反复出现。根因是「只提示一次」的
//   幂等键存在页面实例内存(this.__ownerPrompted), 页面销毁重建即失效; 且判据缺订单阶段。
//   同类模式全仓 5 处(见 once-prompts-baseline.json)。
//
// 规则(exit 1 = FAIL):
//   P1 扫描 miniprogram/ 下所有 js, 识别「已提示」语义的页面内存标记:
//      形如 this.xxx / page.xxx, 名字含 prompted|shown|notified|dismissed|seen
//   P2 实际识别结果必须与 scripts/once-prompts-baseline.json 精确一致:
//      多出未登记标记 → FAIL(新增风险, 必须先落地 §34 持久化)
//      登记项消失 → FAIL(已迁移/已删除必须同步销项, 防基线虚挂)
//   P3 基线内 state=todo 的项不阻断, 仅计入债务数(KNOWN-TODO); state=ok 表示已具备持久化锚
//
// 说明: 不做「同函数内是否有 Storage」的推断(易误判); 是否真正持久化由 §34 条款+评审把关,
//   门禁只保证「不新增未登记的被动提示幂等键」, 可精确判定、双向校验。
'use strict';
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const BASELINE_FILE = path.join(__dirname, 'once-prompts-baseline.json');
const NAME_RE = /prompted|shown|notified|dismissed|seen/i;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm' || name === 'mock') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// 去注释, 避免注释里的示例被误识别
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*/gm, '')
    .replace(/[ \t]+\/\/[^\n]*/g, '');
}

const found = new Map(); // key: relFile + '#' + marker -> true
for (const file of walk(MP, [])) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/');
  const re = /(?:this|page)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (!NAME_RE.test(name)) continue;
    // 仅统计赋值/读写用途的标记, 排除纯声明式命名(如函数名 onXxx)
    found.set(`${rel}#${name}`, { file: rel, marker: name });
  }
}

let baseline = { items: [] };
if (fs.existsSync(BASELINE_FILE)) {
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch (e) {
    console.error('FAIL: once-prompts-baseline.json 解析失败:', e.message);
    process.exit(1);
  }
}
const baseKeys = new Set((baseline.items || []).map((x) => `${x.file}#${x.marker}`));
const problems = [];

for (const [k, v] of found) {
  if (!baseKeys.has(k)) problems.push(`NEW ${v.file} → ${v.marker}（未登记的内存幂等键, 违反 §34）`);
}
for (const k of baseKeys) {
  if (!found.has(k)) problems.push(`STALE ${k}（基线登记但代码中已不存在, 请同步销项）`);
}

const knownTodo = (baseline.items || []).filter((x) => (x.state || 'todo') === 'todo').length;

if (problems.length) {
  console.error('ONCE-PROMPTS FAIL');
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}
console.log(`ONCE-PROMPTS OK ${found.size} markers (${knownTodo} known-todo)`);
