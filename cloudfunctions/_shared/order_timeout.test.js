// order_timeout.test.js · 阶段G(2026-10-15) 履约双确认两中间态超时守护测试(零依赖 node:test)
// 依据: docs/线下陪伴履约流程规范与流程图.md §C8(S2.6 开始履约申请 15min / S3.6 完毕确认 30min)
//       状态机 no.26(S2_6 --start_apply_timeout--> S10.5) / no.30(S3_6 --finish_confirm_timeout--> S10.5)
// 锁定 order-timer 扫描段落 processStartApplyTimeout / processFinishConfirmTimeout:
//   ① S2_6 时间锚(start_apply_at)超阈 → S10.5 + 争议正交位 + 双方 system_notice(dispute_open)
//   ② S2_6 未到阈值 → 不处理(守卫)
//   ③ S3_6 时间锚(finish_apply_at)超阈 → S10.5 + dispute_type=finish_timeout
//   ④ 状态不符(非待确认中间态) → 不处理
//   ⑤ 阈值走 admin_config(后台改配生效, 非写死 15min)
// 说明: 该函数(段落)不使用 A/B 等价证明, 故用入口层契约测试(mock SDK)。
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
  delete require.cache[require.resolve('../order-timer/index.js')];
  return require('../order-timer/index.js');
}

const ADMIN = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const MIN = 60 * 1000, H = 3600 * 1000;

function baseStore(orders = {}) {
  return {
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * H, admin_openids: [ADMIN] } },
    order_main: orders,
    demand: {}, order_status_log: {}, system_notice: {}, evaluation: {},
    credit_score_log: {}, user_account: {}, platform_event: {}, audit_log: {}, withdraw_record: {}
  };
}
function ord(id, status, extra = {}) {
  return Object.assign({ _id: id, order_no: 'ORD-' + id, user_openid: USER, partner_openid: PARTNER, total_fen: 1000 }, extra, { status });
}
async function run(store) {
  const sdk = makeSdk({ openid: ADMIN, store });
  const { main } = loadIndex(sdk);
  const r = await main({}, {});
  return { r, sdk };
}

// ① S2_6 开始履约申请超 15min → S10.5 争议
test('S2_6 超时 → start_apply_timeout=1 且转 S10.5 + 争议正交位 + 通知双方', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ P1: ord('P1', 'S2_6', { start_apply_at: now - 20 * MIN }) }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.data.counts.start_apply_timeout, 1);
  assert.deepStrictEqual(r.data.start_apply_timeout, ['ORD-P1']);
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'P1');
  assert.ok(upd, '应 CAS 写 order_main');
  assert.strictEqual(upd.data.status, 'S10.5');
  assert.strictEqual(upd.data.dispute_state, 'open');
  assert.strictEqual(upd.data.dispute_type, 'start_timeout');
  assert.ok(upd.data.dispute_opened_at > 0, '应写争议开立时间');
  const notices = (sdk.writes.system_notice || []).filter((w) => w.add);
  assert.strictEqual(notices.length, 2, '应通知双方');
  assert.strictEqual(notices[0].data.type, 'dispute_open');
});

// ② S2_6 未到阈值 → 不处理
test('S2_6 未超时 → start_apply_timeout=0', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ P2: ord('P2', 'S2_6', { start_apply_at: now - 5 * MIN }) }));
  assert.strictEqual(r.data.counts.start_apply_timeout, 0);
});

// ③ S3_6 完毕确认超 30min → S10.5 争议
test('S3_6 超时 → finish_confirm_timeout=1 且转 S10.5 + dispute_type=finish_timeout', async () => {
  const now = Date.now();
  const { r, sdk } = await run(baseStore({ P3: ord('P3', 'S3_6', { finish_apply_at: now - 40 * MIN }) }));
  assert.strictEqual(r.data.counts.finish_confirm_timeout, 1);
  assert.deepStrictEqual(r.data.finish_confirm_timeout, ['ORD-P3']);
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === 'P3');
  assert.strictEqual(upd.data.status, 'S10.5');
  assert.strictEqual(upd.data.dispute_type, 'finish_timeout');
});

// ④ 状态不符(非待确认中间态) → 不处理
test('S3 状态(非 S3_6) → finish_confirm_timeout=0', async () => {
  const now = Date.now();
  const { r } = await run(baseStore({ P4: ord('P4', 'S3', { finish_apply_at: now - 40 * MIN }) }));
  assert.strictEqual(r.data.counts.finish_confirm_timeout, 0);
});

// ⑤ 阈值走 admin_config(改配 30min 后, 20min 不触发)
test('admin_config 配 start_apply_timeout_min=30 → 20min 不触发', async () => {
  const now = Date.now();
  const store = baseStore({ P5: ord('P5', 'S2_6', { start_apply_at: now - 20 * MIN }) });
  store.admin_config.global.start_apply_timeout_min = 30;
  const { r } = await run(store);
  assert.strictEqual(r.data.counts.start_apply_timeout, 0);
});

// ⑤b finish 侧对称守护: 配 finish_confirm_timeout_min=30 → 20min 不触发
test('admin_config 配 finish_confirm_timeout_min=30 → 20min 不触发', async () => {
  const now = Date.now();
  const store = baseStore({ P5B: ord('P5B', 'S3_6', { finish_apply_at: now - 20 * MIN }) });
  store.admin_config.global.finish_confirm_timeout_min = 30;
  const { r } = await run(store);
  assert.strictEqual(r.data.counts.finish_confirm_timeout, 0);
});

test.after(() => { Module._load = origLoad; });
