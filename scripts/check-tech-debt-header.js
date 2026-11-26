// 台账头部指针一致性门（P3-47，防 6.2「真值管理工具自身失准」复发）
//
// 判据（一期）：
//   ①[STALE-POINTER] docs/ 下最新 tech-debt-inventory-YYYYMMDD.md 的头部「现行唯一台账」
//     声明若明确指向另一个台账文件名 → FAIL（指针过时，会把读者引到已降归档的旧文件）
//   ②[NO-DECL]       最新台账头部缺失「现行唯一台账」声明 → FAIL（防头部被清空后无人发现）
//   无任何 tech-debt-inventory 文件时不拦（项目初期），仅提示。
// 二期（待立项）：头部关键计数（A/B/用例/known）与 test-manifest 实测对齐。
// 自测：RULES_ROOT 指向临时夹具（同 check-ledger-placeholders 模式）。
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

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
const head = read(newestPath).split('\n').slice(0, 60).join('\n'); // 只看头部 60 行

// ① 缺失声明
if (!/现行唯一台账/.test(head)) {
    fails.push(`[NO-DECL] docs/${selfBase} 头部缺失「现行唯一台账」声明`);
} else {
    // ② 声明行里第一个明确出现的台账文件名应为自身（指到别的文件 = 指针过时）
    const declMatch = head.match(/现行唯一台账[^\n]*?(tech-debt-inventory-\d{8}\.md)/);
    if (declMatch && declMatch[1] !== selfBase) {
        fails.push(`[STALE-POINTER] docs/${selfBase} 头部「现行唯一台账」指向 ${declMatch[1]}，与自身文件名不符（指针过时，请订正头部或建立新台账）`);
    }
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`TECH-DEBT-HEADER OK: 现行台账 docs/${selfBase} 头部指针一致（共 ${inventories.length} 份台账，其余为历史归档）`);
process.exit(0);
