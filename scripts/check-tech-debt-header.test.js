// 台账头部一致性门自测（P3-47）：一期指针 + 二期计数对齐 + 三期内部计数（配额余量/体验版 HEAD）
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
// stub check-rules-size：打印与真实脚本同格式汇总行，供三期解析配额余量/max§（避免依赖真实规则文件）
const STUB_RULES_SIZE = "console.log('RULES-SIZE OK inject 17733B/19456B (硬顶 30720B) | conditional 1011B/2048B | archive 2755B(不计) | max§ 46');\n";
const STUB_RULES_SIZE_FAIL = "process.exitCode = 1;\n"; // 不打印汇总行 → 触发 TRUTH-MEASURE-FAILED
const STUB_RULES_SIZE_NO_MAX = "console.log('RULES-SIZE OK inject 17733B/19456B (硬顶 30720B) | conditional 1011B/2048B');\n"; // 有 inject 无 max§ → 评审修复 #3 断言 [UNPARSEABLE]

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
    'scripts/check-rules-size.js': STUB_RULES_SIZE, // 三期配额真值 stub
    'scripts/test-manifest.json': JSON.stringify({ 'a.test.js': ['t1', 't2'], 'b.test.js': ['t3'] }), // 3 用例 / 2 文件
    'scripts/silent-catch-baseline.json': JSON.stringify({ total: 200, generated_at: '2026-11-25' }),
    // deploy-log：三期取最后一条体验版行的第 3 列（split[3]「前 commit」）作 HEAD 真值（评审修复 #1：夹具与真实 7 列表头同构，覆盖 col3 路径，不再走 fallback）
    // v1.6.24 行用不同 SHA 验证"取最后一条"；表头/分隔行不含「体验版 v」不会被匹配
    'docs/deploy-log.md': '| 日期 | 函数 | 前 commit | 后 commit | 部署前 bundle | 回滚点 | 说明 |\n|---|---|---|---|---|---|---|\n| 2026-11-20 | 小程序（体验版上传） | 1111111 | 1111111 | 未归档 | 1111111 | 体验版 v1.6.24 上传：col3 路径覆盖 |\n| 2026-11-25 | 小程序（体验版上传） | 966f009b | 966f009b | 未归档 | 966f009b | 体验版 **v1.6.25** 上传：col3 路径覆盖 |\n',
    ...over,
});

const baseLedger = (over = {}) => `# 技术负债清单
> **现行唯一台账**：本文件（tech-debt-inventory-20261123.md）

## 关键计数（2026-11-26 实测）

| 项 | 值 |
|---|---|
| \`verify:offline\` | EXIT=0 / A/B **473 EQUIVALENT** / 3 用例 0 fail / 110 known-evolution |
| 空 catch 基线 | **200 处**（generated_at=2026-11-25） |
| 体验版 | **v1.6.25**（HEAD 966f009b） |
| 规则配额 | inject 17733B / 余量 1723B / max§ 46（check-rules-size 实测；targetBytes 19456） |
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

// —— 三期：内部计数守护（配额余量 / 体验版 HEAD）——
test('规则配额余量漂移应 FAIL [COUNT-DRIFT]（三期，P3-47 盲区实证）', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace('余量 1723B', '余量 2110B'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[COUNT-DRIFT\] 规则配额余量/);
    });
});

test('规则配额 max§ 漂移应 FAIL [COUNT-DRIFT]（三期）', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace('max§ 46', 'max§ 45'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[COUNT-DRIFT\] 规则配额 max§/);
    });
});

test('体验版 HEAD 哈希漂移应 FAIL [COUNT-DRIFT]（三期）', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace('HEAD 966f009b', 'HEAD abcdef0'),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[COUNT-DRIFT\] 体验版 HEAD 哈希/);
    });
});

test('缺少规则配额计数行应 FAIL [MISSING-COUNT]（三期）', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger().replace(/\| 规则配额 \|.*\n/, ''),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[MISSING-COUNT\] 头部缺少「规则配额」/);
    });
});

test('check-rules-size 测量失败应 FAIL [TRUTH-MEASURE-FAILED]（三期）', () => {
    withFixture({
        ...baseTruth(),
        'docs/tech-debt-inventory-20261123.md': baseLedger(),
    }, dir => {
        // RULES_SIZE_PATH 指向不存在文件 → 三期配额真值测量失败
        const env = { ...process.env, RULES_ROOT: dir, AB_EQUIVALENCE_PATH: path.join(dir, 'stub-ab.js'), RULES_SIZE_PATH: path.join(dir, 'nonexistent.js') };
        const r = spawnSync(process.execPath, [GATE], { env, encoding: 'utf8' });
        assert.strictEqual(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(`${r.stdout || ''}${r.stderr || ''}`, /\[TRUTH-MEASURE-FAILED\] check-rules-size/);
    });
});

test('check-rules-size 缺 max§ 应 FAIL [UNPARSEABLE]（评审修复 #3，原静默跳过）', () => {
    withFixture({
        ...baseTruth({ 'scripts/check-rules-size.js': STUB_RULES_SIZE_NO_MAX }),
        'docs/tech-debt-inventory-20261123.md': baseLedger(),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 1, out);
        assert.match(out, /\[UNPARSEABLE\] check-rules-size 实测未解析到 max§/);
    });
});

// M11（2026-11-27 修复）：deploy-log 体验版行无 commit SHA 时应记 [WARN] 但不阻断（原静默跳过不可见）
test('deploy-log 体验版行无 SHA 应 WARN 不阻断（M11，原静默跳过）', () => {
    const noShaLog = '| 日期 | 函数 | 前 commit | 后 commit | 部署前 bundle | 回滚点 | 说明 |\n|---|---|---|---|---|---|---|\n| 2026-11-25 | 小程序（体验版上传） | 无SHA | 无SHA | 未归档 | 无SHA | 体验版 **v1.6.25** 上传：col3 无 hex 触发 M11 WARN |\n';
    withFixture({
        ...baseTruth({ 'docs/deploy-log.md': noShaLog }),
        'docs/tech-debt-inventory-20261123.md': baseLedger(),
    }, dir => {
        const { code, out } = run(dir, path.join(dir, 'stub-ab.js'));
        assert.strictEqual(code, 0, out); // 不阻断，exit 0
        assert.match(out, /\[WARN\]/); // 有可见提示
        assert.doesNotMatch(out, /FAIL/); // 无 FAIL
    });
});
