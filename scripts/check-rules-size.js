// 规则体系瘦身门禁：常驻规则总体积 + 核心/索引覆盖自检（无第三方依赖）
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rulesDir = path.join(root, '.trae', 'rules');
const rulesMd = path.join(root, '.trae', 'rules.md');
const corePath = path.join(rulesDir, 'project-rules-core.md');
const indexPath = path.join(rulesDir, 'project_rules-20261013.md');

const fails = [];
const sizeOf = p => fs.statSync(p).size;

const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md')).map(f => path.join(rulesDir, f));
let total = 0;
for (const f of ruleFiles) total += sizeOf(f);
total += sizeOf(rulesMd);

const LIMIT = 30 * 1024;
if (total > LIMIT) fails.push(`[SIZE] 常驻规则总体积 ${total}B > ${LIMIT}B（${ruleFiles.concat([rulesMd]).map(f => path.basename(f) + '=' + sizeOf(f)).join(', ')}）`);

const core = fs.readFileSync(corePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const slim = fs.readFileSync(rulesMd, 'utf8');

for (let n = 0; n <= 9; n++) {
    if (!core.includes(`## ${n}.`)) fails.push(`[CORE] project-rules-core.md 缺少核心节标题 "## ${n}."`);
}
for (let n = 10; n <= 33; n++) {
    if (!core.includes(`## ${n}.`) && !index.includes(`| §${n} |`)) {
        fails.push(`[COVERAGE] §${n} 未出现在 project-rules-core.md 或 project_rules-20261013.md 索引`);
    }
}
for (const kw of ['不可变红线', 'MVP 禁做清单', '技术栈']) {
    if (!slim.includes(kw)) fails.push(`[RULESMD] .trae/rules.md 缺少「${kw}」章节标题`);
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`RULES-SIZE OK ${total}B / core ${sizeOf(corePath)}B / index ${sizeOf(indexPath)}B / rules.md ${sizeOf(rulesMd)}B`);
process.exit(0);
