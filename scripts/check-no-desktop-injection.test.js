// 桌面控制注入门禁自测（§37）：锁定「注入 API 即 FAIL、注释不误报、自身豁免」
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-no-desktop-injection.js');
const API = 'Set' + 'CursorPos'; // 拼接构造，避免自测文本被本门禁命中（§35 R3）

function mkFixture(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-desktop-'));
    for (const [rel, content] of Object.entries(files)) {
        const p = path.join(dir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content, 'utf8');
    }
    return dir;
}
function run(root) {
    const r = spawnSync(process.execPath, [GATE], { env: { ...process.env, DESKTOP_GUARD_ROOT: root }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function withFixture(files, fn) {
    const dir = mkFixture(files);
    try { return fn(run(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('基线：干净夹具 PASS', () => {
    withFixture({ 'scripts/a.js': 'const x = 1;\n' }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /DESKTOP-GUARD OK/);
    });
});

test('负向：.ps1 出现桌面注入 API → FAIL', () => {
    withFixture({ 'scripts/x.ps1': `[void][Win]::${API}(100, 200)\n` }, ({ code, out }) => {
        assert.strictEqual(code, 1, out);
        assert.match(out, /DESKTOP-INJECT.*x\.ps1:1/);
    });
});

test('负向：.js 出现窗口管理 API → FAIL', () => {
    withFixture({ 'scripts/y.js': 'const f = "ShowWindow";\n' }, ({ code, out }) => {
        assert.strictEqual(code, 1, out);
        assert.match(out, /DESKTOP-INJECT.*y\.js:1/);
    });
});

test('注释中的 API 名不误报', () => {
    withFixture({ 'scripts/z.ps1': '# SetCursorPos 仅作说明\nWrite-Host ok\n' }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /DESKTOP-GUARD OK/);
    });
});

test('门禁自身与自测文件豁免', () => {
    withFixture({
        'scripts/check-no-desktop-injection.js': 'const a = "SetCursorPos";\n',
        'scripts/check-no-desktop-injection.test.js': 'const b = "ShowWindow";\n',
    }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /DESKTOP-GUARD OK/);
    });
});
