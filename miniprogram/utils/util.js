// utils/util.js - 通用工具函数

// 分转元字符串(10.00 元 = 1000 分) · 禁止浮点运算金额
function formatMoney(fen) {
  if (fen === null || fen === undefined || fen === '') return '0.00';
  const n = Number(fen);
  if (isNaN(n)) return '0.00';
  const yuan = Math.floor(n / 100);
  const cents = Math.abs(n % 100);
  return `${yuan}.${cents < 10 ? '0' + cents : cents}`;
}

// 手机号脱敏 138****1234
function maskPhone(phone) {
  if (!phone || phone.length < 11) return phone || '';
  return phone.slice(0, 3) + '****' + phone.slice(7);
}

// 身份证号脱敏 5101**********1234
function maskIdCard(id) {
  if (!id || id.length < 18) return id || '';
  return id.slice(0, 4) + '**********' + id.slice(14);
}

// 时间差格式化(N分钟前/N小时前/N天前)
function timeAgo(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
  const d = new Date(ts);
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 防抖
function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait || 300);
  };
}

// Haversine 球面距离(公里) · 两经纬度间直线距离
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 通勤估算:步行 5km/h、骑行 15km/h、公交 20km/h(含等车)、驾车 30km/h(城市道路)
function estimateCommute(km) {
  return {
    distance_km: Math.round(km * 10) / 10,
    walk_min: Math.round(km / 5 * 60),
    bike_min: Math.round(km / 15 * 60),
    bus_min: Math.round(km / 20 * 60),
    drive_min: Math.round(km / 30 * 60)
  };
}

module.exports = {
  formatMoney,
  maskPhone,
  maskIdCard,
  timeAgo,
  debounce,
  haversineKm,
  estimateCommute
};
