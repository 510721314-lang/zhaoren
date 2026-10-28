// admin_config 进程内缓存(2026-10-28 用量治理; 规范源, 修改后跑 sync-config-cache.ps1)
// 背景: 各函数 getConfig() 每次调用都读一次 admin_config.global —— 2026-10-28 实测该集合占 DB 请求
//   23.6%(3,501 / 14,852, 00:00-15:00), 与函数调用数(3,313)几乎 1:1, 属结构性浪费。
// 方案: 进程内 30s TTL + 并发合并(同实例并发请求只发 1 次查询); 读取失败不写缓存(下次调用重试)。
// 隔离: 缓存按 db 实例分桶(WeakMap) —— 生产每函数一个 db 实例(缓存生效);
//   单测各用例各自 new fake db(互不污染; 首版模块级单例曾致 order_timeout/user-login 用例串味)。
// 边界: 配置变更最晚 30s 生效; 「写后立刻读新值」的路径用 { force: true } 或先调 invalidate(db)。
// 用法: const { getGlobalConfig } = require('./config_cache');
//       const cfg = await getGlobalConfig(db);   // 命中返回配置对象; 读取失败返回 null(调用方走默认值兜底)
const DEFAULT_TTL_MS = 30000;

const _buckets = new WeakMap();
let _lastBucket = null;

function _bucket(db) {
  let b = _buckets.get(db);
  if (!b) {
    b = { cache: null, at: 0, inflight: null };
    _buckets.set(db, b);
  }
  _lastBucket = b;
  return b;
}

function invalidate(db) {
  const b = db ? _buckets.get(db) : _lastBucket;
  if (b) { b.cache = null; b.at = 0; }
}

function getGlobalConfig(db, opts) {
  const b = _bucket(db);
  const ttl = (opts && typeof opts.ttlMs === 'number') ? opts.ttlMs : DEFAULT_TTL_MS;
  const force = !!(opts && opts.force);
  const now = Date.now();
  if (!force && b.cache && now - b.at < ttl) return Promise.resolve(b.cache);
  if (b.inflight) return b.inflight;
  b.inflight = db.collection('admin_config').doc('global').get()
    .then((r) => {
      const d = (r && r.data) || null;
      if (d) { b.cache = d; b.at = Date.now(); }
      return d;
    })
    .catch(() => null)
    .then((d) => { b.inflight = null; return d; });
  return b.inflight;
}

module.exports = { getGlobalConfig, invalidate, DEFAULT_TTL_MS };
