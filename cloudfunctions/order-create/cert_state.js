// _shared · cert_state (canonical 规范源)
// 证书派生状态机 + 入驻/接单证书门禁纯函数(不依赖数据库, 由调用方传入 certs)。
// 设计基线: docs/exam-center-plan-20261025.md §2.3 / D1-D3 / D7
// ⚠️ 云函数按单目录打包, 禁止 require('../_shared/...')。
//    修改本文件后跑 sync-cert-state.ps1 复制到 partner-apply / order-create 本地副本。
// 口径:
//  - 有效证书 = 该科目「最新一张」且 status=active、未软删、未过期(expires_at=0 为永久);
//    最新一张被吊销/过期时, 旧证书不得重新生效(复训重发产生多张历史)。
//  - apply 只校场景证书(与现入驻阈值对齐); take 校 base + 场景证书(与现接单双门禁对齐)。
//  - 证书发放阈值统一为科目 pass_line; 门禁开关 cert_gate_enabled 默认 false, S6 验证后开闸。
// 单测: 同目录 cert_state.test.js (node --test)

const BASE_SUBJECT = 'base';
const DEFAULT_W1_CERT_VALID_DAYS = 365;
const DAY_MS = 86400000;

const CERT_STATE = {
  UNTRAINED: 'UNTRAINED',
  TRAINED: 'TRAINED',
  CERTIFIED: 'CERTIFIED',
  EXPIRED: 'EXPIRED',
  CHEAT_SUSPENDED: 'CHEAT_SUSPENDED'
};

// admin_config 证书配置解析(缺省/非法值一律回到安全默认: 开关关、W1 365 天、base 永久)
function readCertConfig(config) {
  const c = config || {};
  const n = parseInt(c.w1_cert_valid_days, 10);
  return {
    enabled: c.cert_gate_enabled === true,
    w1CertValidDays: Number.isInteger(n) && n > 0 ? n : DEFAULT_W1_CERT_VALID_DAYS,
    baseCertPermanent: c.base_cert_permanent !== false
  };
}

// 证书到期时间: base 永久=0; 其余科目=now + N 天
function certExpiresAt(subject, now, opts) {
  const o = opts || {};
  const t = Number(now) || Date.now();
  const permanent = subject === BASE_SUBJECT ? o.baseCertPermanent !== false : false;
  if (permanent) return 0;
  const n = Number(o.w1CertValidDays);
  const days = Number.isFinite(n) && n > 0 ? n : DEFAULT_W1_CERT_VALID_DAYS;
  return t + days * DAY_MS;
}

function certList(certs) {
  return Array.isArray(certs) ? certs.filter((c) => c && typeof c === 'object' && c.is_deleted !== true) : [];
}

// 某科目最新一张证书(按 issued_at 降序; 同时间取后出现者)
function latestCertOf(certs, subject) {
  let best = null;
  for (const c of certList(certs)) {
    if (c.subject !== subject) continue;
    if (!best || (Number(c.issued_at) || 0) >= (Number(best.issued_at) || 0)) best = c;
  }
  return best;
}

function isCertActive(cert, now) {
  if (!cert || cert.is_deleted === true) return false;
  if (cert.status !== undefined && cert.status !== 'active') return false;
  const exp = Number(cert.expires_at) || 0;
  return exp === 0 || exp > now;
}

// 有效证书 = 最新一张且 active / 未过期
function activeCertOf(certs, subject, now) {
  const t = Number(now) || Date.now();
  const latest = latestCertOf(certs, subject);
  return latest && isCertActive(latest, t) ? latest : null;
}

function hasScore(scores, subject) {
  return !!scores && Object.prototype.hasOwnProperty.call(scores, subject) &&
    Number.isFinite(Number(scores[subject]));
}

// 派生态: UNTRAINED < TRAINED < CERTIFIED; EXPIRED / CHEAT_SUSPENDED 为特殊态
function computeCertState(input) {
  const { scores, certs, subject, now, studyCompleted, cheatSuspended } = input || {};
  const t = Number(now) || Date.now();
  if (cheatSuspended === true) return CERT_STATE.CHEAT_SUSPENDED;
  if (activeCertOf(certs, subject, t)) return CERT_STATE.CERTIFIED;
  const latest = latestCertOf(certs, subject);
  if (latest && (latest.status === undefined || latest.status === 'active')) {
    const exp = Number(latest.expires_at) || 0;
    if (exp > 0 && exp <= t) return CERT_STATE.EXPIRED;
  }
  if (hasScore(scores, subject) || studyCompleted === true) return CERT_STATE.TRAINED;
  return CERT_STATE.UNTRAINED;
}

