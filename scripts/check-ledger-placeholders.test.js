// 台账占位符与冲突标记门自测（T-7.42）：锁定冲突标记、提交号占位与「仅查最新 HANDOFF」
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-ledger-placeholders.js');

function mkFixture(overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-ledger-'));
    const files = {
        'docs/HANDOFF-20260101.md': '# 历史台账\n全部已结案。\n',
        'docs/README.md': '# 说明\n',
    };
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
        assert.match(out, /LEDGER OK/);
    });
});

test('M1 Git 冲突标记应 FAIL', () => {
    withFixture({ 'docs/a.md': `${'<'.repeat(7)} HEAD\n冲突\n` }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[CONFLICT\] docs\/a\.md:1/);
    });
});

test('M2 提交号仍是待填占位应 FAIL', () => {
    withFixture({ 'docs/a.md': '结论：commit `待填`\n' }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[COMMIT-TODO\] docs\/a\.md:1/);
    });
});

test('M3 最新 HANDOFF 残留占位应 FAIL', () => {
    withFixture({ 'docs/HANDOFF-20261231.md': '# 新台账\n- T-8.1 待填\n' }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[PLACEHOLDER\] .*HANDOFF-20261231\.md/);
    });
});

test('M4 仅历史 HANDOFF 含占位应 PASS（只查最新）', () => {
    withFixture({
        'docs/HANDOFF-20250101.md': '# 旧台账\n- 历史 TBD 已结案\n',
        'docs/HANDOFF-20261231.md': '# 新台账\n- 已完成\n',
    }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});

test('M5 node_modules 内冲突标记不扫（排除面）', () => {
    withFixture({ 'node_modules/pkg/x.js': `${'<'.repeat(7)} HEAD\n` }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});
