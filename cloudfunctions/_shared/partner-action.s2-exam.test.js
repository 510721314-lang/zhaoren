// partner-action 考试链路 S2 契约测试（多选判分 / exam_sessions / 发证 / bank_ver / 前置门禁）
// 覆盖: D7 多选全对才得分 / 去重升序 / 留痕字段 / base 永久证书 / W1 365 天 / 已有有效证书幂等 / 审计 session_id
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadIndex(sdk) {
  activeSdk = sdk;
  delete require.cache[require.resolve('../partner-action/index.js')];
  return require('../partner-action/index.js');
}

const USER = 'o_exam_user';
const NOW = Date.now();
const DAY_MS = 86400000;

function bankDoc(code, over) {
  return Object.assign({
    _id: 'b_' + code, code, title: code + '考试', desc: '', pass_line: 100,
    requires: code === 'W1' ? ['base'] : [], enabled: true, is_deleted: false,
    updated_at: code === 'W1' ? 2000 : 1000
  }, over || {});
}

// S4: 题目 SSOT = questions，exam_bank 只剩科目 meta
function qDoc(subject, qid, over) {
  return Object.assign({
    _id: subject + '_' + qid, subject, paper: 'A', module: '', qid, type: 'single',
    stem: qid + ' 题干', options: ['a', 'b', 'c', 'd'], answer_idx: 0, score: 1,
    status: 'published', version: 'V1', is_deleted: false, created_at: 100,
    updated_at: subject === 'W1' ? 2000 : 1000
  }, over || {});
}

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: NOW + 2 * 3600 * 1000 } },
    partner_profile: { p1: {
      _id: 'p1', openid: USER, status: 'approved', accept_switch: true,
      exam_scores: {}, is_deleted: false
    } },
    exam_bank: { b_base: bankDoc('base'), b_W1: bankDoc('W1') },
    questions: {
      bq1: qDoc('base', 'A-01', { type: 'multi', answer_idx: [0, 2] }),
      bq2: qDoc('base', 'A-02', { answer_idx: 1 }),
      w1q1: qDoc('W1', 'A-01', { type: 'multi', answer_idx: [0, 2] }),
      w1q2: qDoc('W1', 'A-02', { answer_idx: 1 })
    },
    certificates: {},
    exam_sessions: {},
    audit_log: {}
  }, extra || {});
}

const submit = (subject, answers, extra) => Object.assign({
  action: 'submit_exam', mock_openid: USER, subject, answers
}, extra || {});

test('多选全对(base): [[2,0],1] → 100 分通过, 写 session + 发永久证书 + 审计带 session_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [[2, 0], 1]), {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.score, 100);
  assert.strictEqual(r.data.passed, true);
  assert.strictEqual(r.data.cert_issued, true);
  assert.strictEqual(r.data.cert_expires_at, 0);
  assert.ok(r.data.session_id, '应返回 session_id');

  const sess = sdk.writes.exam_sessions.find((w) => w.add).data;
  assert.deepStrictEqual(sess.answers, [[0, 2], 1], '存储答案应去重升序');
  assert.strictEqual(sess.score, 100);
  assert.strictEqual(sess.passed, true);
  assert.strictEqual(sess.bank_ver, 1000);
  assert.strictEqual(sess.screen_switch_count, 0);
  assert.strictEqual(sess.status, 'submitted');
  assert.strictEqual(sess.is_deleted, false);

  const cert = sdk.writes.certificates.find((w) => w.add).data;
  assert.strictEqual(cert.subject, 'base');
  assert.strictEqual(cert.expires_at, 0);
  assert.strictEqual(cert.status, 'active');
  assert.strictEqual(cert.content_version, '1000');
  assert.strictEqual(cert.session_id, r.data.session_id);
  assert.strictEqual(cert.backfilled, false);

  const patch = sdk.writes.partner_profile.find((w) => w.doc === 'p1').data;
  assert.strictEqual(patch['exam_scores.base'], 100);
  assert.ok(patch['exam_at.base'] > 0);

  await new Promise((res) => setTimeout(res, 5));
  const audit = sdk.writes.audit_log && sdk.writes.audit_log.find((w) => w.add);
  assert.ok(audit, '应写审计');
  assert.strictEqual(audit.data.detail.session_id, r.data.session_id);
});

