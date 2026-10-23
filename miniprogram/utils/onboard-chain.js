// utils/onboard-chain.js — 耍伴入驻八步链(2026-10-23 批3c)
// 设计依据: docs/design-20261007-guest-onboarding-flow.md §1.3/§1.6
// 职责: 统一步骤定义、云端拒绝码→步骤映射、链内前进/进入路由; 页面只调 next/enter
// 约束: 纯前端编排, 不新增云端门禁; 前进一律 redirectTo 保持页面栈深度(E-6 经验: 8 步 navigateTo 会撞栈上限)
const STEPS = [
  { key: 'register', label: '注册登录', url: '/pages-v2/login/login', tab: false },
  { key: 'realname', label: '实名认证', url: '/pages-v2/pkg-low/realname/realname', tab: false },
  { key: 'ec', label: '紧急联系人', url: '/pages-v2/pkg-low/contacts/contacts', tab: false },
  { key: 'profile', label: '资料维护', url: '/pages-v2/pkg-low/partner-profile-edit/partner-profile-edit', tab: false },
  { key: 'config', label: '接单配置', url: '/pages-v2/pkg-low/accept-config/accept-config', tab: false },
  { key: 'exam', label: '考试认证', url: '/pages-v2/pkg-low/exam-status/exam-status', tab: false },
  { key: 'apply', label: '提交申请', url: '/pages-v2/pkg-low/partner-apply/partner-apply', tab: false },
  { key: 'review', label: '等待审核', url: '/pages-v2/profile/profile', tab: true }
];

const TOTAL = STEPS.length;

function indexOfKey(key) {
  for (let i = 0; i < STEPS.length; i++) if (STEPS[i].key === key) return i;
  return -1;
}

function stepOf(key) {
  const i = indexOfKey(key);
  return i < 0 ? null : { key: STEPS[i].key, index: i + 1, total: TOTAL, label: STEPS[i].label };
}

// 云端拒绝码 → 步骤 key(兜底映射: 防前端漏放, 见设计 §1.6)
const CODE_STEP = {
  order_realname_required: 'realname',
  realname_required: 'realname',
  order_ec_required: 'ec',
  order_not_approved: 'apply',
  order_base_exam_required: 'exam',
  order_scene_exam_required: 'exam',
  order_switch_off: 'config',
  order_not_partner: 'apply'
};

function stepKeyOfCode(code) {
  return CODE_STEP[code] || '';
}

// take_readiness.missing 首项 → 步骤 key(与云端 missing 顺序一致)
const MISSING_STEP = {
  realname: 'realname',
  ec: 'ec',
  apply: 'apply',
  role: 'apply',
  base_exam: 'exam',
  scene_exam: 'exam',
  switch_off: 'config',
  review_pending: 'review',
  reapply: 'apply',
  credit_low: ''
};

function stepKeyOfMissing(first) {
  return MISSING_STEP[first] || '';
}

// 能否进链: 已过审且无缺项 → 不进链(可直接接单)
function canEnterChain(rd) {
  return !(rd && rd.can_take === true);
}

// 进链首步: 优先按 readiness 缺项; 草稿档(未申请)从「资料维护」开始
function entryKey(rd) {
  const miss = (rd && rd.missing) || [];
  const byMissing = stepKeyOfMissing(miss[0] || '');
  if (byMissing) return byMissing;
  if (rd && rd.profile_status === 'draft') return 'profile';
  if (rd && rd.profile_status === 'pending_review') return 'review';
  return 'profile';
}

function _appendFrom(url) {
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'from=chain';
}

function open(key) {
  const i = indexOfKey(key);
  if (i < 0) return false;
  const s = STEPS[i];
  const url = _appendFrom(s.url);
  if (s.tab) {
    wx.switchTab({ url: s.url, fail: () => wx.navigateTo({ url, fail: () => {} }) });
  } else {
    wx.redirectTo({ url, fail: () => wx.navigateTo({ url, fail: () => {} }) });
  }
  return true;
}

// 当前步完成 → 下一步(链尾则回首页/我的)
function next(afterKey) {
  const i = indexOfKey(afterKey);
  if (i < 0 || i + 1 >= STEPS.length) {
    wx.switchTab({ url: '/pages-v2/profile/profile', fail: () => {} });
    return 'done';
  }
  const nk = STEPS[i + 1].key;
  open(nk);
  return nk;
}

// 步骤条数据(页面 onLoad 用): from=chain 才展示
function barOf(key, from) {
  const s = stepOf(key);
  if (!s || from !== 'chain') return null;
  return { index: s.index, total: s.total, label: s.label };
}

// 确保草稿档存在(幂等, 10 分钟内不重复请求); 失败静默不阻断页面
let _draftAt = 0;
function ensureDraft(force) {
  const now = Date.now();
  if (!force && _draftAt && now - _draftAt < 600000) return Promise.resolve(null);
  const { callCloud } = require('./cloud.js');
  return callCloud('partner-action', { action: 'init_draft' }).then((r) => {
    if (r && r.ok) _draftAt = Date.now();
    return r || null;
  }).catch(() => null);
}
function invalidateDraft() { _draftAt = 0; }

// 进入链(按云端 readiness 缺项定位首步); 返回 Promise<boolean> = 是否已跳转
function enterByReadiness() {
  const { callCloud } = require('./cloud.js');
  return callCloud('partner-action', { action: 'take_readiness' }).then((r) => {
    const rd = (r && r.ok && r.data) ? r.data : null;
    if (!rd || !canEnterChain(rd)) return false;
    if (rd.profile_status === 'draft') ensureDraft();
    return open(entryKey(rd));
  }).catch(() => false);
}

module.exports = { STEPS, TOTAL, stepOf, stepKeyOfCode, stepKeyOfMissing, canEnterChain, entryKey, open, next, barOf, ensureDraft, invalidateDraft, enterByReadiness };
