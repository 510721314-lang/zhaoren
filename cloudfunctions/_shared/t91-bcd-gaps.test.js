// T-9.1 B/C/D 组自动化收口补测（2026-11-12）：三条断言缺口，不改任何业务代码
//   C4 主链: 四确认 7 位已满 → 需求方补第 8 位 → CAS 进 S0 待支付（此前 entry 测试仅驱动 oa_change_pending 暂停分支）
//   D4 P1:  free_sos_resolve 解除后应写 platform_event(P1, safety_sos_free_resolved)（实现 L269，此前未断言）
//   D6 零读写: 自由求助全链不触碰 order_main（附录A 红线 9 口径，此前无显式断言）
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadOrderAction(sdk) {
  activeSdk = sdk;
  delete require.cache[require.resolve('../order-action/index.js')];
  return require('../order-action/index.js');
}
function loadSafetyReport(sdk) {
  activeSdk = sdk;
  delete require.cache[require.resolve('../safety-report/index.js')];
  return require('../safety-report/index.js');
}

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);
const FREE_ID = 'f'.repeat(32);
const DEV_UNTIL = Date.now() + 2 * 3600 * 1000;

// ───────── C4 主链夹具（与 order-action.entry.test.js s1Store/confDoc 同构）─────────
function s1Store(conf) {
  const s = {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: {
      [OID]: {
        _id: OID, order_no: 'ORDTEST1', status: 'S1',
        user_openid: USER, partner_openid: PARTNER,
        created_at: Date.now() - 5 * 60 * 1000,
        start_time: Date.now() + 3600 * 1000,
        location: { name: '人民医院', latitude: 30, longitude: 120 },
        content_options: ['陪诊'], total_fen: 10000
      }
    }
  };
  if (conf) s.order_confirmations = { [conf._id]: conf };
  return s;
}
function confDoc(items) {
  return { _id: 'cfm' + '1'.repeat(29), order_id: OID, is_deleted: false, version: 2, items };
}

test('C4 主链: 7 位已满 + 需求方补确认 fee → 8 位全齐 CAS 进 S0 待支付', async () => {
  // 前 3 项双方已确认(6 位), fee 位耍伴已确认(第 7 位), 差需求方 fee 位
  const items = {
    time: { value: Date.now() + 3600 * 1000, user_ok: true, partner_ok: true },
    location: { value: { name: '人民医院', latitude: 30, longitude: 120 }, user_ok: true, partner_ok: true },
    content: { value: ['陪诊'], user_ok: true, partner_ok: true },
    fee: { value: 10000, user_ok: false, partner_ok: true }
  };
  // docUpdateWritesBack: confirm_item 先 update 确认位再重读 fresh 判定全齐, mock 需回写 store 才能驱动「8 位全齐」分支
  const sdk = makeSdk({ openid: USER, store: s1Store(confDoc(items)), docUpdateWritesBack: true });
  const { main } = loadOrderAction(sdk);
  const r = await main({ action: 'confirm_item', order_id: OID, item: 'fee', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true, `确认应成功: ${JSON.stringify(r)}`);
  assert.strictEqual(r.data.all_confirmed, true, '应判定 8 位全齐');
  assert.strictEqual(r.data.confirmed_count, 8);
  assert.strictEqual(r.data.status, 'S0', '全齐后应转待支付');
  // CAS 落库: order_main where.update data.status='S0' + pay_expire_at(默认 30 分钟)
  const cas = (sdk.writes.order_main || []).find((w) => w.where && w.data && w.data.status === 'S0');
  assert.ok(cas, '应有 S1→S0 的 CAS 更新');
  assert.strictEqual(typeof cas.data.pay_expire_at, 'number', '应写入支付截止时间');
  assert.ok(cas.data.pay_expire_at > Date.now(), '支付截止应在未来');
});

// ───────── D4 / D6 夹具（与 safety-report.entry.test.js 同构）─────────
function freeStore(reporterOpenid) {
  return {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: {},
    safety_report: {
      [FREE_ID]: {
        _id: FREE_ID, order_id: '', reporter_openid: reporterOpenid, type: 'sos', sub_type: 'free',
        status: 'active', is_deleted: false, created_at: Date.now()
      }
    }
  };
}

test('D4 P1: free_sos_resolve 本人解除 → resolved + 写 platform_event(P1, safety_sos_free_resolved)', async () => {
  const sdk = makeSdk({ openid: USER, store: freeStore(USER) });
  const { main } = loadSafetyReport(sdk);
  const r = await main({ action: 'free_sos_resolve', report_id: FREE_ID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'resolved');
  assert.strictEqual(r.data.resolved_by, 'self');
  // P1 解除事件（实现 safety-report/index.js free_sos_resolve 分支 logEvent('P1', ...)）
  const ev = (sdk.writes.platform_event || []).find((w) => w.add
    && w.data && w.data.level === 'P1' && w.data.type === 'safety_sos_free_resolved');
  assert.ok(ev, '解除应写 P1 safety_sos_free_resolved 事件');
});

test('D6 零读写: 自由求助上报/幂等/解除全链不触碰 order_main（附录A 红线 9）', async () => {
  // 段 1: 空 store 上报（真实上报链路）
  const sdk1 = makeSdk({ openid: USER, store: {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: {}, safety_report: {}
  } });
  const m1 = loadSafetyReport(sdk1).main;
  const r1 = await m1({ action: 'free_sos', mock_openid: USER }, {});
  assert.strictEqual(r1.ok, true, `上报应成功: ${JSON.stringify(r1)}`);
  // 段 2: 预置 active 记录（mock add 不回写 store），幂等命中 + 本人解除
  const sdk2 = makeSdk({ openid: USER, store: freeStore(USER) });
  const m2 = loadSafetyReport(sdk2).main;
  const r2 = await m2({ action: 'free_sos', mock_openid: USER }, {});
  assert.strictEqual(r2.data.idempotent, true, '已有进行中求助应幂等');
  const r3 = await m2({ action: 'free_sos_resolve', report_id: FREE_ID, mock_openid: USER }, {});
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(r3.data.status, 'resolved');
  // 零读写双断言: 两个实例均不得读(order_main 集合访问)也不得写
  for (const [label, sdk] of [['上报', sdk1], ['幂等+解除', sdk2]]) {
    assert.strictEqual((sdk.writes.order_main || []).length, 0, `${label}不得写 order_main`);
    const touched = sdk.calls.filter((c) => c.name === 'order_main');
    assert.strictEqual(touched.length, 0, `${label}不得读 order_main(含查询/计数)`);
  }
});
