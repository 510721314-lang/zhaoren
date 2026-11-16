// admin-action 入口契约测试 · 批4 财务族（finance_stats / withdraw_review）
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
const DOC = 'a'.repeat(32); // 合法 docId（32 hex）

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

const DAY = 86400000;

// ── finance_stats ──
test('finance_stats: start>=end → fs_bad_range', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'finance_stats', start_ts: 2000, end_ts: 1000, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'fs_bad_range');
});

test('finance_stats: 区间超 90 天 → fs_range_too_long', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const now = Date.now();
  const r = await main({ action: 'finance_stats', start_ts: now - 91 * DAY, end_ts: now, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'fs_range_too_long');
});

test('finance_stats: 开始时间过早 → fs_bad_start', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  // s=2001-09-09 (< 1577808000000=2020-01-01), e=s+1s
  const s = 1000000000000;
  const r = await main({ action: 'finance_stats', start_ts: s, end_ts: s + 1000, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'fs_bad_start');
});

test('finance_stats: 结束时间晚于明天 → fs_bad_end', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const now = Date.now();
  const r = await main({ action: 'finance_stats', start_ts: now - 1000, end_ts: now + 3 * DAY, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'fs_bad_end');
});

// ── withdraw_review ──
test('withdraw_review: decision 非法 → wr_bad_decision', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw_review', withdraw_id: DOC, decision: 'xxx', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wr_bad_decision');
});

test('withdraw_review: reject 无原因 → wr_need_reason', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw_review', withdraw_id: DOC, decision: 'reject', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wr_need_reason');
});

test('withdraw_review: withdraw_id 非法 → wr_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw_review', withdraw_id: 'bad', decision: 'approve', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wr_bad_id');
});

test('withdraw_review: 提现记录不存在 → wr_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.withdraw_record = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw_review', withdraw_id: DOC, decision: 'approve', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wr_not_found');
});

test('withdraw_review: 状态非 processing → wr_status', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.withdraw_record = { [DOC]: { _id: DOC, status: 'success', is_deleted: false } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw_review', withdraw_id: DOC, decision: 'approve', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wr_status');
});

test.after(() => { Module._load = origLoad; });
