// scripts/check-no-desktop-injection.js — 桌面控制注入门禁（规则 §37，2026-11-02 越权事件实证）
// 规则：`.ps1` / `.js` 中禁止出现 Win32 桌面注入与窗口管理 API；桌面操作只能走 Computer Use 语义树，
//       且须先取得用户对单个任务的逐项书面授权（见 .trae/documents/project-rules-full-20261029.md §37）。
// 豁免：本门禁与自测文件自身（判据词必须写进源码）。
const fs = require('fs');
const path = require('path');

const root = process.env.DESKTOP_GUARD_ROOT ? path.resolve(process.env.DESKTOP_GUARD_ROOT) : path.resolve(__dirname, '..');
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'public', 'miniprogram_npm']);
const SELF = new Set(['check-no-desktop-injection.js', 'check-no-desktop-injection.test.js']);
const API_RE = /SetCursorPos|mouse_event|keybd_event|SendKeys|SetForegroundWindow|SetWindowPos|ShowWindow/;
const fails = [];
let scanned = 0;

function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIR.has(ent.name)) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) { walk(abs); continue; }
        const isPs1 = ent.name.endsWith('.ps1');
        if (!isPs1 && !ent.name.endsWith('.js')) continue;
        if (SELF.has(ent.name)) continue;
        scanned++;
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        const lines = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n');
        lines.forEach((line, i) => {
            // 注释不算调用：js 剥 //，ps1 剥 #（按扩展名分别处理，避免误伤 URL 里的 //）
            const code = isPs1 ? line.replace(/#.*$/, '') : line.replace(/\/\/.*$/, '');
            if (API_RE.test(code)) {
                fails.push(`[DESKTOP-INJECT] ${rel}:${i + 1} 出现桌面注入/窗口管理 API → 桌面操作须走 Computer Use 语义树并取得用户逐项授权（§37）`);
            }
        });
    }
}

if (!fs.existsSync(root)) {
    console.error(`[DESKTOP-GUARD-ROOT] 路径不存在: ${root}`);
    process.exit(1);
}
walk(root);
for (const f of fails) console.error(f);
if (fails.length) {
    console.error(`DESKTOP-GUARD FAILED: ${fails.length} 处`);
    process.exit(1);
}
console.log(`DESKTOP-GUARD OK: 扫描 ${scanned} 个 .js/.ps1，无桌面注入 API`);
process.exit(0);
