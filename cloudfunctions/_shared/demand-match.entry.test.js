// demand-match 入口层契约测试（apply 报名门禁 + hall_list 大厅可见性）
// 覆盖点（2026-11-15 定向邀约空选修复本轮补测，零副作用）：
//   ① apply 实名改读 user_account 后：未实名才拦、已实名叫通过（修复前恒拦）
//   ② apply 信用分不足 → apply_credit_low
//   ③ apply accept_switch=false → apply_switch_off（P3-37 / T-15.5 云端侧）
//   ④ hall_list 仅返回 broadcast=true：定向单与存量未进池单不进大厅（REGISTRY #175 ③④）
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
  delete require.cache[require.resolve('../demand-match/index.js')];
  return require('../demand-match/index.js');
}

const USER = 'o_partner_1';
const CREATOR = 'o_creator_1';
const DID = 'd'.repeat(32);

function demandDoc(over) {
  return Object.assign({
    _id: DID, demand_no: 'D0001', match_mode: 'select', status: 'matching',
    creator_openid: CREATOR, scene: 'W1', broadcast: true, applicants: [],
    is_deleted: false, remark: '测试需求｜描述'
  }, over || {});
}

function baseStore(extra) {
  return Object.assign({
    admin_config: { global: { env: 'dev', min_credit_take_order: 600, scene_list: [{ code: 'W1', name: '跑腿代办' }] } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'approved', is_deleted: false, accept_switch: true } },
    disclaimer_signature: { s1: { _id: 's1', openid: USER, role: 'partner', scene: 'W1', is_deleted: false } },
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, partner_credit_score: 800 } },
    demand: { [DID]: demandDoc() },
    system_notice: {}
  }, extra || {});
}

function run(sdk, event) {
  return loadIndex(sdk).main(Object.assign({ mock_openid: USER }, event), {});
}

test('apply: 抢单模式需求不可报名 → apply_mode_invalid', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ demand: { [DID]: demandDoc({ match_mode: 'broadcast' }) } }) });
  const r = await run(sdk, { action: 'apply', demand_id: DID });
  assert.strictEqual(r.code, 'apply_mode_invalid');
});

test('apply: 未实名 → apply_realname_required（读 user_account 口径）', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ user_account: { u1: { _id: 'u1', openid: USER } } }) });
  const r = await run(sdk, { action: 'apply', demand_id: DID });
  assert.strictEqual(r.code, 'apply_realname_required');
});

test('apply: 信用分低于门槛 → apply_credit_low', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, partner_credit_score: 500 } } }) });
  const r = await run(sdk, { action: 'apply', demand_id: DID });
  assert.strictEqual(r.code, 'apply_credit_low');
});

test('apply: 接单开关关闭 → apply_switch_off（P3-37 云端侧）', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ partner_profile: { p1: { _id: 'p1', openid: USER, status: 'approved', is_deleted: false, accept_switch: false } } }) });
  const r = await run(sdk, { action: 'apply', demand_id: DID });
  assert.strictEqual(r.code, 'apply_switch_off');
});

test('apply: 已实名+信用达标+开关开 → ok（修复后不再恒拦）', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const r = await run(sdk, { action: 'apply', demand_id: DID });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.applied, true);
});

test('hall_list: 仅 broadcast=true 可见，定向/存量未进池单不出现', async () => {
  const DIR = 'e'.repeat(32);
  const sdk = makeSdk({
    openid: USER,
    store: baseStore({
      demand: {
        [DID]: demandDoc(),                                            // select 且已进池 → 可见
        [DIR]: demandDoc({ _id: DIR, match_mode: 'direct', broadcast: false })  // 定向 → 不可见
      }
    })
  });
  const r = await run(sdk, { action: 'hall_list' });
  assert.strictEqual(r.ok, true);
  const ids = (r.data.list || r.data || []).map((x) => x.demand_id || x._id);
  assert.ok(ids.includes(DID), '已进池 select 单应可见');
  assert.ok(!ids.includes(DIR), '定向单不应进大厅');
});
