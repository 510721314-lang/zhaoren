// 凭据泄漏扫描门（T-7.39 防复发第 6 批）：把 T-0.10 / C-4.13「key 不得出现在仓库」变成机器硬拦
//
// 扫描范围：仓库工作区文本文件（跳过 node_modules/.git/dist/public/miniprogram_npm/.backup-lark/coverage）
// 命中即 FAIL[SECRET]（报告只输出脱敏片段，绝不回显完整凭据）：
//   AWK-<64 位 hex>           后台网关 key（68 位格式）
//   -----BEGIN * PRIVATE KEY  私钥
//   sk-<20+ 位>               API key
//   Bearer eyJ<20+ 位>        JWT
//   secretId/secretKey 赋值    腾讯云凭据
//   ADMIN_KEY/API_KEY/SECRET_KEY/ACCESS_KEY = <16+ 位>
// 另：仓库根内出现 admin-key-*.txt（应只存旧机备份区）→ FAIL[SECRET-FILE]
// 自测：RULES_ROOT 指向临时夹具（scripts/check-secrets.test.js）
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const SKIP_DIR = /node_modules|\.git|[/\\]dist[/\\]|[/\\]public[/\\]|miniprogram_npm|\.backup-lark|[/\\]coverage[/\\]/;
const TEXT_EXT = /\.(js|cjs|mjs|json|md|ps1|sh|yml|yaml|txt|wxml|wxss|wxs|html|vue|env|cfg|ini|csv)$/i;

const PATTERNS = [
    { id: 'ADMIN-KEY', re: /AWK-[A-Za-z0-9]{64}/g, why: '后台网关 key（AWK- + 64 hex）' },
    { id: 'PRIVATE-KEY', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/g, why: '私钥块' },
    { id: 'API-KEY', re: /sk-[A-Za-z0-9]{20,}/g, why: 'sk- 型 API key' },
    { id: 'JWT', re: /Bearer\s+eyJ[A-Za-z0-9._-]{20,}/g, why: 'Bearer JWT' },
    { id: 'TCB-CRED', re: /(?:secretId|secretKey)\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/gi, why: '腾讯云 secretId/secretKey 赋值' },
    { id: 'ENV-KEY', re: /(?:ADMIN_KEY|API_KEY|SECRET_KEY|ACCESS_KEY)\s*=\s*[A-Za-z0-9+/=]{16,}/g, why: '环境变量型 key 赋值' },
];

const fails = [];
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (SKIP_DIR.test(rel)) continue;
        if (e.isDirectory()) walk(p);
        else if (TEXT_EXT.test(e.name) || e.name === '.env') files.push(p);
    }
})(root);

const redact = s => s.slice(0, 4) + '****(' + s.length + ' chars)';

for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (/^admin-key-[A-Za-z0-9_-]+\.txt$/i.test(rel)) {
        fails.push(`[SECRET-FILE] ${rel} 位于仓库内（后台 key 只允许存旧机备份区）`);
        continue;
    }
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const lines = text.split(/\r?\n/);
    lines.forEach((ln, i) => {
        for (const p of PATTERNS) {
            p.re.lastIndex = 0;
            let m;
            while ((m = p.re.exec(ln))) {
                fails.push(`[SECRET] ${rel}:${i + 1} ${p.id}（${p.why}）命中 ${redact(m[0])}`);
            }
        }
    });
}

if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
}
console.log(`SECRETS OK: 扫描 ${files.length} 文本文件，未发现凭据泄漏（AWK-/私钥/sk-/JWT/云凭据/env 型 key）`);
process.exit(0);
