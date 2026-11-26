// 台账头部一致性门（P3-47，防 6.2「真值管理工具自身失准」复发）
//
// 判据：
//   一期（指针）：
//     ①[STALE-POINTER] docs/ 下最新 tech-debt-inventory-YYYYMMDD.md 的头部「现行唯一台账」
//       声明若明确指向另一个台账文件名 → FAIL（指针过时，会把读者引到已降归档的旧文件）
//     ②[NO-DECL]       最新台账头部缺失「现行唯一台账」声明 → FAIL（防头部被清空后无人发现）
//   二期（计数对齐，2026-11-26 实现）：头部「关键计数」表的数值必须与实测真值一致，否则 FAIL，
//       防人工填写后真值变化未同步（6.2 类「计数类脱节」复发）。守护项：
//     ③[COUNT-DRIFT] 用例总数    ← scripts/test-manifest.json 求和
//     ④[COUNT-DRIFT] A/B 总数 + known-evolution ← spawn cloudfunctions/_shared/ab_equivalence.js 解析 stdout
//     ⑤[COUNT-DRIFT] 空 catch 总数 + generated_at ← scripts/silent-catch-baseline.json
//     ⑥[COUNT-DRIFT] 体验版版本号 ← docs/deploy-log.md 最后一条「体验版 vX.Y.Z」
//     真值测量失败 → [TRUTH-MEASURE-FAILED]；声明行缺失/不可解析 → [MISSING-COUNT]/[UNPARSEABLE]
//   无任何 tech-debt-inventory 文件时不拦（项目初期），仅提示。
// 自测：RULES_ROOT 指向临时夹具；A/B 真值可用 AB_EQUIVALENCE_PATH 覆盖为 stub 脚本。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const stripMd = s => s.replace(/\*\*/g, '').replace(/`/g, '');
const num = (s, re) => { const m = s.match(re); return m ? parseInt(m[1], 10) : null; };
const str = (s, re) => { const m = s.match(re); return m ? m[1] : null; };

const fails = [];

// 最新台账：按文件名 8 位日期取最大（现行唯一台账应是日期最新者）
const inventories = fs.existsSync(docsDir)
    ? fs.readdirSync(docsDir)
        .filter(f => /^tech-debt-inventory-(\d{8})\.md$/.test(f))
        .map(f => ({ f, key: f.match(/\d{8}/)[0] }))
        .sort((a, b) => a.key.localeCompare(b.key))
    : [];

if (!inventories.length) {
    console.log('TECH-DEBT-HEADER OK: 无 tech-debt-inventory 文件，跳过');
    process.exit(0);
}

const newest = inventories[inventories.length - 1];
const newestPath = path.join(docsDir, newest.f);
const selfBase = newest.f; // 如 tech-debt-inventory-20261123.md
const headLines = read(newestPath).split('\n').slice(0, 60); // 只看头部 60 行
const head = headLines.join('\n');

// —— 一期：指针一致性 ——
if (!/现行唯一台账/.test(head)) {
    fails.push(`[NO-DECL] docs/${selfBase} 头部缺失「现行唯一台账」声明`);
} else {
    const declMatch = head.match(/现行唯一台账[^\n]*?(tech-debt-inventory-\d{8}\.md)/);
    if (declMatch && declMatch[1] !== selfBase) {
        fails.push(`[STALE-POINTER] docs/${selfBase} 头部「现行唯一台账」指向 ${declMatch[1]}，与自身文件名不符（指针过时，请订正头部或建立新台账）`);
    }
}

// —— 二期：关键计数与实测真值对齐 ——
// 真值测量（每项独立 try/catch，单项失败不阻断其余项核对）
const truth = {};
try {
    const m = JSON.parse(read(path.join(root, 'scripts', 'test-manifest.json')));
    const files = Object.keys(m);
    truth.cases = { files: files.length, total: files.reduce((n, f) => n + (Array.isArray(m[f]) ? m[f].length : 0), 0) };
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] test-manifest：${e.message}`); }

try {
    const abPath = process.env.AB_EQUIVALENCE_PATH
        ? path.resolve(process.env.AB_EQUIVALENCE_PATH)
        : path.join(root, 'cloudfunctions', '_shared', 'ab_equivalence.js');
    const r = spawnSync(process.execPath, [abPath], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const m = out.match(/A\/B EQUIVALENT: (\d+) cases.*?(\d+) known-evolution/);
    if (!m) throw new Error(`ab_equivalence 未输出可解析结果（${r.error ? r.error.message : 'exit=' + r.status}）`);
    truth.ab = { total: +m[1], known: +m[2] };
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] ab_equivalence：${e.message}`); }

