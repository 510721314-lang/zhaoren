// evaluation-submit 入口层契约测试（submit 评价 S5→S8 / get_default_star）
// 覆盖点：身份 / 非法输入 / 订单归属 / 冻结位 / 状态门 / 成功(信用分+落库+状态流水)
// 该函数未参与 index.js 拆分，故用契约测试(mock SDK)而非 A/B 等价证明。
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
  delete require.cache[require.resolve('../evaluation-submit/index.js')];
  return require('../evaluation-submit/index.js');
}

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);

function baseStore(orderExtra = {}, extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    order_main: { [OID]: Object.assign({ _id: OID, order_no: 'ORD-1', status: 'S5', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 }, orderExtra) },
    user_account: { u1: { _id: 'u1', openid: PARTNER, partner_credit_score: 800 } },
    evaluation: {}, credit_score_log: {}, order_status_log: {}, system_notice: {}
  }, extra);
}

// 1. 默认星数
test('get_default_star: → ok + default_star=4', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'get_default_star', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.default_star, 4);
});

// 2. 缺 order_id
test('submit: 缺 order_id → ev_no_order', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_no_order');
});

// 3. 非法 order_id（订单号而非 _id）
test('submit: 非法 order_id → ev_bad_order_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: 'ORD123', star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_bad_order_id');
});

// 4. 非法星数
test('submit: star=6 → ev_star_invalid', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 6, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_star_invalid');
});

// 5. 订单不存在
test('submit: 订单不存在 → ev_not_found', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({}, { order_main: {} }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_not_found');
});

// 6. 非下单用户
test('submit: 非下单用户 → ev_not_owner', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: PARTNER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_not_owner');
});

// 7. 冻结位（争议处理中）
test('submit: 订单冻结 → ev_order_frozen', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ frozen: true }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_order_frozen');
});

// 8. 状态门（非 S5 且无评价记录）
test('submit: 状态非 S5 无评价 → ev_status', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S2' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_status');
});

// 9. 成功：S5→S8 + 信用分 +2 + 落 evaluation/信用流水/状态流水
test('submit: 成功 S5→S8 star=5 → 信用分+2 且四个集合落库', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'S8');
  assert.strictEqual(r.data.credit_delta, 2);
  // 订单 CAS 更新
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === OID);
  assert.ok(upd, '应对 order_main 做状态更新');
  assert.strictEqual(upd.data.status, 'S8');
  // 事务内三类落库
  assert.ok((sdk.writes.evaluation || []).some((w) => w.add), '应写 evaluation');
  assert.ok((sdk.writes.credit_score_log || []).some((w) => w.add), '应写 credit_score_log');
  assert.ok((sdk.writes.order_status_log || []).some((w) => w.add), '应写 order_status_log');
});

// 10. 幂等：已有评价记录 → 直接返回 idempotent
test('submit: 已有评价 → 幂等返回 idempotent', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({}, { evaluation: { e1: { _id: 'e1', order_id: OID, star: 4, is_deleted: false } } }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.idempotent, true);
  assert.strictEqual(r.data.star, 4);
});

// 11. CAS 未抢到(并发竞争落败, 且无重复评价记录) → ev_status_conflict
test('submit: CAS 未抢到且无重复评价 → ev_status_conflict', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore(), updateCount: 0 });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ev_status_conflict');
});

// 12. 评价激励(需求D 2026-10-14): 配置非 0 → 评价成功后双方分别发放(现金 mock + 信用分) + 幂等标记 + 通知
test('submit: 配置评价激励 → 双方各发一笔(mock) + 幂等标记 + 通知', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({}, {
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 3600000,
      eval_reward_user_fen: 100, eval_reward_user_credit: 2,
      eval_reward_partner_fen: 200, eval_reward_partner_credit: 5 } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const rewards = (sdk.writes.pay_transaction || []).filter((w) => w.add && w.data.type === 'eval_reward');
  assert.strictEqual(rewards.length, 2, '双方各一笔现金激励');
  assert.ok(rewards.every((w) => w.data.is_mock === true), '现金激励必须 is_mock');
  assert.ok((sdk.writes.order_main || []).some((w) => w.data && w.data.eval_reward_at), '应写幂等标记 eval_reward_at');
  assert.ok((sdk.writes.system_notice || []).some((w) => w.add && w.data.type === 'eval_reward'), '应通知激励发放');
});

// 13. 评价激励缺省(全 0) → 不发放
test('submit: 评价激励缺省 0 → 不发放(无 eval_reward 流水)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'submit', order_id: OID, star: 5, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const rewards = (sdk.writes.pay_transaction || []).filter((w) => w.add && w.data.type === 'eval_reward');
  assert.strictEqual(rewards.length, 0);
});

test.after(() => { Module._load = origLoad; });
