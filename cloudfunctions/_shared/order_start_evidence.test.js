// order-action start_service 履约留痕(需求B · 强制)守护测试(零依赖 node:test)
// 背景: 「开始履约」由纯确认升级为强制资料 —— 需 1~3 张带地址+时间水印的现场照片 + 耍伴实时精确位置;
//   服务端 fail-closed 拒绝缺资料请求, 并把照片/位置/履约地点落入 order_main.service_start_evidence。
// 本测试锁定: ①缺照片 → 拒绝且不落库; ②缺实时位置 → 拒绝且不落库;
//             ③资料齐全 → S2→S3 且写入 service_start_evidence(photos + partner_location + site_location)。
// 说明: mock OPENID 非空(真实调用面), 走 fail-closed 分支; mock_openid 旁路仅用于云端测试面板。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);

function store() {
  return {
    order_main: {
      [OID]: {
        _id: OID, order_no: 'ORD-1', status: 'S2',
        user_openid: USER, partner_openid: PARTNER, total_fen: 1000,
        location: { name: '成都市武侯区xx', address: '成都市武侯区xx', latitude: 30.5, longitude: 104.0 }
      }
    },
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

function fullEvidence() {
  return {
    photos: [
      { file_id: 'cloud://x/1.jpg', kind: 'scene', at: 1700000000000 },
      { file_id: 'cloud://x/2.jpg', kind: 'closeup', at: 1700000000000 }
    ],
    partner_location: { latitude: 30.6, longitude: 104.1, accuracy: 15, address: '成都市锦江区yy', at: 1700000000000 }
  };
}

test('缺现场照片 → fail-closed 拒绝且不写 order_main', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_service', order_id: OID, mock_openid: PARTNER,
    start_evidence: { partner_location: { latitude: 30.6, longitude: 104.1 } }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_evidence_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('缺实时位置 → fail-closed 拒绝且不写 order_main', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_service', order_id: OID, mock_openid: PARTNER,
    start_evidence: { photos: [{ file_id: 'cloud://x/1.jpg' }] }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_location_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('资料齐全 → S2→S3 且写入 service_start_evidence(照片/耍伴位置/履约地点)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_service', order_id: OID, mock_openid: PARTNER, start_evidence: fullEvidence()
  }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S3');

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S3');
  assert.ok(w, 'CAS 应写入 status=S3');
  const ev = w.data.service_start_evidence;
  assert.ok(ev, '应写入 service_start_evidence');
  assert.equal(ev.photos.length, 2, '记录 2 张照片');
  assert.equal(ev.photos[0].kind, 'scene');
  assert.equal(ev.photos[1].kind, 'closeup');
  assert.equal(ev.partner_location.latitude, 30.6, '记录耍伴实时位置纬度');
  assert.equal(ev.partner_location.accuracy, 15);
  assert.equal(ev.site_location.name, '成都市武侯区xx', '履约地点取自订单 location');
  assert.equal(ev.submitted_by, PARTNER);
});
