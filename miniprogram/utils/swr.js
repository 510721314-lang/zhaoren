// SWR (Stale-While-Revalidate) 轻量本地缓存 · S8 性能优化
// 用途: 列表类只读数据(首页广场/需求广场)先用本地旧缓存秒开渲染, 网络请求回来后静默覆盖
// 边界:
//   - 仅用于可接受"短暂旧数据、最终一致"的只读列表; 交易/支付/状态类数据禁用
//   - 缓存结构带版本号与时间戳, TTL 内才渲染; 数据结构变更时 bump key 版本即自动失效
//   - 存储失败(容量满等)静默降级为纯网络模式, 不影响主流程
const PREFIX = 'swr_';

// 读缓存: 命中且未过期返回 data, 否则 null
function get(key, ttlMs) {
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
  try {
    wx.setStorageSync(PREFIX + key, { ts: Date.now(), data });
  } catch (e) {
    /* 容量满/异常静默降级, 不阻塞业务 */
  }
}

module.exports = { get, set };
