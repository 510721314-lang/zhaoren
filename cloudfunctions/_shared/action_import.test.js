// C2 回归(2026-11-14): admin-action import_collection append 冲突兜底——模块级 ctx 直组(不经过入口鉴权链)
// 覆盖: append 撞库跳过并如实计数 / append 全新全插入 / confirm 二次确认守护
// replace 路径依赖 where().remove() 真实语义(_mock_sdk 不含 remove), 不在此覆盖, 维持原整块抛错行为
const test = require('node:test');
const assert = require('node:assert');
const { import_collection } = require('../admin-action/action_import');

// 可编程 mock 集合: 已存 _id 视为唯一索引冲突(add 抛错), 模拟云端 E11000 语义
function makeStore(initialDocs) {
  const docs = (initialDocs || []).slice();
  const writes = [];
  return {
    writes,
    docs,
    col() {
      return {
        async add(payload) {
          const arr = Array.isArray(payload.data) ? payload.data : [payload.data];
          for (const d of arr) {
            if (docs.some((x) => x._id === d._id)) {
              throw new Error('mock E11000 duplicate key');
            }
            docs.push(Object.assign({}, d));
            writes.push({ _id: d._id });
          }
          return { ids: arr.map(() => 'mock_new_id') };
        }
      };
    }
  };
}

function mkCtx(store, event) {
  return {
    event,
    col: store.col.bind(store),
    _: null,
    openid: 'o_admin_test',
    logEvent: async () => {},
    ok: (data) => ({ ok: true, data }),
    fail: (code, msg) => ({ ok: false, code, msg })
  };
}

const EVT_BASE = { confirm: true, collection: 'order_main' };

// 1. append 全新文档: 全插入, 无冲突跳过
test('action_import: append 全新 → inserted=3, skipped_conflict=0', async () => {
  const store = makeStore([]);
  const r = await import_collection(mkCtx(store, Object.assign({}, EVT_BASE, {
    mode: 'append',
    docs: [{ _id: 'a1' }, { _id: 'a2' }, { _id: 'a3' }]
  })));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.inserted, 3);
  assert.strictEqual(r.data.skipped_conflict, 0);
  assert.strictEqual(store.writes.length, 3);
});

// 2. append 撞库: 已存 _id 混入 → 整块 add 抛错降级逐条, 冲突跳过如实计数(C2 修复守护)
test('action_import: append 撞库 → inserted=2, skipped_conflict=1', async () => {
  const store = makeStore([{ _id: 'dup1', kept: true }]);
  const r = await import_collection(mkCtx(store, Object.assign({}, EVT_BASE, {
    mode: 'append',
    docs: [{ _id: 'dup1' }, { _id: 'b1' }, { _id: 'b2' }]
  })));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.inserted, 2);
  assert.strictEqual(r.data.skipped_conflict, 1);
  // 库内原 dup1 保留未被覆盖, 新增仅 b1/b2
  assert.strictEqual(store.docs.filter((d) => d._id === 'dup1').length, 1);
  assert.ok(store.docs.some((d) => d._id === 'b1') && store.docs.some((d) => d._id === 'b2'));
});

// 3. confirm 二次确认守护(回归既有契约, 与 C2 无关但同文件顺带)
test('action_import: 缺 confirm → restore_need_confirm', async () => {
  const store = makeStore([]);
  const r = await import_collection(mkCtx(store, { collection: 'order_main', docs: [] }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'restore_need_confirm');
});

// 4. R3(2026-11-18 双专家评审): dry_run 预览不执行擦除/回灌, 库内文档与 writes 均不变
test('action_import: dry_run=true replace → 仅预览, 不擦除不回灌', async () => {
  const store = makeStore([{ _id: 'keep1' }]);
  const docsBefore = store.docs.length;
  const writesBefore = store.writes.length;
  const r = await import_collection(mkCtx(store, Object.assign({}, EVT_BASE, {
    mode: 'replace',
    docs: [{ _id: 'x1' }, { _id: 'x2' }],
    dry_run: true
  })));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.dry_run, true);
  assert.strictEqual(r.data.collection, 'order_main');
  assert.strictEqual(r.data.mode, 'replace');
  // 破坏性操作未执行: 库内文档数不变、writes 不变
  assert.strictEqual(store.docs.length, docsBefore);
  assert.strictEqual(store.writes.length, writesBefore);
  assert.ok(store.docs.some((d) => d._id === 'keep1'), 'dry_run 不得擦除库内原有文档');
});
