// 门禁挂载一致性审计（T-7.38 防复发第 5 批）：把「§22-G1 双挂载」从纪律变成机器校验
//
// 分类（新增门禁必须显式归类，否则 FAIL[UNCLASSIFIED]）：
//   DEPLOY_CRITICAL：部署前硬拦，必须同时出现在 `verify:offline` 与 `.trae/predeploy.ps1` 第 2b 步
//   VERIFY_ONLY：只做本地/提交前检查，必须同时出现在 `verify` 与 `verify:offline`（不进 predeploy）
//   TOOL：需要 CLI 参数或一次性使用，禁止进任何门禁链
// 另外校验：分类表无失效项（脚本已删仍留分类 → FAIL[STALE]）、predeploy 引用的脚本真实存在。
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'scripts');
const pkgPath = path.join(root, 'package.json');
const predeployPath = path.join(root, '.trae', 'predeploy.ps1');

// —— 分类表（2026-11-02 T-7.38 首版）——
const DEPLOY_CRITICAL = new Set([
    'check-shared-sync.js',              // _shared 多副本漂移会让云函数加载失败
    'check-require-scope.js',            // 跨目录 require 属部署致命
    'check-cloud-timeout-policy.js',     // 读超时/错误态可见性
    'check-location-timeout-policy.js',  // 定位防卡死
    'check-miniprogram-syntax.js',       // 小程序语法（上传即炸）
    'check-rules-size.js',               // 规则体系体积/水位
    'check-rule-refs.js',                // 悬空 §N 引用
    'check-gate-mounts.js',              // 本审计自身
]);
const VERIFY_ONLY = new Set([
    'check-syntax.js',                   // 云函数语法（服务端可兜底，不阻断部署）
    'check-ssot.js',                     // 配置单一事实源
    'check-handlers.js',                 // HANDLERS 注册完整性
    'check-index-ledger.js',             // 索引台账（需缓存文件）
    'check-deploy-config.js',            // 部署配置（--offline 形态）
    'check-manual-links.js',             // 手册 file:/// 链接
    'check-once-prompts.js',             // 被动提示幂等基线
    'check-nightmask.js',                // 提审合规：功能不可用页必挂 night-mask（2026-11-02 补挂）
]);
const TOOL = new Set([
    'check-handoff-coverage.js',         // 需 2 个 HANDOFF 路径参数，一次性比对工具
]);

const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const fails = [];

let pkg;
try {
    pkg = JSON.parse(read(pkgPath));
} catch (e) {
    console.error(`FAIL [PKG] 无法解析 package.json：${e.message}`);
    process.exit(1);
}
const verifyCmd = (pkg.scripts && pkg.scripts.verify) || '';
const offlineCmd = (pkg.scripts && pkg.scripts['verify:offline']) || '';
const predeploy = fs.existsSync(predeployPath) ? read(predeployPath) : '';
const mounts = g => ({
    verify: verifyCmd.includes(g),
    offline: offlineCmd.includes(g),
    predeploy: predeploy.includes(g) || predeploy.includes(g.replace('.js', '.js')),
});

const gates = fs.readdirSync(scriptsDir)
    .filter(f => /^check-.+\.js$/.test(f) && !f.endsWith('.test.js'));

const classified = new Set([...DEPLOY_CRITICAL, ...VERIFY_ONLY, ...TOOL]);

for (const g of gates) {
    const m = mounts(g);
    if (DEPLOY_CRITICAL.has(g)) {
        if (!m.offline) fails.push(`[NOT-IN-OFFLINE] ${g} 属部署关键门但未挂 verify:offline`);
        if (!m.predeploy) fails.push(`[NOT-IN-DEPLOY] ${g} 属部署关键门但未挂 .trae/predeploy.ps1`);
        if (!m.verify) fails.push(`[NOT-IN-VERIFY] ${g} 未挂 verify（在线链与离线链必须同集）`);
    } else if (VERIFY_ONLY.has(g)) {
        if (!m.offline) fails.push(`[NOT-IN-OFFLINE] ${g} 未挂 verify:offline`);
        if (!m.verify) fails.push(`[NOT-IN-VERIFY] ${g} 未挂 verify（在线链与离线链必须同集）`);
    } else if (TOOL.has(g)) {
        if (m.verify || m.offline || m.predeploy) fails.push(`[TOOL-MOUNTED] ${g} 属参数型工具，禁止进任何门禁链`);
    } else {
        fails.push(`[UNCLASSIFIED] ${g} 未在分类表登记（新门禁须显式归入 DEPLOY_CRITICAL / VERIFY_ONLY / TOOL）`);
    }
}

for (const g of classified) {
    if (!gates.includes(g)) fails.push(`[STALE] 分类表含 ${g}，但 scripts/ 下已不存在（删脚本须同步删分类）`);
}

// predeploy 引用的脚本必须真实存在（防写错文件名后静默跳过）
for (const m of predeploy.matchAll(/scripts[/\\](check-[A-Za-z0-9-]+\.js)/g)) {
    if (!fs.existsSync(path.join(scriptsDir, m[1]))) {
        fails.push(`[MISSING-FILE] predeploy 引用了不存在的 scripts/${m[1]}`);
    }
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`GATE-MOUNTS OK: ${gates.length} 门禁（deploy ${DEPLOY_CRITICAL.size} / verify-only ${VERIFY_ONLY.size} / tool ${TOOL.size}），verify/offline/predeploy 三向一致`);
process.exit(0);
