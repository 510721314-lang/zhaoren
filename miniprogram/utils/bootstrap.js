// utils/bootstrap.js · 前端启动时从 admin_config 拉运营参数覆盖本地 CONFIG（SSOT）
// 设计原则:
//   1. CONFIG 是兜底默认值，任何字段都有初值，云函数挂了不影响小程序运行
//   2. 映射表 CLOUD_MAP 只覆盖明确存在于 admin_config 的键，不盲合并
//   3. 冷启动异步调用，页面初次渲染用兜底，config_get 返回后 Object.assign 到原对象
//   4. 失败静默降级（无网络/云函数冷启动/鉴权），不弹错不阻塞
//   5. 支持 transform 函数处理单位转换(fen→元、分钟数→"HH:mm")
const CONFIG = require('../config/index.js');

// ── transform 工具 ──
function fenToYuan(fen) { return Math.round(fen / 100); }
function minsToHHmm(mins) {
  const m = Number(mins);
  if (m === 0) return '00:00';
  if (m >= 1440) return '24:00';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// admin_config key → CONFIG path 映射表
// 值格式: 'path' 或 { path, transform }
// transform(val) 用于单位转换
const CLOUD_MAP = {
  // ── 已覆盖(不动) ──
  'timeouts.s0_timeout_min': 'ORDER.payTimeoutMin',
  'timeouts.s1_timeout_min': 'ORDER.confirmTimeoutMin',
  'timeouts.interrupt_timeout_h': 'ORDER.partialJudgeDays',
  'timeouts.eval_window_h': 'ORDER.evalWindowH',
  'credits.credit_freeze_line': 'CREDIT.freeze',
  'rate_range.rate_min_fen': 'PARTNER_ACCEPT.rateMinFen',
  'rate_range.rate_max_fen': 'PARTNER_ACCEPT.rateMaxFen',
  'scene_default_rate_fen': 'PARTNER_ACCEPT.defaultSceneRateFen',
  // ── 第一批新增 ──
  'timeouts.default_star': 'ORDER.evalDefaultStars',
  'time_redline.close_min': { path: 'TIME_REDLINE.close', transform: minsToHHmm },
  'time_redline.open_min': { path: 'TIME_REDLINE.open', transform: minsToHHmm },
  'limits.publish_distance_max_km': 'PUBLISH.distanceMaxKm',
  'limits.take_distance_max_km': 'PUBLISH.takeDistanceMaxKm',
  'limits.youth_limit_fen': { path: 'YOUTH.maxOrderAmount', transform: fenToYuan },
  'insurance.coverage_accident_fen': { path: 'INSURANCE.accidentCoverage', transform: fenToYuan },
  'insurance.coverage_property_fen': { path: 'INSURANCE.propertyCoverage', transform: fenToYuan },
  'fast_withdraw.per_order_max_fen': { path: 'WITHDRAW.fastPerOrderMax', transform: fenToYuan },
  'fast_withdraw.per_day_max_fen': { path: 'WITHDRAW.fastPerDayMax', transform: fenToYuan },
  'modify_config.minLeadHours': 'MODIFY.minLeadHours',
  'modify_config.maxTimes': 'MODIFY.maxTimes',
  'modify_config.maxSpanH': 'MODIFY.maxSpanH',
  'modify_config.confirmHours': 'MODIFY.confirmHours'
};

// 深合并: 把 cloud 返回的嵌套结构展平后按映射表写入 CONFIG
// map 的值可以是 'path' 或 { path, transform }
function deepAssign(target, cloudFlat, map) {
  for (const cloudPath of Object.keys(map)) {
    const val = cloudFlat[cloudPath];
    if (val === undefined || val === null) continue;
    const spec = map[cloudPath];
    const path = (typeof spec === 'string') ? spec : spec.path;
    const transform = (typeof spec === 'object') ? spec.transform : null;
    const finalVal = transform ? transform(val) : val;
    // 解析目标路径 'ORDER.payTimeoutMin' → CONFIG.ORDER.payTimeoutMin
    const parts = path.split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = finalVal;
  }
}

// 把 cloudConfig 嵌套结构拍平成 { 'timeouts.s0_timeout_min': 30, ... }
function flatten(obj, prefix) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const path = prefix ? prefix + '.' + k : k;
    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
      Object.assign(out, flatten(obj[k], path));
    } else {
      out[path] = obj[k];
    }
  }
  return out;
}

function bootstrap() {
  if (!wx.cloud) return Promise.resolve(false);
  return wx.cloud.callFunction({
    name: 'admin-action',
    data: { action: 'config_public' }  // 免鉴权公开配置入口(普通用户可调); config_get 需管理员白名单,普通用户必失败
  }).then((r) => {
    const cloudConfig = r.result && r.result.data;
    if (!cloudConfig) return false;
    const flat = flatten(cloudConfig);
    deepAssign(CONFIG, flat, CLOUD_MAP);
    if (cloudConfig.version) CONFIG.VERSION = cloudConfig.version;
    // 注: 不再往 Storage 写 env —— 该调用走 admin-action(需管理员白名单),
    // 普通用户必然鉴权失败, 写不进去; 实名门禁已改为直读 userInfo.is_realname_done
    return true;
  }).catch(() => {
    // 静默降级: 云函数冷启动/无网络/鉴权失败都不阻塞启动
    return false;
  });
}

module.exports = { bootstrap, CLOUD_MAP };

// ── 实名认证门禁守卫 ──
// 登录后用户未实名 → 允许浏览但禁止发布/接单/下单/提现等关键操作
// 【唯一可信来源】user-login 返回并由 app.setUserInfo 持久化的 userInfo.is_realname_done
// 不再依赖 admin_config_env / pending_realname 这类二次缓存(前者需 admin 鉴权,普通用户永远写不进去)
function realnameDoneState() {
  try {
    const app = getApp();
    const u = (app && app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo');
    if (u && typeof u === 'object') return !!u.is_realname_done;
  } catch (e) {}
  return null; // 未知(未登录/无缓存)
}

function requireRealname(actionLabel) {
  const done = realnameDoneState();
  if (done === true) {
    // 服务端已确认实名 → 顺手清掉可能残留的旧标记(自愈)
    try { wx.removeStorageSync('pending_realname'); } catch (e) {}
    return true;
  }
  if (done === null && !wx.getStorageSync('pending_realname')) return true; // 已实名或无标记
  const label = actionLabel || '该操作';
  wx.showModal({
    title: '需先完成实名认证',
    content: `为保障双方权益，${label}前请先完成实名认证。`,
    confirmText: '去实名',
    cancelText: '暂不',
    success: (res) => {
      if (res.confirm) {
        // 跳到 profile 页的实名入口(profile 页有"完成实名"按钮)
        wx.switchTab({ url: '/pages-v2/profile/profile' });
      }
    }
  });
  return false;
}

// 检查是否需要实名(静默, 不弹窗, 供 UI 条件渲染用)
function needsRealname() {
  const done = realnameDoneState();
  if (done !== null) return !done;
  return !!wx.getStorageSync('pending_realname');
}

// 清除实名待办标记(实名成功后调)
function clearRealnamePending() {
  wx.removeStorageSync('pending_realname');
}

module.exports = { bootstrap, CLOUD_MAP, requireRealname, needsRealname, clearRealnamePending };
