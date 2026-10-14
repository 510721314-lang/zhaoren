// order_finish.test.js · 阶段F(2026-10-15) 履约双确认「履约完毕」守护测试(零依赖 node:test)
// 依据: docs/线下陪伴履约流程规范与流程图.md §2.3 履约完毕流程 / §2.4 存证 / §F3(水印取服务端时间戳)
//       图1 迁移 no.27/28/29(S3 --finish_apply--> S3_6 --finish_confirm--> S5 / --finish_reject--> S3)
// 本测试锁定:
//   finish_apply: ①非耍伴→拒绝且不落库; ②缺照片→拒绝; ③缺位置→拒绝; ④精度不足→拒绝; ⑤超距→拒绝;
//                 ⑥里程碑未满→拒绝; ⑦状态不符(非 S3)→拒绝; ⑧达标→S3→S3_6 且落 service_finish_evidence
//                 (photos/partner_location/site_location/submitted_by, 时间取服务端)。
//   finish_confirm: ⑨非需求方→拒绝; ⑩状态不符→拒绝; ⑪达标→S3_6→S5 + service_completed_at。
//   finish_reject: ⑫非需求方→拒绝; ⑬达标→S3_6→S3 + finish_reject_count=1。
// 说明: mock OPENID 非空(=真实调用面), 走 fail-closed 分支; mock_openid 旁路仅用于云端测试面板。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);
const MS3 = { current: 3, confirmed: [true, true, true], evidence: [] };

// 履约地坐标(GCJ-02): 成都武侯区
const SITE = { name: '成都市武侯区xx', address: '成都市武侯区xx', latitude: 30.5, longitude: 104.0 };
const OK_LOC = { latitude: 30.5, longitude: 104.0, accuracy: 15, address: '成都市武侯区xx' };
const OK_PHOTOS = [{ file_id: 'cloud://x/1.jpg', kind: 'scene', at: 1 }, { file_id: 'cloud://x/2.jpg', kind: 'closeup', at: 2 }];

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

// ── finish_apply(S3→S3_6) ──

test('finish_apply 非耍伴 → oa_finish_apply_perm(不落库)', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S3', { milestone: MS3 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: USER,
    finish_evidence: { photos: OK_PHOTOS, partner_location: OK_LOC }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_apply_perm');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('finish_apply 缺照片 → oa_finish_apply_photo_required 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3', { milestone: MS3 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: PARTNER,
    finish_evidence: { partner_location: OK_LOC }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_apply_photo_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('finish_apply 缺位置 → oa_finish_apply_location_required 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3', { milestone: MS3 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: PARTNER,
    finish_evidence: { photos: OK_PHOTOS }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_apply_location_required');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('finish_apply 定位精度不足(>50m) → oa_finish_apply_accuracy_low 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3', { milestone: MS3 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: PARTNER,
    finish_evidence: { photos: OK_PHOTOS, partner_location: { latitude: 30.5, longitude: 104.0, accuracy: 61 } }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_apply_accuracy_low');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('finish_apply 超出履约地 200m → oa_finish_apply_too_far 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3', { milestone: MS3 }) });
  const mod = loadOrderAction(sdk);
  // Δlat 0.02 ≈ 2.2km, 远超 200m 阈值
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: PARTNER,
    finish_evidence: { photos: OK_PHOTOS, partner_location: { latitude: 30.52, longitude: 104.0, accuracy: 15 } }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_apply_too_far');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('finish_apply 里程碑未满(<100%) → oa_finish_apply_milestone 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3', { milestone: { current: 1, confirmed: [true, false, false], evidence: [] } }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: PARTNER,
    finish_evidence: { photos: OK_PHOTOS, partner_location: OK_LOC }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_apply_milestone');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('finish_apply 状态不符(非 S3) → oa_finish_apply_status(不越权迁移)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3_6', { milestone: MS3 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: PARTNER,
    finish_evidence: { photos: OK_PHOTOS, partner_location: OK_LOC }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_apply_status');
});

test('finish_apply 达标 → S3→S3_6 且落 service_finish_evidence(时间取服务端)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3', { milestone: MS3 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'finish_apply', order_id: OID, mock_openid: PARTNER,
    finish_evidence: { photos: OK_PHOTOS, partner_location: OK_LOC }
  }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S3_6');

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.service_finish_evidence);
  assert.ok(w, 'CAS 应写入 service_finish_evidence');
  assert.equal(w.data.status, 'S3_6');
  const ev = w.data.service_finish_evidence;
  assert.equal(ev.stage, 'finish');
  assert.equal(ev.photos.length, 2);
  assert.equal(ev.photos[0].file_id, 'cloud://x/1.jpg');
  assert.equal(ev.photos[0].kind, 'scene');
  assert.ok(ev.photos[0].at > 1000, '照片时间应改写为服务端时间戳(非客户端上报的 1)');
  assert.equal(ev.partner_location.latitude, 30.5);
  assert.equal(ev.partner_location.accuracy, 15);
  assert.ok(ev.site_location && ev.site_location.latitude === 30.5, '履约地由服务端自取订单 location');
  assert.equal(ev.submitted_by, PARTNER);
  assert.ok(ev.submitted_at > 1000, '提交时间应取服务端时间戳');
  assert.equal(ev.submitted_at, ev.photos[0].at, '各字段时间应同源(同一 now)');
});

// ── finish_confirm(S3_6→S5) ──

test('finish_confirm 非需求方 → oa_finish_confirm_perm(不落库)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'finish_confirm', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_confirm_perm');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('finish_confirm 状态不符(非 S3_6) → oa_finish_confirm_status', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S3') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'finish_confirm', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_confirm_status');
});

test('finish_confirm 达标 → S3_6→S5 且写 service_completed_at', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S3_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'finish_confirm', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S5');
  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S5');
  assert.ok(w, 'CAS 应写入 status=S5');
  assert.ok(w.data.service_completed_at > 0, '应写完成时间');
});

// ── finish_reject(S3_6→S3) ──

test('finish_reject 非需求方 → oa_finish_reject_perm', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S3_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'finish_reject', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_finish_reject_perm');
});

test('finish_reject 达标 → S3_6→S3 + finish_reject_count=1(冷却可重发)', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S3_6') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'finish_reject', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S3');
  assert.equal(r.data.finish_reject_count, 1);
  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S3');
  assert.ok(w, 'CAS 应写入 status=S3');
  assert.ok(w.data.finish_reject_at > 0, '应写冷却锚点时间');
  assert.equal(w.data.finish_reject_count, 1);
});
