// config_defaults.js — 改期 / S2 变更规则默认值的唯一规范源（canonical）
// 2026-11-05 N-3：此前 admin CONFIG_SCHEMA / action_config_read / action_config_public /
// action_change_s2 / action_modify_extend / order-timer / 前端 config 各自维护一套，易漂移。
// 本文件由 _shared/config_defaults.json 驱动；副本经 sync-config-defaults.ps1 同步到
// order-action / admin-action / order-timer（禁跨目录 require）。
const RAW = require('./config_defaults.json');
const MODIFY_DEFAULTS = Object.freeze(Object.assign({}, RAW.MODIFY_DEFAULTS));
const S2_CHANGE_DEFAULTS = Object.freeze(Object.assign({}, RAW.S2_CHANGE_DEFAULTS));

function num(v, d, lo, hi) {
  const n = Number(v);
  return (isFinite(n) && n >= lo && n <= hi) ? Math.floor(n) : d;
}

// 改期规则：2026-11-05 N-5 已收口——只读运营页 schema 写入的顶层键（旧 modify_config 嵌套已迁移，不再兜底）
function resolveModify(cfg) {
  const c = cfg || {};
  const pick = (k, d) => (c[k] !== undefined ? c[k] : d);
  return {
    minLeadHours: num(pick('modifyMinLeadHours', MODIFY_DEFAULTS.minLeadHours), MODIFY_DEFAULTS.minLeadHours, 0, 72),
    maxTimes: num(pick('modifyMaxTimes', MODIFY_DEFAULTS.maxTimes), MODIFY_DEFAULTS.maxTimes, 0, 10),
    maxSpanH: num(pick('modifyMaxSpanH', MODIFY_DEFAULTS.maxSpanH), MODIFY_DEFAULTS.maxSpanH, 1, 720),
    confirmHours: num(pick('modifyConfirmHours', MODIFY_DEFAULTS.confirmHours), MODIFY_DEFAULTS.confirmHours, 1, 168)
  };
}

// S2 地点/内容变更规则：2026-11-05 N-5 已收口——只读顶层键
function resolveS2Change(cfg) {
  const c = cfg || {};
  const pick = (k, d) => (c[k] !== undefined ? c[k] : d);
  const bMinHours = num(pick('s2ChangeBMinHours', S2_CHANGE_DEFAULTS.bMinHours), S2_CHANGE_DEFAULTS.bMinHours, 1, 24);
  return {
    enabled: Number(pick('s2ChangeEnabled', S2_CHANGE_DEFAULTS.enabled)) === 1,
    bMinHours,
    aMinHours: Math.max(bMinHours, num(pick('s2ChangeAMinHours', S2_CHANGE_DEFAULTS.aMinHours), S2_CHANGE_DEFAULTS.aMinHours, 1, 72)),
    aConfirmMin: num(pick('s2ChangeAConfirmMin', S2_CHANGE_DEFAULTS.aConfirmMin), S2_CHANGE_DEFAULTS.aConfirmMin, 1, 1440),
    bConfirmMin: num(pick('s2ChangeBConfirmMin', S2_CHANGE_DEFAULTS.bConfirmMin), S2_CHANGE_DEFAULTS.bConfirmMin, 1, 1440),
    perFieldMax: num(pick('s2ChangePerFieldMax', S2_CHANGE_DEFAULTS.perFieldMax), S2_CHANGE_DEFAULTS.perFieldMax, 0, 5),
    totalMax: num(pick('s2ChangeTotalMax', S2_CHANGE_DEFAULTS.totalMax), S2_CHANGE_DEFAULTS.totalMax, 0, 10)
  };
}

module.exports = { MODIFY_DEFAULTS, S2_CHANGE_DEFAULTS, resolveModify, resolveS2Change };