try {
    const b = JSON.parse(read(path.join(root, 'scripts', 'silent-catch-baseline.json')));
    truth.catch = { total: b.total, generated_at: b.generated_at };
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] silent-catch-baseline：${e.message}`); }

try {
    const logPath = path.join(root, 'docs', 'deploy-log.md');
    if (!fs.existsSync(logPath)) throw new Error('docs/deploy-log.md 不存在');
    let ver = null;
    for (const l of read(logPath).split('\n')) {
        const m = l.match(/体验版.*?v(\d+\.\d+\.\d+)/);
        if (m) ver = m[1];
    }
    if (!ver) throw new Error('deploy-log 未找到「体验版 vX.Y.Z」记录');
    truth.beta = ver;
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] deploy-log：${e.message}`); }

// 解析头部「关键计数」表行（按首单元格精确定位，避免误匹配「旧值」行/P3-1 行）
const verifyRow = headLines.find(l => /^\|\s*`?verify:offline`?/.test(l));
const catchRow = headLines.find(l => /^\|\s*空 catch 基线/.test(l));
const betaRow = headLines.find(l => /^\|\s*体验版/.test(l));

if (!verifyRow) {
    fails.push('[MISSING-COUNT] 头部缺少 verify:offline 关键计数行（A/B/用例/known 无从核对）');
} else {
    const vr = stripMd(verifyRow);
    const declAb = num(vr, /A\/B\s*(\d+)/);
    const declKnown = num(vr, /(\d+)\s*known-evolution/);
    const declCases = num(vr, /(\d+)\s*用例/);
    if (truth.ab && declAb !== null && declAb !== truth.ab.total)
        fails.push(`[COUNT-DRIFT] A/B 等价总数：台账声明 ${declAb}，实测 ${truth.ab.total}`);
    if (truth.ab && declKnown !== null && declKnown !== truth.ab.known)
        fails.push(`[COUNT-DRIFT] known-evolution：台账声明 ${declKnown}，实测 ${truth.ab.known}`);
    if (truth.cases && declCases !== null && declCases !== truth.cases.total)
        fails.push(`[COUNT-DRIFT] 测试用例总数：台账声明 ${declCases}，实测 ${truth.cases.total}（${truth.cases.files} 文件）`);
    if (declAb === null) fails.push('[UNPARSEABLE] verify:offline 行未解析到 A/B 数值');
    if (declKnown === null) fails.push('[UNPARSEABLE] verify:offline 行未解析到 known-evolution 数值');
    if (declCases === null) fails.push('[UNPARSEABLE] verify:offline 行未解析到用例数值');
}

if (!catchRow) {
    fails.push('[MISSING-COUNT] 头部缺少「空 catch 基线」行');
} else {
    const cr = stripMd(catchRow);
    const declCatch = num(cr, /(\d+)\s*处/);
    const declAt = str(cr, /generated_at=(\d{4}-\d{2}-\d{2})/);
    if (truth.catch && declCatch !== null && declCatch !== truth.catch.total)
        fails.push(`[COUNT-DRIFT] 空 catch 基线总数：台账声明 ${declCatch}，实测 ${truth.catch.total}`);
    if (truth.catch && declAt !== null && declAt !== truth.catch.generated_at)
        fails.push(`[COUNT-DRIFT] 空 catch generated_at：台账声明 ${declAt}，实测 ${truth.catch.generated_at}`);
    if (declCatch === null) fails.push('[UNPARSEABLE] 空 catch 行未解析到「处」数值');
    if (declAt === null) fails.push('[UNPARSEABLE] 空 catch 行未解析到 generated_at=YYYY-MM-DD');
}

if (!betaRow) {
    fails.push('[MISSING-COUNT] 头部缺少「体验版」行');
} else {
    const br = stripMd(betaRow);
    const declBeta = str(br, /v(\d+\.\d+\.\d+)/);
    if (truth.beta && declBeta !== null && declBeta !== truth.beta)
        fails.push(`[COUNT-DRIFT] 体验版版本：台账声明 v${declBeta}，实测 v${truth.beta}`);
    if (declBeta === null) fails.push('[UNPARSEABLE] 体验版行未解析到 vX.Y.Z');
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`TECH-DEBT-HEADER OK: 现行台账 docs/${selfBase} 指针一致 + 关键计数对齐（共 ${inventories.length} 份台账，其余为历史归档）`);
process.exit(0);
