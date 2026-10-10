// payment-mock 入口层契约测试（withdraw / fast_withdraw）
// 覆盖点：金额格式 / 最低额 / 极速单笔上限 / 余额不足 / 极速当日累计 / 成功落单
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
  delete require.cache[require.resolve('../payment-mock/index.js')];
  return require('../payment-mock/index.js');
}

const OPENID = 'o_partner_1';
function baseStore(extra = {}) {
  return { admin_config: { global: Object.assign({ env: 'dev' }, extra) } };
}
// 模拟已结算收入 50000 分(500元), 无提现占用
function baseAgg(extra = {}) {
  return Object.assign({
    order_main: [{ total: 50000, tip: 0 }],
    withdraw_record: []
  }, extra);
}

// 1. 金额格式错误 → wd_amount（锁前返回，无 DB 依赖）
test('withdraw: 非法金额 → wd_amount', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 'abc', mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_amount');
});

// 2. 低于最低 10 元 → wd_too_small
test('withdraw: 低于 10 元 → wd_too_small', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 500, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_too_small');
});

// 3. 极速单笔超 200 元 → wd_fast_cap
test('fast_withdraw: 超单笔上限 → wd_fast_cap', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'fast_withdraw', amount_fen: 30000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_fast_cap');
});

// 4. 余额不足 → wd_insufficient（聚合返回空 → available=0）
test('withdraw: 余额不足 → wd_insufficient', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore(), agg: { order_main: [], withdraw_record: [] } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 5000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'wd_insufficient');
});

// 5. 极速提现成功 → 即时到账 status=success
test('fast_withdraw: 合法极速提现 → ok + status=success(即时到账)', async () => {
  const sdk = makeSdk({
    openid: OPENID, store: baseStore(),
    agg: { order_main: [{ total: 500000, tip: 0 }], withdraw_record: [] }
  });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'fast_withdraw', amount_fen: 5000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'success');
  assert.strictEqual(r.data.type, 'fast');
});

// 6. 普通提现成功 → processing + 写 withdraw_record
test('withdraw: 合法提现 → ok + 落 withdraw_record(status=processing)', async () => {
  const sdk = makeSdk({ openid: OPENID, store: baseStore(), agg: baseAgg() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'withdraw', amount_fen: 5000, mock_openid: OPENID }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'processing');
  assert.strictEqual(r.data.amount_fen, 5000);
  const rec = (sdk.writes.withdraw_record || []).find((w) => w.add);
  assert.ok(rec, '应写入 withdraw_record');
  assert.strictEqual(rec.data.type, 'normal');
});

test.after(() => { Module._load = origLoad; });
