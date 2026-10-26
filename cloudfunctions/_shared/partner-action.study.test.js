// partner-action 学习中心契约测试（C 端只读 study_content, 仅 published）
// 覆盖: 列表只下发 published(排除 draft/软删) / 科目过滤 / 排序(base 优先) /
//       详情自然键命中 / draft 与软删 → study_not_found / 缺参 → study_bad_key
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

const USER = 'o_study_user';
const NOW = Date.now();

function ch(subject, moduleId, chapterId, over) {
  return Object.assign({
    _id: subject + '_' + chapterId, subject, module_id: moduleId, chapter_id: chapterId,
    sort: Number(String(chapterId).replace(/\D/g, '')) || 1,
    title: subject + ' ' + chapterId + ' 标题',
    body_md: '# 标题\n\n正文内容 ' + chapterId,
    status: 'published', is_deleted: false, created_at: 100, updated_at: 200
  }, over || {});
}

function baseStore(content) {
  return {
    admin_config: { global: { env: 'dev', dev_until: NOW + 2 * 3600 * 1000 } },
    study_content: content || {}
  };
}

test('study_list: 仅 published, 排除 draft/软删, base 优先排序', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    c1: ch('OUTDOOR', 'M1', 'M1-01'),
    c2: ch('base', 'B2', 'B2-01', { sort: 2 }),
    c3: ch('base', 'B1', 'B1-01', { sort: 1 }),
    c4: ch('base', 'B3', 'B3-01', { status: 'draft' }),
    c5: ch('OUTDOOR', 'M2', 'M2-01', { is_deleted: true })
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'study_list', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const ids = r.data.list.map((x) => x.subject + '/' + x.chapter_id);
  assert.deepStrictEqual(ids, ['base/B1-01', 'base/B2-01', 'OUTDOOR/M1-01']);
  assert.strictEqual(r.data.list[0].body_md, undefined, '列表不下发正文');
  assert.ok(r.data.list[0].body_length > 0, '列表带正文长度');
});

test('study_list: subject 过滤只返回该科目', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    c1: ch('base', 'B1', 'B1-01'),
    c2: ch('ONLINE', 'M1', 'M1-01')
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'study_list', mock_openid: USER, subject: 'ONLINE' }, {});
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.list.map((x) => x.subject), ['ONLINE']);
});

test('study_detail: published 章节返回 body_md', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    c1: ch('PEIZHEN', 'M5', 'M5-01', { body_md: '# 培训考核\n\n通过线 90 分。' })
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({
    action: 'study_detail', mock_openid: USER,
    subject: 'PEIZHEN', module_id: 'M5', chapter_id: 'M5-01'
  }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.content.title, 'PEIZHEN M5-01 标题');
  assert.ok(r.data.content.body_md.indexOf('通过线 90 分') > -1);
});

test('study_detail: draft 或软删 → study_not_found(不下发)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    c1: ch('ONLINE', 'M1', 'M1-01', { status: 'draft' }),
    c2: ch('ONLINE', 'M2', 'M2-01', { is_deleted: true })
  }) });
  const { main } = loadIndex(sdk);
  const r1 = await main({ action: 'study_detail', mock_openid: USER, subject: 'ONLINE', module_id: 'M1', chapter_id: 'M1-01' }, {});
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.code, 'study_not_found');
  const r2 = await main({ action: 'study_detail', mock_openid: USER, subject: 'ONLINE', module_id: 'M2', chapter_id: 'M2-01' }, {});
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.code, 'study_not_found');
});

test('study_detail: 缺参 → study_bad_key', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({}) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'study_detail', mock_openid: USER, subject: 'base' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'study_bad_key');
});
