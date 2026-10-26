// partner-action 入口层契约测试（apply / set_switch / sub_authorize / get_exam_questions / review / detail / route_plan）
// 覆盖点：身份 / 未知动作 / 申请前置(未登录/停用) / 非耍伴 / 模板白名单 / 科目不存在 / 越权 / 缺目标
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
  delete require.cache[require.resolve('../partner-action/index.js')];
  return require('../partner-action/index.js');
}

const USER = 'o_user_1';

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: Date.now() + 2 * 3600 * 1000 } },
    user_account: { u1: { _id: 'u1', openid: USER } },
    partner_profile: {},
    // S4: 题目 SSOT = questions；exam_bank 仅 meta。take_readiness 依赖 bank.base 存在 → 需同时种子题目
    exam_bank: { b_base: { _id: 'b_base', code: 'base', title: '基础考试', desc: '', pass_line: 100, requires: [], enabled: true, is_deleted: false, updated_at: 1000 } },
    questions: { bq1: { _id: 'base_A-01', subject: 'base', paper: 'A', qid: 'A-01', type: 'single', stem: '题干', options: ['a', 'b'], answer_idx: 0, score: 1, status: 'published', version: 'V1', is_deleted: false, created_at: 100, updated_at: 1000 } }
  }, extra);
}

test('无 OPENID → pa_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'apply' }, {});
  assert.strictEqual(r.code, 'pa_no_openid');
});

test('未知动作 → pa_unknown_action', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'bogus', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_unknown_action');
});

test('apply 未登录(无 user_account) → pa_no_user', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ user_account: {} }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'apply', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_no_user');
});

test('apply 停用中 → pa_suspended', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, status: 'suspended', suspend_until: Date.now() + 86400000 } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'apply', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_suspended');
});

test('set_switch 非耍伴 → pa_no_profile', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'set_switch', accept_switch: true, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_no_profile');
});

test('sub_authorize 非法模板 → pa_sub_tmpl_bad', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sub_authorize', tmpl: 'bad', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_sub_tmpl_bad');
});

test('sub_authorize confirm_comm 合法 → 落库 sub_msgs.confirm_comm', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ partner_profile: { p1: { _id: 'p1', openid: USER } } }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'sub_authorize', tmpl: 'confirm_comm', authorized: true, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.sub_msgs.confirm_comm.authorized, true);
});

// get_exam_questions 科目不存在 → pa_exam_bad_subject
test('get_exam_questions 科目不存在 → pa_exam_bad_subject', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'get_exam_questions', subject: 'NOPE', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_exam_bad_subject');
});

test('review 非管理员 → pa_not_admin', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'review', target_openid: 'x', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_not_admin');
});

test('detail 缺耍伴标识 → pa_no_target', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'detail', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_no_target');
});

test('route_plan 缺耍伴标识 → pa_no_target', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'route_plan', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_no_target');
});

// ── 2026-10-21 接单资格探针 take_readiness(只读, 前端统一守卫依赖) ──
test('take_readiness 未登录(无 user_account) → pa_no_user', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ user_account: {} }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_no_user');
});

test('take_readiness 无资料无实名 → missing=[realname, apply], can_take=false', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.can_take, false);
  assert.deepStrictEqual(r.data.missing, ['realname', 'apply']);
  assert.strictEqual(r.data.has_profile, false);
});

test('take_readiness 待审核 → missing=[review_pending], 不回退为 apply', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['user'] } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'pending_review' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.deepStrictEqual(r.data.missing, ['review_pending']);
  assert.strictEqual(r.data.profile_status, 'pending_review');
});

test('take_readiness 驳回 → missing=[reapply] 且带 review_note', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['user'] } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'rejected', review_note: '资料不清晰' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.deepStrictEqual(r.data.missing, ['reapply']);
  assert.strictEqual(r.data.review_note, '资料不清晰');
});

test('take_readiness 已通过未考试 → missing=[base_exam](不误报 apply)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['partner'], partner_credit_score: 800 } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'approved', accept_switch: true, exam_scores: {} } },
    emergency_contact: { e1: { _id: 'e1', openid: USER, is_deleted: false, name: '张三', phone: '13800000000', relation: '家人' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.deepStrictEqual(r.data.missing, ['base_exam']);
  assert.strictEqual(r.data.can_take, false);
});

test('take_readiness 已通过+考试+开关开 → can_take=true, missing=[]', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['partner'], partner_credit_score: 800 } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'approved', accept_switch: true, exam_scores: { base: 100 } } },
    emergency_contact: { e1: { _id: 'e1', openid: USER, is_deleted: false, name: '张三', phone: '13800000000', relation: '家人' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.strictEqual(r.data.can_take, true);
  assert.deepStrictEqual(r.data.missing, []);
});

