// geo-guard.js · 履约定位「三层判定」纯函数模块（零 wx API，可单测）
// 依据：docs/线下陪伴履约流程规范与流程图.md §2.2 / C4（按钮状态由实时定位决定，点击二次校验）
//       / C11（定位异常）/ C12（阈值 200m 口径=GCJ-02 直线距离；精度半径>阈值判「不可信」而非「超距」）
//       / §五 建议默认参数（距离阈值 200m、精度 ≤50m）
// 判定优先级：no_site(放行兜底) → no_user_location → untrusted(精度) → misconfig(阈值异常) → out_of_range(距离) → ok
//   ① no_site：订单履约地无有效坐标（缺坐标/非数字/越界/成对 0,0，与后端 demand-publish validLngLat 同口径）
//      → 「放行不置灰」+ 提示，避免存量/手输地址订单被永久卡死（评审 2/2 确认）
//   ② no_user_location：未授权定位或取点失败 → 置灰并引导开启
//   ③ untrusted：精度半径缺失/<=0（不得 fail-open）/ 超过 accuracyMaxM → 置灰提示到开阔处重试
//   ④ misconfig：距离阈值缺失/<=0（配置异常，一律 fail-closed，防 0 值绕过距离校验而 fail-open）
//   ⑤ out_of_range：直线距离 D > thresholdM → 置灰提示确认履约地点
// 距离统一「米」，复用 utils/util.js 的 haversineKm（不重复实现）；坐标全链路 GCJ-02。
// 说明：本模块仅客户端展示层判定，服务端 fail-closed 校验归后续阶段（阶段 C）。

const { haversineKm } = require('./util.js');

// 三套文案 + 兜底（规范 C4/C11/C12）
const TIPS = {
  no_user_location: '发起履约需授权定位，请开启后重试',
  untrusted: '定位不可信，请到开阔处重试',
  out_of_range: '请确认是否到达履约地点，或联系用户确认地点',
  no_site: '本单未记录履约地点坐标，无法校验距离，请自行确认已到达履约点',
  misconfig: '履约校验参数异常，请稍后重试',
  ok: ''
};

// 履约地坐标有效性（与后端 demand-publish validLngLat 同口径：经纬度均为 number、在合法范围内、非成对 0,0）
function hasSiteCoord(site) {
  if (!site) return false;
  const lat = site.latitude;
  const lng = site.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

function build(ok, reason, distanceM, accuracy) {
  return { ok: ok, reason: reason, distanceM: distanceM, accuracy: accuracy, tip: TIPS[reason] || '' };
}

/**
 * 履约定位判定（纯函数）。
 * @param {{user?:{latitude:number,longitude:number,accuracy:number}|null, site?:{latitude:number,longitude:number}|null, thresholdM?:number, accuracyMaxM?:number}} opts
 * @returns {{ok:boolean, reason:string, distanceM:number|null, accuracy:number|null, tip:string}} ok=按钮是否可点击
 */
function evaluatePosition(opts) {
  const o = opts || {};
  const thresholdM = Number(o.thresholdM) || 0;
  const accuracyMaxM = Number(o.accuracyMaxM) || 0;
  // ① 兜底：履约地无有效坐标 → 放行（不可被永久置灰）
  if (!hasSiteCoord(o.site)) return build(true, 'no_site', null, null);
  // ② 未授权/取点失败
  if (!o.user) return build(false, 'no_user_location', null, null);
  const uLat = Number(o.user.latitude);
  const uLng = Number(o.user.longitude);
  if (!isFinite(uLat) || !isFinite(uLng)) return build(false, 'no_user_location', null, null);
  // ③ 精度可信层：缺失/<=0 一律判不可信（不得 fail-open）
  const acc = Number(o.user.accuracy);
  if (!isFinite(acc) || acc <= 0 || (accuracyMaxM > 0 && acc > accuracyMaxM)) {
    return build(false, 'untrusted', null, isFinite(acc) ? acc : null);
  }
  // ④ 阈值层：距离阈值缺失/<=0 属配置异常，一律 fail-closed（防止 0 值绕过距离校验而 fail-open）
  if (!(thresholdM > 0)) return build(false, 'misconfig', null, acc);
  // ⑤ 距离层：GCJ-02 直线距离（米）
  const distanceM = Math.round(haversineKm(uLat, uLng, Number(o.site.latitude), Number(o.site.longitude)) * 1000);
  if (thresholdM > 0 && distanceM > thresholdM) return build(false, 'out_of_range', distanceM, acc);
  return build(true, 'ok', distanceM, acc);
}

module.exports = { evaluatePosition, hasSiteCoord, TIPS };
