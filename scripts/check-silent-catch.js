// 空 catch 增量门（2026-11-11 代码卫生 A1）：只拦「新增」，不追溯存量
//
// 判据：
//   ①[BASELINE-MISSING] 基线文件缺失 → FAIL（先跑 `node scripts/check-silent-catch.js --write`）
//   ②[NEW-SILENT-CATCH] 某文件空 catch 数 > 基线，或出现基线里没有的新文件 → FAIL
//   ③[TOTAL-DECREASE] 总数少于基线 → 只提示（INFO），不失败；可择机 --write 刷新基线
// 统计口径（两种形态）：
//   - 空块：`catch (e) {}`
//   - 空箭头：`.catch(() => {})`
// 扫描范围：miniprogram/ 与 cloudfunctions/ 下的 *.js，排除 *.test.js 与构建产物目录。
// 说明：不判断「该不该吞」，只保证不继续变多；确属有意的降级保留在基线内即可。
// 自测：RULES_ROOT 指向临时夹具（scripts/check-silent-catch.test.js）
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'scripts');
const baselinePath = path.join(scriptsDir, 'silent-catch-baseline.json');
const SCAN_DIRS = ['miniprogram', 'cloudfunctions'];
const SKIP_DIR = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|miniprogram_npm|\.backup-lark/;

const EMPTY_BLOCK = /catch\s*\([^)]*\)\s*\{\s*\}/g;
const EMPTY_ARROW = /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g;

const countIn = text => (text.match(EMPTY_BLOCK) || []).length + (text.match(EMPTY_ARROW) || []).length;

// 递归扫描，返回 { '相对路径': 命中数 }
function scan() {
    const out = {};
    const walk = dir => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            const rel = path.relative(root, p).replace(/\\/g, '/');
            if (SKIP_DIR.test(rel)) continue;
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue;
            const n = countIn(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
            if (n > 0) out[rel] = n;
        }
    };
    for (const d of SCAN_DIRS) walk(path.join(root, d));
    return out;
}

const current = scan();
const total = Object.values(current).reduce((a, b) => a + b, 0);

// --write：生成/刷新基线
if (process.argv.includes('--write')) {
    fs.mkdirSync(scriptsDir, { recursive: true });
    const files = {};
    for (const k of Object.keys(current).sort()) files[k] = current[k];
    fs.writeFileSync(baselinePath, JSON.stringify({
        note: '空 catch 增量门基线（只增不追溯）。刷新：node scripts/check-silent-catch.js --write',
        generated_at: new Date().toISOString().slice(0, 10),
        patterns: ['catch (e) {}', '.catch(() => {})'],
        total,
        files,
    }, null, 2) + '\n', 'utf8');
    console.log(`SILENT-CATCH BASELINE WRITTEN: ${total} 处 / ${Object.keys(files).length} 文件`);
    process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
    console.error('FAIL [BASELINE-MISSING] 缺少 scripts/silent-catch-baseline.json，先执行 node scripts/check-silent-catch.js --write');
    process.exit(1);
}

let baseline;
try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
} catch (e) {
    console.error(`FAIL [BASELINE-BROKEN] 基线文件无法解析：${e.message}`);
    process.exit(1);
}
const base = baseline.files || {};
const fails = [];

for (const [file, n] of Object.entries(current)) {
    const allowed = base[file] || 0;
    if (n > allowed) {
        fails.push(`[NEW-SILENT-CATCH] ${file} 空 catch ${n} 处 > 基线 ${allowed}（+${n - allowed}）；请补日志或说明后更新基线`);
    }
}

const baseTotal = typeof baseline.total === 'number' ? baseline.total : Object.values(base).reduce((a, b) => a + b, 0);
if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
if (total < baseTotal) {
    console.log(`INFO [TOTAL-DECREASE] 空 catch 由基线 ${baseTotal} 降至 ${total}，建议 node scripts/check-silent-catch.js --write 刷新基线`);
}
console.log(`SILENT-CATCH OK: ${total} 处 / ${Object.keys(current).length} 文件（基线 ${baseTotal}，未新增）`);
process.exit(0);
