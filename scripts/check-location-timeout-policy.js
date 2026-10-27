// scripts/check-location-timeout-policy.js — 定位超时兜底门禁(2026-10-27)
//
// 背景: wx.getLocation 回调不返回时, 裸调会让 showLoading/旋转图标/Promise 永久卡死(发布页事故 v1.6.49 修复)。
// 规则(任一不满足即 FAIL, exit 1):
//   L1 miniprogram/ 内除 utils/location.js 外禁止裸调 wx.getLocation; 仅允许 baseline 登记的存量
//   L2 基线按「文件 + 文件内第 N 处」计数, 不依赖行号; 实际多于登记 FAIL(新增裸调),
//      实际少于登记也 FAIL(已迁移必须同步销项, 防基线虚挂)
//   L3 不识别其它封装/豁免注释, 迁移只能改为 getLocationSafe(utils/location.js)
'use strict';
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const SAFE_FILE = path.join(MP, 'utils', 'location.js');
const BASELINE_FILE = path.join(__dirname, 'location-timeout-baseline.json');
const problems = [];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'mock') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 去掉块注释与行注释, 避免注释里的示例代码被误计数
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*/gm, '')
    .replace(/[ \t]+\/\/[^\n]*/g, '');
}

let baseline = {};
if (fs.existsSync(BASELINE_FILE)) {
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch (e) {
    problems.push(`baseline 无法解析: ${path.relative(MP, BASELINE_FILE)} (${e.message})`);
  }
}
if (!fs.existsSync(SAFE_FILE)) problems.push('L0 utils/location.js 缺失(唯一允许裸调的文件)');

const re = /wx\s*\.\s*getLocation\s*\(/g;
const counts = {};
let actualTotal = 0;
for (const f of walk(MP, [])) {
  if (!f.endsWith('.js') || f === SAFE_FILE) continue;
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const hits = (src.match(re) || []).length;
  if (!hits) continue;
  const rel = path.relative(MP, f).split(path.sep).join('/');
  counts[rel] = hits;
  actualTotal += hits;
  const allowed = Number(baseline[rel]) || 0;
  for (let n = allowed + 1; n <= hits; n++) {
    problems.push(`L1 新增裸调 ${rel}#${n}(未登记基线) → 改用 utils/location.js 的 getLocationSafe`);
  }
}

// 基线销项核对: 实际少于登记说明已迁移但没同步收敛基线, 同样 FAIL
let baselineTotal = 0;
for (const rel of Object.keys(baseline)) {
  const allowed = Number(baseline[rel]) || 0;
  baselineTotal += allowed;
  const actual = counts[rel] || 0;
  for (let n = actual + 1; n <= allowed; n++) {
    problems.push(`L2 基线 stale ${rel}#${n}(实际已无此裸调) → 迁移后必须同步删除/递减 baseline`);
  }
}

if (problems.length) {
  console.error('LOCATION-TIMEOUT-POLICY FAILED: ' + problems.length + ' item(s)');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`LOCATION-TIMEOUT-POLICY OK (baseline ${baselineTotal} / actual ${actualTotal} bare wx.getLocation, all registered)`);
