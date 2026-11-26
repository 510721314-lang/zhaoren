// 台账头部一致性门自测（P3-47）：一期指针 + 二期计数对齐
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-tech-debt-header.js');

// stub ab：打印与真实 ab_equivalence 同格式的汇总行，供二期解析（避免真实跑 ~7s）
const STUB_AB = "console.log('A/B EQUIVALENT: 473 cases (237 explicit + 236 auto; 110 known-evolution)');\n";
const STUB_AB_FAIL = "process.exitCode = 1;\n"; // 不打印汇总行 → 触发 TRUTH-MEASURE-FAILED

function mkFixture(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-tdh-'));
    for (const [p, content] of Object.entries(files)) {
        const abs = path.join(dir, p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return dir;
}

function run(root, abPath) {
    const env = { ...process.env, RULES_ROOT: root };
    if (abPath) env.AB_EQUIVALENCE_PATH = abPath;
    const r = spawnSync(process.execPath, [GATE], { env, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function withFixture(files, fn) {
    const dir = mkFixture(files);
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// 基准真值（与台账声明一致 → 应 PASS）
const baseTruth = (over = {}) => ({
    'stub-ab.js': STUB_AB,
    'scripts/test-manifest.json': JSON.stringify({ 'a.test.js': ['t1', 't2'], 'b.test.js': ['t3'] }), // 3 用例 / 2 文件
    'scripts/silent-catch-baseline.json': JSON.stringify({ total: 200, generated_at: '2026-11-25' }),
    'docs/deploy-log.md': '| 2026-11-20 | 体验版 v1.6.24 上传 |\n| 2026-11-25 | 体验版 **v1.6.25** 上传 |\n',
    ...over,
});

const baseLedger = (over = {}) => `# 技术负债清单
> **现行唯一台账**：本文件（tech-debt-inventory-20261123.md）

## 关键计数（2026-11-26 实测）

| 项 | 值 |
|---|---|
| \`verify:offline\` | EXIT=0 / A/B **473 EQUIVALENT** / 3 用例 0 fail / 110 known-evolution |
| 空 catch 基线 | **200 处**（generated_at=2026-11-25） |
| 体验版 | **v1.6.25**（HEAD x） |
` + (over.tail || '');

test('一期指针 + 二期计数全匹配应 PASS', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger(),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 0, out);
        assert.match(out, /关键计数对齐/);
    });
});

test('A/B 总数漂移应 FAIL [COUNT-DRIFT]', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace('A/B **473', 'A/B **466'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[COUNT-DRIFT\] A\/B 等价总数/);
    });
});

test('用例总数漂移应 FAIL [COUNT-DRIFT]', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace('/ 3 用例', '/ 5 用例'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[COUNT-DRIFT\] 测试用例总数/);
    });
});

test('空 catch generated_at 漂移应 FAIL [COUNT-DRIFT]', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace('generated_at=2026-11-25', 'generated_at=2026-11-26'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[COUNT-DRIFT\] 空 catch generated_at/);
    });
});

test('体验版版本漂移应 FAIL [COUNT-DRIFT]', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace('v1.6.25', 'v1.6.16'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[COUNT-DRIFT\] 体验版版本/);
    });
});

test('缺少 verify:offline 计数行应 FAIL [MISSING-COUNT]', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace(/\| `verify:offline`.*\n/, ''),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[MISSING-COUNT\] 头部缺少 verify:offline/);
    });
});

test('ab 测量失败应 FAIL [TRUTH-MEASURE-FAILED]', () => {
    withFixture({
        ...baseTruth({ 'stub-ab.js': STUB_AB_FAIL }),
        'docs/tech-debt-inventory-20261123.md': baseLedger(),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[TRUTH-MEASURE-FAILED\] ab_equivalence/);
    });
});

test('一期指针过时仍应 FAIL [STALE-POINTER]（与二期独立）', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace(
            '本文件（tech-debt-inventory-20261123.md）',
            'tech-debt-inventory-20261105.md'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[STALE-POINTER\]/);
    });
});

test('无台账文件应跳过 OK', () => {
    withFixture({ ...baseTruth() }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 0, out);
        assert.match(out, /无 tech-debt-inventory 文件，跳过/);
    });
});
