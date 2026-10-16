// miniprogram/utils/geo-wx.js · 订单详情「定位能力链路」服务模块
// 拆分阶段2b(2026-10-16): 原 order-detail.js @VERIFIED 方法逐字迁出(用户书面批准, 方案 §8.2 前置3); 接收 page
// 设计: 只搬不改逻辑; 禁 getApp()/globalData(方案 §5.8); 页面 order-detail.js 留同名薄代理, 全部调用点零改
// 迁出源: order-detail.js _evalFulfillGeo(现 L538) / _collectStartLocation(现 L620) / _addrOf(现 L774)

const CONFIG = require('../config/index.js');
const { evaluatePosition } = require('./geo-guard.js');

// 迁自 order-detail.js _evalFulfillGeo(定位能力链路: wx.getLocation + geo-guard 判定); 仅 this→page 机械替换
function evalFulfillGeo(page) {
  const o = page.data.order;
  if (!o || o.status !== 'S2' || o.my_role !== 'partner') {
    if (page.data.geoGuard) page.setData({ geoGuard: null });
    return;
  }
  const site = o.location || null;
  const thresholdM = CONFIG.FULFILL.distanceMaxM;
  const accuracyMaxM = CONFIG.FULFILL.accuracyMaxM;
  wx.getLocation({
    type: 'gcj02',
    isHighAccuracy: true,
    highAccuracyExpireTime: 4000,
    success: (loc) => {
      page.setData({ geoGuard: evaluatePosition({
        user: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy },
        site: site, thresholdM: thresholdM, accuracyMaxM: accuracyMaxM
      }) });
    },
    // 未授权/取点失败: 明确置灰并引导(不静默放行); 若本单履约地本身无有效坐标, 判定内部会兜底放行
    fail: () => {
      page.setData({ geoGuard: evaluatePosition({ user: null, site: site, thresholdM: thresholdM, accuracyMaxM: accuracyMaxM }) });
    }
  });
}

// 迁自 order-detail.js _collectStartLocation(纯定位快照); 原体内 that._addrOf → 模块内 addrOf(机械替换)
function collectStartLocation(page, silent, withAddr) {
  return new Promise((resolve) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success: (loc) => {
        const base = { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy };
        if (!withAddr) { resolve(base); return; }
        addrOf(loc.latitude, loc.longitude).then((addr) => resolve(Object.assign({ address: addr }, base)));
      },
      fail: () => {
        if (!silent) wx.showToast({ title: '发起履约申请需授权定位, 请开启后重试', icon: 'none' });
        resolve(null);
      }
    });
  });
}

// 迁自 order-detail.js _addrOf(逆地理编码取可读地址; 腾讯地图 key 来自 CONFIG); 无 key/请求失败回退坐标串; 不依赖 page
function addrOf(lat, lng) {
  const coord = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  if (!CONFIG.TENCENT_MAP_KEY) return Promise.resolve(coord);
  return new Promise((resolve) => {
    wx.request({
      url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${CONFIG.TENCENT_MAP_KEY}`,
      timeout: 5000,
      success: (r) => {
        const res = r.data && r.data.result;
        const addr = res && ((res.formatted_addresses && res.formatted_addresses.recommend) || res.address);
        resolve(addr || coord);
      },
      fail: () => resolve(coord)
    });
  });
}

// 迁自 publish.js reverseGeocode(顶层函数, 逐字搬迁; 方案 §3 阶段2 与文件1 addrOf 同模块共置, 但**降级行为各自不变**: 本函数无 key 时返回空串 '')
// 逆地理编码: 经纬度 → 中文可读地址(腾讯地图 WebService; key 空则降级返回坐标字符串)
function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    const key = CONFIG.TENCENT_MAP_KEY;
    if (!key) { resolve(''); return; }
    wx.request({
      url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${key}`,
      timeout: 5000,
      success: (r) => {
        const data = r.data || {};
        if (data.status !== 0 || !data.result) {
          console.warn('[reverseGeocode] bad status:', data.status, data.message);
          resolve(''); return;
        }
        const addr = (data.result.formatted_addresses && data.result.formatted_addresses.recommend)
          || data.result.address || '';
        resolve(addr);
      },
      fail: (err) => { console.error('[reverseGeocode] wx.request fail:', err && err.errMsg); resolve(''); }
    });
  });
}

module.exports = { evalFulfillGeo, collectStartLocation, addrOf, reverseGeocode };
