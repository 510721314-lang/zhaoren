// demand-publish 入口层契约测试（publish / cancel / detail / save_draft / delete_draft）
// 覆盖点：身份 / 未知动作 / 场景白名单 / 时间校验 / ID 格式 / 草稿空内容
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
function loadIndex(sdk) {
  activeSdk = sdk;
  delete require.cache[require.resolve('../demand-publish/index.js')];
  return require('../demand-publish/index.js');
}

const USER = 'o_user_1';
const DID = 'd'.repeat(32);

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    user_account: { u1: { _id: 'u1', openid: USER } },
    demand: {}
  }, extra);
}

test('无 OPENID → publish_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish' }, {});
  assert.strictEqual(r.code, 'publish_no_openid');
});

test('未知动作 → publish_unknown_action', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'bogus', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'publish_unknown_action');
});

test('publish 场景不在白名单 → publish_scene_invalid', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish', scene: 'ZZZ', start_time: Date.now() + 3600000, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'publish_scene_invalid');
});

test('publish 开始时间非未来 → publish_start_time', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish', scene: 'W1', start_time: Date.now() - 1000, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'publish_start_time');
});

test('cancel 缺 demand_id → cancel_no_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'cancel_no_id');
});

test('cancel 非法 id → cancel_bad_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel', demand_id: 'DR123', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'cancel_bad_id');
});

test('detail 缺 demand_id → detail_no_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'detail', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'detail_no_id');
});

test('detail 非法 id → detail_bad_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'detail', demand_id: 'DR123', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'detail_bad_id');
});

test('save_draft 空内容 → draft_no_data', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'save_draft', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'draft_no_data');
});

test('delete_draft 缺 draft_id → draft_no_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'delete_draft', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'draft_no_id');
});

test('publish 代发座机号 → publish_proxy_phone（2026-10-16 取消座机仅留手机号）', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({
    action: 'publish', mock_openid: USER,
    scene: 'W1', start_time: Date.now() + 3600000, duration_h: 2, rate_fen: 10000,
    aa_tier: '0-50', aa_promise_checked: true, disclaimer_signed: true,
    publish_type: 'proxy', proxy_authorized: true,
    location: { name: '北京协和医院', latitude: 39.9042, longitude: 116.4074 },
    service_target: { name: '李四', relation: '父母', phone: '028-88888888' }
  }, {});
  assert.strictEqual(r.code, 'publish_proxy_phone');
  assert.strictEqual(r.msg, '请填写正确的手机号');
});

// my_demands 按 demand.remark 全角｜拆出需求标题/详细描述(2026-10-17 新增展示)
test('my_demands: 拆出 demand_title/demand_desc', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    demand: { [DID]: { _id: DID, creator_openid: USER, is_deleted: false, status: 'matching', demand_no: 'DR1', remark: '帮我搬家｜三件大家电，三楼无电梯' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'my_demands', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const d = (r.data.list || [])[0];
  assert.ok(d, '应返回需求');
  assert.strictEqual(d.demand_title, '帮我搬家');
  assert.strictEqual(d.demand_desc, '三件大家电，三楼无电梯');
  assert.strictEqual(d.demand_no, 'DR1', '既有字段不受影响');
});

// 无全角｜时: 标题兜底 content_options[0]、描述为空(2026-10-17 新增展示)
test('my_demands: 无｜时标题兜底 content_options[0]', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    demand: { [DID]: { _id: DID, creator_openid: USER, is_deleted: false, status: 'matching', content_options: ['陪同挂号'], remark: '' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'my_demands', mock_openid: USER }, {});
  const d = (r.data.list || [])[0];
  assert.ok(d, '应返回需求');
  assert.strictEqual(d.demand_title, '陪同挂号');
  assert.strictEqual(d.demand_desc, '');
});

test.after(() => { Module._load = origLoad; });
