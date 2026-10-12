// push_https 单测(批 6.1) · 注入式 postJson, 无网络
const test = require('node:test');
const assert = require('node:assert');
const { createHttpsPusher } = require('../order-timer/push_https.js');

function fakePost(calls) {
  return async (url, body) => {
    calls.push({ url: (url.split('?')[0]).split('/').pop(), body });
    if (url.includes('stable_token')) return { access_token: 'TOK1', expires_in: 7200 };
    if (url.includes('subscribe/send')) return { errcode: 0, errmsg: 'ok' };
    return {};
  };
}

test('未配置 secret → 返回 null(回退云调用)', () => {
  assert.strictEqual(createHttpsPusher({ appid: 'a', secret: '', postJson: () => {} }), null);
  assert.strictEqual(createHttpsPusher({ appid: '', secret: 's', postJson: () => {} }), null);
});
test('getAccessToken 走 stable_token 并缓存(第二次不重复请求)', async () => {
  const calls = [];
  const p = createHttpsPusher({ appid: 'a', secret: 's', postJson: fakePost(calls) });
  const t1 = await p.getAccessToken();
  const t2 = await p.getAccessToken();
  assert.strictEqual(t1, 'TOK1');
  assert.strictEqual(t2, 'TOK1');
  assert.strictEqual(calls.length, 1); // 命中缓存
  assert.strictEqual(calls[0].url, 'stable_token');
  assert.deepStrictEqual(calls[0].body, { grant_type: 'client_credential', appid: 'a', secret: 's', force_refresh: false });
});
test('send 拼 subscribe/send 请求体且 errcode=0 视为成功', async () => {
  const calls = [];
  const p = createHttpsPusher({ appid: 'a', secret: 's', postJson: fakePost(calls) });
  const r = await p.send({ touser: 'o1', templateId: 't1', page: 'p1', data: { thing1: { value: 'x' } } });
  assert.strictEqual(r.ok, true);
  const send = calls.find((c) => c.url === 'send');
  assert.strictEqual(send.body.touser, 'o1');
  assert.strictEqual(send.body.template_id, 't1');
  assert.strictEqual(send.body.data.thing1.value, 'x');
});
test('errcode!=0 抛错并带 errCode', async () => {
  const p = createHttpsPusher({
    appid: 'a', secret: 's',
    postJson: async (url) => url.includes('stable_token')
      ? { access_token: 'TOK', expires_in: 100 }
      : { errcode: 43101, errmsg: 'quota' }
  });
  await assert.rejects(() => p.send({ touser: 'o', templateId: 't', data: {} }), (e) => e.errCode === 43101);
});
