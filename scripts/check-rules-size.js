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

// RULES_ROOT 仅供门禁自测（scripts/check-rules-size.test.js）指向临时夹具；生产恒为仓库根
const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const rulesDir = path.join(root, '.trae', 'rules');
const rulesMd = path.join(root, '.trae', 'rules.md');
const corePath = path.join(rulesDir, 'project-rules-core.md');
const indexPath = path.join(rulesDir, 'project_rules-20261013.md');
const archivePath = path.join(root, '.trae', 'documents', 'project-rules-full-20261029.md');

const INJECT_LIMIT = 30 * 1024;      // 常驻注入预算（数值沿用原 30720B，只是不再把不注入的文件算进来）
const CONDITIONAL_LIMIT = 2 * 1024;  // globs 定向规则上限
// 已知「不注入且无引用」待清项（2026-11-02 S3 已清零：.trae/rules.md 已指针化并被索引引用）
const KNOWN_ORPHANS = {};

const fails = [];
const warns = [];

// L0 常驻上限与水位（T-7.34）：baseline 缺失/不可解析即 FAIL（fail-closed，防静默放行）
const baselinePath = path.join(root, 'scripts', 'rules-size-baseline.json');
let baseline = null;
try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
} catch (e) {
    fails.push('[BASELINE] 缺少或无法解析 scripts/rules-size-baseline.json（T-7.34 水位门禁 fail-closed）');
}

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

// L0 常驻硬上限 + 水位门（T-7.34）：3 文件 / 22 条 / 12KB 目标位；超目标位后任何净新增一律拦（配额制）
if (baseline && baseline.l0) {
    const l0 = baseline.l0;
    if (inject.length > l0.maxFiles) fails.push(`[L0-FILES] 常驻注入文件 ${inject.length} 个 > 上限 ${l0.maxFiles}`);
    const coreSections = (core.match(/^## /gm) || []).length;
    if (coreSections > l0.maxItems) fails.push(`[L0-ITEMS] core 常驻章节 ${coreSections} 条 > 上限 ${l0.maxItems}`);
    if (injectTotal > l0.targetBytes) {
        warns.push(`[L0-TARGET] inject ${injectTotal}B 已超 12KB 目标位 ${l0.targetBytes}B：后续新增须先淘汰/下沉旧条`);
    }
    const growth = injectTotal - (baseline.injectBytes || 0);
    if (growth > (baseline.rateLimitBytes || 0)) {
        fails.push(`[RATE] inject 较水位净增 ${growth}B > ${baseline.rateLimitBytes}B/commit：先淘汰旧条，或显式更新 rules-size-baseline.json`);
    }
    if (injectTotal > l0.targetBytes && growth > 0) {
        fails.push(`[QUOTA] 已超 ${l0.targetBytes}B 目标位仍净增 ${growth}B（配额制：满额须先淘汰旧条再新增）`);
    }
    if (-growth > (baseline.staleToleranceBytes || 0)) {
        warns.push(`[BASELINE-STALE] inject 较水位缩小 ${-growth}B，请刷新 scripts/rules-size-baseline.json`);
    }
}

// T-7.36：conditional 速率门（硬上限仍由 CONDITIONAL_LIMIT 把，这里防「定向桶慢慢堆满」）
if (baseline) {
    const condGrowth = condTotal - (baseline.conditionalBytes || 0);
    if (condGrowth > (baseline.conditionalRateLimitBytes || 0)) {
        fails.push(`[RATE-COND] conditional 较水位净增 ${condGrowth}B > ${baseline.conditionalRateLimitBytes}B/commit（先删旧条或显式更新 baseline）`);
    }
    if (-condGrowth > (baseline.staleToleranceBytes || 0)) {
        warns.push(`[BASELINE-STALE] conditional 较水位缩小 ${-condGrowth}B，请刷新 scripts/rules-size-baseline.json`);
    }

    // T-7.36：全量归档增长门（归档不注入，但无限增长会拖慢 Grep/检索）
    const archiveFull = fs.existsSync(archivePath) ? bytes(archivePath) : 0;
    const archGrowth = archiveFull - (baseline.archiveFullBytes || 0);
    if (archGrowth > (baseline.archiveRateLimitBytes || 0)) {
        fails.push(`[RATE-ARCHIVE] 全量归档较水位净增 ${archGrowth}B > ${baseline.archiveRateLimitBytes}B/commit（新增规则应优先精简旧条）`);
    }

    // T-7.36：.trae/rules.md 指针防回退（禁止被写回正文）
    if (bytes(rulesMd) > (baseline.pointerMaxBytes || 0)) {
        fails.push(`[POINTER-SIZE] .trae/rules.md ${bytes(rulesMd)}B > 指针上限 ${baseline.pointerMaxBytes}B（疑似写回正文）`);
    }
    if (/^## /m.test(read(rulesMd))) {
        fails.push('[POINTER-BODY] .trae/rules.md 出现章节标题，指针文件被写回正文');
    }
}

// .trae/rules.md 已指针化（2026-11-02 S3）：只校验它仍指向 core/归档，正文不再驻留本文件
for (const kw of ['project-rules-core.md', 'project-rules-full-20261029.md']) {
    if (!read(rulesMd).includes(kw)) fails.push(`[RULESMD] .trae/rules.md 指针缺少对「${kw}」的引用`);
}
// 业务红线已迁入 core 常驻（附录A）：防搬迁丢失，锁标题 + 首条 + 末条三处锚点
for (const kw of ['附录A · 不可变红线', '订单 13 态状态机', '系统默认评价']) {
    if (!core.includes(kw)) fails.push(`[CORE] project-rules-core.md 附录A 缺少「${kw}」（业务红线搬迁丢失）`);
}

for (const w of warns) console.error(w);
if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`RULES-SIZE OK inject ${injectTotal}B/${INJECT_LIMIT}B (${inject.map(f => path.basename(f)).join('+')}) | conditional ${condTotal}B/${CONDITIONAL_LIMIT}B | archive ${sum(archive)}B(不计) | max§ ${maxSection}`);
process.exit(0);
