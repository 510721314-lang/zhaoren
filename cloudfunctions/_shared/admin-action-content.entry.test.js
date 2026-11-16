// admin-action 入口契约测试 · 批2 内容族（blog / question / legal_doc_list）
// 只增不改：拦截 wx-server-sdk，断言「event 输入 → 返回 code」契约，零运行时改动。
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
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
const DOC_ID = 'a'.repeat(32); // isDocId = /^[a-f0-9]{32}$/i

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// ── blog ──
test('blog_offline: post_id 非法 → blog_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_offline', post_id: 'bad', note: 'r', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_bad_id');
});

test('blog_offline: 无 note → blog_note_required', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_offline', post_id: DOC_ID, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_note_required');
});

test('blog_offline: 动态不存在 → blog_gone', async () => {
  const store = baseStore('dev', [ADMIN]); store.blog_post = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_offline', post_id: DOC_ID, note: 'r', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_gone');
});

test('blog_offline: 已下架 → blog_already_offline', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.blog_post = { [DOC_ID]: { _id: DOC_ID, status: 'offline' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_offline', post_id: DOC_ID, note: 'r', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_already_offline');
});

test('blog_restore: 非下架状态 → blog_not_offline', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.blog_post = { [DOC_ID]: { _id: DOC_ID, status: 'normal' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_restore', post_id: DOC_ID, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_not_offline');
});

test('blog_delete: 无 note → blog_note_required', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_delete', post_id: DOC_ID, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_note_required');
});

test('blog_comment_list: post_id 非法 → blog_bad_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_comment_list', post_id: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_bad_id');
});

test('blog_comment_delete: comment_id 非法 → blog_bad_comment_id', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'blog_comment_delete', comment_id: 'bad', note: 'r', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'blog_bad_comment_id');
});

// ── question ──
test('question_detail: 缺 subject/qid → question_bad_key', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_detail', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_key');
});

test('question_detail: 题目不存在 → question_not_found', async () => {
  const store = baseStore('dev', [ADMIN]); store.questions = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_detail', subject: 's1', qid: 'q1', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_not_found');
});

test('question_upsert: subject 非法 → question_bad_subject', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_upsert', subject: '', qid: 'q1', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_subject');
});

test('question_upsert: 选项少于2 → question_bad_options', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_upsert', subject: 's1', qid: 'q1', stem: 'q', options: ['A'], answer_idx: 0, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_options');
});

test('question_upsert: 答案越界 → question_bad_answer', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_upsert', subject: 's1', qid: 'q1', stem: 'q', options: ['A', 'B'], answer_idx: 9, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_answer');
});

test('question_delete: 缺 qid → question_bad_key', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_delete', subject: 's1', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_key');
});

test('question_bulk_status: 缺 subject → question_bad_subject', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_bulk_status', status: 'draft', qids: ['q1'], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_subject');
});

test('question_bulk_status: status 非法 → question_bad_status', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_bulk_status', subject: 's1', status: 'xxx', qids: ['q1'], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_status');
});

test('question_bulk_status: qids 为空 → question_bad_qids', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_bulk_status', subject: 's1', status: 'draft', qids: [], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_bad_qids');
});

test('question_import_markdown: 内容为空 → question_import_empty', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'question_import_markdown', text: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'question_import_empty');
});

// ── legal_doc_list ──
test('legal_doc_list: doc_type 非法 → legal_bad_type', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_list', doc_type: 'bad', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'legal_bad_type');
});

test('legal_doc_list: scope 格式非法 → legal_bad_scope', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_list', scope: '!!!', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'legal_bad_scope');
});

test.after(() => { Module._load = origLoad; });
