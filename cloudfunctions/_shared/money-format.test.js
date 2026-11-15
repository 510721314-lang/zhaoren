// 金额展示精度守护测试(2026-11-15 双代理评审修复配套)
// 背景: 多处「分→元」用 Math.round(fen/100), 把 19.90 元(1990 分)抬成 20, 首页/会话摘要/变更文案显示错值。
// 本测试固定 1990 分夹具, 断言三处展示口径为两位小数; 若有人改回 Math.round, 这里必须 FAIL。
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadFn(rel) {
  delete require.cache[require.resolve(rel)];
  return require(rel);
}
const loadIndex = (sdk) => { activeSdk = sdk; return loadFn('../im-conv/index.js'); };

const USER = 'o_user_1';
const OTHER = 'o_other';
const OID = 'a'.repeat(32);
const CID = 'c'.repeat(32);
const DID = 'd'.repeat(32);

// 1990 分 = 19.90 元(取整会变成 20, 是本测试要守住的边界)
const FEN = 1990;

test('im-conv my_convs: 会话订单摘要金额 1990 分 → ¥19.90(非 ¥20)', async () => {
  const sdk = makeSdk({ openid: USER, store: {
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    im_conversation: { [CID]: { _id: CID, order_id: OID, order_no: 'ORD1', user_openid: USER, partner_openid: OTHER, is_deleted: false, last_msg_at: 1, user_unread: 0, partner_unread: 0 } },
    order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: OTHER, content_options: ['遛狗'], demand_id: DID, total_fen: FEN, duration_h: 1 } },
    demand: {}
  } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'my_convs', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const c = (r.data.list || [])[0];
  assert.ok(c, '应返回会话');
  assert.ok(String(c.order_summary.l1).includes('¥19.90'), `摘要应为 ¥19.90, 实际: ${c.order_summary.l1}`);
  assert.ok(!String(c.order_summary.l1).includes('¥20 '), '不得出现被取整的 ¥20');
});

test('order-action my_orders: 订单摘要 1990 分 → ¥19.90(非 ¥20)', async () => {
  activeSdk = makeSdk({ openid: USER, store: {
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    order_main: { [OID]: { _id: OID, order_no: 'ORD1', status: 'S2', user_openid: USER, partner_openid: OTHER, scene: 'W1', total_fen: FEN, duration_h: 1, created_at: 1000, start_time: 2000, is_deleted: false } },
    demand: {}, user_account: {}, order_status_log: {}, complaint: {}, pay_transaction: {}
  } });
  const { main } = loadFn('../order-action/index.js');
  const r = await main({ action: 'my_orders', role: 'user', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const list = (r.data && (r.data.list || r.data.orders)) || [];
  const o = list.find((x) => x.order_id === OID) || list[0];
  assert.ok(o, '应返回订单');
  const l1 = o.order_summary && o.order_summary.l1 ? o.order_summary.l1 : JSON.stringify(o.order_summary);
  assert.ok(String(l1).includes('¥19.90'), `摘要应为 ¥19.90, 实际: ${l1}`);
});

test('home-action square: 需求 1990 分 → budget_text=19.90 且 budget=19.9(不再取整为 20)', async () => {
  activeSdk = makeSdk({ openid: USER, store: {
    admin_config: { global: {
      env: 'dev', dev_until: Date.now() + 3600 * 1000, take_distance_max_km: 50,
      scene_list: [{ code: 'W1', name: '就医陪诊', options: ['陪同挂号'], visible: true, builtin: true }]
    } },
    partner_profile: {},
    demand: { [DID]: { _id: DID, demand_no: 'DR-1990', scene: 'W1', status: 'matching', is_deleted: false, broadcast: true, match_mode: 'broadcast', creator_openid: OTHER, created_at: Date.now() - 60000, start_time: Date.now() + 3600000, expire_at: Date.now() + 7200000, location: { name: '成都市', city: '成都', latitude: 30.55, longitude: 104.05 }, rate_fen: FEN, pricing_type: 'hourly' } },
    user_account: {}, blog_post: {}, system_notice: {}, audit_log: {}
  } });
  const { main } = loadFn('../home-action/index.js');
  const r = await main({ action: 'square', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const list = (r.data && (r.data.list || r.data.demands)) || [];
  const d = list.find((x) => x._id === DID) || list[0];
  assert.ok(d, '应返回需求');
  assert.strictEqual(d.budget_text, '19.90', `budget_text 应为两位小数字符串, 实际: ${d.budget_text}`);
  assert.strictEqual(d.budget, 19.9, `budget 应为 19.9, 实际: ${d.budget}`);
});
