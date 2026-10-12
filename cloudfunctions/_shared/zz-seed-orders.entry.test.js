// zz-seed-orders 入口层契约测试（mock wx-server-sdk，仅测「输入 → 返回码」）
// 覆盖 2026-10-12 评审整改 P0：本函数由「匿名可调用」改为 fail-closed 鉴权。
//   放行 = 真实 OPENID ∈ admin_openids 或 admin-web 代理携合法 _admin_web_proxy_key
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};

function loadIndex(sdk) {
  activeSdk = sdk;
  delete require.cache[require.resolve('../zz-seed-orders/index.js')];
  return require('../zz-seed-orders/index.js');
}

const ADMIN = 'o_admin_1';
// scene_list 为空 → 通过鉴权后必然返回 no_scenes，便于区分「鉴权通过」与「鉴权被拒」
function seedStore(extra) {
  return {
    admin_config: { global: Object.assign({ env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000, admin_openids: [ADMIN], admin_web_key: 'AWK-test-key', scene_list: [] }, extra || {}) },
    demand: {}
  };
}

// 1. 陌生人(真实 OPENID 非管理员, 且无代理密钥) → seed_forbidden
test('zz-seed-orders: 非管理员且无代理密钥 → seed_forbidden', async () => {
  const sdk = makeSdk({ openid: 'o_stranger', store: seedStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'run', mock_openid: 'seed_admin' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'seed_forbidden');
});

// 2. 伪造 mock_openid 冒充管理员(无 OPENID、无密钥) → 仍被拒
test('zz-seed-orders: mock_openid 不再被信任 → seed_forbidden', async () => {
  const sdk = makeSdk({ openid: '', store: seedStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'run', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'seed_forbidden');
});

// 3. 管理员直调(真实 OPENID ∈ admin_openids) → 通过鉴权(此处因 scene_list 空 → no_scenes)
test('zz-seed-orders: 管理员直调 → 通过鉴权(no_scenes)', async () => {
  const sdk = makeSdk({ openid: ADMIN, store: seedStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'run' }, {});
  assert.strictEqual(r.code, 'no_scenes');
});

// 4. admin-web 代理携合法共享密钥(无 OPENID) → 通过鉴权
test('zz-seed-orders: 代理携合法 _admin_web_proxy_key → 通过鉴权(no_scenes)', async () => {
  const sdk = makeSdk({ openid: '', store: seedStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'run', mock_openid: 'seed_admin', _admin_web_proxy_key: 'AWK-test-key' }, {});
  assert.strictEqual(r.code, 'no_scenes');
});

// 5. 代理密钥错误 → 拒绝
test('zz-seed-orders: 代理密钥错误 → seed_forbidden', async () => {
  const sdk = makeSdk({ openid: '', store: seedStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'run', mock_openid: 'seed_admin', _admin_web_proxy_key: 'AWK-wrong' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'seed_forbidden');
});

// 6. admin_openids 为空 → 一律拒绝(防首调用者夺权后滥用)
test('zz-seed-orders: admin_openids 为空 → seed_forbidden', async () => {
  const sdk = makeSdk({ openid: 'o_anyone', store: seedStore({ admin_openids: [], admin_web_key: '' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'run', mock_openid: 'seed_admin', _admin_web_proxy_key: '' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'seed_forbidden');
});

test.after(() => { Module._load = origLoad; });
