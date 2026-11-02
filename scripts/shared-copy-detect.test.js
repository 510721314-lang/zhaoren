// scripts/shared-copy-detect.test.js — F5 改名副本检测的负向/正向用例(2026-11-02 P2-6)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detect } = require('./shared-copy-detect');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zf5-'));
test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

// 夹具: _shared/{money_rules.js, other.js} + 函数目录 a/{index.js}
function fixture(name) {
  const root = path.join(TMP, name);
  const shared = path.join(root, '_shared');
  const fn = path.join(root, 'fn');
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(path.join(fn, 'a'), { recursive: true });
  fs.writeFileSync(path.join(shared, 'money_rules.js'), 'module.exports = { a: 1 };\n');
  fs.writeFileSync(path.join(shared, 'other.js'), 'module.exports = { b: 2 };\n');
  fs.writeFileSync(path.join(fn, 'a', 'index.js'), '// stub\n');
  return { root, shared, fn, dirs: ['a'] };
}

test('F5: 同名副本不报(由 SYNC_MAP/M1 负责)', () => {
  const f = fixture('same-name');
  fs.copyFileSync(path.join(f.shared, 'money_rules.js'), path.join(f.fn, 'a', 'money_rules.js'));
  assert.deepStrictEqual(detect(f.shared, f.fn, f.dirs), []);
});

test('F5: 改名副本命中(内容相同, 文件名不同)', () => {
  const f = fixture('renamed');
  fs.copyFileSync(path.join(f.shared, 'money_rules.js'), path.join(f.fn, 'a', 'money_rules_v2.js'));
  const hits = detect(f.shared, f.fn, f.dirs);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].dir, 'a');
  assert.strictEqual(hits[0].file, 'money_rules_v2.js');
  assert.strictEqual(hits[0].canonical, 'money_rules.js');
});

test('F5: 子目录同名副本命中(SYNC_MAP 只认函数根目录)', () => {
  const f = fixture('nested');
  fs.mkdirSync(path.join(f.fn, 'a', 'lib'));
  fs.copyFileSync(path.join(f.shared, 'other.js'), path.join(f.fn, 'a', 'lib', 'other.js'));
  const hits = detect(f.shared, f.fn, f.dirs);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].file, 'lib/other.js');
});

test('F5: node_modules 内副本跳过(第三方依赖不参与守护)', () => {
  const f = fixture('skip');
  fs.mkdirSync(path.join(f.fn, 'a', 'node_modules', 'x'), { recursive: true });
  fs.copyFileSync(path.join(f.shared, 'money_rules.js'), path.join(f.fn, 'a', 'node_modules', 'x', 'money_rules.js'));
  assert.deepStrictEqual(detect(f.shared, f.fn, f.dirs), []);
});

test('F5: 内容不同(仅同名)不报', () => {
  const f = fixture('drifted');
  fs.writeFileSync(path.join(f.fn, 'a', 'money_rules.js'), 'module.exports = { a: 2 };\n');
  assert.deepStrictEqual(detect(f.shared, f.fn, f.dirs), []);
});
