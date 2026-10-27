// user-login 入口层契约测试（密码登录防爆破防爆破链路）
// 覆盖点：错误密码原子计数 + 达阈值条件置锁 / 锁定中拒绝 / 密码正确清零 / 防枚举同文案
// 该函数未参与 A/B 拆分，故用契约测试(mock SDK)守护登录链路（2026-10-13 留存负债闭环: 计数改原子自增）。
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadIndex(sdk) {
  activeSdk = sdk;
  for (const f of ['../user-login/index.js', '../user-login/openid.js', '../user-login/logger.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../user-login/index.js');
}

const OPENID = 'o_user_login_1';
const SALT = 'salt_u1';
const PWD = 'p@ssw0rd-8';
const PWD_HASH = crypto.createHash('sha256').update(SALT + PWD + SALT).digest('hex');

function loginStore(acc) {
  return {
    admin_config: { global: { env: 'prod' } },
    user_account: {
      u1: Object.assign({
        _id: 'u1', openid: OPENID, login_account: 'user_0001',
        password_salt: SALT, password_hash: PWD_HASH,
        status: 'normal', is_deleted: false,
        user_credit_score: 800, partner_credit_score: 800
      }, acc || {})
    }
  };
}
async function run(store, event) {
  const sdk = makeSdk({ openid: OPENID, store });
  const { main } = loadIndex(sdk);
  const r = await main(event, {});
  return { r, sdk };
}

test('password_login: 错误密码 → password_wrong + 原子自增 + 条件置锁写(gte 5)', async () => {
  const { r, sdk } = await run(loginStore(), { action: 'password_login', login_account: 'user_0001', password: 'wrong-pwd-1' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'password_wrong');
  const ws = sdk.writes.user_account || [];
  const incW = ws.find((w) => w.doc === 'u1' && w.data && w.data.pwd_fail_count && w.data.pwd_fail_count.__sentinel === 'inc');
  assert.ok(incW, '应原子自增失败计数(_.inc)');
  assert.strictEqual(incW.data.pwd_fail_count.args[0], 1, '每次失败 +1');
  const lockW = ws.find((w) => w.where && w.where.pwd_fail_count && w.where.pwd_fail_count.__sentinel === 'gte');
  assert.ok(lockW, '应发起达阈值条件置锁写');
  assert.strictEqual(lockW.where.pwd_fail_count.args[0], 5, '阈值 = 5');
});

test('password_login: 第5次失败(count=4) → 条件置锁(≈now+10min, 计数清零)', async () => {
  const t0 = Date.now();
  const { r, sdk } = await run(loginStore({ pwd_fail_count: 4 }), { action: 'password_login', login_account: 'user_0001', password: 'wrong-pwd-2' });
  assert.strictEqual(r.code, 'password_wrong');
  const lockW = (sdk.writes.user_account || []).find((w) => w.where && w.where.pwd_fail_count && w.where.pwd_fail_count.__sentinel === 'gte');
  assert.ok(lockW, '应发起达阈值条件置锁写');
  assert.strictEqual(lockW.data.pwd_fail_count, 0);
  assert.ok(lockW.data.pwd_lock_until > t0 + 9 * 60 * 1000 && lockW.data.pwd_lock_until < t0 + 11 * 60 * 1000, '锁定 10 分钟');
});

test('password_login: 锁定中(即使密码正确) → password_locked, 不验密不写库', async () => {
  const { r, sdk } = await run(loginStore({ pwd_lock_until: Date.now() + 5 * 60 * 1000 }), { action: 'password_login', login_account: 'user_0001', password: PWD });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'password_locked');
  assert.ok(!sdk.writes.user_account, '锁定拒绝不应写库');
});

test('password_login: 密码正确 → ok 且清零历史失败计数', async () => {
  const { r, sdk } = await run(loginStore({ pwd_fail_count: 3, pwd_lock_until: 0 }), { action: 'password_login', login_account: 'user_0001', password: PWD });
  assert.strictEqual(r.ok, true);
  const w = (sdk.writes.user_account || [])[0];
  assert.deepStrictEqual(w.data, { pwd_fail_count: 0, pwd_lock_until: 0 });
});

test('password_login: 账号不存在 → password_wrong(防枚举, 与密码错误同文案)', async () => {
  const { r } = await run(loginStore(), { action: 'password_login', login_account: 'nobody_99', password: PWD });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'password_wrong');
});

test.after(() => { Module._load = origLoad; });

// ── 2026-10-21 提审期方案A: 实名人脸守卫 fail-closed 断言 ──
// 目标: ① prod + face_mode='wx' 必拒; ② prod 键缺失(默认) 必拒; ③ dev 键缺失仍放行(开发便利保留)。
// 守卫在下载签名图之前, 故这三条用例不依赖 cloud.downloadFile(测试 SDK 未实现)。
const RN_NAME = '测试用户';
const RN_ID = '11010519491231002X'; // 合法校验位(1949-12-31, 成年)
function realnameStore(cfg) {
  return {
    admin_config: { global: Object.assign({ env: 'prod' }, cfg || {}) },
    user_account: {
      u1: { _id: 'u1', openid: OPENID, status: 'normal', is_deleted: false, is_realname_done: false }
    }
  };
}
const RN_EVENT = {
  action: 'submit_realname', real_name: RN_NAME, idcard: RN_ID,
  signature_file_id: 'cloud://test-env/sign_evidence/zz.png', docs_ack: true
};

test('submit_realname: prod + face_mode=wx → realname_face_online(提审后关闸)', async () => {
  const { r, sdk } = await run(realnameStore({ realname_face_mode: 'wx' }), RN_EVENT);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'realname_face_online');
  assert.ok(!(sdk.writes.user_account || []).some((w) => w.data && w.data.is_realname_done), '拒绝时不得置实名');
});

test('submit_realname: prod + face_mode 缺失 → realname_face_online(fail-closed 默认)', async () => {
  const { r } = await run(realnameStore({}), RN_EVENT);
  assert.strictEqual(r.code, 'realname_face_online');
});

test('submit_realname: dev + face_mode 缺失 → 守卫放行(mock 默认, 开发便利)', async () => {
  const { r } = await run(realnameStore({ env: 'dev' }), RN_EVENT);
  assert.notStrictEqual(r.code, 'realname_face_online', 'dev 不应被守卫拦截');
  assert.notStrictEqual(r.code, 'login_server_error', '不得因作用域缺陷抛 ReferenceError(2026-10-21 修复回归)');
});

test('simulate_realname: prod → realname_mock_closed(不得 ReferenceError)', async () => {
  const { r } = await run(realnameStore({ env: 'prod' }), { action: 'simulate_realname' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'realname_mock_closed');
});

test('peek_login: error_scan 巡检通知不计入 unread_notice', async () => {
  const store = loginStore();
  store.system_notice = {
    s1: { _id: 's1', to_openid: OPENID, read: false, type: 'error_scan', created_at: 2 },
    s2: { _id: 's2', to_openid: OPENID, read: false, type: 'demand_grab', created_at: 1 }
  };
  const { r, sdk } = await run(store, { action: 'peek_login' });
  assert.strictEqual(r.ok, true);
  const c = sdk.calls.find((x) => x.method === 'where.count' && x.name === 'system_notice');
  assert.ok(c, '应发起未读 count');
  assert.strictEqual(c.query.type.__sentinel, 'neq', '未读计数须排除 error_scan');
  assert.strictEqual(c.query.type.args[0], 'error_scan');
});