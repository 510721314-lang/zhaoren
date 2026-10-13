// admin-action 入口鉴权门契约测试
// 覆盖点：白名单拒绝 / 空名单 / 无 openid / config_public 免鉴权放行
const test = require('node:test');
const assert = require('node:assert');
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
  // 清 index + 其依赖的 openid(模块级 _cachedEnv 会跨用例残留) + logger 缓存
  for (const f of ['../admin-action/index.js', '../admin-action/openid.js', '../admin-action/logger.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../admin-action/index.js');
}

const ADMIN = 'o_admin_1';
const STRANGER = 'o_stranger_1';

function store(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// 1. 非白名单 → admin_forbidden（白名单非空）
test('admin: 非白名单 openid → admin_forbidden', async () => {
  const sdk = makeSdk({ openid: STRANGER, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_forbidden');
});

// 2. 白名单为空 → admin_empty
test('admin: 白名单为空 → admin_empty', async () => {
  const sdk = makeSdk({ openid: STRANGER, store: store('prod', []) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_empty');
});

// 3. 无 openid（prod + 无真实身份）→ admin_no_openid
test('admin: 无登录身份 → admin_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_no_openid');
});

// 4. config_public 免鉴权：非白名单也能拉取公开配置
test('admin: config_public 免鉴权 → ok', async () => {
  const sdk = makeSdk({ openid: STRANGER, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_public' }, {});
  assert.strictEqual(r.ok, true);
  assert.ok(r.data, '应返回公开配置数据');
});

// 5. dev 环境 mock_openid → 视为测试管理员放行（不被白名单拦截）
test('admin: dev + mock_openid → 放行(不返回 forbidden)', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders', mock_openid: STRANGER }, {});
  // 通过鉴权门后才会进入后续；只要不是 forbidden/empty/no_openid 即证明鉴权门放行
  assert.notStrictEqual(r.code, 'admin_forbidden');
  assert.notStrictEqual(r.code, 'admin_empty');
  assert.notStrictEqual(r.code, 'admin_no_openid');
});

// 批4.1: 切 dev 必须带 dev_hours(1-24), 否则 fail-closed 拒绝放开 mock 身份门控
test('config_set: 切 dev 缺 dev_hours → config_bad_dev_hours', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', env: 'dev', confirm: 'SWITCH_DEV', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_bad_dev_hours');
});

test('config_set: 切 dev dev_hours=25(超上限) → config_bad_dev_hours', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', env: 'dev', confirm: 'SWITCH_DEV', dev_hours: 25, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_bad_dev_hours');
});

test('config_set: 切 dev 带 dev_hours=2 → ok(updated 含 env/dev_until)', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', env: 'dev', confirm: 'SWITCH_DEV', dev_hours: 2, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, true);
  assert.ok((r.data.updated || []).indexOf('env') >= 0, '应写入 env');
  assert.ok((r.data.updated || []).indexOf('dev_until') >= 0, '应写入 dev_until');
});

// ── 2026-10-13: admin_login 防爆破锁定(复用 _shared/security_policy.js, 与 user-login 同口径) ──
const crypto2 = require('crypto');
const SALT = 'salt_x1';
const PWD = 'p@ssw0rd-8';
const PWD_HASH = crypto2.createHash('sha256').update(SALT + PWD + SALT).digest('hex');

function loginStore(acc) {
  return {
    admin_config: { global: { env: 'prod', admin_openids: [ADMIN] } },
    admin_accounts: {
      acc_root: Object.assign({
        _id: 'acc_root', account: 'root', password_salt: SALT, password_hash: PWD_HASH,
        role: 'R1', display_name: 'Root', status: 'active', is_deleted: false
      }, acc || {})
    }
  };
}

test('admin_login: 错误密码 → login_bad + 失败计数写入(pwd_fail_count=1)', async () => {
  const sdk = makeSdk({ openid: '', store: loginStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_login', account: 'root', password: 'wrong-pwd-1' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'login_bad');
  const w = (sdk.writes.admin_accounts || [])[0];
  assert.ok(w, '应写失败计数');
  assert.strictEqual(w.data.pwd_fail_count, 1);
  assert.strictEqual(w.data.pwd_lock_until, undefined, '未达上限不写锁定');
});

test('admin_login: 第5次失败 → 写锁定(pwd_lock_until≈now+10min, 计数清零)', async () => {
  const sdk = makeSdk({ openid: '', store: loginStore({ pwd_fail_count: 4 }) });
  const { main } = loadIndex(sdk);
  const t0 = Date.now();
  const r = await main({ action: 'admin_login', account: 'root', password: 'wrong-pwd-2' }, {});
  assert.strictEqual(r.code, 'login_bad');
  const w = (sdk.writes.admin_accounts || [])[0];
  assert.strictEqual(w.data.pwd_fail_count, 0);
  assert.ok(w.data.pwd_lock_until > t0 + 9 * 60 * 1000 && w.data.pwd_lock_until < t0 + 11 * 60 * 1000, '锁定 10 分钟');
  const ev = (sdk.writes.platform_event || []).find((e) => e.data.type === 'admin_login_fail');
  assert.strictEqual(ev.data.payload.locked, true, 'P1 事件应标注本次触发锁定');
});

test('admin_login: 锁定中(即使密码正确) → login_locked, 不验密不写库', async () => {
  const sdk = makeSdk({ openid: '', store: loginStore({ pwd_lock_until: Date.now() + 5 * 60 * 1000 }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_login', account: 'root', password: PWD }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'login_locked');
  assert.ok(!sdk.writes.admin_accounts, '锁定拒绝不应有账号写');
});

test('admin_login: 密码正确 → 发 token 并清零历史失败计数', async () => {
  const sdk = makeSdk({ openid: '', store: loginStore({ pwd_fail_count: 3, pwd_lock_until: 0 }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_login', account: 'root', password: PWD }, {});
  assert.strictEqual(r.ok, true);
  assert.ok(String(r.data.token).startsWith('ADMT-'), '应发会话 token');
  const w = (sdk.writes.admin_accounts || [])[0];
  assert.deepStrictEqual(w.data, { pwd_fail_count: 0, pwd_lock_until: 0 });
});

// ── 2026-10-13: 网关代理身份校验从 openid.js 上移到 index.js 包装层后的行为锁定 ──
const WK = 'WK-proxy-1';
function proxyStore() {
  return { admin_config: { global: { env: 'prod', admin_openids: [ADMIN], admin_web_key: WK } } };
}

test('proxy: 网关密钥匹配 → 以上游声明 openid 通过鉴权(不再 forbidden/no_openid)', async () => {
  const sdk = makeSdk({ openid: '', store: proxyStore() });
  const { main } = loadIndex(sdk);
  const r = await main({
    action: 'dashboard', __admin_web_proxy: true,
    _admin_web_proxy_openid: ADMIN, _admin_web_proxy_key: WK, mock_openid: ADMIN
  }, {});
  assert.notStrictEqual(r.code, 'admin_forbidden');
  assert.notStrictEqual(r.code, 'admin_empty');
  assert.notStrictEqual(r.code, 'admin_no_openid');
});

test('proxy: 密钥不匹配 → fail-closed 回落正常解析(prod 拒绝 mock → admin_no_openid)', async () => {
  const sdk = makeSdk({ openid: '', store: proxyStore() });
  const { main } = loadIndex(sdk);
  const r = await main({
    action: 'dashboard', __admin_web_proxy: true,
    _admin_web_proxy_openid: ADMIN, _admin_web_proxy_key: 'WRONG-KEY', mock_openid: ADMIN
  }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_no_openid');
});

test.after(() => { Module._load = origLoad; });
