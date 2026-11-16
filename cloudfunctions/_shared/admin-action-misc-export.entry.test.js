// admin-action 入口契约测试 · 批9 杂项/订单处置/导出/配置族（收尾）
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
const DOC = 'a'.repeat(32);

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// ── upload_image ──
test('upload_image: 图片数据为空 → up_bad_data', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'upload_image', fileData: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'up_bad_data');
});

test('upload_image: 超过 2MB → up_too_big', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  // 3M 个 'A' base64 → 解码约 2.25MB > 2MB
  const r = await main({ action: 'upload_image', fileData: 'A'.repeat(3 * 1024 * 1024), mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'up_too_big');
});

test('upload_image: 不支持的格式 → up_bad_ext', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  // 'hello world' 的 base64，不含 jpg/png/webp 魔数
  const b64 = Buffer.from('hello world').toString('base64');
  const r = await main({ action: 'upload_image', fileData: b64, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'up_bad_ext');
});

// ── evidence_query ──
test('evidence_query: evidence_id 非法 → eq_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'evidence_query', evidence_id: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'eq_bad_id');
});

test('evidence_query: 留证记录不存在 → eq_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.disclaimer_signature = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'evidence_query', evidence_id: DOC, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'eq_not_found');
});

test('evidence_query: openid 非法 → eq_bad_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'evidence_query', openid: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'eq_bad_openid');
});

// ── demand_offline ──
test('demand_offline: demand_id 非法 → demand_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'demand_offline', demand_id: 'bad', note: 'x', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'demand_bad_id');
});

test('demand_offline: 缺下架原因 → demand_no_note', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'demand_offline', demand_id: DOC, note: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'demand_no_note');
});

test('demand_offline: 需求不存在 → demand_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.demand = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'demand_offline', demand_id: DOC, note: '违规', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'demand_not_found');
});

test('demand_offline: 状态非 matching → demand_bad_status', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.demand = { [DOC]: { _id: DOC, status: 'completed' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'demand_offline', demand_id: DOC, note: '违规', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'demand_bad_status');
});

// ── order_force_cancel ──
test('order_force_cancel: order_id 非法 → order_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'order_force_cancel', order_id: 'bad', note: 'x', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_bad_id');
});

test('order_force_cancel: 缺取消原因 → cancel_no_note', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'order_force_cancel', order_id: DOC, note: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'cancel_no_note');
});

test('order_force_cancel: 订单不存在 → order_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'order_force_cancel', order_id: DOC, note: '违规', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_not_found');
});

// ── order_detail ──
test('order_detail: order_id 非法 → order_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'order_detail', order_id: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_bad_id');
});

test('order_detail: 订单不存在 → order_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.order_main = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'order_detail', order_id: DOC, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'order_not_found');
});

// ── export ──
test('export_collection: 缺 confirm → export_need_confirm', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'export_collection', collection: 'user_account', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'export_need_confirm');
});

test('export_collection: 集合不在白名单 → export_bad_collection', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'export_collection', confirm: true, collection: 'evil_coll', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'export_bad_collection');
});

// ── config_set ──
test('config_set: 无修改字段 → config_no_change', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_no_change');
});

test('config_set: env 非法 → config_bad_env', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', env: 'staging', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_bad_env');
});

test('config_set: admin_web_key 格式非法 → config_bad_key', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', admin_web_key: 'bad_key', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_bad_key');
});

test.after(() => { Module._load = origLoad; });
