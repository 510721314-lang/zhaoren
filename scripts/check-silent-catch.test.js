// 空 catch 增量门自测（A1）：基线内放行、新增即失败、缺基线失败、减少仅提示
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-silent-catch.js');

function mkFixture(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-silent-'));
    for (const [p, content] of Object.entries(files)) {
        const abs = path.join(dir, p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return dir;
}

function run(root, args = []) {
    const r = spawnSync(process.execPath, [GATE, ...args], { env: { ...process.env, RULES_ROOT: root }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function withFixture(files, fn) {
    const dir = mkFixture(files);
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const baseFile = (files, total) => ({
    'scripts/silent-catch-baseline.json': JSON.stringify({ total, files }),
});

test('与基线一致应 PASS', () => {
    withFixture({
        ...baseFile({ 'miniprogram/a.js': 1 }, 1),
        'miniprogram/a.js': 'try { x() } catch (e) {}\n',
    }, dir => {
        const { code, out } = run(dir);
        assert.strictEqual(code, 0, out);
        assert.match(out, /SILENT-CATCH OK/);
    });
});

test('基线内文件新增一处应 FAIL', () => {
    withFixture({
        ...baseFile({ 'miniprogram/a.js': 1 }, 1),
        'miniprogram/a.js': 'try { x() } catch (e) {}\ntry { y() } catch (e) {}\n',
    }, dir => {
        const { code, out } = run(dir);
        assert.strictEqual(code, 1, out);
        assert.match(out, /NEW-SILENT-CATCH/);
    });
});

test('新文件出现空箭头 catch 应 FAIL', () => {
    withFixture({
        ...baseFile({}, 0),
        'cloudfunctions/fn/index.js': 'p.catch(() => {})\n',
    }, dir => {
        const { code, out } = run(dir);
        assert.strictEqual(code, 1, out);
        assert.match(out, /NEW-SILENT-CATCH/);
    });
});

test('缺基线应 FAIL', () => {
    withFixture({ 'miniprogram/a.js': 'try { x() } catch (e) {}\n' }, dir => {
        const { code, out } = run(dir);
        assert.strictEqual(code, 1, out);
        assert.match(out, /BASELINE-MISSING/);
    });
});

test('--write 生成基线后应 PASS，且总数下降只提示', () => {
    withFixture({ 'miniprogram/a.js': 'try { x() } catch (e) {}\n' }, dir => {
        const w = run(dir, ['--write']);
        assert.strictEqual(w.code, 0, w.out);
        assert.match(w.out, /BASELINE WRITTEN/);
        const pass = run(dir);
        assert.strictEqual(pass.code, 0, pass.out);
        fs.writeFileSync(path.join(dir, 'miniprogram/a.js'), 'try { x() } catch (e) { log(e) }\n', 'utf8');
        const less = run(dir);
        assert.strictEqual(less.code, 0, less.out);
        assert.match(less.out, /TOTAL-DECREASE/);
    });
});
