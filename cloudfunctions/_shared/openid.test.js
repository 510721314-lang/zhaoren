// openid.js 环境安全语义单测(零依赖 node:test) · 核心断言 fail-closed: prod 下 mock_openid 一律失效
// 说明: _readEnv 有模块级缓存(5min), 同进程内首个调用即锁定 env;
//       本文件 mock 云数据库 read 恒失败 → env 恒为 prod(fail-closed), 恰好覆盖最关键的防冒充路径。
const test = require('node:test');
const assert = require('node:assert');
const { resolveOpenid } = require('./openid');

// 云数据库 read 永远抛错 → env 兜底 prod
const cloud = {
  getWXContext: () => ({ OPENID: 'REAL_OPENID_123' }),
  database: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => { throw new Error('db down'); }
      })
    })
  })
};

test('prod + mock_openid + 真实OPENID → 返回真实OPENID(mock 被忽略, 防冒充)', async () => {
  const oid = await resolveOpenid(cloud, { mock_openid: 'FAKE_MOCK' });
  assert.strictEqual(oid, 'REAL_OPENID_123');
});

test('无真实OPENID + mock_openid + prod(fail-closed) → 返回 null', async () => {
  const c = {
    getWXContext: () => ({ OPENID: null }),
    database: () => ({
      collection: () => ({ doc: () => ({ get: async () => { throw new Error('down'); } }) })
    })
  };
  const oid = await resolveOpenid(c, { mock_openid: 'FAKE_MOCK' });
  assert.strictEqual(oid, null);
});

test('配置读取失败已在先前调用触发 → 环境缓存兜底为 prod(fail-closed)', () => {
  assert.strictEqual(require('./openid').getCachedEnv(), 'prod');
});