test('多选漏选: [[0],1] → 50 分不通过, 不发证', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [[0], 1]), {});
  assert.strictEqual(r.data.score, 50);
  assert.strictEqual(r.data.passed, false);
  assert.strictEqual(r.data.cert_issued, false);
  assert.strictEqual((sdk.writes.certificates || []).length, 0);
});

test('多选错选/多选: [[0,1],1] 与 [[0,1,2],1] → 均 50 分不通过', async () => {
  for (const a of [[[0, 1], 1], [[0, 1, 2], 1]]) {
    const sdk = makeSdk({ openid: '', store: baseStore() });
    const { main } = loadIndex(sdk);
    const r = await main(submit('base', a), {});
    assert.strictEqual(r.data.score, 50, JSON.stringify(a));
    assert.strictEqual(r.data.passed, false);
  }
});

test('多选重复索引去重: [[2,0,0],1] → 100 分通过', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [[2, 0, 0], 1]), {});
  assert.strictEqual(r.data.score, 100);
  assert.strictEqual(r.data.passed, true);
});

test('单选回归: [0,0] → 50 分(单选必须索引全等)', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    questions: {
      s1: qDoc('base', 'A-01', { answer_idx: 0 }),
      s2: qDoc('base', 'A-02', { answer_idx: 1 })
    }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [0, 0]), {});
  assert.strictEqual(r.data.score, 50);
});

test('W1 通过: 前置 base 已过 → 365 天证书 + content_version 取 W1 bank_ver', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    partner_profile: { p1: {
      _id: 'p1', openid: USER, status: 'approved', accept_switch: true,
      exam_scores: { base: 100 }, is_deleted: false
    } }
  }) });
  const { main } = loadIndex(sdk);
  const before = Date.now();
  const r = await main(submit('W1', [[0, 2], 1]), {});
  assert.strictEqual(r.data.passed, true);
  assert.strictEqual(r.data.cert_issued, true);
  const exp = r.data.cert_expires_at;
  assert.ok(exp >= before + 365 * DAY_MS - 1000 && exp <= Date.now() + 365 * DAY_MS + 1000, 'W1 应为 365 天');
  const cert = sdk.writes.certificates.find((w) => w.add).data;
  assert.strictEqual(cert.content_version, '2000');
});

test('W1 未过 base → pa_exam_prereq_not_passed 且不写 session/证书', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main(submit('W1', [[0, 2], 1]), {});
  assert.strictEqual(r.code, 'pa_exam_prereq_not_passed');
  assert.strictEqual(sdk.writes.exam_sessions, undefined);
  assert.strictEqual(sdk.writes.certificates, undefined);
});

test('bank_ver 不一致 → pa_exam_bank_changed, 不判分不留痕', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [[0, 2], 1], { bank_ver: 999 }), {});
  assert.strictEqual(r.code, 'pa_exam_bank_changed');
  assert.strictEqual(sdk.writes.exam_sessions, undefined);
});

test('已有有效证书 → 复用得证, 不重复 add(幂等)', async () => {
  const existing = {
    _id: 'c_old', openid: USER, subject: 'base', issued_at: NOW - 1000,
    expires_at: 0, status: 'active', is_deleted: false
  };
  const sdk = makeSdk({ openid: '', store: baseStore({ certificates: { c_old: existing } }) });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [[2, 0], 1]), {});
  assert.strictEqual(r.data.cert_issued, true);
  assert.strictEqual(r.data.cert_expires_at, 0);
  assert.strictEqual((sdk.writes.certificates || []).length, 0, '已有有效证书不应重复发证');
});

test('未完成全部题目 → pa_exam_incomplete, 不写 session', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [[0, 2]]), {});
  assert.strictEqual(r.code, 'pa_exam_incomplete');
  assert.strictEqual(sdk.writes.exam_sessions, undefined);
});
