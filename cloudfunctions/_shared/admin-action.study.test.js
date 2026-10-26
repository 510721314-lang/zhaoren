// admin-action · S4 学习内容只读预览契约测试
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
function makeTestSdk() {
  return makeSdk({
    openid: ADMIN,
    store: {
      admin_config: { global: { env: 'prod', admin_openids: [ADMIN] } },
      study_content: {
        c1: { _id: 'c1', subject: 'base', module_id: 'B1', chapter_id: 'B1-01', sort: 1, title: '平台定位', body_md: '# 平台定位\n正文一', status: 'published', is_deleted: false, created_at: 1, updated_at: 11 },
        c2: { _id: 'c2', subject: 'W1', module_id: 'M1', chapter_id: 'M1-01', sort: 1, title: '陪诊前准备', body_md: '# 陪诊前准备\n正文二', status: 'draft', is_deleted: false, created_at: 1, updated_at: 12 },
        c3: { _id: 'c3', subject: 'W1', module_id: 'M1', chapter_id: 'M1-02', sort: 2, title: '已删除章节', body_md: 'x', status: 'published', is_deleted: true, created_at: 1, updated_at: 13 }
      }
    }
  });
}
async function call(event) {
  const { main } = loadIndex(makeTestSdk());
  return main(event, {});
}

test('content_list: 默认排除软删, 按 subject/module/sort 排序', async () => {
  const r = await call({ action: 'content_list' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.list.length, 2);
  const keys = r.data.list.map((x) => x.subject + '/' + x.chapter_id);
  assert.deepStrictEqual(keys, ['base/B1-01', 'W1/M1-01']);
  assert.strictEqual(r.data.list[0].body_length, String('# 平台定位\n正文一').length);
});

test('content_list: 按科目/状态/关键词过滤', async () => {
  const bySubject = await call({ action: 'content_list', subject: 'W1' });
  assert.strictEqual(bySubject.data.list.length, 1);
  const byStatus = await call({ action: 'content_list', status: 'published' });
  assert.strictEqual(byStatus.data.list.length, 1);
  assert.strictEqual(byStatus.data.list[0].chapter_id, 'B1-01');
  const byKeyword = await call({ action: 'content_list', keyword: '准备' });
  assert.strictEqual(byKeyword.data.list.length, 1);
});

test('content_detail: 返回正文 md；缺参/不存在 → 明确失败码', async () => {
  const r = await call({ action: 'content_detail', subject: 'base', module_id: 'B1', chapter_id: 'B1-01' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.content.body_md, '# 平台定位\n正文一');
  const missing = await call({ action: 'content_detail', subject: 'base' });
  assert.strictEqual(missing.code, 'content_bad_key');
  const gone = await call({ action: 'content_detail', subject: 'W1', module_id: 'M1', chapter_id: 'M1-02' });
  assert.strictEqual(gone.code, 'content_not_found');
});
