// 测试用 wx-server-sdk mock（仅入口层契约测试用，永不进入运行时部署）
// 设计目标：可编程「集合数据 + 调用记录」，让测试断言「输入 → 返回码」契约，
// 而无需真实 CloudBase。被 cloudfunctions/_shared/*.entry.test.js 通过 Module._load 拦截注入。
//
// 用法：
//   const sdk = makeSdk({ openid, store, writes });
//   await main({ action, order_id, mock_openid }, {});
//   assert.strictEqual(result.code, 'oa_not_owner');
//   // 写入断言: assert.deepStrictEqual(sdk.writes.order_main, [ {...} ])

function makeSentinel(name) {
  return function (...args) { return { __sentinel: name, args }; };
}

// db.command 操作符（_.gte / _.inc / _.push / _.or 等）→ 透传标记，不参与断言
const commandProxy = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'or' || prop === 'and') {
      return (...args) => ({ __op: prop, args });
    }
    return makeSentinel(prop);
  }
});

function makeSdk(opts = {}) {
  const openid = opts.openid || 'test_openid';
  // store: { collectionName: { docId: docData } }  —— 模拟 doc().get() / where().get()
  const store = opts.store || {};
  // 写入捕获：{ collectionName: [ {where, data} ... ] }
  const writes = {};
  const calls = [];

  function collection(name) {
    calls.push({ method: 'collection', name });
    return {
      async add(payload) {
        calls.push({ method: 'add', name, payload });
        (writes[name] = writes[name] || []).push({ add: true, data: payload && payload.data });
        const _id = 'mock_id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        return { _id };
      },
      doc(id) {
        return {
          async get() {
            calls.push({ method: 'doc.get', name, id });
            const d = (store[name] && store[name][id]) || null;
            return { data: d };
          },
          async update(payload) {
            calls.push({ method: 'doc.update', name, id, payload });
            (writes[name] = writes[name] || []).push({ doc: id, data: payload && payload.data });
            return { stats: { updated: 1 } };
          }
        };
      },
      where(query) {
        const q = query || {};
        return {
          limit() { return this; },
          async get() {
            calls.push({ method: 'where.get', name, query: q });
            // 简易匹配：按 q 的等值字段过滤 store[name] 的所有文档
            const all = store[name] ? Object.values(store[name]) : [];
            const matched = all.filter((doc) =>
              Object.keys(q).every((k) => doc[k] === q[k])
            );
            return { data: matched };
          },
          async count() {
            calls.push({ method: 'where.count', name, query: q });
            return { total: 0 };
          },
          async update(data) {
            calls.push({ method: 'where.update', name, query: q, data });
            (writes[name] = writes[name] || []).push({ where: q, data: data && data.data });
            return { stats: { updated: 1 } };
          }
        };
      }
    };
  }

  const db = {
    collection,
    get command() { return commandProxy; }
  };

  const sdk = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database() { calls.push({ method: 'database' }); return db; },
    getWXContext() { return { OPENID: openid }; },
    openapi: {
      subscribeMessage: { send: async () => ({ errMsg: 'send:ok' }) }
    },
    // 测试断言面
    _store: store,
    writes,
    calls
  };
  return sdk;
}

module.exports = { makeSdk };
