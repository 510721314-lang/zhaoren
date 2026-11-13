// scripts/check-test-manifest.test.js —— 用例清单门自测（防复发：Edit 整块替换导致静默删用例）
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECK = path.join(__dirname, 'check-test-manifest.js');
const SAMPLE = "const { test } = require('node:test');\ntest('用例甲', () => {});\ntest('用例乙', () => {});\n";

function fixture(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-manifest-'));
    for (const rel of Object.keys(files)) {
        const p = path.join(dir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, files[rel], 'utf8');
    }
    return dir;
}
function run(dir, args) {
    return spawnSync(process.execPath, [CHECK].concat(args || []), {
        env: Object.assign({}, process.env, { RULES_ROOT: dir }),
        encoding: 'utf8'
    });
}

test('清单与用例一致 → PASS', () => {
    const dir = fixture({ 'scripts/a.test.js': SAMPLE });
    try {
        assert.strictEqual(run(dir, ['--update']).status, 0);
        const r = run(dir);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /TEST-MANIFEST OK: 1 文件 \/ 2 用例/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('静默删用例 → TEST-LOST', () => {
    const dir = fixture({ 'scripts/a.test.js': SAMPLE });
    try {
        run(dir, ['--update']);
        fs.writeFileSync(path.join(dir, 'scripts/a.test.js'), SAMPLE.replace("test('用例乙', () => {});\n", ''), 'utf8');
        const r = run(dir);
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /\[TEST-LOST\] scripts\/a\.test\.js 缺少用例「用例乙」/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('新增用例未登记 → TEST-UNREGISTERED', () => {
    const dir = fixture({ 'scripts/a.test.js': SAMPLE });
    try {
        run(dir, ['--update']);
        fs.writeFileSync(path.join(dir, 'scripts/a.test.js'), SAMPLE + "test('用例丙', () => {});\n", 'utf8');
        const r = run(dir);
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /\[TEST-UNREGISTERED\].*用例丙/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('测试文件被整体删除 → TEST-FILE-LOST', () => {
    const dir = fixture({ 'scripts/a.test.js': SAMPLE });
    try {
        run(dir, ['--update']);
        fs.rmSync(path.join(dir, 'scripts/a.test.js'));
        const r = run(dir);
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /\[TEST-FILE-LOST\] scripts\/a\.test\.js/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
