#!/usr/bin/env node
/**
 * check-handoff-coverage.js
 * HANDOFF 防丢条目自动检查脚本（v8 draft1 丢失 64 条事故后落地 · 持续迭代）
 *
 * 用法：node scripts/check-handoff-coverage.js <上一版HANDOFF路径> <新稿HANDOFF路径>
 * 示例：node scripts/check-handoff-coverage.js docs/HANDOFF-20261023.md docs/HANDOFF-20261024.md
 *
 * Exit code：0=全绿，1=有缺失（阻断交付）
 */

const fs = require('fs');
const path = require('path');

const PREV_PATH = process.argv[2];
const NEW_PATH = process.argv[3];

if (!PREV_PATH || !NEW_PATH) {
  console.error('用法：node check-handoff-coverage.js <上一版> <新稿>');
  process.exit(1);
}
if (!fs.existsSync(PREV_PATH) || !fs.existsSync(NEW_PATH)) {
  console.error('HANDOFF 文件不存在');
  process.exit(1);
}

const prev = fs.readFileSync(PREV_PATH, 'utf8');
const next = fs.readFileSync(NEW_PATH, 'utf8');

// ── Step 1：枚举上一版所有编号 ──
const PATTERNS = [
  { re: /C-3\.(\d+)(?:[~～]\s*C-?3\.(\d+))?/g, label: 'C-3' },
  { re: /C-4\.(\d+)(?:[~～]\s*C-?4\.(\d+))?/g, label: 'C-4' },
  { re: /E-6\.(\d+)(?:[~～]\s*E-?6\.(\d+))?/g, label: 'E-6' },
  { re: /T-7\.(\d+)(?:[~～]\s*T-?7\.(\d+))?/g, label: 'T-7' },
  { re: /T-0\.(\d+)(?:[~～]\s*T-?0\.(\d+))?/g, label: 'T-0' },
];

function expand(label, start, end) {
  const out = [];
  const lo = parseInt(start);
  const hi = end ? parseInt(end) : lo;
  for (let i = lo; i <= hi; i++) out.push(`${label}.${i}`);
  return out;
}

function collectIds(text) {
  const ids = new Set();
  for (const { re, label } of PATTERNS) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      expand(label, m[1], m[2]).forEach(id => ids.add(id));
    }
  }
  return [...ids].sort((a, b) => {
    const [aP, aN] = a.split('.');
    const [bP, bN] = b.split('.');
    if (aP !== bP) return a.localeCompare(b);
    return parseInt(aN) - parseInt(bN);
  });
}

const prevIds = collectIds(prev);
console.log('=== HANDOFF 覆盖率检查 ===');
console.log('上一版：' + PREV_PATH + '  新稿：' + NEW_PATH);
console.log('上一版编号总数：' + prevIds.length);

// ── Step 2：顶层补丁格式声明检测 ──
function hasPatchFormatDeclaration(text) {
  // 补丁格式 = 开头声明"先读上一版全文" + "未被标记作废的条目全部继续有效"
  const readPrev = /先读.*(?:v\d+|上一版).*全文/.test(text.slice(0, 500));
  const allContinue = /未.*标记作废.*全部继续有效|继续有效/.test(text.slice(0, 1500));
  return readPrev && allContinue;
}
const PATCH_MODE = hasPatchFormatDeclaration(next);
if (PATCH_MODE) {
  console.log('补丁格式：已识别（先读上一版全文 + 继承声明）——v7 所有编号默认 present，除非映射表显式标记 已完成/作废/转移/顺延');
} else {
  console.log('补丁格式：未识别——所有编号必须在新稿正文显式出现或映射表显式列出');
}

