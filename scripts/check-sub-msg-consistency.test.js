// scripts/check-sub-msg-consistency.test.js — 订阅发送入口门禁自测（2026-11-02 方案A）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zsubmsg-'));
test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

function fixture(name) {
  const root = path.join(TMP, name);
  fs.mkdirSync(path.join(root, 'cloudfunctions', '_shared'), { recursive: true });
  fs.mkdirSync(path.join(root, 'cloudfunctions', 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cloudfunctions', '_shared', 'sub_msg.js'), "await cloud.openapi.subscribeMessage.send(a);\n");
  fs.writeFileSync(path.join(root, 'cloudfunctions', 'a', 'sub_msg.js'), "await cloud.openapi.subscribeMessage.send(a);\n");
  return root;
}

function run(root) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'check-sub-msg-consistency.js')], {
      env: Object.assign({}, process.env, { SUBMSG_ROOT: root }), encoding: 'utf8', stdio: 'pipe'
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}

test('干净夹具 → SUB-MSG OK', () => {
  const root = fixture('clean');
  const r = run(root);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(r.out.includes('SUB-MSG OK'), r.out);
});

test('业务文件裸调 → FAIL[SUBMSG-DIRECT]', () => {
  const root = fixture('direct');
  fs.writeFileSync(path.join(root, 'cloudfunctions', 'a', 'index.js'), "await cloud.openapi.subscribeMessage.send({});\n");
  const r = run(root);
  assert.strictEqual(r.code, 1, r.out);
  assert.ok(r.out.includes('[SUBMSG-DIRECT]'), r.out);
});

test('_orig_baseline.js 冻结基线豁免', () => {
  const root = fixture('baseline');
  fs.writeFileSync(path.join(root, 'cloudfunctions', 'a', '_orig_baseline.js'), "await cloud.openapi.subscribeMessage.send({});\n");
  const r = run(root);
  assert.strictEqual(r.code, 0, r.out);
});

test('测试文件 mock 豁免', () => {
  const root = fixture('testfile');
  fs.writeFileSync(path.join(root, 'cloudfunctions', 'a', 'x.test.js'), "sdk.openapi.subscribeMessage.send({});\n");
  const r = run(root);
  assert.strictEqual(r.code, 0, r.out);
});

test('注释中的 subscribeMessage.send 不误报', () => {
  const root = fixture('comment');
  fs.writeFileSync(path.join(root, 'cloudfunctions', 'a', 'push.js'), "// 回退到 cloud.openapi.subscribeMessage.send(云调用)\n");
  const r = run(root);
  assert.strictEqual(r.code, 0, r.out);
});
