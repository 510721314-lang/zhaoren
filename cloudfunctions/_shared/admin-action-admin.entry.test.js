// admin-action 入口契约测试 · 批8 管理员账号与名单族
// 只增不改：拦截 wx-server-sdk，断言「event 输入 → 返回 code」契约，零运行时改动。
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
  for (const f of ['../admin-action/index.js', '../admin-action/openid.js', '../admin-action/logger.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../admin-action/index.js');
}

const ADMIN = 'o_admin_12345';
const OTHER = 'o_other_admin_1';

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// ── admin_account_create ──
test('admin_account_create: 登录名格式非法 → acc_bad_account', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_account_create', account: 'ab', password: 'password123', role: 'R1', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'acc_bad_account');
});

test('admin_account_create: 密码过短 → acc_bad_pwd', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_account_create', account: 'admin01', password: '1234567', role: 'R1', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'acc_bad_pwd');
});

test('admin_account_create: 角色非法 → acc_bad_role', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_account_create', account: 'admin01', password: 'password123', role: 'R9', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'acc_bad_role');
});

// ── admin_account_set_status ──
test('admin_account_set_status: 状态非法 → acc_bad_status', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_account_set_status', account: 'admin01', status: 'xxx', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'acc_bad_status');
});

test('admin_account_set_status: 账号不存在 → acc_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.admin_accounts = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_account_set_status', account: 'ghost', status: 'disabled', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'acc_not_found');
});

// ── admin_add ──
test('admin_add: openid 非法 → admin_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_add', target_openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_bad_openid');
});

test('admin_add: 已是管理员 → admin_exists', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN, OTHER]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_add', target_openid: OTHER, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_exists');
});

// ── admin_remove ──
test('admin_remove: openid 非法 → admin_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_remove', target_openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_bad_openid');
});

test('admin_remove: 不能移除自己 → admin_cannot_remove_self', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN, OTHER]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_remove', target_openid: ADMIN, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_cannot_remove_self');
});

test('admin_remove: 至少保留 1 名 → admin_last_one', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  // target 不是自己也不在名单，但名单只剩 1 人
  const r = await main({ action: 'admin_remove', target_openid: OTHER, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_last_one');
});

test('admin_remove: 不在管理员名单 → admin_not_found', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN, OTHER]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_remove', target_openid: 'o_ghost_12345', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_not_found');
});

// ── claim_admin（runTransaction 不支持，仅测早期 fail）──
test('claim_admin: 无 openid → admin_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', []) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'claim_admin' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_no_openid');
});

test.after(() => { Module._load = origLoad; });