// ── Step 3：对每个编号验证新稿落点 ──
function hasDirectHit(id, text) {
  const escaped = id.replace('.', '\\.');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

// 新稿中有"继承 v7 原文"这类范围写法 = 覆盖范围内所有编号
function getCoveredRanges(text) {
  const ranges = [];
  // 匹配 C-3.11~3.28 / C-3.11~C-3.28 / E-6.1~28 等写法
  const rangeRe = /(C-3|C-4|E-6|T-7|T-0)\.(\d+)\s*[~～]\s*(?:(?:C-?3|C-?4|E-?6|T-?7|T-?0)\.)?(\d+)/g;
  let m;
  while ((m = rangeRe.exec(text)) !== null) {
    ranges.push({ label: m[1], lo: parseInt(m[2]), hi: parseInt(m[3]) });
  }
  // 也匹配"继承 v7 C-3.x / C-4.x / E-6.x 原文"这类范围声明
  const inheritRe = /继承\s*v\d+\s*((?:(?:C-3|C-4|E-6|T-7|T-0)\.?\s*\d*[、,，\s]+)*)(?:原文|全部)/g;
  while ((m = inheritRe.exec(text)) !== null) {
    const refs = m[1];
    // 逐个提取编号
    const reNum = /(C-3|C-4|E-6|T-7|T-0)\.?\s*(\d+)/g;
    let m2;
    while ((m2 = reNum.exec(refs)) !== null) {
      ranges.push({ label: m2[1], lo: parseInt(m2[2]), hi: parseInt(m2[2]) });
    }
  }
  return ranges;
}

function isInCoveredRanges(id, ranges) {
  const [label, num] = id.split('.');
  const n = parseInt(num);
  return ranges.some(r => r.label === label && n >= r.lo && n <= r.hi);
}

// 映射表显式列了上一版编号 + 状态 = 覆盖
function getMappingTableRows(text) {
  // 映射表一般在 §1，markdown 表格
  const mappingSection = text.split('## §1')[1] || text;
  const ids = new Set();
  const statuses = {};
  // 提取所有出现在映射表中的上一版编号
  const re = /(C-3|C-4|E-6|T-7|T-0)\.(\d+)/g;
  let m;
  while ((m = re.exec(mappingSection)) !== null) {
    const id = `${m[1]}.${m[2]}`;
    ids.add(id);
    // 判断状态（同行查找）
    const lineStart = mappingSection.lastIndexOf('|', re.lastIndex);
    const lineEnd = mappingSection.indexOf('\n', re.lastIndex);
    const line = mappingSection.slice(Math.max(0, lineStart - 10), lineEnd);
    if (/已完成|已交付|已关闭/.test(line)) statuses[id] = 'completed';
    else if (/作废/.test(line)) statuses[id] = 'voided';
    else if (/转移/.test(line)) statuses[id] = 'transferred';
    else if (/顺延|独立立项/.test(line)) statuses[id] = 'deferred';
    else statuses[id] = 'present';
  }
  return { ids, statuses };
}

const coveredRanges = getCoveredRanges(next);
const mappingTable = getMappingTableRows(next);

const results = { present: [], completed: [], voided: [], transferred: [], deferred: [], missing: [] };

// 映射表中显式出现且状态非 present 的编号集合
const mappingExplicitStatusIds = new Set(
  Object.entries(mappingTable.statuses)
    .filter(([_, st]) => st !== 'present')
    .map(([id]) => id)
);

for (const id of prevIds) {
  if (PATCH_MODE) {
    // 补丁模式：映射表显式列了 已完成/作废/转移/顺延 → 用那个状态；否则一律 present（继承 v7）
    if (mappingTable.statuses[id] && mappingTable.statuses[id] !== 'present') {
      results[mappingTable.statuses[id]].push(id);
    } else {
      results.present.push(id);
    }
  } else {
    // 非补丁模式：必须显式出现或映射表 present
    let placed = false;
    if (hasDirectHit(id, next)) { results.present.push(id); placed = true; }
    else if (isInCoveredRanges(id, coveredRanges)) { results.present.push(id); placed = true; }
    else if (mappingTable.ids.has(id)) {
      const st = mappingTable.statuses[id] || 'present';
      results[st].push(id); placed = true;
    }
    if (!placed) results.missing.push(id);
  }
}

// ── Step 3：输出 ──
console.log('\n落点分布：');
console.log('  present（正文出现 / 继承范围 / 映射表 present）：' + results.present.length);
console.log('  completed（映射表已完成/已交付）：' + results.completed.length);
console.log('  voided（映射表作废）：' + results.voided.length);
console.log('  transferred（映射表转移）：' + results.transferred.length);
console.log('  deferred（映射表顺延/独立立项）：' + results.deferred.length);

if (results.missing.length === 0) {
  console.log('\n✅ ALL OK — 上一版 ' + prevIds.length + ' 个编号全部有落点');
  process.exit(0);
} else {
  console.log('\n❌ BLOCKED — 有 ' + results.missing.length + ' 个编号在新稿中无任何落点：');
  results.missing.forEach(id => console.log('  🔴 ' + id));
  process.exit(1);
}
