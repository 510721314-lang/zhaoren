// order_state.js 单测(零依赖 node:test) · 覆盖状态分组 / 迁移白名单表 / 读兼容 mapStatus / CAS 语义
// Wave1 契约 = 行为不变: casTransition 必须与既有 casStatus 逐字同构(数组 expect 走 _.in / stats.updated===1 / 异常返回 false)
const test = require('node:test');
const assert = require('node:assert');
const S = require('./order_state');

// ── 状态分组常量 ──
test('状态分组: 目标主轴9态 + 争议占位S10.5 + 终态3个 + 退役态S9 = 14 个合法 S 码, 无重复', () => {
  assert.strictEqual(S.MAIN_AXIS.length, 9);
  assert.deepStrictEqual(S.TERMINAL_STATES, ['S6', 'S7', 'S10']);
  assert.deepStrictEqual(S.SIDE_STATES, ['S10.5']);
  assert.deepStrictEqual(S.LEGACY_STATES, ['S9']);
  assert.strictEqual(S.ALL_STATES.length, 14);
  assert.strictEqual(new Set(S.ALL_STATES).size, 14);
  // 结算资格组收编原「S8/S9/S10 隐式算已结算」注释口径
  assert.deepStrictEqual(S.SETTLE_ELIGIBLE, ['S8', 'S9', 'S10']);
});

// ── 迁移表 ──
test('迁移表: 22 条, no 连续 1..22', () => {
  assert.strictEqual(S.TRANSITIONS.length, 22);
  S.TRANSITIONS.forEach((t, i) => assert.strictEqual(t.no, i + 1));
});

test('迁移表: 每条 from 非空 且 取值均在 ALL_STATES 或通配 * 内', () => {
  for (const t of S.TRANSITIONS) {
    assert.ok(Array.isArray(t.from) && t.from.length > 0, `#${t.no} from 为空`);
    for (const f of t.from) {
      assert.ok(f === '*' || S.ALL_STATES.indexOf(f) >= 0, `#${t.no} 非法 from=${f}`);
    }
    if (t.to !== null) assert.ok(S.ALL_STATES.indexOf(t.to) >= 0, `#${t.no} 非法 to=${t.to}`);
  }
});

// ── canTransition 正向(逐条代表性用例) ──
test('canTransition 正向: 关键迁移均命中白名单', () => {
  assert.ok(S.canTransition('confirm_done', 'S1', 'S0'));
  assert.ok(S.canTransition('pay', 'S0', 'S2'));
  assert.ok(S.canTransition('cancel', 'S1', 'S6'));
  assert.ok(S.canTransition('cancel', 'S0', 'S6'));            // 数组 from 命中
  assert.ok(S.canTransition('start_service', 'S2', 'S3'));
  assert.ok(S.canTransition('complete', 'S3', 'S5'));
  assert.ok(S.canTransition('evaluate', 'S5', 'S8'));
  assert.ok(S.canTransition('ratio_agree', 'S4', 'S5'));
  assert.ok(S.canTransition('after_sale_expire', 'S8', 'S10'));
  assert.ok(S.canTransition('interrupt_report', 'S3', 'S3.5'));
  assert.ok(S.canTransition('resume', 'S3.5', 'S3'));
});

test('canTransition: to=null 的规则(目标由业务决定)只校验 from', () => {
  assert.ok(S.canTransition('complaint_open', 'S5'));          // 目标态=原状态+frozen
  assert.ok(S.canTransition('complaint_withdraw', 'S10.5'));   // from 通配 *
  assert.ok(!S.canTransition('complaint_withdraw', 'S99'));    // 非法态仍拒绝
});

test('canTransition 拒绝: 非法 from / 非法 to / 未知 event', () => {
  assert.ok(!S.canTransition('start_service', 'S0', 'S3'));    // from 不在白名单
  assert.ok(!S.canTransition('pay', 'S0', 'S5'));              // to 不匹配
  assert.ok(!S.canTransition('no_such_event', 'S0', 'S2'));    // 未知事件
});

test('transitionFor: 返回命中规则本身(含 no/guard/money/timeout)', () => {
  const r = S.transitionFor('pay', 'S0', 'S2');
  assert.ok(r && r.no === 2);
  assert.strictEqual(r.money, 'type=pay 流水');
  assert.strictEqual(S.transitionFor('no_such_event', 'S0', 'S2'), null);
});

