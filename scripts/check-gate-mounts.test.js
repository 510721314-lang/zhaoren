// 门禁挂载一致性审计自测（T-7.38）：锁定分类与三向挂载判据
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-gate-mounts.js');

const DEPLOY = ['check-shared-sync.js', 'check-require-scope.js', 'check-cloud-timeout-policy.js', 'check-location-timeout-policy.js', 'check-miniprogram-syntax.js', 'check-rules-size.js', 'check-rule-refs.js', 'check-secrets.js', 'check-gate-mounts.js'];
const VERIFY_ONLY = ['check-syntax.js', 'check-ssot.js', 'check-collections-consistency.js', 'check-config-defaults.js', 'check-handlers.js', 'check-index-ledger.js', 'check-deploy-config.js', 'check-manual-links.js', 'check-doc-links.js', 'check-ledger-placeholders.js', 'check-test-globs.js', 'check-once-prompts.js', 'check-nightmask.js', 'check-sub-msg-consistency.js', 'check-no-desktop-injection.js'];
const TOOL = ['check-handoff-coverage.js'];

function mkFixture(opt = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-mounts-'));
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.trae'), { recursive: true });
    const all = [...DEPLOY, ...VERIFY_ONLY, ...TOOL].filter(f => !(opt.deleteFile || []).includes(f));
    for (const f of all) fs.writeFileSync(path.join(dir, 'scripts', f), '// stub\n', 'utf8');
    for (const f of opt.extraFiles || []) fs.writeFileSync(path.join(dir, 'scripts', f), '// stub\n', 'utf8');

    const inOffline = [...DEPLOY, ...VERIFY_ONLY, ...(opt.extraInOffline || [])]
        .filter(f => !(opt.removeFromOffline || []).includes(f));
    const inVerify = [...DEPLOY, ...VERIFY_ONLY, ...(opt.extraInVerify || [])]
        .filter(f => !(opt.removeFromVerify || []).includes(f));
    const pkg = {
        name: 'fixture',
        scripts: {
            verify: inVerify.map(f => `node scripts/${f}`).join(' && '),
            'verify:offline': inOffline.map(f => `node scripts/${f}`).join(' && '),
        },
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg), 'utf8');

    const preList = [...DEPLOY.filter(f => !(opt.removeFromPredeploy || []).includes(f)), ...(opt.extraInPredeploy || [])];
    const pre = `$gateFailed = @()\nforeach ($gateJs in @(${preList.map(f => `"scripts\\${f}"`).join(', ')})) { }`;
    fs.writeFileSync(path.join(dir, '.trae', 'predeploy.ps1'), pre, 'utf8');
    // predeploy 里额外引用的缺失文件（G5）
    if (opt.missingInPredeploy) {
        fs.writeFileSync(path.join(dir, '.trae', 'predeploy.ps1'), pre.replace(')) { }', `, "scripts\\${opt.missingInPredeploy}")) { }`), 'utf8');
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

test('基线夹具应 PASS（三向一致）', () => {
    withFixture({}, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /GATE-MOUNTS OK/);
    });
});

test('G1 [NOT-IN-OFFLINE] 门禁漏挂 verify:offline', () => {
    withFixture({ removeFromOffline: ['check-nightmask.js'] }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[NOT-IN-OFFLINE\] check-nightmask\.js/);
    });
});

test('G2 [NOT-IN-DEPLOY] 部署关键门漏挂 predeploy', () => {
    withFixture({ removeFromPredeploy: ['check-rules-size.js'] }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[NOT-IN-DEPLOY\] check-rules-size\.js/);
    });
});

test('G3 [UNCLASSIFIED] 新增门禁未登记分类', () => {
    withFixture({ extraFiles: ['check-zz-new.js'], extraInOffline: ['check-zz-new.js'], extraInVerify: ['check-zz-new.js'] }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[UNCLASSIFIED\] check-zz-new\.js/);
    });
});

test('G4 [STALE] 分类表含已删除脚本', () => {
    withFixture({ deleteFile: ['check-handoff-coverage.js'] }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[STALE\].*check-handoff-coverage\.js/);
    });
});

test('G5 [MISSING-FILE] predeploy 引用不存在的脚本', () => {
    withFixture({ missingInPredeploy: 'check-ghost.js' }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[MISSING-FILE\].*check-ghost\.js/);
    });
});

test('G6 [TOOL-MOUNTED] 参数型工具被挂进门禁链', () => {
    withFixture({ extraInVerify: ['check-handoff-coverage.js'], extraInOffline: ['check-handoff-coverage.js'] }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[TOOL-MOUNTED\] check-handoff-coverage\.js/);
    });
});

test('G7 [NOT-IN-VERIFY] 门禁只在 offline 不在 verify（在线/离线链须同集）', () => {
    withFixture({ removeFromVerify: ['check-ssot.js'] }, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[NOT-IN-VERIFY\] check-ssot\.js/);
    });
});
