// partner-action 考试链路 S3 契约测试（questions 单源读取, S4 起 fail-closed）
// 覆盖: questions(published+A) 为唯一题目来源 / 空或仅草稿 → pa_exam_bad_subject 不降级 /
//       bank_ver=该科目 max(updated_at) / 拉题剥答案 / 多选判分与留痕等价
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

const USER = 'o_s3_user';
const NOW = Date.now();

function bankDoc(code, over) {
  return Object.assign({
    _id: 'b_' + code, code, title: code + '考试', desc: '', pass_line: 100,
    requires: code === 'W1' ? ['base'] : [], enabled: true, is_deleted: false,
    updated_at: code === 'W1' ? 2000 : 1000
  }, over || {});
}

function qDoc(subject, qid, over) {
  return Object.assign({
    _id: subject + '_' + qid, subject, paper: 'A', module: '', qid,
    type: 'single', stem: qid + ' 题干', options: ['a', 'b', 'c', 'd'],
    answer_idx: 0, score: 1, status: 'published', version: 'V1',
    is_deleted: false, created_at: 100, updated_at: 100
  }, over || {});
}

function baseStore(extra) {
  return Object.assign({
    admin_config: { global: { env: 'dev', dev_until: NOW + 2 * 3600 * 1000 } },
    partner_profile: { p1: {
      _id: 'p1', openid: USER, status: 'approved', accept_switch: true,
      exam_scores: {}, is_deleted: false
    } },
    exam_bank: { b_base: bankDoc('base'), b_W1: bankDoc('W1') },
    questions: {},
    certificates: {},
    exam_sessions: {},
    audit_log: {}
  }, extra || {});
}

const pull = (subject) => ({ action: 'get_exam_questions', mock_openid: USER, subject });
const submit = (subject, answers, extra) => Object.assign({
  action: 'submit_exam', mock_openid: USER, subject, answers
}, extra || {});

test('questions 优先: 拉题取 published+A 题目, 剥答案, bank_ver=max(updated_at)', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    questions: {
      q1: qDoc('base', 'A-01', { type: 'multi', answer_idx: [0, 2], updated_at: 5000 }),
      q2: qDoc('base', 'A-02', { answer_idx: 1, updated_at: 4000 }),
      draft: qDoc('base', 'A-03', { status: 'draft', updated_at: 9000 }),
      deleted: qDoc('base', 'A-04', { is_deleted: true, updated_at: 9000 }),
      paperB: qDoc('base', 'B-01', { paper: 'B', updated_at: 9000 })
    }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(pull('base'), {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.title, 'base考试');
  assert.strictEqual(r.data.pass_line, 100);
  assert.deepStrictEqual(r.data.requires, []);
  assert.strictEqual(r.data.bank_ver, 5000, '取该科目已发布题目的 max(updated_at)');
  assert.strictEqual(r.data.questions.length, 2);
  assert.deepStrictEqual(Object.keys(r.data.questions[0]).sort(), ['options', 'question']);
  assert.strictEqual(r.data.questions[0].question, 'A-01 题干');
});

test('questions 路径判分等价: 多选去重升序全对 → 100 分, session bank_ver=5000', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    questions: {
      q1: qDoc('base', 'A-01', { type: 'multi', answer_idx: [0, 2], updated_at: 5000 }),
      q2: qDoc('base', 'A-02', { answer_idx: 1, updated_at: 4000 })
    }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [[2, 0], 1]), {});
  assert.strictEqual(r.data.score, 100);
  assert.strictEqual(r.data.passed, true);
  assert.strictEqual(r.data.cert_issued, true);
  const sess = sdk.writes.exam_sessions.find((w) => w.add).data;
  assert.deepStrictEqual(sess.answers, [[0, 2], 1]);
  assert.strictEqual(sess.bank_ver, 5000);
});

test('questions 为空 → fail-closed: pa_exam_bad_subject(不读 exam_bank.questions)', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    exam_bank: { b_base: bankDoc('base', { updated_at: 1000, questions: [
      { question: '旧Q1', options: ['a', 'b'], answer_idx: 0 },
      { question: '旧Q2', options: ['a', 'b'], answer_idx: 1 }
    ] }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(pull('base'), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pa_exam_bad_subject');
  const subs = await main({ action: 'exam_subjects', mock_openid: USER }, {});
  assert.deepStrictEqual(subs.data.list, [], '无题目科目不应出现在科目列表');
});

test('questions 仅草稿 → 视为无题: pa_exam_bad_subject(不降级)', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    questions: { d1: qDoc('base', 'A-01', { status: 'draft' }) },
    exam_bank: { b_base: bankDoc('base', { updated_at: 1100, questions: [
      { question: '旧Q1', options: ['a', 'b'], answer_idx: 0 }
    ] }) }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(pull('base'), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pa_exam_bad_subject');
});

test('exam_bank 无科目 → pa_exam_bad_subject(兜底已退役, 不再返回 10 题)', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({ exam_bank: {} }) });
  const { main } = loadIndex(sdk);
  const r = await main(pull('base'), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'pa_exam_bad_subject');
  const subs = await main({ action: 'exam_subjects', mock_openid: USER }, {});
  assert.deepStrictEqual(subs.data.list, []);
});

test('questions 路径 bank_ver 不一致 → pa_exam_bank_changed, 不判分不留痕', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore({
    questions: {
      q1: qDoc('base', 'A-01', { answer_idx: 0, updated_at: 5000 }),
      q2: qDoc('base', 'A-02', { answer_idx: 1, updated_at: 4000 })
    }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main(submit('base', [0, 1], { bank_ver: 999 }), {});
  assert.strictEqual(r.code, 'pa_exam_bank_changed');
  assert.strictEqual(sdk.writes.exam_sessions, undefined);
});
