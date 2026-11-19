// blog-action 入口契约测试（R3-6/R3-7 治理修复配套，2026-11-19）
// 覆盖点：封禁账号发布/评论拦截(account_restricted) / 评论重复删前置拦截(comment_gone) /
// 正常发布 happy path / like dup-key 幂等(N1/N3, mock SDK 注入 addReject)。全部零副作用。
// 注：线上 blog_like(post_id,openid) 唯一索引经 tcb listIndexes 实证缺失(2026-11-19), 待控制台建索引后生效。
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
  delete require.cache[require.resolve('../blog-action/index.js')];
  return require('../blog-action/index.js');
}

const USER = 'o_user_1';
const POST = 'b'.repeat(32);
const COMMENT = 'c'.repeat(32);

function baseStore(extra = {}) {
  return Object.assign({
    admin_config: { global: { switch_blog: true } },
    user_account: { u1: { _id: 'u1', openid: USER, nickname: '测试用户', status: 'normal', roles: [] } },
    blog_post: {},
    blog_comment: {}
  }, extra);
}

test('blog publish: 正常账号 → 发布成功', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish', content: '今天天气不错', scene: 'W1', tags: [] }, {});
  assert.strictEqual(r.ok, true);
  const w = (sdk.writes.blog_post || [])[0];
  assert.strictEqual(w.data.status, 'normal');
});

test('blog publish(R3-7): 封禁账号 → account_restricted 拒绝', async () => {
  const store = baseStore({ user_account: { u1: { _id: 'u1', openid: USER, nickname: 'X', status: 'banned', roles: [] } } });
  const sdk = makeSdk({ openid: USER, store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish', content: '今天天气不错', scene: 'W1', tags: [] }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'account_restricted');
});

test('blog comment_add(R3-7): 冻结账号 → account_restricted 拒绝', async () => {
  const store = baseStore({
    user_account: { u1: { _id: 'u1', openid: USER, nickname: 'X', status: 'frozen', roles: [] } },
    blog_post: { [POST]: { _id: POST, status: 'normal', is_deleted: false, comment_count: 0 } }
  });
  const sdk = makeSdk({ openid: USER, store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'comment_add', post_id: POST, content: '路过看看' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'account_restricted');
  assert.ok(!(sdk.writes.blog_comment || []).length, '评论不应落库');
});

test('blog comment_delete(R3-6): 重复删除 → comment_gone(不重复扣计数)', async () => {
  const store = baseStore({
    blog_post: { [POST]: { _id: POST, comment_count: 1 } },
    blog_comment: { [COMMENT]: { _id: COMMENT, post_id: POST, author_openid: USER, status: 'normal', is_deleted: false } }
  });
  const sdk = makeSdk({ openid: USER, store, docUpdateWritesBack: true }); // 回写使第二次删除读到已删状态
  const { main } = loadIndex(sdk);
  const r1 = await main({ action: 'comment_delete', comment_id: COMMENT }, {});
  assert.strictEqual(r1.ok, true);
  const r2 = await main({ action: 'comment_delete', comment_id: COMMENT }, {});
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.code, 'comment_gone');
  // 第二次删除不应再扣 comment_count
  const incs = (sdk.writes.blog_post || []).filter((w) => w.doc === POST && w.data.comment_count);
  assert.strictEqual(incs.length, 1, 'comment_count 仅扣减一次');
});

test('blog like(R3-6): 第二次点赞 dup-key → 幂等返回, like_count 仅自增一次', async () => {
  const store = baseStore({
    blog_post: { [POST]: { _id: POST, status: 'normal', is_deleted: false, like_count: 0 } }
  });
  let addCount = 0;
  const sdk = makeSdk({
    openid: USER,
    store,
    // 模拟并发: 第二次 add blog_like 命中唯一索引抛 dup-key
    addReject: (name) => {
      if (name !== 'blog_like') return null;
      addCount += 1;
      return addCount >= 2 ? { errCode: '11000', errMsg: 'E11000 duplicate key error collection' } : null;
    }
  });
  const { main } = loadIndex(sdk);
  const r1 = await main({ action: 'like', post_id: POST }, {});
  assert.strictEqual(r1.ok, true, '第一次点赞成功');
  const r2 = await main({ action: 'like', post_id: POST }, {});
  assert.strictEqual(r2.ok, true, '第二次 dup-key 仍返回成功');
  assert.strictEqual(r2.data.idempotent, true, '第二次应标记幂等');
  const incs = (sdk.writes.blog_post || []).filter((w) => w.doc === POST && w.data && w.data.like_count);
  assert.strictEqual(incs.length, 1, 'like_count 仅自增一次(并发不重复计数)');
});

test('blog like(N3): dup-key errCode=11000 且 msg 不含 duplicate → 仍幂等(旧 /duplicate/i 会漏判)', async () => {
  const store = baseStore({
    blog_post: { [POST]: { _id: POST, status: 'normal', is_deleted: false, like_count: 0 } }
  });
  const sdk = makeSdk({
    openid: USER,
    store,
    // 仅 errCode=11000, message 不含 "duplicate" —— 旧正则 /duplicate/i 会走 else throw
    addReject: (name) => (name === 'blog_like' ? { errCode: '11000', message: 'conflict on unique key uk_blog_like' } : null)
  });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'like', post_id: POST }, {});
  assert.strictEqual(r.ok, true, 'errCode=11000 应命中幂等分支而非抛错');
  assert.strictEqual(r.data.idempotent, true);
  const incs = (sdk.writes.blog_post || []).filter((w) => w.doc === POST && w.data && w.data.like_count);
  assert.strictEqual(incs.length, 0, 'dup-key 命中后不应自增 like_count');
});

test.after(() => { Module._load = origLoad; });
