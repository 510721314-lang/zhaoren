// 规则引用门禁（T-7.37 防复发第 4 批）：扫描全仓 `§N` 引用，确保每个被引用的节真实存在
//
// 判据：
//   ① n ≤ maxSection（core §0–§9 + 归档 §10–§34 的最大编号）：必须能找到正文节（core `## n.` 或归档 `## n.`），否则 FAIL[REF]
//   ② n > maxSection：属「未来节」，必须紧跟「起」字（如「新增 §35 起」）显式标注为前向声明，否则 FAIL[FORWARD]
// 跳过：node_modules / .git / dist / public / _orig_baseline.js（冻结基线不参与维护）
// 自测：RULES_ROOT 指向临时夹具（scripts/check-rule-refs.test.js）
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const corePath = path.join(root, '.trae', 'rules', 'project-rules-core.md');
const archivePath = path.join(root, '.trae', 'documents', 'project-rules-full-20261029.md');
const SCAN_DIRS = ['docs', '.trae', 'cloudfunctions', 'miniprogram'];
const SKIP = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|_orig_baseline\.js/;
// 历史不可变载体（追加型台账/快照）不参与断链校验：过去写法不改写，断链无修复意义
const SKIP_HISTORY = /^docs\/(CHANGELOG\.md|HANDOFF-[0-9]+(?:-v\d+)?\.md|session-log\/|backup-report-[0-9]+\.md|tech-debt-delivery-report-[0-9]+\.md)/;

const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const fails = [];

const core = fs.existsSync(corePath) ? read(corePath) : '';
const archive = fs.existsSync(archivePath) ? read(archivePath) : '';
const sectionNums = [core, archive].map(t => {
    const m = t.match(/^## [0-9]+\./gm) || [];
    return m.length ? Math.max(...m.map(s => parseInt(s.replace(/\D/g, ''), 10))) : 0;
});
const maxSection = Math.max(...sectionNums);
const hasSection = n => (n <= 9 ? core.includes(`## ${n}.`) : new RegExp(`^## ${n}\\.`, 'm').test(archive));

const files = [];
(function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (SKIP.test(p.replace(/\\/g, '/'))) continue;
        if (e.isDirectory()) walk(p);
        else if (/\.(md|js)$/.test(e.name)) files.push(p);
    }
})(root);

let refCount = 0;
for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (!SCAN_DIRS.some(d => rel.startsWith(d + '/') || rel === d)) continue;
    if (SKIP_HISTORY.test(rel)) continue;
    const lines = read(f).split('\n');
    lines.forEach((ln, i) => {
        const re = /§\s?([0-9]+)\s*(起)?/g;
        let m;
        while ((m = re.exec(ln))) {
            const n = parseInt(m[1], 10);
            refCount++;
            if (n <= maxSection) {
                if (!hasSection(n)) fails.push(`[REF] ${rel}:${i + 1} §${n} 无正文节（core/归档均不存在）`);
            } else if (!m[2]) {
                fails.push(`[FORWARD] ${rel}:${i + 1} §${n} 超出 max§${maxSection} 且未标注「起」（前向声明须写「§${n} 起」）`);
            }
        }
    });
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`RULE-REFS OK: 扫描 ${files.length} 文件 / ${refCount} 处 §N 引用，全部有主（max§ ${maxSection}）`);
process.exit(0);