test('take_readiness 开关关闭 → missing 含 switch_off', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['partner'], partner_credit_score: 800 } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'approved', accept_switch: false, exam_scores: { base: 100 } } },
    emergency_contact: { e1: { _id: 'e1', openid: USER, is_deleted: false, name: '张三', phone: '13800000000', relation: '家人' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.deepStrictEqual(r.data.missing, ['switch_off']);
  assert.strictEqual(r.data.can_take, false);
});

// ── 2026-10-23 批3a: 入驻草稿 init_draft + draft 态预配置(P2-10-a) ──
test('init_draft 未登录(无 user_account) → pa_no_user', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ user_account: {} }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'init_draft', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_no_user');
});

test('init_draft 停用中 → pa_suspended', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, status: 'suspended', suspend_until: Date.now() + 86400000 } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'init_draft', mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_suspended');
});

test('init_draft 首次 → 建 draft 档案且不授予 partner 角色', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, roles: ['user'] } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'init_draft', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.existed, false);
  assert.strictEqual(r.data.status, 'draft');
  const added = (sdk.writes.partner_profile || []).filter((w) => w.add).map((w) => w.data);
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].status, 'draft');
  assert.strictEqual(added[0].is_deleted, false);
  // 关键断言: draft 阶段不得写 partner 角色(角色只在 apply 审核通过时授予)
  assert.strictEqual(sdk.writes.user_account, undefined);
});

test('init_draft 幂等 → 已有 approved 档案原样返回, 不降级为 draft', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'approved', is_deleted: false } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'init_draft', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.existed, true);
  assert.strictEqual(r.data.status, 'approved');
  assert.strictEqual(sdk.writes.partner_profile, undefined);   // 无任何写库
});

test('draft 态 set_switch 不再被 pa_not_approved 拦截', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'draft', is_deleted: false, accept_switch: true } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'set_switch', accept_switch: true, mock_openid: USER }, {});
  assert.notStrictEqual(r.code, 'pa_not_approved');
  assert.strictEqual(r.ok, true);
});

test('draft 态 update_config 不再被 pa_not_approved 拦截', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'draft', is_deleted: false, accept_switch: true } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'update_config', mock_openid: USER }, {});
  assert.notStrictEqual(r.code, 'pa_not_approved');
});

test('pending_review 态 set_switch 仍被 pa_not_approved 拦截(不放宽)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'pending_review', is_deleted: false } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'set_switch', accept_switch: true, mock_openid: USER }, {});
  assert.strictEqual(r.code, 'pa_not_approved');
});

test('take_readiness draft 态 → missing 含 apply(不误判为可接单)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['user'] } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'draft', is_deleted: false, accept_switch: true } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.strictEqual(r.data.can_take, false);
  assert.ok(r.data.missing.indexOf('apply') >= 0);
});

// ── 2026-10-23 批3b: EC(紧急联系人)接单前置探针(C-3.26: 申请不拦) ──
const APPROVED_PROFILE = { p1: { _id: 'p1', openid: USER, status: 'approved', is_deleted: false, accept_switch: true } };

test('take_readiness approved 无 EC → missing 含 ec 且不可接单', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['user', 'partner'] } },
    partner_profile: APPROVED_PROFILE,
    emergency_contact: {}
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.has_ec, false);
  assert.ok(r.data.missing.indexOf('ec') >= 0);
  assert.strictEqual(r.data.can_take, false);
});

test('take_readiness approved 有 EC → 不含 ec 缺项', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['user', 'partner'] } },
    partner_profile: APPROVED_PROFILE,
    emergency_contact: { e1: { _id: 'e1', openid: USER, is_deleted: false, name: '张三', phone: '13800000000', relation: '家人' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.strictEqual(r.data.has_ec, true);
  assert.strictEqual(r.data.missing.indexOf('ec'), -1);
});

test('take_readiness 未过审(draft) 不因缺 EC 多出 ec 项(申请不拦)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, is_realname_done: true, roles: ['user'] } },
    partner_profile: { p1: { _id: 'p1', openid: USER, status: 'draft', is_deleted: false, accept_switch: true } },
    emergency_contact: {}
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'take_readiness', mock_openid: USER }, {});
  assert.strictEqual(r.data.has_ec, false);
  assert.strictEqual(r.data.missing.indexOf('ec'), -1);
});

test.after(() => { Module._load = origLoad; });
