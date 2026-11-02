// 规则体系体积门禁（2026-11-01 口径修正：按「是否真的注入模型」分桶计量 + 核心/索引/归档覆盖自检，无第三方依赖）
// 旧口径问题（实测）：.trae/rules 目录全量 + rules.md 一起按 30KB 计，其中 8118B（26.5%）从不注入模型
//   （.trae/rules.md 无 front-matter、miniprogram-config-guard.md 为 alwaysApply:false 的 globs 定向规则）；
//   且按磁盘字节计，Windows autocrlf 检出成 CRLF 时会凭空多出「行数」字节（5 文件 379 行 = +379B），
//   足以让新电脑首次 verify 在上限处假红（30656 + 379 = 31035 > 30720）。
// 现口径：①INJECT 桶 = front-matter alwaysApply:true（真正常驻注入）≤ 30KB；②CONDITIONAL 桶 = alwaysApply:false（globs 定向）≤ 2KB；
//   ③ARCHIVE 桶 = 无 front-matter（不注入）不计体积，但必须被某个 INJECT 文件按路径引用，否则 FAIL[ORPHAN]
//   （「写了但永不可见」的规则是最危险的，显式登记在 KNOWN_ORPHANS 的待清项只告警）。
// 字节一律按 LF 归一化后计，与 git 检出时的行尾无关。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rulesDir = path.join(root, '.trae', 'rules');
const rulesMd = path.join(root, '.trae', 'rules.md');
const corePath = path.join(rulesDir, 'project-rules-core.md');
const indexPath = path.join(rulesDir, 'project_rules-20261013.md');
const archivePath = path.join(root, '.trae', 'documents', 'project-rules-full-20261029.md');

const INJECT_LIMIT = 30 * 1024;      // 常驻注入预算（数值沿用原 30720B，只是不再把不注入的文件算进来）
const CONDITIONAL_LIMIT = 2 * 1024;  // globs 定向规则上限
// 已知「不注入且无引用」待清项：显式登记并只告警，禁止静默豁免（P1 把 rules.md 改成指针后删除本条）
const KNOWN_ORPHANS = {
    '.trae/rules.md': '待 P1 指针化；当前由下方 [RULESMD] 三章关键词校验兜住',
};

const fails = [];
const warns = [];

// LF 归一化 + 去 BOM 后的 UTF-8 字节数：跨机（CRLF/LF 检出）与中文编辑工具补 BOM 均不影响结果
// （2026-11-01 负向测试实证：带 BOM 的文件会被 startsWith('---') 误判成无 front-matter，故先剥 BOM）
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const bytes = p => Buffer.from(read(p), 'utf8').length;

// 解析 front-matter（只有文件首行是 --- 才算），返回 alwaysApply 取值与是否含 globs
const frontMatter = p => {
    const text = read(p);
    if (!text.startsWith('---')) return { present: false, alwaysApply: null, globs: false };
    const end = text.indexOf('\n---', 3);
    const head = end < 0 ? '' : text.slice(3, end);
    const m = /alwaysApply\s*:\s*([a-zA-Z]+)/.exec(head);
    return { present: true, alwaysApply: m ? m[1].toLowerCase() : null, globs: /globs\s*:/.test(head) };
};

const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md')).map(f => path.join(rulesDir, f));
const allFiles = ruleFiles.concat([rulesMd]);
const inject = [], conditional = [], archive = [];
for (const f of allFiles) {
    const fm = frontMatter(f);
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (!fm.present) { archive.push(f); continue; }
    if (fm.alwaysApply === 'false' || (fm.alwaysApply === null && fm.globs)) { conditional.push(f); continue; }
    // alwaysApply:true 或解析不出（fail-closed：宁可当注入来卡体积，也不静默放行）
    inject.push(f);
    if (fm.alwaysApply === null) warns.push(`[WARN] ${rel} front-matter 无 alwaysApply 且无 globs，已按注入桶计（fail-closed）`);
}

