// miniprogram/utils/once-anchor.js · 被动提示幂等锚（规则 §34，2026-10-30）
// 背景: 页面实例内存标记(this.__x)随页面销毁即失效, 重进页面会把同一提示再弹一次。
// 约定: 键一律 once:<scene>:<id>:<阶段>(本模块自动加 once: 前缀), 阶段推进才允许重提示。
// 只做 Storage 读写, 不含业务判断; 键名与阶段由调用方拼装。

const PREFIX = 'once:';
const MAX_MAP = 30; // 列表类去重只保留最近 N 条, 防 Storage 无限增长

function has(key) {
  try { return !!wx.getStorageSync(PREFIX + key); } catch (e) { return false; }
}

function mark(key) {
  try { wx.setStorageSync(PREFIX + key, 1); } catch (e) {}
}

// 列表类去重: 取回 {id:1} 映射, 调用方过滤后写回
function getMap(key) {
  try { return wx.getStorageSync(PREFIX + key) || {}; } catch (e) { return {}; }
}

function putMap(key, map) {
  const keys = Object.keys(map || {});
  const trimmed = keys.length > MAX_MAP
    ? keys.slice(keys.length - MAX_MAP).reduce((a, k) => { a[k] = 1; return a; }, {})
    : (map || {});
  try { wx.setStorageSync(PREFIX + key, trimmed); } catch (e) {}
}

module.exports = { has, mark, getMap, putMap };
