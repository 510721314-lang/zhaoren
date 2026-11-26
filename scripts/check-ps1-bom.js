// .ps1 BOM 复检门（P3-48 / 6.6 防复发）：防含中文的 PowerShell 脚本缺 BOM 致 PS5 ParserError
//
// 背景：2026-11 PS5 下含中文的 .ps1 若缺 UTF-8 BOM（EF BB BF）会抛 ParserError（project_memory 实证）。
// 判据：缺 BOM 且文件含非 ASCII 字节（>0x7F）→ FAIL [BOM-MISSING]。
//   - 纯 ASCII 的 .ps1 缺 BOM 不强制（存量 sync-*.ps1 多为生成产物，纯 ASCII 不会触发 ParserError，避免误报）。
//   - 已有 BOM → OK。
// 排除：node_modules/.git/dist/public/.backup-lark/.tmp-tcb
// 自测：RULES_ROOT 指向临时夹具
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const SKIP_DIR = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|\.backup-lark|\.tmp-tcb/;

const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (SKIP_DIR.test(rel)) continue;
        if (e.isDirectory()) walk(p);
        else if (/\.ps1$/i.test(e.name)) files.push(p);
    }
})(root);

const fails = [];
let pureAsciiNoBom = 0;
for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    const b = fs.readFileSync(f);
    const hasBom = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    if (hasBom) continue;
    const hasNonAscii = b.some(x => x > 0x7F);
    if (hasNonAscii) fails.push(`[BOM-MISSING] ${rel} 含非 ASCII 字符但缺 UTF-8 BOM（PS5 会 ParserError）`);
    else pureAsciiNoBom++;
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`PS1-BOM OK: ${files.length} 个 .ps1 已检（含非 ASCII 的均带 BOM；${pureAsciiNoBom} 个纯 ASCII 无 BOM 不强制）`);
process.exit(0);
