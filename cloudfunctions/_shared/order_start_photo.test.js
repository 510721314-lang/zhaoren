// order_start_photo.test.js · 阶段E(2026-10-14) 履约双确认「现场照片上传存证」守护测试(零依赖 node:test)
// 依据: docs/线下陪伴履约流程规范与流程图.md §2.2 第6条 / §2.4(水印存证) / §F3(水印时间取服务端时间戳)
// 本测试锁定: ①server_now 返回服务端时间戳; ②非耍伴 → 拒绝且不落库; ③缺照片 → 拒绝且不落库;
//             ④缺位置 → 拒绝且不落库; ⑤状态不符(非 S3) → 拒绝; ⑥成功 → 写 service_start_evidence
//             (photos/partner_location/site_location/submitted_by), 时间一律取服务端(忽略客户端 at), status 保持 S3;
//             ⑦已有留痕 → 幂等返回且不重复写库。
// 说明: mock OPENID 非空(=真实调用面), 走 fail-closed 分支; mock_openid 旁路仅用于云端测试面板。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);

// 履约地坐标(GCJ-02): 成都武侯区
const SITE = { name: '成都市武侯区xx', address: '成都市武侯区xx', latitude: 30.5, longitude: 104.0 };

function store(status, extra) {
  const o = {
    _id: OID, order_no: 'ORD-1', status: status || 'S3',
    user_openid: USER, partner_openid: PARTNER, total_fen: 1000, location: SITE
  };
  Object.assign(o, extra || {});
  return {
    order_main: { [OID]: o },
    order_status_log: {}, order_confirmations: {}, system_notice: {}, audit_log: {},
    admin_config: { global: {} }
  };
}

function loadOrderAction(sdk) {
  const orig = Module._load;
  Module._load = function (r) { if (r === 'wx-server-sdk') return sdk; return orig.apply(this, arguments); };
  const full = path.join(__dirname, '..', 'order-action', 'index.js');
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  Module._load = orig;
  return mod;
}

test('server_now → 返回服务端时间戳(供前端水印使用)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'server_now' }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.ok(r.data.server_time > 0, '应返回服务端时间戳');
});

test('非耍伴上传 → oa_start_photo_perm(不落库)', async () => {
  const sdk = makeSdk({ openid: USER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_photo', order_id: OID, mock_openid: USER,
    start_evidence: { photos: [{ file_id: 'cloud://x/1.jpg' }], partner_location: { latitude: 30.5, longitude: 104.0 } }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_photo_perm');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('缺照片 → oa_start_photo_required 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_photo', order_id: OID, mock_openid: PARTNER,
    start_evidence: { partner_location: { latitude: 30.5, longitude: 104.0 } }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_photo_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('缺位置 → oa_start_photo_location_required 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_photo', order_id: OID, mock_openid: PARTNER,
    start_evidence: { photos: [{ file_id: 'cloud://x/1.jpg' }] }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_photo_location_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('状态不符(非 S3) → oa_start_photo_status(不越权写入)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S2_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_photo', order_id: OID, mock_openid: PARTNER,
    start_evidence: { photos: [{ file_id: 'cloud://x/1.jpg' }], partner_location: { latitude: 30.5, longitude: 104.0 } }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_photo_status');
});

test('上传成功 → 落 service_start_evidence 且时间取服务端, status 保持 S3', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_photo', order_id: OID, mock_openid: PARTNER,
    start_evidence: {
      // 客户端上报 at 一律被忽略, 服务端改写为 now(规范 §F3)
      photos: [{ file_id: 'cloud://x/1.jpg', kind: 'scene', at: 1 }, { file_id: 'cloud://x/2.jpg', kind: 'closeup', at: 2 }],
      partner_location: { latitude: 30.5, longitude: 104.0, accuracy: 15, address: '成都市武侯区xx', at: 1 }
    }
  }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S3');
  assert.equal(r.data.photos, 2);

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.service_start_evidence);
  assert.ok(w, '应写入 service_start_evidence');
  const ev = w.data.service_start_evidence;
  assert.equal(ev.photos.length, 2);
  assert.equal(ev.photos[0].file_id, 'cloud://x/1.jpg');
  assert.equal(ev.photos[0].kind, 'scene');
  assert.equal(ev.photos[1].kind, 'closeup');
  assert.ok(ev.photos[0].at > 1000, '照片时间应改写为服务端时间戳(非客户端上报的 1)');
  assert.equal(ev.partner_location.latitude, 30.5);
  assert.equal(ev.partner_location.accuracy, 15);
  assert.ok(ev.partner_location.at > 1000, '位置时间应取服务端时间戳');
  assert.ok(ev.site_location && ev.site_location.latitude === 30.5, '履约地由服务端自取订单 location');
  assert.equal(ev.submitted_by, PARTNER);
  assert.ok(ev.submitted_at > 1000, '提交时间应取服务端时间戳');
  assert.equal(ev.submitted_at, ev.photos[0].at, '各字段时间应同源(同一 now)');
  assert.ok(!('status' in w.data), '不改订单状态(阶段E 非状态迁移)');
});

test('已有留痕 → 幂等返回且不重复写库', async () => {
  const sdk = makeSdk({
    openid: PARTNER,
    store: store('S3', { service_start_evidence: { photos: [{ file_id: 'cloud://x/old.jpg', kind: 'scene', at: 5 }], submitted_by: PARTNER, submitted_at: 5 } })
  });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_photo', order_id: OID, mock_openid: PARTNER,
    start_evidence: { photos: [{ file_id: 'cloud://x/new.jpg' }], partner_location: { latitude: 30.5, longitude: 104.0 } }
  }, {});
  assert.equal(r.ok, true, `应幂等成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.idempotent, true);
  assert.equal((sdk.writes.order_main || []).length, 0, '已有留痕不得重复写 order_main');
});
