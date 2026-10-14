// order_start_apply.test.js · 阶段C-1(2026-10-14) 履约双确认「开始履约申请」守护测试(零依赖 node:test)
// 依据: docs/线下陪伴履约流程规范与流程图.md §2.2 / §2.4(存证先行) / 图1 迁移 no.23(S2 --start_apply--> S2_6)
// 本测试锁定: ①非耍伴 → 拒绝; ②缺定位 → 拒绝且不落库; ③精度不足(>50m) → 拒绝且不落库;
//             ④超距(>200m) → 拒绝且不落库; ⑤达标 → S2→S2_6 + 落 start_apply_evidence(定位快照, 无照片);
//             ⑥状态不符 → 拒绝(不越权迁移)。
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

function store(status) {
  return {
    order_main: {
      [OID]: {
        _id: OID, order_no: 'ORD-1', status: status || 'S2',
        user_openid: USER, partner_openid: PARTNER, total_fen: 1000,
        location: SITE
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

test('非耍伴发起 → oa_start_apply_perm(不落库)', async () => {
  const sdk = makeSdk({ openid: USER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: USER,
    start_location: { latitude: 30.5, longitude: 104.0, accuracy: 15 }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_apply_perm');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('缺定位快照 → oa_start_apply_location_required 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_apply', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_apply_location_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('定位精度不足(>50m) → oa_start_apply_accuracy_low 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: PARTNER,
    start_location: { latitude: 30.5, longitude: 104.0, accuracy: 61 }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_apply_accuracy_low');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('超出履约地 200m → oa_start_apply_too_far 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  // Δlat 0.02 ≈ 2.2km, 远超 200m 阈值
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: PARTNER,
    start_location: { latitude: 30.52, longitude: 104.0, accuracy: 15 }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_apply_too_far');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('定位达标 → S2→S2_6 且落 start_apply_evidence(定位快照, 存证先行, 无照片)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: PARTNER,
    start_location: { latitude: 30.5, longitude: 104.0, accuracy: 15, address: '成都市武侯区xx' }
  }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S2_6');

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S2_6');
  assert.ok(w, 'CAS 应写入 status=S2_6');
  const ev = w.data.start_apply_evidence;
  assert.ok(ev, '应写入 start_apply_evidence');
  assert.equal(ev.stage, 'start');
  assert.equal(ev.coord_system, 'GCJ-02');
  assert.equal(ev.role, 'partner');
  assert.equal(ev.lat, 30.5);
  assert.equal(ev.lng, 104.0);
  assert.equal(ev.accuracy, 15);
  assert.equal(ev.threshold_used, 200, '记录发起瞬间的距离阈值');
  assert.deepStrictEqual(ev.photo_urls, [], '申请阶段不带照片(照片在需求方同意后, 阶段E)');
  assert.ok(ev.server_time > 0, '时间取服务端时间戳');
});

test('状态不符(非 S2) → oa_start_apply_status(不越权迁移)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: PARTNER,
    start_location: { latitude: 30.5, longitude: 104.0, accuracy: 15 }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_apply_status');
});
