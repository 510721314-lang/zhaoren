// utils/redline.js · V15.1 全局合规红线校验
// R1 夜间时间红线 / R9 场景白名单 / R5 年龄校验 / 金额校验（含18-22岁200元上限）
// 供所有页面/组件调用，禁止在业务代码内重复实现规则

const CONFIG = require('../config/index.js');
const { SCENES } = require('../config/enums.js');

// R1 红线常量: close=24:00 表示午夜(00:00)关闭, open=06:00 恢复
// picker mode="time" 不接受 24:00, 用 23:59 替代（逻辑等价, 23:59 仍属可服务区间）
const CLOSE_STR = CONFIG.TIME_REDLINE.close;   // '24:00'
const OPEN_STR = CONFIG.TIME_REDLINE.open;     // '06:00'
const PICKER_CLOSE = CLOSE_STR === '24:00' ? '23:59' : CLOSE_STR;
const DISPLAY_CLOSE = CLOSE_STR === '24:00' ? '00:00' : CLOSE_STR;

// R1：当前（或指定时间）是否处于 23:00-06:00 夜间红线
// close=23:00 open=06:00；命中时段内暂停预约与履约
function isInRedline(date) {
  const d = date || new Date();
  const hhmm = d.getHours() * 60 + d.getMinutes();
  const closeMin = toMinutes(CONFIG.TIME_REDLINE.close); // 1380
  const openMin = toMinutes(CONFIG.TIME_REDLINE.open);   // 360
  return hhmm >= closeMin || hhmm < openMin;
}

// R1：校验服务时间（HH:mm）是否落在可服务区间 06:00-23:00
function isServiceTimeAllowed(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  const m = /^(\d{1,2}):(\d{2})/.exec(timeStr.trim());
  if (!m) return false;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= toMinutes(CONFIG.TIME_REDLINE.open) && mins < toMinutes(CONFIG.TIME_REDLINE.close);
}

// R9：场景白名单（一期5场景，硬编码）
function isSceneAllowed(sceneCode) {
  return SCENES.some((s) => s.code === sceneCode);
}

function getScene(sceneCode) {
  return SCENES.find((s) => s.code === sceneCode) || null;
}

// R5：成年门槛（阈值取 CONFIG.ADULT_AGE）
function isAdult(age) {
  return Number(age) >= CONFIG.ADULT_AGE;
}

// 是否18-22岁青年保护区间
function isYouth(age) {
  const [min, max] = CONFIG.YOUTH.ageRange;
  return Number(age) >= min && Number(age) <= max;
}

// 预算校验：商业单 10-500 元/小时；公益单无预算
// 返回 { ok:boolean, msg:string }
function validateBudget(budget, projectAttr) {
  if (projectAttr === 'public_welfare') return { ok: true, msg: '' };
  const v = Number(budget);
  if (!v || isNaN(v)) return { ok: false, msg: '请输入预算金额' };
  const [min, max] = CONFIG.BUDGET_RANGE;
  if (v < min || v > max) return { ok: false, msg: `预算需在${min}-${max}元/小时之间` };
  return { ok: true, msg: '' };
}

// 18-22岁单笔金额上限200元（发布/下单共用）
// 返回 { ok:boolean, msg:string }
function validateYouthAmount(amount, age) {
  if (!isYouth(age)) return { ok: true, msg: '' };
  if (Number(amount) > CONFIG.YOUTH.maxOrderAmount) {
    return { ok: false, msg: `18-22岁用户单笔金额上限${CONFIG.YOUTH.maxOrderAmount}元` };
  }
  return { ok: true, msg: '' };
}

// 抢单/发布入口统一闸门：命中R1即拦截
function checkEntryLocked(date) {
  if (isInRedline(date)) {
    return { locked: true, msg: `每日${CONFIG.TIME_REDLINE.open}-${CONFIG.TIME_REDLINE.close}外暂停预约与履约` };
  }
  return { locked: false, msg: '' };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

module.exports = {
  isInRedline,
  isServiceTimeAllowed,
  isSceneAllowed,
  getScene,
  isAdult,
  isYouth,
  validateBudget,
  validateYouthAmount,
  checkEntryLocked,
  PICKER_CLOSE,
  DISPLAY_CLOSE,
  OPEN_STR,
  CLOSE_STR
};
