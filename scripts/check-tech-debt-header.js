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
//   三期（内部计数，2026-11-26 实现）：头部「规则配额」行 + 体验版行 HEAD 哈希亦须对齐，
//       防 L79 类内部声明漂移未拦截（实证：2026-11-26 二次实测发现台账余量 2110B→1723B 漂移，二期未守）：
//     ⑦[COUNT-DRIFT] 体验版 HEAD 哈希 ← docs/deploy-log.md 最后一条体验版行第 3 列 commit
//     ⑧[COUNT-DRIFT] 规则配额余量 + max§ ← spawn scripts/check-rules-size.js 解析 stdout（inject used/cap → 余量=cap-used）
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
const warnings = []; // M11（2026-11-27）：不阻断的可见提示，仅输出不影响 exit

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
    // E-6.50: ab_equivalence 测量偶发超时/系统抖动会假红；失败自动重试 1 次（间隔 1s），
    // 重试仍失败才记 [TRUTH-MEASURE-FAILED]，消除「需人工串行重跑」的摩擦（不掩盖真问题，重试上限 1 次）。
    const sleep = ms => { const t = Date.now(); while (Date.now() - t < ms) {} };
    const measure = () => {
        const r = spawnSync(process.execPath, [abPath], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
        const out = `${r.stdout || ''}${r.stderr || ''}`;
        const m = out.match(/A\/B EQUIVALENT: (\d+) cases.*?(\d+) known-evolution/);
        if (!m) throw new Error(`ab_equivalence 未输出可解析结果（${r.error ? r.error.message : 'exit=' + r.status}）`);
        return { total: +m[1], known: +m[2] };
    };
    try { truth.ab = measure(); } catch (e1) { sleep(1000); truth.ab = measure(); }
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] ab_equivalence：${e.message}`); }

try {
    const b = JSON.parse(read(path.join(root, 'scripts', 'silent-catch-baseline.json')));
    truth.catch = { total: b.total, generated_at: b.generated_at };
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] silent-catch-baseline：${e.message}`); }

try {
    const logPath = path.join(root, 'docs', 'deploy-log.md');
    if (!fs.existsSync(logPath)) throw new Error('docs/deploy-log.md 不存在');
    let ver = null, sha = null;
    for (const l of read(logPath).split('\n')) {
        const m = l.match(/体验版.*?v(\d+\.\d+\.\d+)/);
        if (m) {
            ver = m[1];
            // 三期：提取该体验版对应的 commit SHA（优先第 3 列「前 commit」，fallback 行内首个 7+ hex）
            const col3 = (l.split('|')[3] || '').trim();
            const sm = col3.match(/([0-9a-f]{7,40})/) || l.match(/\b([0-9a-f]{7,40})\b/);
            if (sm) sha = sm[1];
        }
    }
    if (!ver) throw new Error('deploy-log 未找到「体验版 vX.Y.Z」记录');
    truth.beta = { ver, sha };
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] deploy-log：${e.message}`); }

// 三期 ⑧：规则配额余量 + max§ ← spawn check-rules-size 解析 stdout（测试可用 RULES_SIZE_PATH 覆盖为 stub）
try {
    const rsPath = process.env.RULES_SIZE_PATH
        ? path.resolve(process.env.RULES_SIZE_PATH)
        : path.join(root, 'scripts', 'check-rules-size.js');
    if (!fs.existsSync(rsPath)) throw new Error('scripts/check-rules-size.js 不存在');
    const r = spawnSync(process.execPath, [rsPath], { cwd: root, encoding: 'utf8', timeout: 15000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const mu = out.match(/inject\s+(\d+)B\s*\/\s*(\d+)B/);
    const mm = out.match(/max§\s*(\d+)/);
    if (!mu) throw new Error(`check-rules-size 未输出可解析结果（exit=${r.status}）`);
    truth.quota = { used: +mu[1], cap: +mu[2], headroom: +mu[2] - +mu[1], maxSection: mm ? +mm[1] : null };
} catch (e) { fails.push(`[TRUTH-MEASURE-FAILED] check-rules-size：${e.message}`); }

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
    const declSha = str(br, /HEAD\s*`?([0-9a-f]{7,40})`?/); // 三期：体验版 HEAD 哈希
    if (truth.beta && declBeta !== null && declBeta !== truth.beta.ver)
        fails.push(`[COUNT-DRIFT] 体验版版本：台账声明 v${declBeta}，实测 v${truth.beta.ver}`);
    // 三期：仅当 deploy-log 实测到 SHA 时才比对 HEAD（deploy-log 无 SHA 则跳过，不阻断）
    if (truth.beta && truth.beta.sha) {
        if (declSha === null) fails.push('[MISSING-COUNT] 体验版行声明 HEAD 但未解析到有效哈希');
        else if (declSha !== truth.beta.sha) fails.push(`[COUNT-DRIFT] 体验版 HEAD 哈希：台账声明 ${declSha}，实测 ${truth.beta.sha}`);
    } else if (truth.beta) {
        // M11（2026-11-27 修复）：deploy-log 最后一条体验版行无 SHA 时记 WARN（不阻断），原静默跳过不可见
        warnings.push('[WARN] deploy-log 最后一条体验版行未解析到 commit SHA，体验版 HEAD 哈希校验已跳过（不阻断，建议补登 SHA）');
    }
    if (declBeta === null) fails.push('[UNPARSEABLE] 体验版行未解析到 vX.Y.Z');
}

// 三期 ⑧：规则配额余量 + max§ 与实测对齐
const quotaRow = headLines.find(l => /^\|\s*规则配额/.test(l));
if (!quotaRow) {
    fails.push('[MISSING-COUNT] 头部缺少「规则配额」计数行（inject/余量/max§ 无从核对）');
} else {
    const qr = stripMd(quotaRow);
    const declHeadroom = num(qr, /余量\s*(\d+)\s*B/);
    const declMax = num(qr, /max§\s*(\d+)/);
    if (truth.quota && declHeadroom !== null && declHeadroom !== truth.quota.headroom)
        fails.push(`[COUNT-DRIFT] 规则配额余量：台账声明 ${declHeadroom}B，实测 ${truth.quota.headroom}B（inject ${truth.quota.used}/${truth.quota.cap}）`);
    if (truth.quota && truth.quota.maxSection === null)
        fails.push('[UNPARSEABLE] check-rules-size 实测未解析到 max§（无法核对台账 max§ 声明）'); // 评审修复 #3：原为静默跳过（maxSection null 时 max§ 漂移不被拦）
    if (truth.quota && truth.quota.maxSection !== null && declMax !== null && declMax !== truth.quota.maxSection)
        fails.push(`[COUNT-DRIFT] 规则配额 max§：台账声明 ${declMax}，实测 ${truth.quota.maxSection}`);
    if (declHeadroom === null) fails.push('[UNPARSEABLE] 规则配额行未解析到「余量 N B」数值');
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
for (const w of warnings) console.error('WARN ' + w); // M11：不阻断，仅可见提示
console.log(`TECH-DEBT-HEADER OK: 现行台账 docs/${selfBase} 指针一致 + 关键计数对齐（共 ${inventories.length} 份台账，其余为历史归档）`);
process.exit(0);