const sum = list => list.reduce((a, f) => a + bytes(f), 0);
const detail = list => list.map(f => path.basename(f) + '=' + bytes(f)).join(', ');
const injectTotal = sum(inject);
const condTotal = sum(conditional);

if (injectTotal > INJECT_LIMIT) fails.push(`[SIZE] 常驻注入桶 ${injectTotal}B > ${INJECT_LIMIT}B（${detail(inject)}）`);
if (condTotal > CONDITIONAL_LIMIT) fails.push(`[CONDITIONAL] globs 定向桶 ${condTotal}B > ${CONDITIONAL_LIMIT}B（${detail(conditional)}）`);

// 归档桶不计体积，但必须被某个注入文件按相对路径或文件名引用
const injectText = inject.map(f => read(f)).join('\n');
for (const f of archive) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (injectText.includes(rel) || injectText.includes(path.basename(f))) continue;
    const known = KNOWN_ORPHANS[rel];
    if (known) { warns.push(`[ORPHAN-KNOWN] ${rel} 未被任何注入文件引用：${known}`); continue; }
    fails.push(`[ORPHAN] ${rel} 既不被注入也未被引用（规则写了但模型永不可见）`);
}

const core = read(corePath);
const index = read(indexPath);
const archiveText = fs.existsSync(archivePath) ? read(archivePath) : '';

// 索引支持「区间映射」（2026-11-02 S1）：如 `§0–§9`、`§10–§34`；覆盖判据按区间认，不再要求逐节 `| §N |` 行
const intervals = [];
for (const m of index.matchAll(/§\s*(\d+)\s*[–—\-~]\s*§?\s*(\d+)/g)) {
    intervals.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
}
const coveredByInterval = n => intervals.some(([a, b]) => n >= a && n <= b);

for (let n = 0; n <= 9; n++) {
    if (!core.includes(`## ${n}.`)) fails.push(`[CORE] project-rules-core.md 缺少核心节标题 "## ${n}."`);
}

// 上限不再硬编码：由 core / 索引 / 归档三处现有的最大 §N 自动推导，并纳入索引区间上界
// （区间上界也参与推导：若索引声明到 §35 而归档无 §35 正文，则由下面 [ARCHIVE] 拦下，不留静默空洞）
const sectionNums = [core, index, archiveText].map(t => {
    const m = t.match(/^## [0-9]+\./gm) || [];
    return m.length ? Math.max(...m.map(s => parseInt(s.replace(/\D/g, ''), 10))) : 0;
});
const intervalMax = intervals.length ? Math.max(...intervals.map(i => i[1])) : 0;
const maxSection = Math.max(...sectionNums, intervalMax);

for (let n = 10; n <= maxSection; n++) {
    if (!core.includes(`## ${n}.`) && !index.includes(`| §${n} |`) && !coveredByInterval(n)) {
        fails.push(`[COVERAGE] §${n} 未出现在 project-rules-core.md，也未被 project_rules-20261013.md 的索引行或区间覆盖`);
    }
    if (!new RegExp(`^## ${n}\\.`, 'm').test(archiveText)) {
        fails.push(`[ARCHIVE] 归档缺少 §${n} 正文节（摘要与索引指向空锚点）`);
    }
}

for (const kw of ['不可变红线', 'MVP 禁做清单', '技术栈']) {
    if (!read(rulesMd).includes(kw)) fails.push(`[RULESMD] .trae/rules.md 缺少「${kw}」章节标题`);
}

for (const w of warns) console.error(w);
if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`RULES-SIZE OK inject ${injectTotal}B/${INJECT_LIMIT}B (${inject.map(f => path.basename(f)).join('+')}) | conditional ${condTotal}B/${CONDITIONAL_LIMIT}B | archive ${sum(archive)}B(不计) | max§ ${maxSection}`);
process.exit(0);
