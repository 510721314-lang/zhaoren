// 测试挂载门自测（T-7.43）：锁定 glob 覆盖判据、空 glob 与排除面
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-test-globs.js');

function mkFixture(opt = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-globs-'));
    const globs = opt.globs || ['cloudfunctions/_shared/*.test.js', 'scripts/*.test.js'];
    const pkg = { name: 'fixture', scripts: { test: `node --test ${globs.map(g => `"${g}"`).join(' ')}` } };
    const files = {
        'package.json': JSON.stringify(pkg),
        'scripts/a.test.js': '// stub\n',
        'cloudfunctions/_shared/b.test.js': '// stub\n',
    };
    Object.assign(files, opt.files || {});
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

function withFixture(opt, fn) {
    const dir = mkFixture(opt);
    try { return fn(run(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('基线夹具应 PASS', () => {
    withFixture({}, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /TEST-GLOBS OK/);
    });
});

test('T1 子目录测试文件未被 glob 覆盖应 FAIL', () => {
    withFixture({ files: { 'scripts/sub/c.test.js': '// stub\n' } }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[TEST-GLOB\] scripts\/sub\/c\.test\.js/);
    });
});

test('T2 空 glob（命中 0 文件）应 FAIL', () => {
    withFixture({ globs: ['cloudfunctions/_shared/*.test.js', 'scripts/*.test.js', 'nothing/*.test.js'] }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[GLOB-EMPTY\]/);
    });
});

test('T3 node_modules 内测试文件不参与', () => {
    withFixture({ files: { 'node_modules/pkg/x.test.js': '// stub\n' } }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});

test('T4 ** 跨层 glob 可覆盖子目录', () => {
    withFixture({
        globs: ['cloudfunctions/_shared/*.test.js', 'scripts/**/*.test.js'],
        files: { 'scripts/sub/c.test.js': '// stub\n' },
    }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});
