// heal.js 惰性治愈逻辑单测(零依赖 node:test) · getHealedPartnerProfile(col,_,openid) 依赖注入, 可 mock
const test = require('node:test');
const assert = require('node:assert');
const { getHealedPartnerProfile } = require('./heal');

// 构造可注入 col/_ 假对象: getResult() 决定查询返回, updateCalls 收集治愈写入
function makeFake(present, getError) {
  const updateCalls = [];
  const _ = { neq: (v) => ({ $neq: v }), eq: (v) => ({ $eq: v }) };
  const col = () => ({
    where: () => ({
      limit: () => ({
        get: async () => {
          if (getError) throw getError;
          return { data: present ? [present] : [] };
        }
      })
    }),
    doc: (id) => ({
      update: async (payload) => { updateCalls.push({ id, payload: payload.data }); }
    })
  });
  return { col, _, updateCalls };
}

test('有效文档(已带 is_deleted:false) → 原样返回, 不做治愈(无 update)', async () => {
  const p = { _id: 'x1', openid: 'o', is_deleted: false, accept_switch: true };
  const f = makeFake(p);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r, p);
  assert.strictEqual(f.updateCalls.length, 0);
});

test('历史坏文档(is_deleted 缺省) → 惰性治愈: 补 is_deleted:false + 缺省 accept_switch, 并写 update', async () => {
  const p = { _id: 'x2', openid: 'o' };
  const f = makeFake(p);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(f.updateCalls.length, 1);
  assert.strictEqual(r.is_deleted, false);
  assert.strictEqual(r.accept_switch, true);
  assert.strictEqual(f.updateCalls[0].payload.is_deleted, false);
  assert.strictEqual(f.updateCalls[0].payload.accept_switch, true);
});

test('已软删(is_deleted:true) → 查询被 _.neq(true) 过滤不命中 → 返回 null', async () => {
  // 真实 DB 对 is_deleted: true 文档, where 的 _.neq(true) 排除, 查询返回空集 → heal 返回 null
  const f = makeFake(null);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r, null);
});

test('查询失败 → 容错返回 null(不抛)', async () => {
  const f = makeFake(null, new Error('db down'));
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r, null);
});