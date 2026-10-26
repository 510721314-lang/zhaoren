// admin-action · S4 题库写入口契约测试
// 覆盖：questions 列表/详情/新增/更新/软删/批量状态/Markdown 导入/科目元数据更新
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
  for (const f of ['../admin-action/index.js', '../admin-action/openid.js', '../admin-action/logger.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../admin-action/index.js');
}

const ADMIN = 'o_admin_1';
function store(extra) {
  return Object.assign({
    admin_config: { global: { env: 'prod', admin_openids: [ADMIN] } },
    exam_bank: {
      b1: { _id: 'b1', code: 'base', title: '基础', desc: '', pass_line: 100, requires: [], enabled: true, is_deleted: false, created_at: 1, updated_at: 11 },
      w1: { _id: 'w1', code: 'W1', title: '陪诊', desc: '', pass_line: 100, requires: ['base'], enabled: true, is_deleted: false, created_at: 2, updated_at: 22 }
    },
    questions: {
      q1: {
        _id: 'q1', subject: 'base', paper: 'A', module: 'M1', qid: 'A-01', type: 'single',
        stem: '平台是什么角色？', options: ['居间信息服务平台', '用人单位'], answer_idx: 0,
        score: 1, difficulty: 'easy', knowledge: '平台定位', analysis: '居间服务',
        status: 'published', version: 'V1', is_deleted: false, created_at: 1, updated_at: 11
      },
      q2: {
        _id: 'q2', subject: 'base', paper: 'A', module: 'M2', qid: 'A-02', type: 'multi',
        stem: '哪些行为禁止？', options: ['私下交易', '引导绕开平台', '按订单履约', '代签合同'], answer_idx: [0, 1, 3],
        score: 1, difficulty: 'medium', knowledge: '服务边界', analysis: '',
        status: 'draft', version: 'V1', is_deleted: false, created_at: 1, updated_at: 12
      },
      q3: {
        _id: 'q3', subject: 'base', paper: 'A', qid: 'A-03', type: 'single',
        stem: '已删除题', options: ['a', 'b'], answer_idx: 0, score: 1, status: 'published',
        is_deleted: true, created_at: 1, updated_at: 13
      }
    }
  }, extra || {});
}
function sdk(extraStore) {
  return makeSdk({ openid: ADMIN, store: store(extraStore) });
}
function call(sdkInst, event) {
  const { main } = loadIndex(sdkInst);
  return main(Object.assign({ mock_openid: undefined }, event), {});
}

test('question_list: 过滤已删除、按状态筛选、关键词命中题干/题号', async () => {
  const s = sdk();
  const all = await call(s, { action: 'question_list' });
  assert.strictEqual(all.ok, true);
  assert.strictEqual(all.data.total, 2, '软删题不应出现');
  const pub = await call(s, { action: 'question_list', status: 'published' });
  assert.strictEqual(pub.data.total, 1);
  assert.strictEqual(pub.data.list[0].qid, 'A-01');
  const kw = await call(s, { action: 'question_list', keyword: '服务边界' });
  assert.strictEqual(kw.data.total, 1);
  assert.strictEqual(kw.data.list[0].qid, 'A-02');
});

test('question_list: 分页返回 total/page/size 且切片正确', async () => {
  const s = sdk();
  const r = await call(s, { action: 'question_list', page: 2, size: 1 });
  assert.strictEqual(r.data.total, 2);
  assert.strictEqual(r.data.page, 2);
  assert.strictEqual(r.data.size, 1);
  assert.strictEqual(r.data.list.length, 1);
  assert.strictEqual(r.data.list[0].qid, 'A-02');
});

