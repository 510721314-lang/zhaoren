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
