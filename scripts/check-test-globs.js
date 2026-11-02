// 测试挂载门（T-7.43 防复发第 10 批）：仓库里每个 *.test.js 必须被 npm test 的 glob 覆盖
//
// 判据：
//   ①[TEST-GLOB]  存在 *.test.js 未被 `scripts.test` 中任何 glob 命中 → FAIL（写了测试但永远不跑）
//   ②[GLOB-EMPTY] scripts.test 中某 glob 一个文件都命中不到 → FAIL（配置失效或目录被清空）
// 说明：只支持 `*`（同层任意）与 `**`（跨层任意）两种通配；排除 node_modules/.git/dist/public/.backup-lark/coverage/miniprogram_npm
// 自测：RULES_ROOT 指向临时夹具（scripts/check-test-globs.test.js）
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const SKIP_DIR = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|\.backup-lark|[/\\]coverage[/\\]|miniprogram_npm/;

const fails = [];
let testCmd = '';
try {
    testCmd = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.test || '';
} catch (e) {
    console.error(`FAIL [PKG] 无法解析 package.json：${e.message}`);
    process.exit(1);
}

// 从 test 命令中提取所有 *.test.js glob（形如 "cloudfunctions/_shared/*.test.js"）
const globs = [...testCmd.matchAll(/"([^"]*\.test\.js)"/g)].map(m => m[1].replace(/\\/g, '/'));
if (!globs.length) {
    console.error('FAIL [GLOB-EMPTY] scripts.test 未声明任何 *.test.js glob');
    process.exit(1);
}
const toRe = g => new RegExp('^' + g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@DEEP@@')    // `**/` 允许零层或多层子目录（与常见 glob 语义一致）
    .replace(/\*\*/g, '@@ANY@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DEEP@@/g, '(?:.*/)?')
    .replace(/@@ANY@@/g, '.*') + '$');

const files = [];
(function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (SKIP_DIR.test(rel)) continue;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.test.js')) files.push(rel);
    }
})(root);

for (const g of globs) {
    if (!files.some(f => toRe(g).test(f))) {
        fails.push(`[GLOB-EMPTY] glob "${g}" 未命中任何 *.test.js（配置失效）`);
    }
}

for (const f of files) {
    if (!globs.some(g => toRe(g).test(f))) {
        fails.push(`[TEST-GLOB] ${f} 未被 scripts.test 的 glob 覆盖（写了测试但永远不跑）`);
    }
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`TEST-GLOBS OK: ${files.length} 个 *.test.js 全部被 ${globs.length} 条 glob 覆盖（${globs.join(' + ')}）`);
process.exit(0);
