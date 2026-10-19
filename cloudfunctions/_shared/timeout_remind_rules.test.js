const test = require('node:test');
const assert = require('node:assert');
const { remindCfg, dueRemindStages } = require('./timeout_remind_rules');

const M = 60 * 1000;
const ST = 1_000_000;
const base = (over) => Object.assign({ _id: 'o1', status: 'S2_6', start_apply_at: ST, user_openid: 'u', partner_openid: 'p' }, over);

test('remindCfg 默认值', () => {
  const c = remindCfg({});
  assert.equal(c.startApplyRemind1Min, 5);
  assert.equal(c.startApplyRemind2Min, 10);
  assert.equal(c.finishConfirmRemind1Min, 10);
  assert.equal(c.finishConfirmRemind2Min, 20);
});

test('remindCfg 覆盖 + 0 合法值不被 || 吞', () => {
  const c = remindCfg({ start_apply_remind1_min: 0, start_apply_remind2_min: 2, finish_confirm_remind1_min: 3, finish_confirm_remind2_min: 4 });
  assert.equal(c.startApplyRemind1Min, 0);
  assert.equal(c.startApplyRemind2Min, 2);
  assert.equal(c.finishConfirmRemind1Min, 3);
  assert.equal(c.finishConfirmRemind2Min, 4);
});

test('dueRemindStages: 非 S2_6/S3_6 → []', () => {
  assert.deepEqual(dueRemindStages(base({ status: 'S2' }), ST + 10 * M, {}), []);
  assert.deepEqual(dueRemindStages(base({ status: 'S3' }), ST + 10 * M, {}), []);
});

test('dueRemindStages: 缺锚点 → []', () => {
  assert.deepEqual(dueRemindStages(base({ start_apply_at: 0 }), ST, {}), []);
  assert.deepEqual(dueRemindStages(base({ start_apply_at: undefined }), ST, {}), []);
});

test('dueRemindStages: 未到锚点 → []', () => {
  assert.deepEqual(dueRemindStages(base({}), ST - 1, {}), []);
});

test('dueRemindStages: S2_6 +5min 仅 sr1(接收方=user)', () => {
  const r = dueRemindStages(base({}), ST + 5 * M, {});
  assert.equal(r.length, 1);
  assert.equal(r[0].stage, 'sr1');
  assert.equal(r[0].to, 'user');
  assert.equal(r[0].markField, 'start_apply_remind1_at');
});

test('dueRemindStages: S2_6 +10min 触发 sr1+sr2(顺序)', () => {
  const r = dueRemindStages(base({}), ST + 10 * M, {});
  assert.deepEqual(r.map((s) => s.stage), ['sr1', 'sr2']);
});

test('dueRemindStages: S2_6 幂等 - 已标记 remind1 则不含 sr1', () => {
  const r = dueRemindStages(base({ start_apply_remind1_at: 1 }), ST + 10 * M, {});
  assert.deepEqual(r.map((s) => s.stage), ['sr2']);
});

test('dueRemindStages: S2_6 幂等 - 全标记 → []', () => {
  const r = dueRemindStages(base({ start_apply_remind1_at: 1, start_apply_remind2_at: 1 }), ST + 20 * M, {});
  assert.deepEqual(r, []);
});

test('dueRemindStages: S3_6 +10min 仅 fr1 / +20min 触发 fr1+fr2', () => {
  const o = base({ status: 'S3_6', start_apply_at: undefined, finish_apply_at: ST });
  assert.deepEqual(dueRemindStages(o, ST + 10 * M, {}).map((s) => s.stage), ['fr1']);
  assert.deepEqual(dueRemindStages(o, ST + 20 * M, {}).map((s) => s.stage), ['fr1', 'fr2']);
});

test('dueRemindStages: S3_6 幂等 - 已标记 remind2 则不含 fr2', () => {
  const o = base({ status: 'S3_6', finish_apply_at: ST, finish_confirm_remind2_at: 1 });
  assert.deepEqual(dueRemindStages(o, ST + 20 * M, {}).map((s) => s.stage), ['fr1']);
});

test('dueRemindStages: cancel_request pending → []（互斥）', () => {
  assert.deepEqual(dueRemindStages(base({ cancel_request: { status: 'pending' } }), ST + 10 * M, {}), []);
});

test('dueRemindStages: frozen → []（互斥）', () => {
  assert.deepEqual(dueRemindStages(base({ frozen: true }), ST + 10 * M, {}), []);
});

test('dueRemindStages: 自定义阈值 start_apply_remind1_min=0 即时 sr1', () => {
  const r = dueRemindStages(base({}), ST + 1, { start_apply_remind1_min: 0, start_apply_remind2_min: 30 });
  assert.deepEqual(r.map((s) => s.stage), ['sr1']);
});

test('dueRemindStages: 空订单 → []（容错）', () => {
  assert.deepEqual(dueRemindStages(null, ST, {}), []);
  assert.deepEqual(dueRemindStages(undefined, ST, {}), []);
});
