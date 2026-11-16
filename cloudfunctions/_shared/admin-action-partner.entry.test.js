// admin-action 入口契约测试 · 批7 耍伴/用户详情与审核族
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
const OPENID = 'o_target_user_123';

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// ── partner_detail ──
test('partner_detail: openid 非法 → detail_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_detail', target_openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'detail_bad_openid');
});

test('partner_detail: 耍伴不存在 → partner_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.partner_profile = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_detail', target_openid: OPENID, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'partner_not_found');
});

// ── user_detail ──
test('user_detail: openid 非法 → detail_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_detail', target_openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'detail_bad_openid');
});

test('user_detail: 用户不存在 → user_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.user_account = {};
  store.emergency_contact = {};
  store.demand = {};
  store.order_main = {};
  store.credit_score_log = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_detail', target_openid: OPENID, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'user_not_found');
});

// ── partner_online ──
test('partner_online: openid 非法 → partner_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_online', target_openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'partner_bad_openid');
});

test('partner_online: 耍伴不存在 → partner_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.partner_profile = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_online', target_openid: OPENID, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'partner_not_found');
});

test('partner_online: 状态非 approved → partner_not_approved', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.partner_profile = { [OPENID]: { _id: OPENID, openid: OPENID, status: 'pending', is_deleted: false } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_online', target_openid: OPENID, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'partner_not_approved');
});

// ── partner_profile_review ──
test('partner_profile_review: openid 非法 → pp_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_profile_review', target_openid: 'bad', items: [], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pp_bad_openid');
});

test('partner_profile_review: 耍伴不存在 → pp_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.partner_profile = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_profile_review', target_openid: OPENID, items: [], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pp_not_found');
});

test('partner_profile_review: 不在审核队列 → pp_no_pending', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.partner_profile = { [OPENID]: { _id: OPENID, openid: OPENID, profile_audit_status: 'approved', is_deleted: false } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_profile_review', target_openid: OPENID, items: [{ field: 'bio' }], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pp_no_pending');
});

test('partner_profile_review: 缺审核项 → pp_no_items', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.partner_profile = { [OPENID]: { _id: OPENID, openid: OPENID, profile_audit_status: 'pending', is_deleted: false } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'partner_profile_review', target_openid: OPENID, items: [], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pp_no_items');
});

// ── review（耍伴入驻审核）──
test('review: 缺 openid → review_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'review', decision: 'approve', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'review_no_openid');
});

test('review: decision 非法 → review_bad_decision', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'review', target_openid: OPENID, decision: 'xxx', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'review_bad_decision');
});

test('review: 耍伴申请不存在 → review_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.partner_profile = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'review', target_openid: OPENID, decision: 'approve', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'review_not_found');
});

// ── user_ec_update ──
test('user_ec_update: openid 非法 → ec_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_ec_update', target_openid: 'bad', contacts: [], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ec_bad_openid');
});

test('user_ec_update: 联系人数非法 → ec_count', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_ec_update', target_openid: OPENID, contacts: [], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ec_count');
});

test('user_ec_update: 姓名/手机号格式有误 → ec_field', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_ec_update', target_openid: OPENID, contacts: [{ name: '', phone: '123' }], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ec_field');
});

test('user_ec_update: 手机号加密密钥未配置 → ec_no_key', async () => {
  const store = baseStore('dev', [ADMIN]);
  // admin_config.global 无 phone_aes_key → readPhoneKey 返回 '' → ec_no_key
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_ec_update', target_openid: OPENID, contacts: [{ name: '张三', phone: '13800138000' }], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ec_no_key');
});

test.after(() => { Module._load = origLoad; });
