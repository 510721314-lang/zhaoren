// config_cache.js 守护测试(2026-10-28 用量治理): 缓存必须真的减少 admin_config 读取, 且不吞错
const test = require('node:test');
const assert = require('node:assert');
const { getGlobalConfig, invalidate, DEFAULT_TTL_MS } = require('./config_cache');

function fakeDb(opts) {
  const db = { calls: 0, fail: false };
  db.collection = () => ({
    doc: () => ({
      get: async () => {
        db.calls++;
        if (db.fail) throw new Error('boom');
        return { data: { scene_list: [], tick: db.calls } };
      }
    })
  });
  if (opts && opts.fail) db.fail = true;
  return db;
}

test('命中缓存: TTL 内连续两次只读 1 次', async () => {
  invalidate();
  const db = fakeDb();
  const a = await getGlobalConfig(db);
  const b = await getGlobalConfig(db);
  assert.strictEqual(db.calls, 1);
  assert.deepStrictEqual(a, b);
  assert.ok(a && a.scene_list);
});

test('force=true 穿透缓存', async () => {
  invalidate();
  const db = fakeDb();
  await getGlobalConfig(db);
  const c = await getGlobalConfig(db, { force: true });
  assert.strictEqual(db.calls, 2);
  assert.strictEqual(c.tick, 2);
});

test('ttlMs=0 等价不缓存', async () => {
  invalidate();
  const db = fakeDb();
  await getGlobalConfig(db, { ttlMs: 0 });
  await getGlobalConfig(db, { ttlMs: 0 });
  assert.strictEqual(db.calls, 2);
});

test('读取失败返回 null 且不污染缓存(后续成功仍可读)', async () => {
  invalidate();
  const db = fakeDb({ fail: true });
  const r1 = await getGlobalConfig(db);
  assert.strictEqual(r1, null);
  db.fail = false;
  const r2 = await getGlobalConfig(db);
  assert.ok(r2 && r2.scene_list);
  assert.strictEqual(db.calls, 2);
});

test('并发合并: 同时两次只发 1 次查询', async () => {
  invalidate();
  const db = fakeDb();
  const [x, y] = await Promise.all([getGlobalConfig(db), getGlobalConfig(db)]);
  assert.strictEqual(db.calls, 1);
  assert.deepStrictEqual(x, y);
});

test('invalidate 后重新读取', async () => {
  invalidate();
  const db = fakeDb();
  await getGlobalConfig(db);
  invalidate(db);
  await getGlobalConfig(db);
  assert.strictEqual(db.calls, 2);
});

test('不同 db 实例缓存互相隔离(单测防串味)', async () => {
  const db1 = fakeDb();
  const db2 = fakeDb();
  await getGlobalConfig(db1);
  await getGlobalConfig(db2);
  // 若缓存为模块级单例, 第二次会命中 db1 的缓存 → db2.calls 为 0; 隔离后各读 1 次
  assert.strictEqual(db1.calls, 1);
  assert.strictEqual(db2.calls, 1);
});

test('默认 TTL 为 30s', () => {
  assert.strictEqual(DEFAULT_TTL_MS, 30000);
});
