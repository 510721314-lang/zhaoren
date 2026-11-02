// 文档链接有效性门自测（T-7.40）：锁定 live 范围、锚点剥离、目录可达与非 live 排除
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-doc-links.js');

function mkFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-doclinks-'));
    const files = {
        'docs/FUNCTION-REGISTRY.md': '# REG\n',
        'docs/runbooks/a.md': '# a\n[reg](../FUNCTION-REGISTRY.md)\n',
        '.trae/rules/x.md': '# rules\n',
    };
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

function withFixture(fn) {
    const dir = mkFixture();
    try { return fn(dir, run(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('基线夹具应 PASS', () => {
    withFixture((dir, { code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /DOC-LINKS OK/);
    });
});

test('L1 file:/// 目标不存在应 FAIL', () => {
    withFixture((dir, { code, out }) => {
        fs.appendFileSync(path.join(dir, 'docs/runbooks/a.md'), `[x](file:///${dir.replace(/\\/g, '/')}/docs/nope.md)\n`, 'utf8');
        const r = run(dir);
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /FAIL \[LINK\].*file:\/\/\/ 目标不存在/);
    });
});

test('L2 相对链接不存在应 FAIL', () => {
    withFixture((dir) => {
        fs.appendFileSync(path.join(dir, 'docs/runbooks/a.md'), '[x](./missing.md)\n', 'utf8');
        const r = run(dir);
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /FAIL \[LINK\].*相对链接不存在/);
    });
});

test('L3 带 #锚点但文件存在应 PASS（剥锚点）', () => {
    withFixture((dir) => {
        fs.appendFileSync(path.join(dir, '.trae/rules/x.md'), '[x](../../docs/FUNCTION-REGISTRY.md#L10)\n', 'utf8');
        const r = run(dir);
        assert.strictEqual(r.code, 0, r.out);
    });
});

test('L4 链接指向目录应 PASS（目录也算可达）', () => {
    withFixture((dir) => {
        fs.mkdirSync(path.join(dir, 'docs/runbooks/sub'), { recursive: true });
        fs.appendFileSync(path.join(dir, 'docs/runbooks/a.md'), '[d](./sub/)\n', 'utf8');
        const r = run(dir);
        assert.strictEqual(r.code, 0, r.out);
    });
});

test('L5 http/mailto 链接不校验', () => {
    withFixture((dir) => {
        fs.appendFileSync(path.join(dir, 'docs/runbooks/a.md'), '[h](https://example.com/x) [m](mailto:a@b.c)\n', 'utf8');
        const r = run(dir);
        assert.strictEqual(r.code, 0, r.out);
    });
});

test('L6 非 live 文档（历史 HANDOFF）不参与校验', () => {
    withFixture((dir) => {
        fs.writeFileSync(path.join(dir, 'docs/HANDOFF-20300101.md'), '[x](./gone.md)\n', 'utf8');
        const r = run(dir);
        assert.strictEqual(r.code, 0, r.out);
    });
});
