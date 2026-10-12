#!/usr/bin/env node
// scripts/check-manual-links.js · 校验《技术开发手册》(docs/dev-manual/*.md) 内
// 所有 `file:///` 链接指向的本地文件/目录真实存在，防止手册引用腐烂。
// 运行: node scripts/check-manual-links.js   (exit 0 = 全部有效; 非 0 = 有失效链接)
// 说明: 手册以代码为唯一事实源, 链接必须可校验 —— 纳入 npm run verify。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANUAL_DIR = path.join(ROOT, 'docs', 'dev-manual');

// markdown 链接: [text](file:///...)
const LINK_RE = /\]\(\s*(file:\/\/\/[^)\s]+)\s*\)/g;

// file:///c:/x/y -> c:\x\y ; 去掉 #Lxx 锚点
function toFsPath(url) {
  let p = url.replace(/^file:\/\/\//, '');
  p = p.split('#')[0];
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // 去掉 Windows 路径前的额外斜杠
  return path.normalize(p);
}

if (!fs.existsSync(MANUAL_DIR)) {
  console.log(`[manual-links] 手册目录不存在，跳过: ${MANUAL_DIR}`);
  process.exit(0);
}

const mdFiles = fs.readdirSync(MANUAL_DIR).filter((f) => f.endsWith('.md'));
let checked = 0;
const missing = [];

for (const f of mdFiles) {
  const full = path.join(MANUAL_DIR, f);
  const text = fs.readFileSync(full, 'utf8');
  let m;
  while ((m = LINK_RE.exec(text)) !== null) {
    const url = m[1];
    const fsPath = toFsPath(url);
    checked++;
    if (!fs.existsSync(fsPath)) {
      const line = text.slice(0, m.index).split('\n').length;
      missing.push(`${f}:${line} -> ${url}`);
    }
  }
}

if (missing.length) {
  console.error(`[manual-links] FAIL: ${missing.length} 个失效链接 (共校验 ${checked} 个)`);
  for (const miss of missing) console.error(`  [MISS] ${miss}`);
  process.exit(1);
}
console.log(`[manual-links] OK: 校验 ${checked} 个 file:/// 链接，全部存在 (${mdFiles.length} 个手册文件)`);
