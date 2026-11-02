// 规则体系季度体检报告（T-7.34 ④）：输出可直接贴进台账的一行 + 明细
// 用法：node scripts/rules-size-report.js  （npm run rules:report）
// 说明：「注入但从不命中」无法静态推导，需人工按命中次数填写（本脚本只给占位与口径）。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const bytes = p => Buffer.from(read(p), 'utf8').length;
const rel = p => path.relative(root, p).replace(/\\/g, '/');

const rulesDir = path.join(root, '.trae', 'rules');
const rulesMd = path.join(root, '.trae', 'rules.md');
const baseline = JSON.parse(read(path.join(root, 'scripts', 'rules-size-baseline.json')));

const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md')).map(f => path.join(rulesDir, f)).concat([rulesMd]);
const buckets = { inject: [], conditional: [], archive: [] };
for (const f of files) {
    const text = read(f);
    const hasFm = text.startsWith('---');
    const head = hasFm ? text.slice(3, text.indexOf('\n---', 3)) : '';
    if (!hasFm) buckets.archive.push(f);
    else if (/alwaysApply\s*:\s*false/.test(head) || /globs\s*:/.test(head)) buckets.conditional.push(f);
    else buckets.inject.push(f);
}
const sum = list => list.reduce((a, f) => a + bytes(f), 0);
const core = read(path.join(rulesDir, 'project-rules-core.md'));
const inject = sum(buckets.inject);
const cond = sum(buckets.conditional);

const pct = (a, b) => (b ? (a * 100 / b).toFixed(1) : '0.0');
const today = new Date().toISOString().slice(0, 10);

console.log('# 规则体系体检 · ' + today);
console.log('');
console.log(`- inject ${inject}B / ${baseline.l0.targetBytes}B 目标位（${pct(inject, baseline.l0.targetBytes)}%）/ 30720B 硬上限`);
console.log(`- conditional ${cond}B / 2048B（${pct(cond, 2048)}%）`);
console.log(`- archive ${sum(buckets.archive)}B（不计体积，${buckets.archive.length} 文件）`);
console.log(`- 常驻文件 ${buckets.inject.length}/${baseline.l0.maxFiles} · core 章节 ${(core.match(/^## /gm) || []).length}/${baseline.l0.maxItems}`);
console.log(`- 水位 ${baseline.injectBytes}B（更新于 ${baseline.updatedAt}）· 差额 ${inject - baseline.injectBytes}B`);
console.log('');
console.log('## 台账行（粘贴到 tech-debt / HANDOFF）');
console.log(`| ${today} | inject ${inject}B（目标 12288B，${pct(inject, 12288)}%）/ conditional ${cond}B | 常驻 ${buckets.inject.length} 文件·${(core.match(/^## /gm) || []).length} 章节 | 注入但从不命中：待人工按会话日志填写 |`);
console.log('');
console.log('## 文件明细');
for (const f of buckets.inject) console.log(`- [inject] ${rel(f)} ${bytes(f)}B`);
for (const f of buckets.conditional) console.log(`- [conditional] ${rel(f)} ${bytes(f)}B`);
for (const f of buckets.archive) console.log(`- [archive] ${rel(f)} ${bytes(f)}B`);
