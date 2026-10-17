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
    partner_profile: {}, exam_bank: {}
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

test.after(() => { Module._load = origLoad; });