function normScenes(scenes) {
  if (Array.isArray(scenes)) return scenes.filter(Boolean).map(String);
  return scenes ? [String(scenes)] : [];
}

function sceneLabel(subject, titles) {
  const t = titles && titles[subject];
  return t ? `「${t}」` : `「${subject}」`;
}

// 入驻门禁: 只校场景证书; examSubjects 为当前存在的考试科目(如 ['base','W1'])
function requireCertForApply(profile, scenes, opts) {
  const o = opts || {};
  const now = Number(o.now) || Date.now();
  const certs = o.certs || [];
  const examSubjects = Array.isArray(o.examSubjects) ? o.examSubjects.map(String) : [BASE_SUBJECT, 'W1'];
  for (const s of normScenes(scenes)) {
    if (examSubjects.indexOf(s) < 0) continue;
    if (activeCertOf(certs, s, now)) continue;
    if (s === 'W1') {
      return { locked: true, code: 'apply_w1_exam_failed', msg: '就医陪诊场景需持有有效的陪诊专项证书(可在考试认证页考取)' };
    }
    return { locked: true, code: 'apply_scene_exam_failed', msg: `场景 ${s} 需持有有效的对应场景证书` };
  }
  return { locked: false };
}

// 接单门禁: base + 场景证书; baseSubject 传 null/'' 可跳过 base 校验(科目未配置时)
function requireCertForTake(profile, scenes, baseSubject, opts) {
  const o = opts || {};
  const now = Number(o.now) || Date.now();
  const certs = o.certs || [];
  const base = baseSubject === undefined ? BASE_SUBJECT : baseSubject;
  const examSubjects = Array.isArray(o.examSubjects) ? o.examSubjects.map(String) : [BASE_SUBJECT, 'W1'];
  if (base && !activeCertOf(certs, base, now)) {
    return { locked: true, code: 'order_base_exam_required', msg: '需先取得有效的耍伴基础证书(接单配置页可去考试)' };
  }
  for (const s of normScenes(scenes)) {
    if (s === base) continue;
    if (examSubjects.indexOf(s) < 0) continue;
    if (activeCertOf(certs, s, now)) continue;
    return { locked: true, code: 'order_scene_exam_required', msg: `该场景接单需持有有效的${sceneLabel(s, o.titles)}场景证书` };
  }
  return { locked: false };
}

// 证书文档: 发证/回填共用; expires_at=0 永久; backfilled=true 标记存量回填
function buildCertRecord(input) {
  const { openid, subject, score, sessionId, contentVersion, now, validDays, basePermanent, backfilled, sourceExamAt } = input || {};
  const t = Number(now) || Date.now();
  return {
    openid: String(openid || ''),
    subject: String(subject || ''),
    score: Number(score) || 0,
    session_id: sessionId || '',
    issued_at: t,
    expires_at: certExpiresAt(subject, t, { w1CertValidDays: validDays, baseCertPermanent: basePermanent }),
    content_version: contentVersion || '',
    backfilled: backfilled === true,
    source_exam_at: Number(sourceExamAt) || 0,
    status: 'active',
    is_deleted: false,
    created_at: t
  };
}

// 读取用户证书(调用方传 col 函数); 读失败返回 [](门禁 fail-closed)
async function loadCerts(col, openid, opts) {
  const o = opts || {};
  if (!openid) return [];
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 100, 1), 100);
  try {
    const r = await col('certificates').where({ openid, is_deleted: false })
      .orderBy('issued_at', 'desc').limit(limit).get();
    return certList(r.data);
  } catch (e) {
    return [];
  }
}

module.exports = {
  BASE_SUBJECT,
  DEFAULT_W1_CERT_VALID_DAYS,
  DAY_MS,
  CERT_STATE,
  readCertConfig,
  certExpiresAt,
  latestCertOf,
  isCertActive,
  activeCertOf,
  computeCertState,
  requireCertForApply,
  requireCertForTake,
  buildCertRecord,
  loadCerts
};
