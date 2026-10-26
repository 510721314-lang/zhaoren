// order-create create_from_take 成功路径守护测试(零依赖 node:test)
// 背景(拆分前既有 bug): orderNo/totalFen/feeFen/partnerIncomeFen/orderData/orderId/
//   userEvidenceId 原在外层 try 块内声明, 却在 finally 之后的后置段引用 → 接单成功必抛
//   ReferenceError; 事务已提交但客户端收 500、审计/通知不写。
// 本测试用 mock SDK 走通成功路径, 锁定: 返回 ok + 三单写入 + demand CAS matched + 审计 + 通知。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const DEM = 'd'.repeat(32);

// 次日 CN 12:00(=UTC 04:00): 安全时段且在未来/30 天窗口内
const _ts = new Date(); _ts.setUTCDate(_ts.getUTCDate() + 1); _ts.setUTCHours(4, 0, 0, 0);
const NEW_TS = _ts.getTime();

function store() {
  return {
    admin_config: { global: {
      env: 'dev', dev_until: Date.now() + 3600 * 1000, take_distance_max_km: 50,
      min_credit_take_order: 600, min_credit_place_order: 600, youth_limit_fen: 20000,
      platform_fee_rate_fen: 1000, legal_scene_disclaimers: { W1: 'W1就医陪诊场景免责声明全文' }
    } },
    user_account: {
      ['u'.repeat(32)]: { _id: 'u'.repeat(32), openid: USER, nickname: '耍伴', roles: ['user', 'partner'], status: 'normal', is_realname_done: true, partner_credit_score: 800, user_credit_score: 800, age: null, is_deleted: false },
      ['v'.repeat(32)]: { _id: 'v'.repeat(32), openid: PARTNER, nickname: '需方', roles: ['user'], status: 'normal', user_credit_score: 800, age: null, is_deleted: false }
    },
    partner_profile: {
      ['p'.repeat(32)]: { _id: 'p'.repeat(32), openid: USER, status: 'approved', accept_switch: true, accept_scenes: ['W1'], exam_scores: { base: 100, W1: 100 }, max_distance_km: 10, is_deleted: false }
    },
    demand: {
      [DEM]: { _id: DEM, demand_no: 'DR-OC1', scene: 'W1', status: 'matching', is_deleted: false, broadcast: true, match_mode: 'broadcast', creator_openid: PARTNER, start_time: NEW_TS, duration_h: 1, expire_at: Date.now() + 7200000, location: { name: '成都市', city: '成都', latitude: 30.5, longitude: 104.0 }, publish_location: null, content_options: ['陪同挂号'], pricing_type: 'hourly', rate_fen: 5000, total_fen: 5000, project_attr: 'commercial', headcount: 1 }
    },
    disclaimer_signature: {
      ['s'.repeat(32)]: { _id: 's'.repeat(32), openid: USER, role: 'partner', scene: 'W1', is_deleted: false, signature_hash: 'abc123', docs: [] }
    },
    exam_bank: {},
    certificates: {},
    // 批3b'（2026-10-23）: 接单硬门禁要求已填紧急联系人
    emergency_contact: { ['e'.repeat(32)]: { _id: 'e'.repeat(32), openid: USER, name: '张三', phone: '13800000000', relation: '家人', is_deleted: false } },
    order_main: {}, order_confirmations: {}, order_status_log: {}, platform_event: {},
    system_notice: {}, audit_log: {}
  };
}

function loadOrderCreate(sdk) {
  const orig = Module._load;
  Module._load = function (r) { if (r === 'wx-server-sdk') return sdk; return orig.apply(this, arguments); };
  const full = path.join(__dirname, '..', 'order-create', 'index.js');
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  Module._load = orig;
  return mod;
}

test('create_from_take 成功路径: 建单三表 + demand CAS matched + 审计 + 接单通知, 返回 order_id/no', async () => {
  const sdk = makeSdk({ openid: USER, store: store() });
  const mod = loadOrderCreate(sdk);

  const r = await mod.main({
    action: 'create_from_take', demand_id: DEM,
    partner_location: { latitude: 30.5, longitude: 104.0 },
    mock_openid: USER, device: 'test'
  }, {});

  // ① 返回值: 成功且带订单标识(修复前这里永远抛 ReferenceError → 客户端收 500)
  assert.equal(r.ok, true, `应成功, 实际: ${JSON.stringify(r)}`);
  assert.ok(r.data && r.data.order_id, '返回 order_id');
  assert.ok(r.data.order_no, '返回 order_no');
  assert.equal(r.data.status, 'S1');
  assert.equal(r.data.total_fen, 5000);

  // ② 事务三表各写入 1 条
  assert.equal((sdk.writes.order_main || []).length, 1, 'order_main 写入 1 条');
  assert.equal(sdk.writes.order_main[0].data.status, 'S1');
  assert.equal(sdk.writes.order_main[0].data.order_no, r.data.order_no);
  assert.equal((sdk.writes.order_confirmations || []).length, 1, 'order_confirmations 写入 1 条');
  assert.equal((sdk.writes.order_status_log || []).length, 1, 'order_status_log 写入 1 条');
  assert.equal(sdk.writes.order_status_log[0].data.to_status, 'S1');
  assert.equal((sdk.writes.disclaimer_signature || []).length, 1, '需求者免责凭证写入 1 条');

  // ③ demand CAS matching→matched
  const dm = (sdk.writes.demand || []).find((w) => w.data && w.data.status === 'matched');
  assert.ok(dm, 'demand 被 CAS 置为 matched');

  // ④ 后置段(原越界点): 审计 + 发单人接单通知必须落库
  assert.equal((sdk.writes.audit_log || []).length, 1, '审计 order_take 写入 1 条');
  assert.equal(sdk.writes.audit_log[0].data.action, 'order_take');
  assert.equal(sdk.writes.audit_log[0].data.target_id, r.data.order_id);
  assert.equal((sdk.writes.system_notice || []).length, 1, '接单通知写入 1 条');
  assert.equal(sdk.writes.system_notice[0].data.to_openid, PARTNER);
});

