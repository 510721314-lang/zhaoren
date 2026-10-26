// partner-apply 入口层契约测试（S2 P0 + 证书门禁分支）
// 覆盖点：只认服务端 exam_scores / 忽略 event.exam_scores / 不覆盖清空档案分数 /
//         门禁关旧口径 W1>=80 / 门禁开场景证书（有效放行 / 缺失或过期拦截）
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
  delete require.cache[require.resolve('../partner-apply/index.js')];
  return require('../partner-apply/index.js');
}

const USER = 'o_apply_user';
const NOW = Date.now();

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: {
      env: 'dev', dev_until: NOW + 2 * 3600 * 1000,
      rate_min_fen: 3000, rate_max_fen: 10000,
      min_credit_take_order: 600, auto_approve_partner: false
    } },
    user_account: { u1: {
      _id: 'u1', openid: USER, nickname: '测试用户',
      is_realname_done: true, user_credit_score: 800, roles: ['user'], status: 'normal'
    } },
    emergency_contact: { e1: { _id: 'e1', openid: USER, is_deleted: false } },
    partner_profile: {},
    exam_bank: {},
    certificates: {}
  }, extra);
}

const applyEvent = (scenes, rates, extra) => Object.assign({
  action: 'apply', mock_openid: USER, accept_scenes: scenes, scene_rates: rates
}, extra || {});

function profile(over) {
  return Object.assign({ _id: 'p1', openid: USER, status: 'approved', is_deleted: false, exam_scores: {} }, over || {});
}
function cert(over) {
  return Object.assign({
    _id: 'c1', openid: USER, subject: 'W1', issued_at: NOW - 1000,
    expires_at: 0, status: 'active', is_deleted: false
  }, over || {});
}

// ── P0: 客户端分数不可信 ──
test('P0: event.exam_scores.W1=100 但服务端无分数 → apply_w1_exam_failed', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    partner_profile: { p1: profile({ status: 'rejected' }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }, { exam_scores: { W1: 100 } }), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'apply_w1_exam_failed');
});

test('P0: 服务端 W1=100 且 event 未传 → 放行', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    partner_profile: { p1: profile({ exam_scores: { W1: 100 } }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }), {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'approved');
});

test('P0: 服务端 W1=100 且 event 传 0 → 忽略客户端, 仍放行', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    partner_profile: { p1: profile({ exam_scores: { W1: 100 } }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }, { exam_scores: { W1: 0 } }), {});
  assert.strictEqual(r.ok, true);
});

test('P0: 服务端 W1=79 → 拦截(门禁关旧口径 <80)', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    partner_profile: { p1: profile({ exam_scores: { W1: 79 } }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }), {});
  assert.strictEqual(r.code, 'apply_w1_exam_failed');
});

test('P0: 重提交更新档案不写入/清空 exam_scores', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    partner_profile: { p1: profile({ exam_scores: { base: 100, W1: 100 } }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }), {});
  assert.strictEqual(r.ok, true);
  const upd = sdk.writes.partner_profile.find((w) => w.doc === 'p1');
  assert.ok(upd, '应走 doc.update 更新路径');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(upd.data, 'exam_scores'), false,
    '更新载荷不得出现 exam_scores, 避免覆盖/清空');
});

test('P0: 首次申请(W2)忽略 event.exam_scores, 新档案 exam_scores={}', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W2'], { W2: 3000 }, { exam_scores: { W1: 100, base: 100 } }), {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'pending_review');
  const add = sdk.writes.partner_profile.find((w) => w.add);
  assert.ok(add, '应走 add 新建档案');
  assert.deepStrictEqual(add.data.exam_scores, {});
});

// ── 证书门禁分支 ──
test('门禁开: 服务端满分但无证书 → apply_w1_exam_failed', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    admin_config: { global: {
      env: 'dev', dev_until: NOW + 2 * 3600 * 1000,
      rate_min_fen: 3000, rate_max_fen: 10000,
      min_credit_take_order: 600, auto_approve_partner: false,
      cert_gate_enabled: true
    } },
    partner_profile: { p1: profile({ exam_scores: { base: 100, W1: 100 } }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }), {});
  assert.strictEqual(r.code, 'apply_w1_exam_failed');
});

test('门禁开: 有效 W1 证书 → 放行(不再看 exam_scores)', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    admin_config: { global: {
      env: 'dev', dev_until: NOW + 2 * 3600 * 1000,
      rate_min_fen: 3000, rate_max_fen: 10000,
      min_credit_take_order: 600, auto_approve_partner: false,
      cert_gate_enabled: true
    } },
    partner_profile: { p1: profile({ exam_scores: { W1: 80 } }) },
    certificates: { c1: cert() }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }), {});
  assert.strictEqual(r.ok, true);
});

test('门禁开: W1 证书已过期 → apply_w1_exam_failed', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    admin_config: { global: {
      env: 'dev', dev_until: NOW + 2 * 3600 * 1000,
      rate_min_fen: 3000, rate_max_fen: 10000,
      min_credit_take_order: 600, auto_approve_partner: false,
      cert_gate_enabled: true
    } },
    partner_profile: { p1: profile({ exam_scores: { W1: 100 } }) },
    certificates: { c1: cert({ expires_at: NOW - 1 }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W1'], { W1: 3000 }), {});
  assert.strictEqual(r.code, 'apply_w1_exam_failed');
});

test('门禁开: W2 无考试科目场景不校证书 → 放行', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    admin_config: { global: {
      env: 'dev', dev_until: NOW + 2 * 3600 * 1000,
      rate_min_fen: 3000, rate_max_fen: 10000,
      min_credit_take_order: 600, auto_approve_partner: false,
      cert_gate_enabled: true
    } },
    partner_profile: { p1: profile() }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(applyEvent(['W2'], { W2: 3000 }), {});
  assert.strictEqual(r.ok, true);
});
