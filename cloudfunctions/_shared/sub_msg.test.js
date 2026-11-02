// cloudfunctions/_shared/sub_msg.test.js — 订阅消息计数状态机单测(方案A 2026-11-02)
const test = require('node:test');
const assert = require('node:assert');
const { stateOf, authorizePatch, revokePatch, sentPatch, exhaustedPatch, withKey, sendOnce } = require('./sub_msg');

test('存量布尔模型: authorized=true 按 1 条授权兼容', () => {
  const st = stateOf({ authorized: true });
  assert.deepStrictEqual(st, { granted: 1, sent: 0, canSend: true });
});

test('存量未授权/空值 → 不可发送', () => {
  assert.deepStrictEqual(stateOf({ authorized: false }), { granted: 0, sent: 0, canSend: false });
  assert.deepStrictEqual(stateOf(undefined), { granted: 0, sent: 0, canSend: false });
});

test('授权 2 条 → granted_count=2, 尚未发送仍可发', () => {
  const p = authorizePatch(undefined, 2, 100);
  assert.strictEqual(p.granted_count, 2);
  assert.strictEqual(p.sent_count, 0);
  assert.strictEqual(p.authorized, true);
});

test('发送成功消费 1 条; 2 条授权发 1 条后仍可发', () => {
  const p = sentPatch({ authorized: true, granted_count: 2, sent_count: 0 }, 200);
  assert.strictEqual(p.sent_count, 1);
  assert.strictEqual(p.authorized, true);
});

test('发送成功消费最后 1 条 → authorized=false', () => {
  const p = sentPatch({ authorized: true, granted_count: 1, sent_count: 0 }, 200);
  assert.strictEqual(p.sent_count, 1);
  assert.strictEqual(p.authorized, false);
  assert.strictEqual(stateOf(p).canSend, false);
});

test('43101 收口: sent_count 抬到 granted_count 并关闭授权', () => {
  const p = exhaustedPatch({ authorized: true, granted_count: 2, sent_count: 1 }, 300);
  assert.strictEqual(p.sent_count, 2);
  assert.strictEqual(p.authorized, false);
  assert.strictEqual(p.quota_empty_at, 300);
});

test('关闭开关清零计数', () => {
  const p = revokePatch({ authorized: true, granted_count: 2, sent_count: 1 }, 400);
  assert.strictEqual(p.granted_count, 0);
  assert.strictEqual(p.sent_count, 0);
  assert.strictEqual(p.authorized, false);
});

test('withKey 不破坏其他模板状态', () => {
  const next = withKey({ confirm_comm: { authorized: true } }, 'demand_urge', { authorized: false });
  assert.strictEqual(next.confirm_comm.authorized, true);
  assert.strictEqual(next.demand_urge.authorized, false);
});

test('sendOnce 成功/失败均不抛出, 返回结构化结果', async () => {
  const cloud = { openapi: { subscribeMessage: { send: async () => ({ errMsg: 'send:ok' }) } } };
  assert.deepStrictEqual(await sendOnce(cloud, {}), { sent: true, errCode: '', errMsg: '' });
  const bad = { openapi: { subscribeMessage: { send: async () => { const e = new Error('x'); e.errCode = 43101; throw e; } } } };
  const r = await sendOnce(bad, {});
  assert.strictEqual(r.sent, false);
  assert.strictEqual(r.errCode, 43101);
});

test('sendOnce 可注入 HTTPS 发送器(不走云调用)', async () => {
  let used = 0;
  const cloud = { openapi: { subscribeMessage: { send: async () => { used++; } } } };
  const r = await sendOnce(cloud, {}, async () => { throw Object.assign(new Error('https'), { errCode: 47003 }); });
  assert.strictEqual(r.sent, false);
  assert.strictEqual(r.errCode, 47003);
  assert.strictEqual(used, 0, '注入 sender 后不得回退云调用');
});
