// scripts/check-sub-msg-consistency.js — 订阅消息发送入口一致性门禁（2026-11-02 方案A）
// 规则：`subscribeMessage.send` 只允许出现在 sub_msg.js（规范源与各函数副本）；
//       其他业务文件裸调即 FAIL，必须改走 _shared/sub_msg.js 的 sendOnce。
// 豁免：_orig_baseline.js（冻结基线，禁改）、*.test.js（测试注入 mock 不属于生产调用）。
const fs = require('fs');
const path = require('path');

const root = process.env.SUBMSG_ROOT ? path.resolve(process.env.SUBMSG_ROOT) : path.resolve(__dirname, '..');
const cfDir = path.join(root, 'cloudfunctions');
const SKIP_DIR = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist', 'public']);
const CALL_RE = /subscribeMessage\s*\.\s*send\s*\(/;
const fails = [];
let scanned = 0;

function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIR.has(ent.name)) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) { walk(abs); continue; }
        if (!ent.name.endsWith('.js')) continue;
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        if (ent.name === '_orig_baseline.js' || ent.name.endsWith('.test.js')) continue;
        if (ent.name === 'sub_msg.js') continue;   // 唯一允许的发送入口
        scanned++;
        const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, '');   // 忽略行注释（如 push_https.js 的降级说明）
            if (CALL_RE.test(code)) fails.push(`[SUBMSG-DIRECT] ${rel}:${i + 1} 裸调 subscribeMessage.send → 请改用 _shared/sub_msg.js 的 sendOnce`);
        });
    }
}

if (!fs.existsSync(cfDir)) {
    console.error(`[SUBMSG-ROOT] 缺少 cloudfunctions 目录: ${cfDir}`);
    process.exit(1);
}
walk(cfDir);
for (const f of fails) console.error(f);
if (fails.length) {
    console.error(`SUB-MSG CHECK FAILED: ${fails.length} problem(s)`);
    process.exit(1);
}
console.log(`SUB-MSG OK: 扫描 ${scanned} 个业务 js，无裸调 subscribeMessage.send`);
