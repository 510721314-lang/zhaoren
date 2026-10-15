// order_start_apply.test.js · 阶段C-1(2026-10-14) 履约双确认「开始履约申请」守护测试(零依赖 node:test)
// 依据: docs/线下陪伴履约流程规范与流程图.md §2.2 / §2.4(存证先行) / 图1 迁移 no.23(S2 --start_apply--> S2_6)
// 2026-10-15 需求变更(凭证前置): 现场照片(1~3 张)随申请一并提交, 与定位快照同一次 CAS 落库
// 本测试锁定: ①非耍伴 → 拒绝; ②缺定位 → 拒绝且不落库; ③精度不足(>50m) → 拒绝且不落库;
//             ④超距(>200m) → 拒绝且不落库; ⑤缺 start_evidence(照片) → 拒绝且不落库;
//             ⑥达标且带 start_evidence → S2→S2_6 + 落 start_apply_evidence(photo_urls=fileID) + service_start_evidence;
//             ⑦状态不符 → 拒绝(不越权迁移)。
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

test('定位达标但缺 start_evidence(照片) → oa_start_evidence_required 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: PARTNER,
    start_location: { latitude: 30.5, longitude: 104.0, accuracy: 15 }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_evidence_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('定位达标且带 start_evidence → S2→S2_6 + 落 start_apply_evidence(photo_urls) + service_start_evidence', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: PARTNER,
    start_location: { latitude: 30.5, longitude: 104.0, accuracy: 15, address: '成都市武侯区xx' },
    start_evidence: {
      photos: [
        { file_id: 'cloud://a.jpg', kind: 'scene', at: 111 },
        { file_id: 'cloud://b.jpg', kind: 'closeup', at: 222 }
      ],
      partner_location: { latitude: 30.5, longitude: 104.0, accuracy: 12, address: '成都市武侯区xx', at: 333 }
    }
  }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S2_6');

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S2_6');
  assert.ok(w, 'CAS 应写入 status=S2_6');
  // 存证先行(定位快照): 照片已随申请前置提交, photo_urls 不再为空
  const ev = w.data.start_apply_evidence;
  assert.ok(ev, '应写入 start_apply_evidence');
  assert.equal(ev.stage, 'start');
  assert.equal(ev.coord_system, 'GCJ-02');
  assert.equal(ev.role, 'partner');
  assert.equal(ev.lat, 30.5);
  assert.equal(ev.lng, 104.0);
  assert.equal(ev.accuracy, 15);
  assert.equal(ev.threshold_used, 200, '记录发起瞬间的距离阈值');
  assert.deepStrictEqual(ev.photo_urls, ['cloud://a.jpg', 'cloud://b.jpg'], '凭证前置: 照片 fileID 随申请落存证');
  assert.ok(ev.server_time > 0, '时间取服务端时间戳');
  // 凭证前置(2026-10-15): 与状态迁移同一次 CAS 原子写 service_start_evidence, 需求方在 S2_6 即可见照片
  const sse = w.data.service_start_evidence;
  assert.ok(sse, '应写入 service_start_evidence');
  assert.strictEqual(sse.photos.length, 2, '照片 2 张');
  assert.equal(sse.photos[0].file_id, 'cloud://a.jpg');
  assert.equal(sse.photos[0].kind, 'scene');
  assert.equal(sse.photos[1].kind, 'closeup');
  assert.ok(sse.photos[0].at > 0, '照片时间戳归一化');
  assert.equal(sse.partner_location.address, '成都市武侯区xx', '优先取照片水印定位');
  assert.equal(sse.partner_location.latitude, 30.5);
  assert.equal(sse.partner_location.accuracy, 12);
  assert.equal(sse.site_location.address, SITE.address, '履约地取服务端订单 location(客户端不可伪造)');
  assert.equal(sse.submitted_by, PARTNER);
  assert.ok(sse.submitted_at > 0, '提交时间取服务端时间戳');
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
