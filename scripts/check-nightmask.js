// 检查所有 pages-v2 下 night-mask 组件挂载点是否有 bind:reserve
// 微信审核合规红线：功能不可用=必挂
// 用法: node scripts/check-nightmask.js
// exit code 0 = 全齐 | exit code 1 = 有遗漏

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const PAGES_DIR = path.join(ROOT, 'pages-v2');

// 递归找所有 .wxml
function walk(dir, ext, list = []) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, ext, list);
    else if (f.endsWith(ext)) list.push(full);
  }
  return list;
}

const wxmlFiles = walk(PAGES_DIR, '.wxml');
const results = [];

for (const file of wxmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  // 匹配所有 night-mask 挂载点
  const mountRegex = /<night-mask[^>]*>/g;
  let m;
  while ((m = mountRegex.exec(content)) !== null) {
    const tag = m[0];
    const hasBindReserve = tag.includes('bind:reserve=') || tag.includes('bindreserve=');
    const relPath = path.relative(ROOT, file);
    results.push({ file: relPath, tag, hasBindReserve });
  }
}

// 也检查非 pages-v2 下的 night-mask（如 components 自身）
const allWxml = walk(ROOT, '.wxml').filter(f => !f.startsWith(PAGES_DIR));
for (const file of allWxml) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes('night-mask')) continue;
  const relPath = path.relative(ROOT, file);
  results.push({ file: relPath, tag: '(非pages-v2目录)', hasBindReserve: null });
}

const missing = results.filter(r => r.hasBindReserve === false);
const total = results.filter(r => r.hasBindReserve !== null).length;

console.log(`\n=== night-mask 合规检查 ===`);
console.log(`总挂载点: ${total}`);
console.log(`完整(bind:reserve): ${total - missing.length}`);
console.log(`缺失: ${missing.length}`);

if (missing.length > 0) {
  console.log(`\n❌ 以下文件缺失 bind:reserve:`);
  for (const m of missing) {
    console.log(`  ${m.file}`);
  }
  console.log(`\n修复: 在 night-mask 标签里加 bind:reserve="onReserve"，并确保 JS 里有 onReserve 方法`);
  process.exit(1);
} else {
  console.log(`\n✅ 所有 night-mask 挂载点都有 bind:reserve`);
  process.exit(0);
}
