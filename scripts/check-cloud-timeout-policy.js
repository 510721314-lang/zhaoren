// scripts/check-cloud-timeout-policy.js — 云调用超时与错误态门禁(2026-10-27)
//
// 背景: 多个页面因默认 6s 超时 + 云函数多段联表被判超时, 且列表页把「空态」写在「错误态」之前,
//       导致失败时只显示「暂无消息」而无任何错误信息, 排障成本极高。
// 规则(任一不满足即 FAIL, exit 1):
//   R1 miniprogram/app.js 的 cloudCall 默认读超时 >= 12000ms
//   R2 页面不得显式传 timeout < 10000 给 callCloud/app.cloudCall
//   R3 含 loadError 的 wxml, 错误态分支必须出现在「列表空态(=== 0)」之前
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const problems = [];

// R1
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const m = appJs.match(/const\s+timeout\s*=\s*opts\.timeout\s*\|\|\s*(\d+)/);
if (!m) problems.push('R1 app.js 未找到 cloudCall 默认超时常量');
else if (Number(m[1]) < 12000) problems.push(`R1 app.js 默认超时 ${m[1]}ms < 12000ms`);

// R2
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'mock') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const allFiles = walk(ROOT, []);
const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  if (f.endsWith(path.join('utils', 'cloud.js')) || f.endsWith('app.js')) continue;
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:callCloud|cloudCall)\([\s\S]{0,400}?\{\s*timeout\s*:\s*(\d{3,6})/g;
  let mm;
  while ((mm = re.exec(src))) {
    if (Number(mm[1]) < 10000) problems.push(`R2 ${path.relative(ROOT, f)} 显式超时 ${mm[1]}ms < 10000ms`);
  }
}

// R3
const wxmlFiles = allFiles.filter((f) => f.endsWith('.wxml'));
for (const f of wxmlFiles) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (src.indexOf('loadError') === -1) continue;
  const errAt = src.search(/wx:elif="\{\{\s*loadError/);
  const emptyAt = src.search(/wx:elif="\{\{\s*[A-Za-z_$][\w$]*\.length\s*===\s*0/);
  if (errAt === -1 || emptyAt === -1) continue;
  if (errAt > emptyAt) problems.push(`R3 ${path.relative(ROOT, f)} 错误态分支在空态之后(失败会被「暂无数据」掩盖)`);
}

if (problems.length) {
  console.error('CLOUD-TIMEOUT-POLICY FAILED: ' + problems.length + ' item(s)');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('CLOUD-TIMEOUT-POLICY OK (R1 default>=12000 / R2 no low timeout / R3 error-before-empty)');
