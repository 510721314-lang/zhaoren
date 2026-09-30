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

test('dev 环境(读配置成功 env=dev) + 无真实OPENID + mock_openid → 云端测试面板放行返回 mock', async () => {
  const { resolveOpenid } = freshOpenid();
  const cloud = makeCloud({ env: 'dev' });
  cloud.getWXContext = () => ({ OPENID: null });
  const oid = await resolveOpenid(cloud, { mock_openid: 'MOCK_DEV_1' });
  assert.strictEqual(oid, 'MOCK_DEV_1');
});

test('配置读取失败 → 环境缓存兜底 prod(fail-closed), 不隐式放开 mock', async () => {
  const m = freshOpenid();
  await m.resolveOpenid(makeCloud(new Error('db down')), {}); // 触发 _readEnv 失败, 写入兜底缓存
  assert.strictEqual(m.getCachedEnv(), 'prod');
});