// ── 正交位默认值 ──
test('orthoDefaults: 每次返回全新对象(嵌套 fund 不共享引用)', () => {
  const a = S.orthoDefaults();
  const b = S.orthoDefaults();
  assert.deepStrictEqual(a, b);
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.fund, b.fund);
  a.fund.paid_fen = 999;
  assert.strictEqual(b.fund.paid_fen, 0);
  assert.strictEqual(a.eval_state, 'pending');
  assert.strictEqual(a.dispute_state, 'none');
  assert.strictEqual(a.frozen, false);
});

// ── 读兼容 mapStatus(§5.1) ──
test('mapStatus: S9 → S8 + auto_done', () => {
  const m = S.mapStatus({ status: 'S9' });
  assert.strictEqual(m.status, 'S8');
  assert.strictEqual(m.eval_state, 'auto_done');
});

test('mapStatus: S8 → S8 + user_done', () => {
  const m = S.mapStatus({ status: 'S8' });
  assert.strictEqual(m.status, 'S8');
  assert.strictEqual(m.eval_state, 'user_done');
});

test('mapStatus: S10.5 → 回事务前主轴状态 + dispute open + frozen', () => {
  const m = S.mapStatus({ status: 'S10.5', complaint_from_status: 'S5' });
  assert.strictEqual(m.status, 'S5');
  assert.strictEqual(m.dispute_state, 'open');
  assert.strictEqual(m.frozen, true);
});

test('mapStatus: 已有正交位优先于旧状态推导; 普通态补默认', () => {
  const m1 = S.mapStatus({ status: 'S9', eval_state: 'user_done' });
  assert.strictEqual(m1.eval_state, 'user_done');          // 显式正交位不被推导覆盖
  const m2 = S.mapStatus({ status: 'S3' });
  assert.strictEqual(m2.eval_state, 'pending');
  assert.strictEqual(m2.dispute_state, 'none');
  assert.strictEqual(m2.frozen, false);
});

// ── CAS 语义(与既有 casStatus 逐字同构) ──
function makeFakeCas(updated) {
  const calls = [];
  const _ = { in: (arr) => ({ $in: arr }) };
  const col = () => ({
    where: (cond) => ({
      update: async (payload) => { calls.push({ cond, patch: payload.data }); return { stats: { updated } }; }
    })
  });
  return { col, _, calls };
}

test('casTransition: updated===1 → 抢到 true, 且按 status 条件更新', async () => {
  const f = makeFakeCas(1);
  const won = await S.casTransition(f.col, f._, 'o1', 'S2', { status: 'S3' });
  assert.strictEqual(won, true);
  assert.deepStrictEqual(f.calls[0].cond, { _id: 'o1', status: 'S2' });
  assert.deepStrictEqual(f.calls[0].patch, { status: 'S3' });
});

test('casTransition: updated!==1 → 未抢到 false', async () => {
  const f = makeFakeCas(0);
  assert.strictEqual(await S.casTransition(f.col, f._, 'o1', 'S2', { status: 'S3' }), false);
});

test('casTransition: 数组 expect → 走 _.in; 异常 → 返回 false 且回调 onError', async () => {
  const f = makeFakeCas(1);
  await S.casTransition(f.col, f._, 'o1', ['S1', 'S0'], { status: 'S6' });
  assert.deepStrictEqual(f.calls[0].cond.status, { $in: ['S1', 'S0'] });

  const boom = () => ({ where: () => ({ update: async () => { throw new Error('x'); } }) });
  let caught = null;
  const won = await S.casTransition(boom, { in: (a) => a }, 'o1', 'S2', {}, { onError: (e) => { caught = e; } });
  assert.strictEqual(won, false);
  assert.ok(caught && caught.message === 'x');
});

test('casTransition: 影子校验仅对白名单外迁移回调(onShadow), 不阻断', async () => {
  const f = makeFakeCas(1);
  const seen = [];
  // 白名单内(pay S0→S2): 不触发影子
  await S.casTransition(f.col, f._, 'o1', 'S0', { status: 'S2' }, { event: 'pay', onShadow: (...a) => seen.push(a) });
  assert.strictEqual(seen.length, 0);
  // 白名单外(pay 却 S0→S9): 触发影子, 但返回值仍为 true(行为不变)
  const won = await S.casTransition(f.col, f._, 'o2', 'S0', { status: 'S9' }, { event: 'pay', onShadow: (...a) => seen.push(a) });
  assert.strictEqual(won, true);
  assert.strictEqual(seen.length, 1);
});
