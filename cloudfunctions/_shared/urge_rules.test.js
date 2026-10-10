const test = require('node:test');
const assert = require('node:assert');
const { urgeCfg, dueStages, canManualUrge } = require('./urge_rules');

const H = 3600 * 1000;
const ST = 1_000_000;
const base = (over) => Object.assign({ _id: 'o1', status: 'S2', start_time: ST, user_openid: 'u', partner_openid: 'p' }, over);

test('urgeCfg 默认值', () => {
  const c = urgeCfg({});
  assert.equal(c.remindAfterH, 1);
  assert.equal(c.escalateAfterH, 4);
  assert.equal(c.urgeMaxCount, 2);
});

test('urgeCfg 覆盖 + 0 合法值不被 || 吞', () => {
  const c = urgeCfg({ remind_after_h: 0, escalate_after_h: 2, urge_max_count: 3 });
  assert.equal(c.remindAfterH, 0);
  assert.equal(c.escalateAfterH, 2);
  assert.equal(c.urgeMaxCount, 3);
});

test('dueStages: 非 S2 → []', () => {
  assert.deepEqual(dueStages(base({ status: 'S3' }), ST + 10 * H, {}), []);
});

test('dueStages: 未到 start_time → []', () => {
  assert.deepEqual(dueStages(base({}), ST - 1, {}), []);
  assert.deepEqual(dueStages(base({ start_time: 0 }), ST, {}), []);
});

test('dueStages: 到点仅触发 t0', () => {
  const r = dueStages(base({}), ST + 1, {});
  assert.equal(r.length, 1);
  assert.equal(r[0].stage, 't0');
  assert.equal(r[0].to, 'partner');
});

test('dueStages: T+1h 触发 t0+t1', () => {
  const r = dueStages(base({}), ST + 1 * H + 1, {});
  assert.deepEqual(r.map(s => s.stage), ['t0', 't1']);
  assert.equal(r[1].to, 'user');
});

test('dueStages: T+4h 触发 t0+t1+t2', () => {
  const r = dueStages(base({}), ST + 4 * H + 1, {});
  assert.deepEqual(r.map(s => s.stage), ['t0', 't1', 't2']);
});

test('dueStages: 幂等 - 已标记 t0 则不含 t0', () => {
  const r = dueStages(base({ urge_t0_at: ST }), ST + 4 * H, {});
  assert.deepEqual(r.map(s => s.stage), ['t1', 't2']);
});

test('dueStages: 幂等 - 全标记 → []', () => {
  const r = dueStages(base({ urge_t0_at: 1, urge_t1_at: 1, urge_t2_at: 1 }), ST + 9 * H, {});
  assert.deepEqual(r, []);
});

test('dueStages: cancel_request pending → []（互斥）', () => {
  const r = dueStages(base({ cancel_request: { status: 'pending' } }), ST + 9 * H, {});
  assert.deepEqual(r, []);
});

test('dueStages: frozen → []（互斥）', () => {
  const r = dueStages(base({ frozen: true }), ST + 9 * H, {});
  assert.deepEqual(r, []);
});

test('dueStages: 自定义阈值 remind_after_h=0 即时 t1', () => {
  const r = dueStages(base({}), ST + 1, { remind_after_h: 0 });
  assert.deepEqual(r.map(s => s.stage), ['t0', 't1']);
});

test('canManualUrge: 准入通过返回 remaining', () => {
  const r = canManualUrge(base({}), ST + 1, {});
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 2);
  assert.equal(r.max, 2);
});

test('canManualUrge: 未到点拒绝', () => {
  assert.equal(canManualUrge(base({}), ST - 1, {}).code, 'oa_urge_not_started');
});

test('canManualUrge: 非 S2 拒绝', () => {
  assert.equal(canManualUrge(base({ status: 'S3' }), ST + 1, {}).code, 'oa_urge_status');
});

test('canManualUrge: 达上限拒绝', () => {
  const r = canManualUrge(base({ urge_count: 2 }), ST + 1, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'oa_urge_limit');
});

test('canManualUrge: 取消挂起/冻结拒绝', () => {
  assert.equal(canManualUrge(base({ cancel_request: { status: 'pending' } }), ST + 1, {}).code, 'oa_urge_cancel_pending');
  assert.equal(canManualUrge(base({ frozen: true }), ST + 1, {}).code, 'oa_urge_frozen');
});
