// 台账占位符与冲突标记门（T-7.42 防复发第 9 批）：防「未闭合占位」与「合并冲突」静默入库
//
// 判据：
//   ①[CONFLICT]  全仓文本文件出现 Git 冲突标记 `<<<<<<< ` / `>>>>>>> ` → FAIL（`=======` 单独不判，避免 Markdown 下划线误报）
//   ②[COMMIT-TODO] 全仓出现 `commit `待填`` 类未闭合提交号占位 → FAIL
//   ③[PLACEHOLDER] **最新 HANDOFF**（按文件名日期取最大）出现 `待填` / `TBD` / `TODO` → FAIL
//      （历史 HANDOFF 与 CHANGELOG 是追加型快照，内含「TBD 结案」等历史叙述，不查）
// 排除：node_modules/.git/dist/public/.backup-lark，以及本门禁脚本与自测自身（模式字符串误报）
// 自测：RULES_ROOT 指向临时夹具（scripts/check-ledger-placeholders.test.js）
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const SKIP_DIR = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|\.backup-lark/;
const SELF = /^scripts\/check-ledger-placeholders(\.test)?\.js$/;
const TEXT_EXT = /\.(js|cjs|mjs|json|md|ps1|sh|yml|yaml|txt|wxml|wxss|wxs|html|vue|env|cfg|ini|csv)$/i;

const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (SKIP_DIR.test(rel)) continue;
        if (e.isDirectory()) walk(p);
        else if (TEXT_EXT.test(e.name) || e.name === '.env') files.push(p);
    }
})(root);

// 最新 HANDOFF：按文件名中的 8 位日期取最大
const docsDir = path.join(root, 'docs');
const handoffs = fs.existsSync(docsDir)
    ? fs.readdirSync(docsDir).filter(f => /^HANDOFF-\d{8}(-v\d+)?\.md$/.test(f))
        .map(f => ({ f, key: (f.match(/\d{8}/) || [''])[0] }))
        .sort((a, b) => a.key.localeCompare(b.key))
    : [];
const newest = handoffs.length ? path.join(docsDir, handoffs[handoffs.length - 1].f) : null;

const fails = [];
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (SELF.test(rel)) continue;
    const lines = read(f).split('\n');
    lines.forEach((ln, i) => {
        if (/^(<<<<<<< |>>>>>>> )/.test(ln)) fails.push(`[CONFLICT] ${rel}:${i + 1} Git 冲突标记`);
        if (/commit\s*[`「]?待填/.test(ln)) fails.push(`[COMMIT-TODO] ${rel}:${i + 1} 提交号仍为「待填」占位`);
    });
}

if (newest) {
    const rel = path.relative(root, newest).replace(/\\/g, '/');
    read(newest).split('\n').forEach((ln, i) => {
        if (/待填|TBD|TODO/.test(ln)) fails.push(`[PLACEHOLDER] ${rel}:${i + 1} 现行台账残留占位（待填/TBD/TODO）`);
    });
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`LEDGER OK: ${files.length} 文件无冲突标记/未闭合提交号；最新台账 ${newest ? path.basename(newest) : '(无)'} 无占位残留`);
process.exit(0);