test('question_detail: 命中返回全字段（含答案），软删题 → question_not_found', async () => {
  const s = sdk();
  const r = await call(s, { action: 'question_detail', subject: 'base', qid: 'A-02' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.question.answer_idx, [0, 1, 3]);
  assert.strictEqual(r.data.question.type, 'multi');
  const gone = await call(s, { action: 'question_detail', subject: 'base', qid: 'A-03' });
  assert.strictEqual(gone.ok, false);
  assert.strictEqual(gone.code, 'question_not_found');
});

test('question_upsert: 新题走 add，落库含自然键/默认状态/审计字段', async () => {
  const s = sdk();
  const r = await call(s, {
    action: 'question_upsert', subject: 'W1', qid: 'A-99', module: 'M1',
    type: 'single', stem: '陪诊前需要做什么？', options: ['核对订单', '直接到达'], answer_idx: 0,
    knowledge: '接单准备', status: 'draft'
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.created, true);
  const w = (s.writes.questions || []).find((x) => x.add);
  assert.ok(w, '应写入 questions');
  assert.strictEqual(w.data.subject, 'W1');
  assert.strictEqual(w.data.qid, 'A-99');
  assert.strictEqual(w.data.paper, 'A');
  assert.strictEqual(w.data.status, 'draft');
  assert.strictEqual(w.data.is_deleted, false);
  assert.strictEqual(w.data.created_by, ADMIN);
});

test('question_upsert: 自然键命中走 update 并可复活软删题', async () => {
  const s = sdk();
  const r = await call(s, {
    action: 'question_upsert', subject: 'base', qid: 'A-01', module: 'M1',
    type: 'single', stem: '改后题干', options: ['甲', '乙'], answer_idx: 1, status: 'published'
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.created, false);
  const w = (s.writes.questions || []).find((x) => x.doc === 'q1');
  assert.strictEqual(w.data.stem, '改后题干');
  assert.strictEqual(w.data.answer_idx, 1);
  assert.strictEqual(w.data.is_deleted, false);
});

test('question_upsert: 校验失败不落库', async () => {
  const s = sdk();
  const bad1 = await call(s, { action: 'question_upsert', subject: 'base', qid: 'A-10', stem: '题', options: ['a', 'b'], answer_idx: 5 });
  assert.strictEqual(bad1.code, 'question_bad_answer');
  const bad2 = await call(s, { action: 'question_upsert', subject: 'base', qid: 'A-10', type: 'single', stem: '题', options: ['a', 'b'], answer_idx: [0, 1] });
  assert.strictEqual(bad2.code, 'question_bad_answer');
  const bad3 = await call(s, { action: 'question_upsert', subject: 'base', qid: 'A-10', stem: '题', options: ['a'], answer_idx: 0 });
  assert.strictEqual(bad3.code, 'question_bad_options');
  assert.ok(!(s.writes.questions || []).length, '校验失败不应写库');
});

test('question_delete: 软删置 is_deleted=true；重复删 → question_not_found', async () => {
  const s = sdk();
  const r = await call(s, { action: 'question_delete', subject: 'base', qid: 'A-01' });
  assert.strictEqual(r.ok, true);
  const w = (s.writes.questions || []).find((x) => x.doc === 'q1');
  assert.strictEqual(w.data.is_deleted, true);
  const again = await call(s, { action: 'question_delete', subject: 'base', qid: 'A-03' });
  assert.strictEqual(again.code, 'question_not_found');
});

test('question_bulk_status: 批量发布命中项并回报 missing', async () => {
  const s = sdk();
  const r = await call(s, { action: 'question_bulk_status', subject: 'base', qids: ['A-01', 'A-02', 'A-404'], status: 'published' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.updated, 2);
  assert.deepStrictEqual(r.data.missing, ['A-404']);
  const docs = (s.writes.questions || []).filter((x) => x.doc).map((x) => x.doc).sort();
  assert.deepStrictEqual(docs, ['q1', 'q2']);
});

test('question_import_markdown: 部分成功（合法落库 + 非法明细 + 多选字母转索引）', async () => {
  const s = sdk();
  const md = [
    '<!-- q:start',
    'subject: base',
    'qid: A-T01',
    'module: M1',
    'answer: A',
    'status: draft',
    'knowledge: 平台定位',
    '-->',
    '新题一？',
    'A. 选项一',
    'B. 选项二',
    '解析：因为这样',
    '<!-- q:end -->',
    '',
    '<!-- q:start',
    'subject: base',
    'qid: A-T02',
    'module: M2',
    'type: multi',
    'answer: A,C',
    'status: published',
    '-->',
    '（多选）新题二？',
    'A. 甲',
    'B. 乙',
    'C. 丙',
    'D. 丁',
    '<!-- q:end -->',
    '',
    '<!-- q:start',
    'subject: base',
    'qid: A-T03',
    'answer: Z',
    '-->',
    '坏题',
    'A. 甲',
    'B. 乙',
    '<!-- q:end -->'
  ].join('\n');
  const r = await call(s, { action: 'question_import_markdown', markdown: md });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.total, 3);
  assert.strictEqual(r.data.created, 2);
  assert.strictEqual(r.data.partial, true);
  assert.strictEqual(r.data.errors.length, 1);
  assert.strictEqual(r.data.errors[0].qid, 'A-T03');
  const added = (s.writes.questions || []).filter((x) => x.add).map((x) => x.data);
  const multi = added.find((d) => d.qid === 'A-T02');
  assert.deepStrictEqual(multi.answer_idx, [0, 2]);
  assert.strictEqual(multi.type, 'multi');
  const single = added.find((d) => d.qid === 'A-T01');
  assert.strictEqual(single.analysis, '因为这样');
  assert.strictEqual(single.options.length, 2);
});

test('question_import_markdown: 空内容/无题目块 → 明确失败码', async () => {
  const s = sdk();
  const empty = await call(s, { action: 'question_import_markdown', markdown: '  ' });
  assert.strictEqual(empty.code, 'question_import_empty');
  const none = await call(s, { action: 'question_import_markdown', markdown: '# 只有标题' });
  assert.strictEqual(none.code, 'question_import_no_block');
});

test('exam_subject_overview: 科目 meta + 题量统计（总数/已发布）', async () => {
  const s = sdk();
  const r = await call(s, { action: 'exam_subject_overview' });
  assert.strictEqual(r.ok, true);
  const base = r.data.list.find((x) => x.code === 'base');
  assert.strictEqual(base.question_count, 2);
  assert.strictEqual(base.published_count, 1);
  const w1 = r.data.list.find((x) => x.code === 'W1');
  assert.strictEqual(w1.question_count, 0);
});

test('exam_subject_meta_update: 只更新元数据, 不写 questions 字段', async () => {
  const s = sdk();
  const r = await call(s, { action: 'exam_subject_meta_update', code: 'W1', title: '陪诊服务', desc: '陪诊', pass_line: 90, requires: ['base'], enabled: true });
  assert.strictEqual(r.ok, true);
  const w = (s.writes.exam_bank || []).find((x) => x.doc === 'w1');
  assert.strictEqual(w.data.title, '陪诊服务');
  assert.strictEqual(w.data.pass_line, 90);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(w.data, 'questions'), false, '不应再写 questions 字段');
});

test('exam_subject_meta_update: 前置引用不存在/前置自身 → 校验失败', async () => {
  const s = sdk();
  const bad = await call(s, { action: 'exam_subject_meta_update', code: 'W1', title: '陪诊', pass_line: 90, requires: ['NOPE'] });
  assert.strictEqual(bad.code, 'exam_bad_require_ref');
  const self = await call(s, { action: 'exam_subject_meta_update', code: 'W1', title: '陪诊', pass_line: 90, requires: ['W1'] });
  assert.strictEqual(self.code, 'exam_bad_require_self');
});
