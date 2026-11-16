// admin-action 入口契约测试 · 批1 用户管理族（user_ban/freeze/credit_adjust/penalty）
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

const ADMIN = 'o_admin_1';
const TARGET = 'o_target_1';

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// user_freeze / user_unfreeze
test('user_freeze: 无 target_openid → freeze_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_freeze', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'freeze_bad_openid');
});

test('user_unfreeze: 无 target_openid → freeze_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_unfreeze', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'freeze_bad_openid');
});

test('user_freeze: 有效 openid 但用户不存在 → user_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_freeze', target_openid: TARGET, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'user_not_found');
});

// user_credit_adjust
test('user_credit_adjust: 无 target_openid → credit_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_credit_adjust', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'credit_bad_openid');
});

test('user_credit_adjust: delta=0 → credit_bad_delta', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_credit_adjust', target_openid: TARGET, delta: 0, reason: 'r', score_type: 'user', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'credit_bad_delta');
});

test('user_credit_adjust: delta=101(超上限) → credit_bad_delta', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_credit_adjust', target_openid: TARGET, delta: 101, reason: 'r', score_type: 'user', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'credit_bad_delta');
});

test('user_credit_adjust: 无 reason → credit_no_reason', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_credit_adjust', target_openid: TARGET, delta: 10, score_type: 'user', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'credit_no_reason');
});

test('user_credit_adjust: score_type 非法 → credit_bad_type', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_credit_adjust', target_openid: TARGET, delta: 10, reason: 'r', score_type: 'xxx', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'credit_bad_type');
});

test('user_credit_adjust: 用户不存在 → user_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_credit_adjust', target_openid: TARGET, delta: 10, reason: 'r', score_type: 'user', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'user_not_found');
});

// user_ban / user_unban
test('user_ban: 无 target_openid → ban_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_ban', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ban_bad_openid');
});

test('user_unban: 无 target_openid → ban_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_unban', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ban_bad_openid');
});

test('user_ban: 用户不存在 → ban_user_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_ban', target_openid: TARGET, reason: 'r', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ban_user_not_found');
});

test('user_ban: 无 reason → ban_no_reason', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = { u1: { _id: 'u1', openid: TARGET, status: 'normal' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_ban', target_openid: TARGET, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ban_no_reason');
});

// penalty
test('penalty: 无 target_openid → pen_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'penalty', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pen_bad_openid');
});

test('penalty: level 非法 → pen_bad_level', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'penalty', target_openid: TARGET, level: 'xxx', reason: 'r', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pen_bad_level');
});

test('penalty: 用户不存在 → pen_user_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'penalty', target_openid: TARGET, level: 'warning', reason: 'r', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pen_user_not_found');
});

test('penalty: 无 reason → pen_no_reason', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = { u1: { _id: 'u1', openid: TARGET, status: 'normal' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'penalty', target_openid: TARGET, level: 'warning', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pen_no_reason');
});

test.after(() => { Module._load = origLoad; });
