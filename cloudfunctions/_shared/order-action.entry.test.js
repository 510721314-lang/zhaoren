// order-action 入口层契约测试（mock wx-server-sdk，仅测「输入 → 返回码」，不改运行逻辑）
// 覆盖点：nudge_partner 的越权/归属/准入校验 —— 评审指出的最脆弱入口之一。
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

// 在 require('../order-action/index') 之前拦截 wx-server-sdk
let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};

function loadIndex(sdk) {
  activeSdk = sdk;
  // 清掉可能已缓存的 index（不同测试用不同 sdk 实例）
  delete require.cache[require.resolve('../order-action/index.js')];
  return require('../order-action/index.js');
}

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);

function baseStore(extra = {}) {
  return {
    admin_config: { global: { env: 'dev' } },
    order_main: {
      [OID]: Object.assign({
        _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER,
        start_time: Date.now() - 60 * 1000, urge_count: 0
      }, extra)
    }
  };
}

// 1. 非发单人催办 → 越权拒绝
test('nudge_partner: 非订单发单人 → oa_not_owner', async () => {
  const sdk = makeSdk({ openid: 'o_stranger', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: 'o_stranger' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_owner');
});

// 2. 服务未到开始时间 → oa_urge_not_started
test('nudge_partner: 未到 start_time → oa_urge_not_started', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ start_time: Date.now() + 60 * 60 * 1000 }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_urge_not_started');
});

// 3. 订单不存在 → oa_not_found
test('nudge_partner: 订单不存在 → oa_not_found', async () => {
  const sdk = makeSdk({ openid: USER, store: { admin_config: { global: { env: 'dev' } }, order_main: {} } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_found');
});

// 4. 缺 order_id → oa_bad_order_id（分发层预检，无需进 DB）
test('nudge_partner: 缺 order_id → oa_bad_order_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_bad_order_id');
});

// 5. 成功路径 → ok 且写入催办记录
test('nudge_partner: 合法催办 → ok + 写 order_main 与 system_notice', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.urge_count, 1);
  assert.ok(sdk.writes.order_main, '应写入 order_main');
  const notice = (sdk.writes.system_notice || []).find((w) => w.add && w.data.type === 'nudge');
  assert.ok(notice, '应向耍伴写入 nudge 站内通知');
  assert.strictEqual(notice.data.to_openid, PARTNER);
});

// 6. cancel: 非订单参与方 → oa_not_participant（roleOf 门，与 nudge 的精确匹配门互补）
test('cancel: 非参与方 → oa_not_participant', async () => {
  const sdk = makeSdk({ openid: 'o_stranger', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel', order_id: OID, mock_openid: 'o_stranger' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_participant');
});

// 还原 Module._load，避免污染后续测试文件
test.after(() => { Module._load = origLoad; });
