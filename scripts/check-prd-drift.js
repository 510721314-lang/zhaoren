// PRD 漂移防护门（2026-11-08）
//
// 设计原则：分层，不把判断性内容交给机器改。
//   ① 机械比对层：PRD 中可量化的断言 ↔ 代码/台账实际值（状态码、页面数、云函数目录数、集合数、配置键等）
//   ② 锚点层：PRD 引用的文件路径/行号、REGISTRY #N、§章节、附录X 必须真实存在；失效即报错
//
// 用法: node scripts/check-prd-drift.js
// 退出码: 0 = 无漂移且锚点全部有效 | 1 = 有漂移或锚点失效
// 环境变量: RULES_ROOT 可覆盖仓库根（自测夹具用）
//
// 说明：本脚本只读，不改 PRD、不改代码。判断性章节（现状/规划/冲突定性）不在自动修订范围，
//       PRD 维护触发条件见 docs/runbooks/prd-maintenance.md。

const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const PRD_REL = 'PRD/PRD.md';
const SKIP = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|\.backup-lark|[/\\]coverage[/\\]|miniprogram_npm/;

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const exists = (p) => { try { fs.statSync(p); return true; } catch (e) { return false; } };

let prd;
try {
    prd = read(PRD_REL);
} catch (e) {
    console.error(`FAIL [PRD] 无法读取 ${PRD_REL}：${e.message}`);
    process.exit(1);
}
const prdLines = prd.split('\n');
const fails = [];
const oks = [];

// ───────────────────────── 通用工具 ─────────────────────────

function findLine(re, from = 0) {
    for (let i = from; i < prdLines.length; i++) if (re.test(prdLines[i])) return i;
    return -1;
}

function lineNo(i) {
    return i >= 0 ? i + 1 : -1;
}

// 单值断言：PRD 写的 vs 实际值
function checkValue(tag, name, prdIdx, written, actual, evidence) {
    if (String(written) === String(actual)) {
        oks.push(`OK   [${tag}] ${name}：${actual}（PRD/PRD.md:${lineNo(prdIdx)} ↔ ${evidence}）`);
        return;
    }
    fails.push(
        `FAIL [DRIFT] ${tag} ${name}\n` +
        `  PRD 写的：${written}（PRD/PRD.md:${lineNo(prdIdx)}）\n` +
        `  实际是：${actual}\n` +
        `  依据：${evidence}`
    );
}

// 集合断言：PRD 清单 vs 实际清单
function checkList(tag, name, prdIdx, prdList, actualList, evidence) {
    const prdSet = new Set(prdList);
    const actSet = new Set(actualList);
    const missing = actualList.filter((x) => !prdSet.has(x));
    const extra = prdList.filter((x) => !actSet.has(x));
    if (!missing.length && !extra.length && prdList.length === actualList.length) {
        oks.push(`OK   [${tag}] ${name}：${actualList.length} 项一致（PRD/PRD.md:${lineNo(prdIdx)} ↔ ${evidence}）`);
        return;
    }
    fails.push(
        `FAIL [DRIFT] ${tag} ${name} 清单不一致\n` +
        `  PRD 写的（${prdList.length}）：${prdList.join('、') || '（空）'}（PRD/PRD.md:${lineNo(prdIdx)}）\n` +
        `  实际是（${actualList.length}）：${actualList.join('、') || '（空）'}\n` +
        `  差异：PRD 缺 [${missing.join('、') || '无'}]；PRD 多 [${extra.join('、') || '无'}]\n` +
        `  依据：${evidence}`
    );
}

// ───────────────────────── ① 机械比对层 ─────────────────────────

