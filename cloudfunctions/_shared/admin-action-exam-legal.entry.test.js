// admin-action 入口契约测试 · 批5 题库/内容/法律文档/导入恢复族
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
const DOC = 'a'.repeat(32); // 合法 docId（32 hex）

function baseStore(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// ── exam_subject_detail ──
test('exam_subject_detail: code 为空 → exam_bad_code', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'exam_subject_detail', code: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'exam_bad_code');
});

test('exam_subject_detail: 科目不存在 → exam_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.exam_bank = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'exam_subject_detail', code: 'ghost', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'exam_not_found');
});

// ── exam 写入口退役 ──
test('exam_subject_create: 写入口退役 → exam_write_retired', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'exam_subject_create', code: 'x', title: 'x', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'exam_write_retired');
});

// ── content_detail ──
test('content_detail: 缺 key → content_bad_key', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'content_detail', subject: 'base', module_id: '', chapter_id: '', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'content_bad_key');
});

test('content_detail: 章节不存在 → content_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.study_content = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'content_detail', subject: 'base', module_id: 'm1', chapter_id: 'c1', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'content_not_found');
});

// ── legal_doc_list ──
test('legal_doc_list: doc_type 非法 → legal_bad_type', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_list', doc_type: 'xxx', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_bad_type');
});

test('legal_doc_list: scope 格式非法 → legal_bad_scope', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_list', doc_type: 'scene_disclaimer', scope: '!!!', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_bad_scope');
});

// ── legal_doc_get ──
test('legal_doc_get: version 非法 → legal_bad_version', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_get', doc_type: 'privacy_policy', version: 0, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_bad_version');
});

test('legal_doc_get: 版本不存在 → legal_version_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.legal_doc = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_get', doc_type: 'privacy_policy', version: 99, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_version_not_found');
});

// ── legal_doc_publish ──
test('legal_doc_publish: 内容为空 → legal_empty_content', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_publish', doc_type: 'privacy_policy', content: '   ', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_empty_content');
});

test('legal_doc_publish: 内容超长 → legal_too_long', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  // privacy_policy MAX_LEN=20000
  const r = await main({ action: 'legal_doc_publish', doc_type: 'privacy_policy', content: 'x'.repeat(20001), mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_too_long');
});

// ── legal_doc_rollback ──
test('legal_doc_rollback: version 非法 → legal_bad_version', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_rollback', doc_type: 'privacy_policy', version: -1, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_bad_version');
});

test('legal_doc_rollback: 版本不存在 → legal_version_not_found', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.legal_doc = {};
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_rollback', doc_type: 'privacy_policy', version: 99, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_version_not_found');
});

test('legal_doc_rollback: 版本已停用(空内容) → legal_version_retired', async () => {
  const store = baseStore('dev', [ADMIN]);
  store.legal_doc = { [DOC]: { _id: DOC, doc_type: 'privacy_policy', version: 1, content: '', status: 'retired' } };
  const sdk = makeSdk({ openid: '', store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_rollback', doc_type: 'privacy_policy', version: 1, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_version_retired');
});

// ── legal_doc_retire ──
test('legal_doc_retire: 非 scoped 类型不支持停用 → legal_retire_unsupported', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  // privacy_policy 非 scoped，不支持 retire
  const r = await main({ action: 'legal_doc_retire', doc_type: 'privacy_policy', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_retire_unsupported');
});

// ── config_restore ──
test('config_restore: 缺 confirm → restore_need_confirm', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_restore', config: { a: 1 }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'restore_need_confirm');
});

test('config_restore: config 非对象 → restore_bad_config', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_restore', confirm: true, config: 'notobj', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'restore_bad_config');
});

// ── import_collection ──
test('import_collection: 集合不在白名单 → restore_bad_collection', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'import_collection', confirm: true, collection: 'evil_coll', docs: [], mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'restore_bad_collection');
});

test('import_collection: docs 非数组 → restore_bad_docs', async () => {
  const sdk = makeSdk({ openid: '', store: baseStore('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'import_collection', confirm: true, collection: 'user_account', docs: 'x', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'restore_bad_docs');
});

test.after(() => { Module._load = origLoad; });
