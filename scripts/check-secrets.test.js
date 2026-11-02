// 凭据泄漏扫描门自测（T-7.39）：锁定命中面、排除面与脱敏输出
// 注意：本文件不得出现任何「连续」的假凭据字面量（否则会被门禁自身扫到），一律用拼接构造
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-secrets.js');
const AWK = 'AWK-' + 'a'.repeat(64);
const SK = 'sk-' + 'b'.repeat(32);
const PEM = '-----BEGIN ' + 'RSA PRIVATE KEY';
const ENVKEY = 'ADMIN_KEY=' + 'c'.repeat(24);

function mkFixture(overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-secrets-'));
    const files = { 'README.md': '# 干净夹具\n' };
    Object.assign(files, overrides);
    for (const [p, content] of Object.entries(files)) {
        const abs = path.join(dir, p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return dir;
}

function run(root) {
    const r = spawnSync(process.execPath, [GATE], { env: { ...process.env, RULES_ROOT: root }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function withFixture(overrides, fn) {
    const dir = mkFixture(overrides);
    try { return fn(run(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('干净夹具应 PASS', () => {
    withFixture({}, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /SECRETS OK/);
    });
});

test('S1 AWK- 64 位 hex 命中', () => {
    withFixture({ 'docs/leak.md': `key=${AWK}\n` }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[SECRET\] docs\/leak\.md:1 ADMIN-KEY/);
    });
});

test('S2 私钥块命中', () => {
    withFixture({ 'scripts/id.txt': `${PEM}\nAAAA\n` }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[SECRET\].*PRIVATE-KEY/);
    });
});

test('S3 sk- 型 key 命中', () => {
    withFixture({ 'README.md': `token: ${SK}\n` }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[SECRET\].*API-KEY/);
    });
});

test('S4 环境变量型 key 命中', () => {
    withFixture({ '.env': `${ENVKEY}\n` }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[SECRET\].*ENV-KEY/);
    });
});

test('S5 仓库内 admin-key 文件命中', () => {
    withFixture({ 'admin-key-prod.txt': 'placeholder\n' }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[SECRET-FILE\]/);
    });
});

test('S6 node_modules 内假 key 不扫（排除面）', () => {
    withFixture({ 'node_modules/pkg/leak.js': `const k = '${AWK}';\n` }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});

test('S7 63 位 hex 不命中（阈值边界）', () => {
    withFixture({ 'docs/almost.md': `AWK-${'a'.repeat(63)}\n` }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});

test('S8 命中报告已脱敏（不回显完整凭据）', () => {
    withFixture({ 'docs/leak.md': `key=${AWK}\n` }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.ok(!out.includes(AWK), '报告中不得出现完整 key');
        assert.match(out, /AWK-\*\*\*\*/);
    });
});
