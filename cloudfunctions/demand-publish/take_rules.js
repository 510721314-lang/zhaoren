// 共享：接单/发布规则纯函数库(规范源/单一实现)
// ⚠️ 微信云开发按单函数目录打包, 不支持跨目录 require('../_shared/')。
// 本文件为「规范源」, 修改后需运行 sync-take-rules.ps1 同步复制到:
//   cloudfunctions/order-create/take_rules.js
//   cloudfunctions/demand-publish/take_rules.js
//   cloudfunctions/order-action/take_rules.js
//   cloudfunctions/home-action/take_rules.js
// (各函数用本地 ./take_rules.js, 与本项目 ./logger 惯例一致)
// 抽取来源(2026-10-06 D2-3 防漂移):
//   order-create: CN_OFFSET_MS/isServiceTimeAllowed/cnDayStart/cnWeekday/DAY_MS/
//                 readRateRange/parseSlot/rangeInSlot/slotCovers/haversineKm/TAKE_MAX_DISTANCE_KM
//   demand-publish: isServiceTimeAllowed(与 order-create 逐行一致)/haversineKm
//   order-action: haversineKm(同式)
//   home-action: haversineKm(asin 变体, 数学等价, 统一为 atan2 形式)
// 单测: 同目录 take_rules.test.js (node --test)

// ── 东八区时区工具 ──
// 云函数运行时时区不可依赖(运行时为 UTC), 统一按 UTC+8 折算
const CN_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;

// 星期 key(0=周日, 避免依赖 Date.getDay() 的运行时区); 1970-01-01 为周四
const DAY_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// 东八区自然日 00:00 毫秒时间戳
function cnDayStart(ts) {
  return Math.floor((ts + CN_OFFSET_MS) / DAY_MS) * DAY_MS - CN_OFFSET_MS;
}

function cnWeekday(ts) {
  const epochDay = Math.floor((ts + CN_OFFSET_MS) / DAY_MS);
  return DAY_KEY[(((epochDay % 7) + 4) % 7 + 7) % 7];
}

// ── 服务端时间红线(R1, 与前端 redline.js 同口径, 防绕过): 00:00-06:00 不可履约/预约 ──
// close_min=1440(=24:00)→仅拦 00:00-06:00; close_min=0→全天开放; open_min 默认 360(06:00)
function isServiceTimeAllowed(ts, cfg) {
  const config = cfg || {};
  const close = parseInt(config.time_redline_close_min, 10);
  const open = parseInt(config.time_redline_open_min, 10);
  const closeMin = (close >= 0 && close <= 1440) ? close : 1440;
  const openMin = (open >= 0 && open < closeMin) ? open : 360;
  if (closeMin === 0) return true;  // 全天开放
  const d = new Date(Number(ts) + CN_OFFSET_MS);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= openMin && mins < closeMin;
}

// ── 接单价格区间读取 + 钳制到平台边界 ──
// 缺字段(null/undefined)=不限; 0 是合法下限(不能用 || 兜底, 否则 admin 配置 0 会被误当成缺省 3000)
function readRateRange(profile, config) {
  const _lo = Number(config.rate_min_fen);
  const _hi = Number(config.rate_max_fen);
  const lo = Number.isFinite(_lo) ? _lo : 3000;
  const hi = Number.isFinite(_hi) ? _hi : 10000;
  const clamp = (v) => Math.min(Math.max(v, lo), hi);
  const raw = (v) => (v === undefined || v === null ? null : clamp(Number(v)));
  const mn = raw(profile.accept_rate_min_fen);
  const mx = raw(profile.accept_rate_max_fen);
  if (mn !== null && mx !== null && mn > mx) return [mx, mn];   // 异常数据兜底
  return [mn, mx];
}

// ── 每周接单时段 ──
// 时段解析: 兼容结构化 {start,end}(分钟) 与旧格式 {time:'09:00-18:00'}
function parseSlot(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.start === 'number' && typeof s.end === 'number') {
    return { enabled: !!s.enabled, start: s.start, end: s.end };
  }
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(s.time || ''));
  return m ? { enabled: !!s.enabled, start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] } : null;
}

// [from,to) 是否被槽 [s,e) 覆盖; s>e 表示跨夜槽([s,1440)∪[0,e))
function rangeInSlot(from, to, s, e) {
  if (s < e) return from >= s && to <= e;
  return (from >= s) || (to <= e);
}

// 服务时间段是否完全落在启用的接单时段内; 未配置 / 无任何启用日 → 不限制(兼容老数据)
function slotCovers(weekly, startTs, endTs) {
  if (!weekly || typeof weekly !== 'object') return true;
  const slots = {};
  let anyEnabled = false;
  for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    const s = parseSlot(weekly[k]);
    slots[k] = s;
    if (s && s.enabled) anyEnabled = true;
  }
  if (!anyEnabled) return true;
  // 按东八区自然日切片逐段判定(跨午夜服务需次日槽也覆盖)
  let cur = startTs;
  for (let i = 0; i < 8 && cur < endTs; i++) {
    const dayStart = cnDayStart(cur);
    const segEnd = Math.min(endTs, dayStart + DAY_MS);
    const s = slots[cnWeekday(cur)];
    if (!s || !s.enabled) return false;
    const fromMin = (cur - dayStart) / 60000;
    const toMin = (segEnd - dayStart) / 60000;
    if (!rangeInSlot(fromMin, toMin, s.start, s.end)) return false;
    cur = segEnd;
  }
  return true;
}

// ── Haversine 球面距离(公里) · 两经纬度间直线距离 ──
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 接单距离上限(公里): 耍伴接单时实际位置与履约地点直线距离(admin take_distance_max_km 可覆盖)
const TAKE_MAX_DISTANCE_KM = 50;

module.exports = {
  CN_OFFSET_MS, DAY_MS, DAY_KEY,
  cnDayStart, cnWeekday, isServiceTimeAllowed,
  readRateRange, parseSlot, rangeInSlot, slotCovers,
  haversineKm, TAKE_MAX_DISTANCE_KM
};
