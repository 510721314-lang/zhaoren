// init-db 入口契约测试(2026-10-13)
// 覆盖: force_set_env 高危开关的 confirm 门 / 管理员身份门(网关代理密钥) /
//       切 dev 同刻写 dev_until(openid.js 规范源 fail-closed 判定依据, 2026-10-13 收敛)
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
function loadInitDb(sdk) {
  activeSdk = sdk;
  // 清 index + openid 模块级缓存(env 缓存会跨用例残留)
  for (const f of ['../init-db/index.js', '../init-db/openid.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../init-db/index.js');
}

const ADMIN = 'o_admin_1';
const WK = 'WK-init-1';
const store = () => ({
  admin_config: { global: { env: 'prod', admin_openids: [ADMIN], admin_web_key: WK } }
});
const proxyEvent = (extra) => Object.assign({
  __admin_web_proxy: true, _admin_web_proxy_key: WK, _admin_web_proxy_openid: ADMIN
}, extra);

test('force_set_env: 缺 confirm → need_confirm', async () => {
  const sdk = makeSdk({ openid: '', store: store() });
  const { main } = loadInitDb(sdk);
  const r = await main(proxyEvent({ action: 'force_set_env', env: 'dev', reason: 't' }), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'need_confirm');
});

test('force_set_env: 代理密钥不匹配 → no_identity(fail-closed)', async () => {
  const sdk = makeSdk({ openid: '', store: store() });
  const { main } = loadInitDb(sdk);
  const r = await main({ action: 'force_set_env', env: 'dev', reason: 't', confirm: true, __admin_web_proxy: true, _admin_web_proxy_key: 'WRONG', _admin_web_proxy_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no_identity');
});

test('force_set_env: 切 dev → 同刻写 dev_until(=force_expire_at, 约4h 自毁)', async () => {
  const sdk = makeSdk({ openid: '', store: store() });
  const { main } = loadInitDb(sdk);
  const t0 = Date.now();
  const r = await main(proxyEvent({ action: 'force_set_env', env: 'dev', reason: 't', confirm: true }), {});
  assert.strictEqual(r.ok, true);
  const w = (sdk.writes.admin_config || []).find((x) => x.data && x.data.env === 'dev');
  assert.ok(w, '应写 admin_config.env=dev');
  assert.strictEqual(w.data.dev_until, w.data.force_expire_at, 'dev_until 与 force_expire_at 同刻到期');
  assert.ok(w.data.dev_until > t0 + 3.9 * 3600 * 1000, '窗口约 4 小时');
});

test('force_set_env: 切回 prod → dev_until 归零(不再被判定为 dev)', async () => {
  const sdk = makeSdk({ openid: '', store: (() => {
    const s = store();
    s.admin_config.global.env = 'dev';
    s.admin_config.global.dev_until = Date.now() + 3600 * 1000;
    return s;
  })() });
  const { main } = loadInitDb(sdk);
  const r = await main(proxyEvent({ action: 'force_set_env', env: 'prod', reason: 't', confirm: true }), {});
  assert.strictEqual(r.ok, true);
  const w = (sdk.writes.admin_config || []).find((x) => x.data && x.data.env === 'prod');
  assert.ok(w, '应写 admin_config.env=prod');
  assert.strictEqual(w.data.dev_until, 0, 'dev_until 归零');
  assert.strictEqual(w.data.force_expire_at, null, 'force_expire_at 清空');
});

test.after(() => { Module._load = origLoad; });