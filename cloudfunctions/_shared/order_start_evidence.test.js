// order-action 履约留痕测试(零依赖 node:test)
// 批4(2026-11-01 用户批准·形态B 入口软退役): 旧 start_service 入口已停用, 一律返回 oa_legacy_retired,
//   因此原先「缺照片/缺位置/资料齐全」三例已不可达, 本文件改为锁定「入口拒绝 + 不落库」。
//   履约留痕的 fail-closed 规则现由 start_photo(凭证前置)承担, 行为守护见 order_start_photo.test.js。
// 保留 detail 回传用例: order_main.service_start_evidence 的历史字段仍需在订单详情原样回传。
// 说明: mock OPENID 非空(真实调用面); mock_openid 旁路仅用于云端测试面板。
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

// 批4 形态B: 缺照片(原 oa_start_evidence_required)分支已不可达 → 统一断言入口退役
test('start_service 入口软退役: 资料不全也直接 oa_legacy_retired 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_service', order_id: OID, mock_openid: PARTNER,
    start_evidence: { partner_location: { latitude: 30.6, longitude: 104.1 } }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_legacy_retired');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

// 批4 形态B: 缺位置(原 oa_start_location_required)分支已不可达 → 统一断言入口退役
test('start_service 入口软退役: 缺实时位置也直接 oa_legacy_retired 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_service', order_id: OID, mock_openid: PARTNER,
    start_evidence: { photos: [{ file_id: 'cloud://x/1.jpg' }] }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_legacy_retired');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

// 批4 形态B: 资料齐全(原 S2→S3 成功路径)也已不可达 → 一律拒绝, 不得写 status=S3
test('start_service 入口软退役: 资料齐全也被拒, 不写 status=S3', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_service', order_id: OID, mock_openid: PARTNER, start_evidence: fullEvidence()
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_legacy_retired');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('detail 回传 service_start_evidence → 双方订单详情可见履约留痕(fileID 原样)', async () => {
  // 独立守护: ab_equivalence 的 detail_ok 在 KNOWN_EVOLUTION(详情字段扩充), 故新字段须另有行为断言
  const st = store();
  st.order_main[OID].status = 'S3';
  st.order_main[OID].service_start_evidence = {
    photos: [{ file_id: 'cloud://x/1.jpg', kind: 'scene', at: 1700000000000 }],
    partner_location: { latitude: 30.6, longitude: 104.1, accuracy: 15, address: '成都市锦江区yy', at: 1700000000000 },
    submitted_by: PARTNER, submitted_at: 1700000000000
  };
  const sdk = makeSdk({ openid: USER, store: st });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'detail', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  const se = r.data.service_start_evidence;
  assert.ok(se, 'detail 应回传 service_start_evidence');
  assert.equal(se.photos.length, 1);
  assert.equal(se.photos[0].file_id, 'cloud://x/1.jpg', 'fileID 原样回传(前端直接用于 <image src>)');
  assert.equal(se.partner_location.address, '成都市锦江区yy');
});
