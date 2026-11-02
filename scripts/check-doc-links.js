// 文档链接有效性门（T-7.40 防复发第 7 批）：live docs 的 file:/// 与相对链接必须真实存在
//
// 范围（只查「现行真值载体」，历史快照不查——过去写法不改写）：
//   docs/runbooks/**       运维与回归指引
//   docs/FUNCTION-REGISTRY.md / docs/tech-debt-inventory-*.md / docs/deploy-log.md
//   .trae/rules/** 与 .trae/rules.md（常驻规则与指针）
// 判据：剥掉 #锚点 后，file:/// 绝对路径或 markdown 相对路径必须能在磁盘命中（文件或目录均可）；
//       http(s)/mailto 不校验。命中失败 → FAIL[LINK]。
// 与 check-manual-links.js（只覆盖 docs/dev-manual 13 文件）互补，不重叠。
// 自测：RULES_ROOT 指向临时夹具（scripts/check-doc-links.test.js）
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const LIVE = [
    /^docs\/runbooks\/.+\.md$/,
    /^docs\/FUNCTION-REGISTRY\.md$/,
    /^docs\/tech-debt-inventory-[0-9]+\.md$/,
    /^docs\/deploy-log\.md$/,
    /^\.trae\/rules\/.+\.md$/,
    /^\.trae\/rules\.md$/,
];
const SKIP = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]/;

const files = [];
(function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (SKIP.test(rel)) continue;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md') && LIVE.some(re => re.test(rel))) files.push(p);
    }
})(root);

const exists = p => { try { fs.statSync(p); return true; } catch (e) { return false; } };
const fails = [];
let linkCount = 0;

for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    const lines = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
    lines.forEach((ln, i) => {
        // file:/// 绝对路径（可能指向 repo 外）
        for (const m of ln.matchAll(/file:\/\/\/([^)\s"'`]+)/g)) {
            linkCount++;
            const raw = decodeURIComponent(m[1]).split('#')[0].replace(/\/+$/, '');
            const abs = raw.replace(/^c:/i, 'C:');
            if (!exists(abs)) fails.push(`[LINK] ${rel}:${i + 1} file:/// 目标不存在 → ${raw}`);
        }
        // markdown 相对链接（只校验本地文件类型，忽略 http(s)/mailto/纯锚点）
        for (const m of ln.matchAll(/\]\(([^)\s"'`]+)\)/g)) {
            const raw = m[1];
            if (/^(https?:|mailto:|file:|\/\/)/.test(raw)) continue;
            const t = raw.split('#')[0];
            if (!t) continue;
            linkCount++;
            if (!exists(path.resolve(path.dirname(f), t))) fails.push(`[LINK] ${rel}:${i + 1} 相对链接不存在 → ${raw}`);
        }
    });
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`DOC-LINKS OK: ${files.length} 个 live 文档 / ${linkCount} 条链接全部可达`);
process.exit(0);
