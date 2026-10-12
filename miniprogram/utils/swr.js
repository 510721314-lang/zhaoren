// SWR (Stale-While-Revalidate) 轻量本地缓存 · S8 性能优化
// 用途: 列表类只读数据(首页广场/需求广场)先用本地旧缓存秒开渲染, 网络请求回来后静默覆盖
// 边界:
//   - 仅用于可接受"短暂旧数据、最终一致"的只读列表; 交易/支付/状态类数据禁用
//   - 缓存结构带版本号与时间戳, TTL 内才渲染; 数据结构变更时 bump key 版本即自动失效
//   - 存储失败(容量满等)静默降级为纯网络模式, 不影响主流程
const PREFIX = 'swr_';

// ── 缓存 key 版本规范(批2.3) ──
// 约定: 所有 swr key 必须以 _v{n} 结尾(现存: home_square_v1 / home_scene_groups_v2 / square_page_v1)。
// 缓存结构或字段语义变更时 bump 版本号 → 旧 key 自然失效(不再被读取), 避免旧结构数据污染新渲染逻辑
// (场景「前端不显示」开关已踩过 v1→v2)。带版本的 key 只需过期即可, 无需显式清理旧 key。
// 新增 key 未带版本号时开发期告警(仅提示, 不阻塞)。
const KEY_RE = /_v\d+$/;
function warnKey(key) {
  if (!KEY_RE.test(String(key))) {
    try { console.warn('[swr] 缓存 key 需带版本号 _v{n}: ' + key); } catch (e) {}
  }
}

// 读缓存: 命中且未过期返回 data, 否则 null
function get(key, ttlMs) {
  warnKey(key);
  try {
    const wrap = wx.getStorageSync(PREFIX + key);
    if (!wrap || typeof wrap !== 'object' || !wrap.ts) return null;
    if (Date.now() - wrap.ts > ttlMs) return null;
    return wrap.data;
  } catch (e) {
    return null;
  }
}

// 写缓存: { ts, data } 结构
function set(key, data) {
  warnKey(key);
  try {
    wx.setStorageSync(PREFIX + key, { ts: Date.now(), data });
  } catch (e) {
    /* 容量满/异常静默降级, 不阻塞业务 */
  }
}

module.exports = { get, set };
