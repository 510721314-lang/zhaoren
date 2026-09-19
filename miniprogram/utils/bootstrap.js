// utils/bootstrap.js · 前端启动时从 admin_config 拉运营参数覆盖本地 CONFIG（SSOT）
// 设计原则:
//   1. CONFIG 是兜底默认值，任何字段都有初值，云函数挂了不影响小程序运行
//   2. 映射表 CLOUD_MAP 只覆盖明确存在于 admin_config 的键，不盲合并
//   3. 冷启动异步调用，页面初次渲染用兜底，config_get 返回后 Object.assign 到原对象
//   4. 失败静默降级（无网络/云函数冷启动/鉴权），不弹错不阻塞
const CONFIG = require('./config/index.js');

// admin_config key → CONFIG path 映射表
// 点号分隔表示嵌套路径: 'ORDER.payTimeoutMin' → CONFIG.ORDER.payTimeoutMin
const CLOUD_MAP = {
  'timeouts.s0_timeout_min': 'ORDER.payTimeoutMin',
  'timeouts.s1_timeout_min': 'ORDER.confirmTimeoutMin',
  'timeouts.interrupt_timeout_h': 'ORDER.partialJudgeDays',       // 中断超时 → 部分完成判定窗口(近似映射)
  'timeouts.eval_window_h': 'ORDER.evalWindowH',
  'credits.credit_freeze_line': 'CREDIT.freeze',
  'rate_range.rate_min_fen': 'PARTNER_ACCEPT.rateMinFen',        // 前端校验用, 服务端为准
  'rate_range.rate_max_fen': 'PARTNER_ACCEPT.rateMaxFen',
  'scene_default_rate_fen': 'PARTNER_ACCEPT.defaultSceneRateFen' // 新增: 耍伴默认时薪
};

// 深合并: 把 cloud 返回的嵌套结构展平后按映射表写入 CONFIG
function deepAssign(target, cloudFlat, map) {
  for (const cloudPath of Object.keys(map)) {
    const configPath = map[cloudPath];
    const val = cloudFlat[cloudPath];
    if (val === undefined || val === null) continue;
    // 解析目标路径 'ORDER.payTimeoutMin' → CONFIG.ORDER.payTimeoutMin
    const parts = configPath.split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
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
    data: { action: 'config_get' }
  }).then((r) => {
    const cloudConfig = r.result && r.result.data;
    if (!cloudConfig) return false;
    const flat = flatten(cloudConfig);
    deepAssign(CONFIG, flat, CLOUD_MAP);
    // 版本号也同步一下（admin_config 如果有 version 字段的话）
    if (cloudConfig.version) CONFIG.VERSION = cloudConfig.version;
    return true;
  }).catch(() => {
    // 静默降级: 云函数冷启动/无网络/鉴权失败都不阻塞启动
    return false;
  });
}

module.exports = { bootstrap, CLOUD_MAP };
