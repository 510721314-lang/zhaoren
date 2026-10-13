// openid.js 环境安全语义单测(零依赖 node:test) · 核心断言 fail-closed: prod 下 mock_openid 一律失效
// 每条 test 通过 freshOpenid() 重置模块缓存(清 _cachedEnv), 保证自包含、无顺序依赖。
const test = require('node:test');
const assert = require('node:assert');

// 清除 openid.js 的 require 缓存并重新加载 → 模块级 _cachedEnv 归零, 每条测试独立
function freshOpenid() {
  delete require.cache[require.resolve('./openid')];
  return require('./openid');
}

// 可控 cloud mock: dbResult 为 Error → 读配置抛错(env 兜底 prod); 为对象 → 返回 { data }
function makeCloud(dbResult) {
  return {
    getWXContext: () => ({ OPENID: 'REAL_OPENID_123' }),
    database: () => ({
      collection: () => ({
        doc: () => ({
          get: async () => {
            if (dbResult instanceof Error) throw dbResult;
            return { data: dbResult };
          }
        })
      })
    })
  };
}

test('prod(配置读失败兜底) + mock_openid + 真实OPENID → 返回真实OPENID(mock 被忽略, 防冒充)', async () => {
  const { resolveOpenid } = freshOpenid();
  const oid = await resolveOpenid(makeCloud(new Error('db down')), { mock_openid: 'FAKE_MOCK' });
  assert.strictEqual(oid, 'REAL_OPENID_123');
});

test('prod + 无真实OPENID + mock_openid → fail-closed 返回 null(不放开 mock)', async () => {
  const { resolveOpenid } = freshOpenid();
  const cloud = makeCloud(new Error('down'));
  cloud.getWXContext = () => ({ OPENID: null });
  const oid = await resolveOpenid(cloud, { mock_openid: 'FAKE_MOCK' });
  assert.strictEqual(oid, null);
});

const FUTURE = Date.now() + 2 * 3600 * 1000; // 2h 后
const PAST = Date.now() - 1000;              // 1s 前(已过期)

test('dev + dev_until 未过期 + 无真实OPENID + mock_openid → 放行返回 mock', async () => {
  const { resolveOpenid } = freshOpenid();
  const cloud = makeCloud({ env: 'dev', dev_until: FUTURE });
  cloud.getWXContext = () => ({ OPENID: null });
  const oid = await resolveOpenid(cloud, { mock_openid: 'MOCK_DEV_1' });
  assert.strictEqual(oid, 'MOCK_DEV_1');
});

test('dev + dev_until 已过期 → fail-closed 回 prod, mock 被拒(返回 null)', async () => {
  const { resolveOpenid } = freshOpenid();
  const cloud = makeCloud({ env: 'dev', dev_until: PAST });
  cloud.getWXContext = () => ({ OPENID: null });
  const oid = await resolveOpenid(cloud, { mock_openid: 'MOCK_DEV_2' });
  assert.strictEqual(oid, null);
});

test('dev + 缺 dev_until(0/缺失) → 视同过期, fail-closed 回 prod', async () => {
  const { resolveOpenid } = freshOpenid();
  const cloud = makeCloud({ env: 'dev' }); // 无 dev_until
  cloud.getWXContext = () => ({ OPENID: null });
  const oid = await resolveOpenid(cloud, { mock_openid: 'MOCK_DEV_3' });
  assert.strictEqual(oid, null);
});

test('dev + dev_bypass=true(回滚开关) → 跳过过期校验, 即使无 dev_until 也放行', async () => {
  const { resolveOpenid } = freshOpenid();
  const cloud = makeCloud({ env: 'dev', dev_bypass: true });
  cloud.getWXContext = () => ({ OPENID: null });
  const oid = await resolveOpenid(cloud, { mock_openid: 'MOCK_DEV_4' });
  assert.strictEqual(oid, 'MOCK_DEV_4');
});

test('dev + 有真实OPENID + dev_until 未过期 → mock 优先(dev 语义)', async () => {
  const { resolveOpenid } = freshOpenid();
  const cloud = makeCloud({ env: 'dev', dev_until: FUTURE });
  const oid = await resolveOpenid(cloud, { mock_openid: 'MOCK_OVER' });
  assert.strictEqual(oid, 'MOCK_OVER');
});

test('配置读取失败 → 环境缓存兜底 prod(fail-closed), 不隐式放开 mock', async () => {
  const m = freshOpenid();
  await m.resolveOpenid(makeCloud(new Error('db down')), {}); // 触发 _readEnv 失败, 写入兜底缓存
  assert.strictEqual(m.getCachedEnv(), 'prod');
});

// ── 2026-10-13: invalidateEnvCache(init-db force_set_env 收敛到规范源所需) ──
test('invalidateEnvCache → 清缓存后立即感知新 env: dev(有效) → prod 生效, mock 被拒', async () => {
  const m = freshOpenid();
  const devCloud = makeCloud({ env: 'dev', dev_until: FUTURE });
  devCloud.getWXContext = () => ({ OPENID: null });
  assert.strictEqual(await m.resolveOpenid(devCloud, { mock_openid: 'M1' }), 'M1');
  // 未清缓存时换 prod 配置不生效(5 分钟短缓存内仍按 dev)
  const prodCloud = makeCloud({ env: 'prod' });
  prodCloud.getWXContext = () => ({ OPENID: null });
  assert.strictEqual(await m.resolveOpenid(prodCloud, { mock_openid: 'M2' }), 'M2');
  // 清缓存(force_set_env 场景)后立即按 prod fail-closed
  m.invalidateEnvCache();
  assert.strictEqual(await m.resolveOpenid(prodCloud, { mock_openid: 'M3' }), null);
});