// 1) 订单状态码集合（对 order_state.js 的 OrderStatus typedef）
(function checkOrderStates() {
    const rel = 'cloudfunctions/order-action/order_state.js';
    let lines;
    try { lines = read(rel).split('\n'); } catch (e) {
        fails.push(`FAIL [DRIFT] STATES 无法读取 ${rel}：${e.message}`);
        return;
    }
    const typeIdx = lines.findIndex((l) => /@typedef\s*\{[^}]*\}\s*OrderStatus/.test(l));
    if (typeIdx < 0) {
        fails.push(`FAIL [DRIFT] STATES 未在 ${rel} 找到 OrderStatus typedef（锚点失效）`);
        return;
    }
    const actual = Array.from(lines[typeIdx].matchAll(/'(S[0-9._]+)'/g)).map((m) => m[1]);
    const titleIdx = findLine(/代码状态集合/);
    let prdIdx = titleIdx;
    while (prdIdx >= 0 && prdIdx < prdLines.length && !/`S\d/.test(prdLines[prdIdx])) prdIdx++;
    if (titleIdx < 0 || prdIdx >= prdLines.length) {
        fails.push('FAIL [DRIFT] STATES 未在 PRD 找到状态码集合行（锚点失效）');
        return;
    }
    const written = Array.from(prdLines[prdIdx].matchAll(/`(S[0-9._]+)`/g)).map((m) => m[1]);
    checkList('STATES', '订单状态码集合', prdIdx, written, actual, `${rel}:${typeIdx + 1}（OrderStatus typedef）`);
})();

// 2) 页面数（主包 / 分包 / 分包个数 / 合计）
(function checkPages() {
    const rel = 'miniprogram/app.json';
    let app;
    try { app = JSON.parse(read(rel)); } catch (e) {
        fails.push(`FAIL [DRIFT] PAGES 无法解析 ${rel}：${e.message}`);
        return;
    }
    const main = (app.pages || []).length;
    const subs = app.subPackages || [];
    const subPages = subs.reduce((n, s) => n + (s.pages || []).length, 0);
    const subPkgCount = subs.length;
    const total = main + subPages;
    const evidence = `${rel}:3（pages ${main} 项）; :24（subPackages ${subPkgCount} 个 / ${subPages} 页）`;

    const mainIdx = findLine(/^\|\s*主包页面\s*\|\s*\d+\s*\|/);
    const subIdx = findLine(/^\|\s*分包页面\s*\|\s*\d+\s*\|/);
    const totalIdx = findLine(/主包\s*\d+\s*页\s*\+\s*\d+\s*个分包.*合计\s*\d+\s*页/);

    const num = (i, re) => {
        if (i < 0) return null;
        const m = prdLines[i].match(re);
        return m ? Number(m[1]) : null;
    };
    if (mainIdx < 0) fails.push('FAIL [DRIFT] PAGES 未在 PRD 找到「主包页面」行（锚点失效）');
    else checkValue('PAGES', '主包页面数', mainIdx, num(mainIdx, /\|\s*主包页面\s*\|\s*(\d+)\s*\|/), main, evidence);

    if (subIdx < 0) fails.push('FAIL [DRIFT] PAGES 未在 PRD 找到「分包页面」行（锚点失效）');
    else checkValue('PAGES', '分包页面数', subIdx, num(subIdx, /\|\s*分包页面\s*\|\s*(\d+)\s*\|/), subPages, evidence);

    if (totalIdx < 0) {
        fails.push('FAIL [DRIFT] PAGES 未在 PRD 找到「主包 N 页 + M 个分包…合计 K 页」行（锚点失效）');
    } else {
        checkValue('PAGES', '主包页面数（15.1 叙述）', totalIdx, num(totalIdx, /主包\s*(\d+)\s*页/), main, evidence);
        checkValue('PAGES', '分包个数（15.1 叙述）', totalIdx, num(totalIdx, /\+\s*(\d+)\s*个分包/), subPkgCount, evidence);
        checkValue('PAGES', '页面合计（15.1 叙述）', totalIdx, num(totalIdx, /合计\s*(\d+)\s*页/), total, evidence);
    }
})();

// 3) 云函数目录数（业务函数 = 目录数 - _shared）
(function checkCloudDirs() {
    const cfDir = path.join(root, 'cloudfunctions');
    let dirs;
    try {
        dirs = fs.readdirSync(cfDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (e) {
        fails.push(`FAIL [DRIFT] CLOUD 无法读取 cloudfunctions/：${e.message}`);
        return;
    }
    const total = dirs.length;
    const business = dirs.filter((d) => d !== '_shared').length;
    const evidence = 'cloudfunctions/（目录枚举）';

    const rowIdx = findLine(/^\|\s*云函数目录\s*\|/);
    if (rowIdx < 0) fails.push('FAIL [DRIFT] CLOUD 未在 PRD 找到「云函数目录」行（锚点失效）');
    else {
        const cells = prdLines[rowIdx].split('|').map((s) => s.trim());
        checkValue('CLOUD', '云函数目录数', rowIdx, Number(cells[2]), total, evidence);
        const biz = (cells[3] || '').match(/业务\s*(\d+)/);
        if (biz) checkValue('CLOUD', '业务函数数', rowIdx, Number(biz[1]), business, evidence);
    }

    const titleIdx = findLine(/云函数（\d+ 个业务函数）/);
    if (titleIdx >= 0) {
        checkValue('CLOUD', '业务函数数（15.2 标题）', titleIdx, Number(prdLines[titleIdx].match(/云函数（(\d+)\s*个业务函数）/)[1]), business, evidence);
    }
})();

// 4) 数据库集合（init-db 声明 + 运行时动态 + 合计）
(function checkCollections() {
    const initRel = 'cloudfunctions/init-db/index.js';
    let initText;
    try { initText = read(initRel); } catch (e) {
        fails.push(`FAIL [DRIFT] COLLECTIONS 无法读取 ${initRel}：${e.message}`);
        return;
    }
    const initLines = initText.split('\n');
    const startIdx = initLines.findIndex((l) => /const COLLECTIONS\s*=\s*\[/.test(l));
    const block = initText.match(/const COLLECTIONS\s*=\s*\[([\s\S]*?)\];/);
    if (startIdx < 0 || !block) {
        fails.push(`FAIL [DRIFT] COLLECTIONS 未在 ${initRel} 找到 COLLECTIONS 常量（锚点失效）`);
        return;
    }
    const declared = Array.from(block[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
    const declareEvidence = `${initRel}:${startIdx + 1}（COLLECTIONS 声明）`;

    // PRD 声明清单
    const declTitle = findLine(/`init-db`\s*声明\s*\d+\s*个/);
    let declIdx = declTitle;
    while (declIdx >= 0 && declIdx < prdLines.length && !/`[a-z_]+`、/.test(prdLines[declIdx])) declIdx++;
    if (declTitle < 0 || declIdx >= prdLines.length) {
        fails.push('FAIL [DRIFT] COLLECTIONS 未在 PRD 找到「init-db 声明 N 个」清单（锚点失效）');
    } else {
        const written = Array.from(prdLines[declIdx].matchAll(/`([a-z][a-z0-9_]+)`/g)).map((m) => m[1]);
        checkValue('COLLECTIONS', 'init-db 声明数', declTitle, Number(prdLines[declTitle].match(/声明\s*(\d+)\s*个/)[1]), declared.length, declareEvidence);
        checkList('COLLECTIONS', 'init-db 声明清单', declIdx, written, declared, declareEvidence);
    }

    // PRD 运行时动态清单
    const runTitle = findLine(/代码运行时另建\/使用的\s*\d+\s*个/);
    let runIdx = runTitle;
    while (runIdx >= 0 && runIdx < prdLines.length && !/`[a-z_]+`、/.test(prdLines[runIdx])) runIdx++;
    let runtime = [];
    if (runTitle < 0 || runIdx >= prdLines.length) {
        fails.push('FAIL [DRIFT] COLLECTIONS 未在 PRD 找到「运行时另建/使用 N 个」清单（锚点失效）');
    } else {
        runtime = Array.from(prdLines[runIdx].matchAll(/`([a-z][a-z0-9_]+)`/g)).map((m) => m[1]);
        checkValue('COLLECTIONS', '运行时动态集合数', runTitle, Number(prdLines[runTitle].match(/使用的\s*(\d+)\s*个/)[1]), runtime.length, 'PRD 清单逐项在代码中检索');
    }

    // 运行时集合必须：不在 init-db 声明中 + 在云函数代码中真实出现
    const codeHits = new Map();
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            const rel = path.relative(root, p).replace(/\\/g, '/');
            if (SKIP.test(rel)) continue;
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.js')) {
                const lines = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
                lines.forEach((l, i) => {
                    for (const name of runtime) {
                        if (!codeHits.has(name) && (l.includes(`'${name}'`) || l.includes(`"${name}"`))) {
                            codeHits.set(name, `${rel}:${i + 1}`);
                        }
                    }
                });
            }
        }
    })(path.join(root, 'cloudfunctions'));

    for (const name of runtime) {
        if (declared.includes(name)) {
            fails.push(`FAIL [DRIFT] COLLECTIONS ${name} 被 PRD 列为「运行时动态」，但 init-db 已声明（分类错误）`);
        } else if (!codeHits.has(name)) {
            fails.push(`FAIL [DRIFT] COLLECTIONS ${name} 在 cloudfunctions/ 代码中检索不到（PRD 写的运行时集合已失效）`);
        }
    }
    if (runtime.length) {
        const hit = runtime.filter((n) => codeHits.has(n)).length;
        if (hit === runtime.length) {
            oks.push(`OK   [COLLECTIONS] 运行时动态集合 ${hit}/${runtime.length} 均在代码中命中（${runtime.map((n) => codeHits.get(n)).join('; ')}）`);
        }
    }

    // 合计行 + §16.1 标题 + 第 15 章叙述
    const actualTotal = declared.length + runtime.length;
    const rowIdx = findLine(/^\|\s*数据库集合\s*\|/);
    if (rowIdx >= 0) {
        const m = prdLines[rowIdx].match(/(\d+)\s*声明\s*\+\s*(\d+)\s*运行时动态\s*=\s*(\d+)/);
        if (!m) fails.push(`FAIL [DRIFT] COLLECTIONS PRD:${rowIdx + 1} 合计行格式无法解析（锚点失效）`);
        else {
            checkValue('COLLECTIONS', '声明数（11.1 合计行）', rowIdx, Number(m[1]), declared.length, declareEvidence);
            checkValue('COLLECTIONS', '运行时数（11.1 合计行）', rowIdx, Number(m[2]), runtime.length, 'PRD 运行时清单');
            checkValue('COLLECTIONS', '集合合计（11.1 合计行）', rowIdx, Number(m[3]), actualTotal, 'init-db + 运行时清单');
        }
    } else {
        fails.push('FAIL [DRIFT] COLLECTIONS 未在 PRD 找到「数据库集合」合计行（锚点失效）');
    }

    const h161 = findLine(/^### 16\.1 集合清单（\d+ 个）/);
    if (h161 >= 0) checkValue('COLLECTIONS', '集合总数（16.1 标题）', h161, Number(prdLines[h161].match(/（(\d+) 个）/)[1]), actualTotal, 'init-db + 运行时清单');

    const c15 = findLine(/云数据库\s*\d+\s*个集合/);
    if (c15 >= 0) checkValue('COLLECTIONS', '集合总数（15.3 叙述）', c15, Number(prdLines[c15].match(/云数据库\s*(\d+)\s*个集合/)[1]), actualTotal, 'init-db + 运行时清单');
})();

// 5) 关键配置键（附录 J 表格逐键对 config_schema.js）
(function checkConfigKeys() {
    const rel = 'cloudfunctions/admin-action/config_schema.js';
    let schema;
    try { schema = read(rel); } catch (e) {
        fails.push(`FAIL [DRIFT] CONFIG 无法读取 ${rel}：${e.message}`);
        return;
    }
    const schemaKeys = new Set(Array.from(schema.matchAll(/\{ f: '([a-zA-Z0-9_]+)'/g)).map((m) => m[1]));
    const start = findLine(/^## 附录J/);
    const end = prdLines.findIndex((l, i) => i > start && /^## 附录K/.test(l));
    if (start < 0 || end < 0) {
        fails.push('FAIL [DRIFT] CONFIG 未找到附录 J 区域（锚点失效）');
        return;
    }
    const prdKeys = [];
    for (let i = start; i < end; i++) {
        const cells = prdLines[i].trim().split('|').map((s) => s.trim());
        if (cells.length < 4) continue; // 非表格行
        const keyCell = cells[2] || '';
        for (const m of keyCell.matchAll(/`([a-zA-Z][a-zA-Z0-9_]*)`/g)) prdKeys.push({ key: m[1], line: i + 1 });
    }
    let bad = 0;
    for (const k of prdKeys) {
        if (k.key === 'env') continue; // 环境变量不在 config_schema（云端 admin_config 特殊键）
        if (!schemaKeys.has(k.key)) {
            bad++;
            fails.push(
                `FAIL [DRIFT] CONFIG 配置键 ${k.key}\n` +
                `  PRD 写的：${k.key}（PRD/PRD.md:${k.line}）\n` +
                `  实际是：config_schema.js 无此键\n` +
                `  依据：${rel}:12（CONFIG_SCHEMA 数组）`
            );
        }
    }
    if (!bad) oks.push(`OK   [CONFIG] 附录 J 配置键 ${prdKeys.length} 个均在 config_schema.js 中（PRD/PRD.md:${start + 1}-${end} ↔ ${rel}:12）`);
})();

// 6) 台账条目数（FUNCTION-REGISTRY）
let registryIdSet = new Set();
let maxRegistryId = 0;
(function checkRegistryCount() {
    const rel = 'docs/FUNCTION-REGISTRY.md';
    let lines;
    try { lines = read(rel).split('\n'); } catch (e) {
        fails.push(`FAIL [DRIFT] REGISTRY 无法读取 ${rel}：${e.message}`);
        return;
    }
    const ids = [];
    lines.forEach((l) => {
        const m = l.match(/^\|\s*(\d+)\s*\|/);
        if (m) ids.push(Number(m[1]));
    });
    const valid = ids.filter((n) => n >= 1);
    registryIdSet = new Set(valid);
    maxRegistryId = valid.length ? Math.max(...valid) : 0;

    let found = 0;
    prdLines.forEach((l, i) => {
        if (!l.includes('FUNCTION-REGISTRY.md')) return;
        const m = l.match(/(\d+)\s*条/);
        if (!m) return;
        found++;
        checkValue('REGISTRY', '已验证功能条目数', i, Number(m[1]), valid.length, `${rel}（编号 ≥1 的表格行）`);
    });
    if (!found) fails.push('FAIL [DRIFT] REGISTRY PRD 中未找到「FUNCTION-REGISTRY.md（N 条）」断言（锚点失效）');
})();

// 7) 自定义组件数
(function checkComponents() {
    const dir = path.join(root, 'miniprogram/components');
    let actual;
    try {
        actual = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    } catch (e) {
        fails.push(`FAIL [DRIFT] COMPONENTS 无法读取 miniprogram/components/：${e.message}`);
        return;
    }
    const evidence = 'miniprogram/components/（目录枚举）';
    const a = findLine(/组件库：\d+\s*个自定义组件/);
    if (a >= 0) checkValue('COMPONENTS', '自定义组件数（9.1）', a, Number(prdLines[a].match(/组件库：(\d+)\s*个/)[1]), actual, evidence);
    const b = findLine(/^\|\s*自定义组件\s*\|\s*\d+\s*\|/);
    if (b >= 0) checkValue('COMPONENTS', '自定义组件数（11.1 表）', b, Number(prdLines[b].match(/\|\s*自定义组件\s*\|\s*(\d+)\s*\|/)[1]), actual, evidence);
    const c = findLine(/自定义组件\s*\d+\s*个（/);
    if (c >= 0) checkValue('COMPONENTS', '自定义组件数（15.1）', c, Number(prdLines[c].match(/自定义组件\s*(\d+)\s*个/)[1]), actual, evidence);
})();

// 8) 后台视图数（admin-web-frontend/src/views 下 .vue 文件）
(function checkAdminViews() {
    const dir = path.join(root, 'admin-web-frontend/src/views');
    let actual = 0;
    try {
        (function walk(d) {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) walk(p);
                else if (e.name.endsWith('.vue')) actual++;
            }
        })(dir);
    } catch (e) {
        fails.push(`FAIL [DRIFT] VIEWS 无法读取 admin-web-frontend/src/views/：${e.message}`);
        return;
    }
    const evidence = 'admin-web-frontend/src/views/（递归 .vue 文件）';
    const a = findLine(/，\d+\s*个视图/);
    if (a >= 0) checkValue('VIEWS', '后台视图数（5.1）', a, Number(prdLines[a].match(/，(\d+)\s*个视图/)[1]), actual, evidence);
    const b = findLine(/^\|\s*后台视图\s*\|\s*\d+\s*\|/);
    if (b >= 0) checkValue('VIEWS', '后台视图数（11.1 表）', b, Number(prdLines[b].match(/\|\s*后台视图\s*\|\s*(\d+)\s*\|/)[1]), actual, evidence);
    const c = findLine(/\|\s*\d+\s*视图\s*\+/);
    if (c >= 0) checkValue('VIEWS', '后台视图数（附录 T）', c, Number(prdLines[c].match(/\|\s*(\d+)\s*视图\s*\+/)[1]), actual, evidence);
})();

// ───────────────────────── ② 锚点层 ─────────────────────────

// 全仓文件索引（只建一次，供裸文件名锚点解析）
const fileIndex = new Map();
(function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (SKIP.test(rel)) continue;
        if (e.isDirectory()) walk(p);
        else {
            const arr = fileIndex.get(e.name) || [];
            arr.push(rel);
            fileIndex.set(e.name, arr);
        }
    }
})(root);

function resolveToken(tok) {
    const clean = tok.replace(/\/+$/, '');
    const cands = [
        clean,
        'miniprogram/' + clean,
        'cloudfunctions/' + clean,
        'admin-web-frontend/' + clean,
        'scripts/' + clean,
        'docs/' + clean,
    ];
    for (const c of cands) if (exists(path.join(root, c))) return c;
    const base = clean.split('/').pop();
    const hits = fileIndex.get(base);
    if (hits && hits.length) return hits[0]; // 同名多副本（如 order_state.js）任取其一，锚点只要求文件存在
    return null;
}

const anchorFails = [];
let fileAnchorCount = 0;
let registryAnchorCount = 0;
let sectionAnchorCount = 0;
let appendixAnchorCount = 0;

// 章节/附录标题索引
const appendixSet = new Set();
for (const l of prdLines) {
    const m = l.match(/^## 附录([A-Z])/);
    if (m) appendixSet.add(m[1]);
}
function hasSection(ref) {
    if (ref.includes('.')) {
        const re = new RegExp('^#{2,4}\\s*' + ref.replace(/\./g, '\\.') + '\\s');
        return prdLines.some((l) => re.test(l));
    }
    const n = Number(ref);
    if (prdLines.some((l) => new RegExp('^## ' + n + '\\.\\s').test(l))) return true;
    return prdLines.some((l) => {
        const m = l.match(/^## 第 (\d+) 章/);
        return m && Number(m[1]) === n;
    });
}

prdLines.forEach((ln, idx) => {
    const no = idx + 1;

    // 2.1 反引号内的文件/目录锚点（可带 :行号 或 :起-止 / :逗号分隔）
    for (const m of ln.matchAll(/`([^`\n]+)`/g)) {
        let tok = m[1].trim();
        if (!tok || /^(https?:|mailto:)/.test(tok) || tok.includes('*')) continue;
        let nums = [];
        const lm = tok.match(/^(.*?):([0-9][0-9,\-]*)$/);
        if (lm) {
            tok = lm[1];
            nums = lm[2].split(/[,\-]/).filter(Boolean).map(Number);
        }
        const known = /^(docs|cloudfunctions|miniprogram|admin-web-frontend|scripts|PRD|\.trae|\.predeploy)\//.test(tok);
        const hasExt = /\.(js|json|md|ps1|wxml|wxss|vue|csv|html|txt)$/.test(tok);
        if (!known && !hasExt) continue;

        const rel = resolveToken(tok);
        if (!rel) {
            anchorFails.push(`FAIL [ANCHOR] PRD/PRD.md:${no} 路径锚点失效 → ${m[1]}`);
            continue;
        }
        fileAnchorCount++;
        if (!nums.length) continue;
        const abs = path.join(root, rel);
        try {
            if (fs.statSync(abs).isDirectory()) continue;
            const count = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n').length;
            for (const n of nums) {
                if (n < 1 || n > count) {
                    anchorFails.push(`FAIL [ANCHOR] PRD/PRD.md:${no} 行号锚点越界 → ${m[1]}（实际 ${rel} 共 ${count} 行）`);
                }
            }
        } catch (e) {
            anchorFails.push(`FAIL [ANCHOR] PRD/PRD.md:${no} 行号锚点读取失败 → ${m[1]}（${e.message}）`);
        }
    }

    // 2.2 REGISTRY #N 锚点
    for (const m of ln.matchAll(/REGISTRY\s*#([0-9]+(?:\s*\/\s*#?[0-9]+)*)/g)) {
        for (const num of m[1].matchAll(/[0-9]+/g)) {
            const id = Number(num[0]);
            registryAnchorCount++;
            if (!registryIdSet.has(id)) {
                anchorFails.push(`FAIL [ANCHOR] PRD/PRD.md:${no} REGISTRY #${id} 不存在 → docs/FUNCTION-REGISTRY.md（有效编号 1..${maxRegistryId}）`);
            }
        }
    }

    // 2.3 §章节锚点
    for (const m of ln.matchAll(/§\s*([0-9]+(?:\.[0-9]+)?)/g)) {
        sectionAnchorCount++;
        if (!hasSection(m[1])) anchorFails.push(`FAIL [ANCHOR] PRD/PRD.md:${no} 章节锚点失效 → §${m[1]}`);
    }

    // 2.4 附录X 锚点（附录 C 在 PRD 中明确注明不存在，跳过该说明行）
    if (!/不存在附录/.test(ln)) {
        for (const m of ln.matchAll(/附录\s?([A-Z])((?:\s*\/\s*[A-Z])*)/g)) {
            const letters = (m[1] + (m[2] || '')).match(/[A-Z]/g) || [];
            for (const L of letters) {
                appendixAnchorCount++;
                if (!appendixSet.has(L)) anchorFails.push(`FAIL [ANCHOR] PRD/PRD.md:${no} 附录锚点失效 → 附录${L}`);
            }
        }
    }
});

// ───────────────────────── 输出 ─────────────────────────

for (const line of oks) console.log(line);

if (fails.length || anchorFails.length) {
    for (const line of fails) console.error(line);
    for (const line of anchorFails) console.error(line);
    console.error(`\nPRD DRIFT FAILED: ${fails.length} 处机械漂移 / ${anchorFails.length} 处锚点失效`);
    console.error('处理：机械漂移按「实际值」修订 PRD；锚点失效先修复引用或补台账条目。禁止绕过门禁。');
    process.exit(1);
}

console.log(`\n锚点层 OK: 文件/行 ${fileAnchorCount} 条、REGISTRY ${registryAnchorCount} 条、章节 ${sectionAnchorCount} 条、附录 ${appendixAnchorCount} 条，全部有效`);
console.log(`PRD DRIFT OK: 机械断言 ${oks.length} 项一致，无漂移`);
process.exit(0);
