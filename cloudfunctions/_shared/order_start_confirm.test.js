// order_start_confirm.test.js · 阶段D(2026-10-14) 履约双确认「需求方确认耍伴到场 / 不同意」守护测试(零依赖 node:test)
// 依据: docs/线下陪伴履约流程规范与流程图.md §2.2 / 图1 迁移 no.24(S2_6 --start_confirm--> S3) / no.25(S2_6 --start_reject--> S2)
// 本测试锁定: ①仅需求方可确认(耍伴调用被拒); ②非 S2_6 不可确认; ③确认成功 S2_6→S3 + 用户定位留痕(user_confirm);
//             ④不同意 S2_6→S2 + 计数/reject_at 落库; ⑤拒绝后 60s 冷却内不可重发申请(start_apply);
//             ⑥detail 对需求方回传耍伴实名+脱敏号(partner_contact, 阶段C/D 弹窗用)。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);
const SITE = { name: '成都市武侯区xx', address: '成都市武侯区xx', latitude: 30.5, longitude: 104.0 };

function store(status, extra) {
  const o = {
    _id: OID, order_no: 'ORD-1', status: status || 'S2_6',
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

test('耍伴调用 start_confirm → oa_start_confirm_perm(仅需求方)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_confirm', order_id: OID, mock_openid: PARTNER }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_confirm_perm');
  assert.equal((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

test('非 S2_6(处于 S2) → oa_start_confirm_status(不越权迁移)', async () => {
  const sdk = makeSdk({ openid: USER, store: store('S2') });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_confirm', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_confirm_status');
});

test('需求方确认 → S2_6→S3 且带用户定位留痕(user_confirm)', async () => {
  const sdk = makeSdk({ openid: USER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_confirm', order_id: OID, mock_openid: USER,
    user_location: { latitude: 30.5, longitude: 104.0, accuracy: 12, address: '成都市武侯区xx' }
  }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S3');

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S3');
  assert.ok(w, 'CAS 应写入 status=S3');
  assert.ok(w.data.service_started_at > 0, '应记录开始履约时间');
  assert.ok(w.data.milestone && w.data.milestone.current === 0, '应初始化里程碑(0/3)');
  const uc = w.data.user_confirm;
  assert.ok(uc, '应写入用户定位留痕 user_confirm');
  assert.equal(uc.latitude, 30.5);
  assert.equal(uc.accuracy, 12);
  assert.equal(uc.by, USER);
});

test('需求方确认(未带定位) → 仍成功, 但不写 user_confirm(留痕可选)', async () => {
  const sdk = makeSdk({ openid: USER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_confirm', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S3');
  assert.ok(w, 'CAS 应写入 status=S3');
  assert.strictEqual(w.data.user_confirm, undefined, '未带定位时不留痕');
});

test('需求方不同意 → S2_6→S2 且计数/拒绝时间落库', async () => {
  const sdk = makeSdk({ openid: USER, store: store() });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'start_reject', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.equal(r.data.status, 'S2');
  assert.equal(r.data.start_reject_count, 1);

  const w = (sdk.writes.order_main || []).find((x) => x.data && x.data.status === 'S2');
  assert.ok(w, 'CAS 应写回 status=S2');
  assert.equal(w.data.start_reject_count, 1);
  assert.ok(w.data.start_reject_at > 0, '应记录拒绝时间(供冷却计算)');
});

test('拒绝后 60s 冷却内不可重发申请 → oa_start_apply_cooldown', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: store('S2', { start_reject_at: Date.now() - 10 * 1000 }) });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({
    action: 'start_apply', order_id: OID, mock_openid: PARTNER,
    start_location: { latitude: 30.5, longitude: 104.0, accuracy: 15 }
  }, {});
  assert.equal(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.equal(r.code, 'oa_start_apply_cooldown');
});

test('detail 对需求方回传耍伴实名+脱敏号(partner_contact)', async () => {
  const st = store('S2');
  st.user_account = {
    ['u'.repeat(32)]: { _id: 'u'.repeat(32), openid: USER, nickname: '需求方' },
    ['v'.repeat(32)]: { _id: 'v'.repeat(32), openid: PARTNER, nickname: '耍伴', real_name: '李四', phone_mask: '138****1234' }
  };
  const sdk = makeSdk({ openid: USER, store: st });
  const mod = loadOrderAction(sdk);
  const r = await mod.main({ action: 'detail', order_id: OID, mock_openid: USER }, {});
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  const pc = r.data.partner_contact;
  assert.ok(pc, '需求方应拿到耍伴联系方式');
  assert.equal(pc.real_name, '李四', '实名全名');
  assert.equal(pc.phone_mask, '138****1234', '脱敏号(phone_mask, 不解密)');
});
