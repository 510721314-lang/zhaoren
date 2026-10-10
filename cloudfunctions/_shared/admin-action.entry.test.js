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
  return { admin_config: { global: { env, admin_openids: adminOpenids } } };
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

test.after(() => { Module._load = origLoad; });
