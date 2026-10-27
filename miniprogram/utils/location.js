// miniprogram/utils/location.js · 定位调用统一收口(2026-10-27)
// 背景: wx.getLocation 回调在部分机型/权限异常下不返回, 裸调会让 showLoading/旋转图标/Promise 永久卡死(发布页事故)。
// 约定: miniprogram/ 内禁止裸调 wx.getLocation(scripts/check-location-timeout-policy.js 门禁);
//       一律走 getLocationSafe: 默认 gcj02 + 高精度, 8s 必收敛, Promise 永不 reject、永不悬空, 迟到回调丢弃。
'use strict';

const DEFAULT_TIMEOUT_MS = 8000;

// 返回 { ok: true, latitude, longitude, accuracy, ... } | { ok: false, timeout?: true, errMsg }
// options: { type, isHighAccuracy, highAccuracyExpireTime, timeoutMs }, 默认值即安全值
function getLocationSafe(options) {
  const opts = options || {};
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (r) => {
      if (settled) return;   // 超时后迟到的回调直接丢弃
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    timer = setTimeout(() => {
      console.warn('[getLocationSafe] timeout', timeoutMs);
      finish({ ok: false, timeout: true, errMsg: `getLocation:fail timeout(${timeoutMs}ms)` });
    }, timeoutMs);
    try {
      wx.getLocation({
        type: opts.type || 'gcj02',
        isHighAccuracy: opts.isHighAccuracy !== false,
        highAccuracyExpireTime: opts.highAccuracyExpireTime || 4000,
        success: (res) => finish({
          ok: true,
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          altitude: res.altitude,
          speed: res.speed,
          errMsg: res.errMsg || 'getLocation:ok'
        }),
        fail: (err) => finish({ ok: false, errMsg: (err && err.errMsg) || 'getLocation:fail' })
      });
    } catch (e) {
      finish({ ok: false, errMsg: (e && e.message) || 'getLocation:throw' });
    }
  });
}

module.exports = { getLocationSafe, DEFAULT_TIMEOUT_MS };
