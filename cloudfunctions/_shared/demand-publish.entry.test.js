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

// ── 需求标题/详细描述字数上限(publish_title_max_len / publish_desc_max_len 后台可配; 缺省 20 / 200) ──
// 2026-10-18: 由「整串总闸」改为「标题、描述分别可配 + 服务端分别校验」; 落库仍拼回 remark(展示口径不变)
const PUB_UID = 'u'.repeat(32);
function pubStore(over = {}) {
  return Object.assign({
    admin_config: { global: {
      env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000,
      scene_list: [{ code: 'W1', name: '就医陪诊', options: ['陪同挂号', '取药', '陪检'], visible: true, builtin: true, disclaimer_type: 'medical_disclaimer' }],
      legal_scene_disclaimers: { W1: 'W1 就医陪诊场景免责声明全文' },
      rate_min_fen: 3000, rate_max_fen: 10000,
      min_credit_place_order: 600, min_credit_take_order: 600,
      city_enabled: ['成都'], publish_distance_max_km: 50, take_distance_max_km: 50,
      welfare_fixed_price_fen: 5000
    } },
    user_account: { [PUB_UID]: { _id: PUB_UID, openid: USER, nickname: '张三', surname: '张', status: 'normal', is_realname_done: true, user_credit_score: 800, age: null, is_deleted: false } },
    emergency_contact: {}, partner_profile: {}, demand_draft: {}, disclaimer_signature: {},
    demand: {}, order_main: {}, system_notice: {}, audit_log: {}, platform_event: {}
  }, over || {});
}
// 可穿透的 publish 入参(除标题/描述外全部合法); extra 覆盖 action / demand_id / title / description / remark 等
function pubEvent(extra = {}) {
  return Object.assign({
    action: 'publish', mock_openid: USER, device: 'test',
    scene: 'W1', start_time: Date.now() + 3600000, duration_h: 1,
    location: { name: '成都武侯区某医院', latitude: 30.55, longitude: 104.05, city: '成都' },
    publish_location: { name: '当前位置', latitude: 30.55, longitude: 104.05, city: '成都' },
    aa_tier: '0-50', aa_promise_checked: true, disclaimer_signed: true,
    content_options: ['陪同挂号'], rate_fen: 5000, match_mode: 'broadcast',
    publish_type: 'self', contact_phone: '13800000000', headcount: 1
  }, extra || {});
}

test('publish: 标题超默认上限(21字) → publish_title_long「需求标题最长 20 字」', async () => {
  const sdk = makeSdk({ openid: USER, store: pubStore() });
  const { main } = loadIndex(sdk);
  const r = await main(pubEvent({ title: '标'.repeat(21), description: '正常描述' }), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'publish_title_long');
  assert.strictEqual(r.msg, '需求标题最长 20 字');
});

test('publish: 描述超默认上限(201字) → publish_desc_long「详细描述最长 200 字」', async () => {
  const sdk = makeSdk({ openid: USER, store: pubStore() });
  const { main } = loadIndex(sdk);
  const r = await main(pubEvent({ title: '正常标题', description: '描'.repeat(201) }), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'publish_desc_long');
  assert.strictEqual(r.msg, '详细描述最长 200 字');
});

test('publish: 后台 publish_title_max_len=5 / publish_desc_max_len=50 生效(证明可配)', async () => {
  const store = pubStore();
  store.admin_config.global.publish_title_max_len = 5;
  store.admin_config.global.publish_desc_max_len = 50;
  const sdk = makeSdk({ openid: USER, store });
  const { main } = loadIndex(sdk);
  const r1 = await main(pubEvent({ title: '标'.repeat(6), description: '正常描述' }), {});
  assert.strictEqual(r1.code, 'publish_title_long');
  assert.strictEqual(r1.msg, '需求标题最长 5 字', '标题上限应取自后台配置而非硬编码 20');
  const r2 = await main(pubEvent({ title: '正常标题', description: '描'.repeat(51) }), {});
  assert.strictEqual(r2.code, 'publish_desc_long');
  assert.strictEqual(r2.msg, '详细描述最长 50 字', '描述上限应取自后台配置而非硬编码 200');
});

test('publish: 标题/描述在限内 → 成功穿透落库, 且服务端拼回 remark(独立行为守护)', async () => {
  const sdk = makeSdk({ openid: USER, store: pubStore() });
  const { main } = loadIndex(sdk);
  const r = await main(pubEvent({ title: '帮我搬家', description: '三件大家电，三楼无电梯' }), {});
  assert.strictEqual(r.ok, true, `应发布成功, 实际: ${r.code || ''} ${r.msg || ''}`);
  const added = (sdk.writes.demand || []).filter((w) => w.add);
  assert.strictEqual(added.length, 1, '应写库 1 条 demand');
  assert.strictEqual(added[0].data.remark, '帮我搬家｜三件大家电，三楼无电梯');
  assert.strictEqual(added[0].data.creator_openid, USER);
});

test('publish: 旧客户端只传 remark 整串 → 派生总上限(20+1+200=221)兜底: 221 放行 / 222 拒', async () => {
  const sdk = makeSdk({ openid: USER, store: pubStore() });
  const { main } = loadIndex(sdk);
  const okR = await main(pubEvent({ remark: 'x'.repeat(221) }), {});
  assert.strictEqual(okR.ok, true, `221 字应放行, 实际: ${okR.code || ''} ${okR.msg || ''}`);
  const badR = await main(pubEvent({ remark: 'x'.repeat(222) }), {});
  assert.strictEqual(badR.code, 'publish_remark_long');
  assert.strictEqual(badR.msg, '备注最长 221 字');
});

test('update: 标题超默认上限 → update_title_long「需求标题最长 20 字」', async () => {
  const sdk = makeSdk({ openid: USER, store: pubStore({
    demand: { [DID]: { _id: DID, creator_openid: USER, is_deleted: false, status: 'matching', demand_no: 'DR1', remark: '旧标题｜旧描述' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(pubEvent({ action: 'update', demand_id: DID, title: '标'.repeat(21), description: '正常描述' }), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'update_title_long');
  assert.strictEqual(r.msg, '需求标题最长 20 字');
});

test.after(() => { Module._load = origLoad; });
