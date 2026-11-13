// 测试用例清单门（2026-11-13 防复发）：把每个 *.test.js 的用例标题锁进清单，静默删改一律 FAIL
//
// 背景（实证根因）：Edit 按字符串精确替换，若替换块未包含原有用例，用例会被静默删除且门禁仍全绿。
//   2026-11-13 实测：C27「改费用提交载荷」被 C28-C30 的新增整块替换掉，全量跑出 940 例（应 941），
//   无任何检查报警；仅因人工核对 test() 数量才被发现。
// 判据：
//   ①[TEST-LOST]         清单中的用例标题在当前文件中找不到（被删除或改名）
//   ②[TEST-FILE-LOST]    清单中的测试文件已不存在
//   ③[TEST-UNREGISTERED] 当前新增用例未登记清单（新增须显式 --update，避免"顺手覆盖"）
// 用法：node scripts/check-test-manifest.js [--update]
// 自测：RULES_ROOT 指向临时夹具（scripts/check-test-manifest.test.js）
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'scripts', 'test-manifest.json');
const SKIP_DIR = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|\.backup-lark|[/\\]coverage[/\\]|miniprogram_npm/;
// 与仓库既有写法一致：行首 test('标题', ...)
const TITLE_RE = /^\s*test\(\s*'((?:[^'\\]|\\.)*)'/;

function collect() {
    const out = {};
    (function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            const rel = path.relative(root, p).replace(/\\/g, '/');
            if (SKIP_DIR.test(rel)) continue;
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.test.js')) continue;
            out[rel] = fs.readFileSync(p, 'utf8').split(/\r?\n/)
                .map(l => { const m = TITLE_RE.exec(l); return m ? m[1] : null; })
                .filter(Boolean);
        }
    })(root);
    return out;
}

const current = collect();

if (process.argv.includes('--update')) {
    const sorted = {};
    for (const f of Object.keys(current).sort()) sorted[f] = current[f];
    fs.writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
    const total = Object.values(sorted).reduce((n, a) => n + a.length, 0);
    console.log(`TEST-MANIFEST UPDATED: ${Object.keys(sorted).length} 文件 / ${total} 用例 → scripts/test-manifest.json`);
    process.exit(0);
}

let baseline;
try {
    baseline = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
    console.error(`FAIL [MANIFEST] 无法读取 scripts/test-manifest.json：${e.message}（首次生成用 --update）`);
    process.exit(1);
}

const fails = [];
let checked = 0;
for (const [file, titles] of Object.entries(baseline)) {
    if (!current[file]) {
        fails.push(`[TEST-FILE-LOST] ${file} 已不存在（连带其 ${titles.length} 个用例）`);
        continue;
    }
    for (const t of titles) {
        checked++;
        if (!current[file].includes(t)) fails.push(`[TEST-LOST] ${file} 缺少用例「${t}」（被删除或改名）`);
    }
}

const known = new Set(Object.keys(baseline).reduce((acc, f) => acc.concat(baseline[f].map(t => f + '::' + t)), []));
for (const [file, titles] of Object.entries(current)) {
    for (const t of titles) {
        if (!known.has(file + '::' + t)) fails.push(`[TEST-UNREGISTERED] ${file} 新增用例「${t}」未登记（确认无误后跑 --update）`);
    }
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    console.error('修复：合法删改/新增请跑 node scripts/check-test-manifest.js --update 并 review diff；否则恢复被删用例。');
    process.exit(1);
}
console.log(`TEST-MANIFEST OK: ${Object.keys(current).length} 文件 / ${checked} 用例与清单一致`);
process.exit(0);
