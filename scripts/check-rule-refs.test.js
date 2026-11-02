// 规则引用门禁自测（T-7.37）：锁定 [REF]/[FORWARD] 判据与历史/冻结排除规则
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-rule-refs.js');

function mkFixture(overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-refs-'));
    const files = {
        '.trae/rules/project-rules-core.md': ['## 0. A', '## 1. B', '## 2. C', '## 3. D', '## 4. E', '## 5. F', '## 6. G', '## 7. H', '## 8. I', '## 9. J'].join('\n'),
        '.trae/documents/project-rules-full-20261029.md': Array.from({ length: 25 }, (_, i) => `## ${10 + i}. 归档${10 + i}`).join('\n'),
        'docs/a.md': '引用 §3 与 §24 正常。',
    };
    for (const [p, content] of Object.entries(files)) {
        const abs = path.join(dir, p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    for (const [p, content] of Object.entries(overrides)) {
        const abs = path.join(dir, p);
        if (content === null) { if (fs.existsSync(abs)) fs.unlinkSync(abs); continue; }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, typeof content === 'function' ? content(fs.readFileSync(abs, 'utf8')) : content, 'utf8');
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

test('基线夹具应 PASS', () => {
    withFixture({}, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /RULE-REFS OK/);
    });
});

test('D1 [REF] 引用不存在的已有节（§5 被删）', () => {
    withFixture({
        '.trae/rules/project-rules-core.md': t => t.replace('## 5. F', ''),
        'docs/b.md': '见 §5 的要求。',
    }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[REF\] docs\/b\.md:1 §5/);
    });
});

test('D2 [FORWARD] 超出 max§ 且未写「起」', () => {
    withFixture({ 'docs/b.md': '新增 §99 的规则。' }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[FORWARD\]/);
    });
});

test('D3 超出 max§ 但写明「§N 起」应 PASS', () => {
    withFixture({ 'docs/b.md': '新增 §35 起：先写归档全文。' }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});

test('D4 历史台账（CHANGELOG）不参与断链校验', () => {
    withFixture({ 'docs/CHANGELOG.md': '历史记录提到 §99 属快照，不改写。' }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});

test('D5 云函数代码注释同样受检（§98 应 FAIL）', () => {
    withFixture({ 'cloudfunctions/x/index.js': '// 规则 §98\nmodule.exports = {};' }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[FORWARD\] cloudfunctions\/x\/index\.js/);
    });
});

test('D6 冻结基线 _orig_baseline.js 不参与校验', () => {
    withFixture({ 'cloudfunctions/x/_orig_baseline.js': '// 规则 §99\n' }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});

test('D7 node_modules 不参与校验', () => {
    withFixture({ 'docs/node_modules/y.js': '// §99\n' }, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
    });
});