// ── 2026-10-26 S2: cert_gate_enabled 分支 ──
function gateOn(s) {
  s.admin_config.global.cert_gate_enabled = true;
  return s;
}
function cert(subject, over) {
  return Object.assign({
    _id: 'c_' + subject, openid: USER, subject, issued_at: Date.now() - 1000,
    expires_at: 0, status: 'active', is_deleted: false
  }, over || {});
}
async function take(sdk) {
  const mod = loadOrderCreate(sdk);
  return mod.main({
    action: 'create_from_take', demand_id: DEM,
    partner_location: { latitude: 30.5, longitude: 104.0 },
    mock_openid: USER, device: 'test'
  }, {});
}

test('门禁关(默认): 无 base 分数 → order_base_exam_required(旧路径不变)', async () => {
  const s = store();
  s.partner_profile['p'.repeat(32)].exam_scores = {};
  const r = await take(makeSdk({ openid: USER, store: s }));
  assert.strictEqual(r.code, 'order_base_exam_required');
});

// ── 2026-10-26 S4: 接单门禁改按 exam_bank meta(题目 SSOT 已迁 questions, meta 无 questions 字段) ──
function bankMeta(code, over) {
  return Object.assign({
    _id: 'b_' + code, code, title: code, desc: '', pass_line: 100,
    requires: [], enabled: true, is_deleted: false, updated_at: 1000
  }, over || {});
}

test('门禁关: exam_bank meta 生效(无 questions 字段) → W1 按 pass_line=90 放行', async () => {
  const s = store();
  s.exam_bank = { b_base: bankMeta('base'), b_W1: bankMeta('W1', { pass_line: 90, requires: ['base'] }) };
  s.partner_profile['p'.repeat(32)].exam_scores = { base: 100, W1: 90 };
  const r = await take(makeSdk({ openid: USER, store: s }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('门禁关: exam_bank meta 生效 → W1 89 分被拒(order_scene_exam_required)', async () => {
  const s = store();
  s.exam_bank = { b_base: bankMeta('base'), b_W1: bankMeta('W1', { pass_line: 90, requires: ['base'] }) };
  s.partner_profile['p'.repeat(32)].exam_scores = { base: 100, W1: 89 };
  const r = await take(makeSdk({ openid: USER, store: s }));
  assert.strictEqual(r.code, 'order_scene_exam_required');
});

test('门禁开: 无证书(即使 exam_scores 满分) → order_base_exam_required', async () => {
  const s = gateOn(store());
  const r = await take(makeSdk({ openid: USER, store: s }));
  assert.strictEqual(r.code, 'order_base_exam_required');
});

test('门禁开: 仅 base 证书, W1 场景 → order_scene_exam_required', async () => {
  const s = gateOn(store());
  s.certificates = { c_base: cert('base') };
  const r = await take(makeSdk({ openid: USER, store: s }));
  assert.strictEqual(r.code, 'order_scene_exam_required');
});

test('门禁开: base + W1 有效证书(不看 exam_scores) → 接单成功', async () => {
  const s = gateOn(store());
  s.partner_profile['p'.repeat(32)].exam_scores = {};
  s.certificates = {
    c_base: cert('base'),
    c_W1: cert('W1', { expires_at: Date.now() + 365 * 86400000 })
  };
  const r = await take(makeSdk({ openid: USER, store: s }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.data.status, 'S1');
});

test('门禁开: W1 证书过期 → order_scene_exam_required', async () => {
  const s = gateOn(store());
  s.certificates = {
    c_base: cert('base'),
    c_W1: cert('W1', { expires_at: Date.now() - 1 })
  };
  const r = await take(makeSdk({ openid: USER, store: s }));
  assert.strictEqual(r.code, 'order_scene_exam_required');
});

