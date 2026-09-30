// heal.js 惰性治愈逻辑单测(零依赖 node:test) · getHealedPartnerProfile(col,_,openid) 依赖注入, 可 mock
// fake col 模拟 DB 过滤语义: where({is_deleted: neq(true)}) 排除 is_deleted===true 的文档
const test = require('node:test');
const assert = require('node:assert');
const { getHealedPartnerProfile } = require('./heal');

// docs: 库内候选文档数组(含软删); where 按 is_deleted !== true 过滤, limit(1) 取首条
function makeFake(docs, getError) {
  const updateCalls = [];
  const _ = { neq: (v) => ({ $neq: v }) };
  const col = () => ({
    where: (cond) => {
      const visible = docs
        .filter((d) => !(d && d.is_deleted === true)); // 模拟 _.neq(true) 过滤
      return {
        limit: () => ({
          get: async () => {
            if (getError) throw getError;
            return { data: visible.slice(0, 1) };
          }
        })
      };
    },
    doc: (id) => ({
      update: async (payload) => { updateCalls.push({ id, payload: payload.data }); }
    })
  });
  return { col, _, updateCalls };
}

test('有效文档(已带 is_deleted:false) → 原样返回, 不做治愈(无 update)', async () => {
  const p = { _id: 'x1', openid: 'o', is_deleted: false, accept_switch: true };
  const f = makeFake([p]);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r, p);
  assert.strictEqual(f.updateCalls.length, 0);
});

test('历史坏文档(is_deleted 缺省) → 惰性治愈: 补 is_deleted:false + 缺省 accept_switch, 并写 update', async () => {
  const p = { _id: 'x2', openid: 'o' };
  const f = makeFake([p]);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(f.updateCalls.length, 1);
  assert.strictEqual(r.is_deleted, false);
  assert.strictEqual(r.accept_switch, true);
  assert.strictEqual(f.updateCalls[0].payload.is_deleted, false);
  assert.strictEqual(f.updateCalls[0].payload.accept_switch, true);
});

test('已软删(is_deleted:true) → 被 where 过滤不命中 → 返回 null', async () => {
  const f = makeFake([{ _id: 'x3', openid: 'o', is_deleted: true }]);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r, null);
});

test('多条候选 → limit(1) 取首条; 后置软删不命中', async () => {
  const f = makeFake([{ _id: 'x4', openid: 'o' }, { _id: 'x5', openid: 'o', is_deleted: true }]);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r._id, 'x4');
});

test('查询失败 → 容错返回 null(不抛)', async () => {
  const f = makeFake([{ _id: 'x6', openid: 'o' }], new Error('db down'));
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r, null);
});

// ── 审核死锁治愈: status=pending 但所有 pending 字段空 → 自动解锁 approved ──
test('死锁治愈: pending 但待审内容全空 → 解锁 approved 并写 update', async () => {
  const p = { _id: 'x7', openid: 'o', profile_audit_status: 'pending', profile_reject_reason: 'x',
    bio_pending: '', skills_pending: [], highlights_pending: [],
    qualifications_pending: { titles: [], photos: [] }, honors_pending: { titles: [], photos: [] } };
  const f = makeFake([p]);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r.profile_audit_status, 'approved');
  assert.strictEqual(r.profile_reject_reason, '');
  const up = f.updateCalls.find((c) => c.payload.profile_audit_status === 'approved');
  assert.ok(up, '应写入解锁 update');
});

test('非死锁: pending 且有待审内容 → 保持 pending 不治愈', async () => {
  const p = { _id: 'x8', openid: 'o', profile_audit_status: 'pending',
    bio_pending: '简介A', skills_pending: [], highlights_pending: [],
    qualifications_pending: { titles: [], photos: [] }, honors_pending: { titles: [], photos: [] } };
  const f = makeFake([p]);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r.profile_audit_status, 'pending');
  assert.ok(!f.updateCalls.some((c) => c.payload.profile_audit_status === 'approved'));
});

test('非死锁: approved 状态 → 不治愈', async () => {
  const p = { _id: 'x9', openid: 'o', is_deleted: false, profile_audit_status: 'approved', bio_pending: '' };
  const f = makeFake([p]);
  const r = await getHealedPartnerProfile(f.col, f._, 'o');
  assert.strictEqual(r.profile_audit_status, 'approved');
  assert.strictEqual(f.updateCalls.length, 0);
});