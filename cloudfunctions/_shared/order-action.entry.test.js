// order-action 入口层契约测试（mock wx-server-sdk，仅测「输入 → 返回码」，不改运行逻辑）
// 覆盖点：nudge_partner 的越权/归属/准入校验 —— 评审指出的最脆弱入口之一。
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

// 在 require('../order-action/index') 之前拦截 wx-server-sdk
let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};

function loadIndex(sdk) {
  activeSdk = sdk;
  // 清掉可能已缓存的 index（不同测试用不同 sdk 实例）
  delete require.cache[require.resolve('../order-action/index.js')];
  return require('../order-action/index.js');
}

const USER = 'o_user_1';
const PARTNER = 'o_partner_1';
const OID = 'a'.repeat(32);
const DEV_UNTIL = Date.now() + 2 * 3600 * 1000;

function baseStore(extra = {}) {
  return {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: {
      [OID]: Object.assign({
        _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER,
        start_time: Date.now() - 60 * 1000, urge_count: 0
      }, extra)
    }
  };
}

// 1. 非发单人催办 → 越权拒绝
test('nudge_partner: 非订单发单人 → oa_not_owner', async () => {
  const sdk = makeSdk({ openid: 'o_stranger', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: 'o_stranger' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_owner');
});

// 2. 服务未到开始时间 → oa_urge_not_started
test('nudge_partner: 未到 start_time → oa_urge_not_started', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ start_time: Date.now() + 60 * 60 * 1000 }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_urge_not_started');
});

// 3. 订单不存在 → oa_not_found
test('nudge_partner: 订单不存在 → oa_not_found', async () => {
  const sdk = makeSdk({ openid: USER, store: { admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } }, order_main: {} } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_found');
});

// 4. 缺 order_id → oa_bad_order_id（分发层预检，无需进 DB）
test('nudge_partner: 缺 order_id → oa_bad_order_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_bad_order_id');
});

// 5. 成功路径 → ok 且写入催办记录
test('nudge_partner: 合法催办 → ok + 写 order_main 与 system_notice', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.urge_count, 1);
  assert.ok(sdk.writes.order_main, '应写入 order_main');
  const notice = (sdk.writes.system_notice || []).find((w) => w.add && w.data.type === 'nudge');
  assert.ok(notice, '应向耍伴写入 nudge 站内通知');
  assert.strictEqual(notice.data.to_openid, PARTNER);
});

// 6. cancel: 非订单参与方 → oa_not_participant（roleOf 门，与 nudge 的精确匹配门互补）
test('cancel: 非参与方 → oa_not_participant', async () => {
  const sdk = makeSdk({ openid: 'o_stranger', store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel', order_id: OID, mock_openid: 'o_stranger' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_participant');
});

// 7. CAS 未抢到(并发竞争落败): 状态已被他人改走 → oa_status_conflict
test('cancel: CAS 未抢到且订单未变 S6 → oa_status_conflict', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S1' }), updateCount: 0 });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'cancel', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_status_conflict');
});

// 8. CAS 未抢到: 开始履约竞争落败 → oa_status_conflict
// 注: 2026-10-14(需求B)起 start_service 强制 start_evidence, 须先满足资料门才能走到 CAS 分支
test('start_service: CAS 未抢到 → oa_status_conflict', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: baseStore({ status: 'S2' }), updateCount: 0 });
  const { main } = loadIndex(sdk);
  const r = await main({
    action: 'start_service', order_id: OID, mock_openid: PARTNER,
    start_evidence: {
      photos: [{ file_id: 'cloud://x/1.jpg', kind: 'scene', at: 1 }],
      partner_location: { latitude: 30.5, longitude: 104.0, at: 1 }
    }
  }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_status_conflict');
});

// 9. CAS 未抢到: 完成履约竞争落败 → oa_status_conflict
test('complete_service: CAS 未抢到 → oa_status_conflict', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: baseStore({ status: 'S3', milestone: { current: 3, confirmed: [true, true, true] } }), updateCount: 0 });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complete_service', order_id: OID, mock_openid: PARTNER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_status_conflict');
});

// 时间线测试夹具: 覆盖 5 个数据源(状态轴/投诉/爽约/支付/订单内嵌里程碑+催办)
function tlStore() {
  return {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: {
      [OID]: {
        _id: OID, status: 'S5', user_openid: USER, partner_openid: PARTNER,
        milestone: { current: 2, evidence: [{ milestone: 1, label: '30%', note: '第一阶段完成', submitted_by: PARTNER, submitted_at: 800 }] },
        urge_logs: [{ at: 700, by: USER }]
      }
    },
    order_status_log: {
      l1: { order_id: OID, from_status: 'S2', to_status: 'S3', action: 'start_service', operator: PARTNER, created_at: 1000, is_deleted: false },
      l2: { order_id: OID, from_status: 'S5', to_status: 'S10.5', action: 'user_complaint', operator: USER, created_at: 2000, is_deleted: false },
      l3: { order_id: OID, from_status: 'S3', to_status: 'S5', action: 'complete_service', operator: PARTNER, created_at: 3000, is_deleted: false }
    },
    complaint: {
      c1: { order_id: OID, initiator_openid: USER, initiator_role: 'user', reason: '服务与描述不符', status: 'pending', created_at: 2000, is_deleted: false }
    },
    no_show_report: {},
    pay_transaction: {
      t1: { order_id: OID, type: 'pay', amount_fen: 10000, status: 'success', created_at: 500, is_deleted: false }
    }
  };
}

// 10. complaint(D1 放开 2026-10-12): S2 付款后即可发起 → ok
test('complaint: S2 付款后发起投诉 → ok(白名单放开)', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S2' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint', order_id: OID, reason: '服务与描述不符', mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'S10.5');
  assert.ok((sdk.writes.complaint || []).length, '应写入 complaint 记录');
});

// 11. complaint: 已取消(S6) 不可发起 → oa_complaint_status
test('complaint: S6 不可发起 → oa_complaint_status', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S6' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_complaint_status');
});

// 12. complaint: 非参与方 → oa_not_participant
test('complaint: 非参与方 → oa_not_participant', async () => {
  const sdk = makeSdk({ openid: 'o_stranger', store: baseStore({ status: 'S2' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint', order_id: OID, mock_openid: 'o_stranger' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_participant');
});

// 12c. complaint: 履约完成(S5) 起双方均不可发起 → oa_complaint_status(2026-10-15 需求变更)
test('complaint: S5 需求方不可发起 → oa_complaint_status 且不落库', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S5' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.strictEqual(r.code, 'oa_complaint_status');
  assert.strictEqual((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

// 12d. complaint: 已评价(S8) 起耍伴同样不可发起 → oa_complaint_status(双方一致收口)
test('complaint: S8 耍伴不可发起 → oa_complaint_status 且不落库', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: baseStore({ status: 'S8' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint', order_id: OID, mock_openid: PARTNER }, {});
  assert.strictEqual(r.ok, false, `应拒绝: ${JSON.stringify(r)}`);
  assert.strictEqual(r.code, 'oa_complaint_status');
  assert.strictEqual((sdk.writes.order_main || []).length, 0, '拒绝时不得写 order_main');
});

// 13. timeline: 缺 order_id → oa_bad_order_id(分发层预检)
test('timeline: 缺 order_id → oa_bad_order_id', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'timeline', mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_bad_order_id');
});

// 14. timeline: 非参与方 → oa_not_participant
test('timeline: 非参与方 → oa_not_participant', async () => {
  const sdk = makeSdk({ openid: 'o_stranger', store: tlStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'timeline', order_id: OID, mock_openid: 'o_stranger' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_participant');
});

// 15. timeline: 多源合并 + 倒序 + 跳过投诉类 status_log + 不外显 openid
test('timeline: 多源合并/倒序/去重/隐私 → 契约', async () => {
  const sdk = makeSdk({ openid: USER, store: tlStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'timeline', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const ev = r.data.events;
  // status: start_service(1000)/complete_service(3000); user_complaint(2000) 去重跳过
  assert.strictEqual(ev.filter((e) => e.type === 'status').length, 2);
  assert.strictEqual(ev.filter((e) => e.type === 'complaint').length, 1);
  assert.strictEqual(ev.filter((e) => e.type === 'money').length, 1);
  assert.strictEqual(ev.filter((e) => e.type === 'milestone').length, 1);
  assert.strictEqual(ev.filter((e) => e.type === 'urge').length, 1);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1].at >= ev[i].at, '应按时间倒序');
  const raw = JSON.stringify(r);
  assert.ok(raw.indexOf(USER) < 0 && raw.indexOf(PARTNER) < 0, '不应外显 openid');
});

// 16. timeline: 超过 50 条 → 仅返回最近 50
test('timeline: 超过 50 条 → 仅返回最近 50', async () => {
  const logs = {};
  for (let i = 0; i < 80; i++) {
    logs['l' + i] = { order_id: OID, from_status: 'S3', to_status: 'S3', action: 'start_service', operator: PARTNER, created_at: i, is_deleted: false };
  }
  const sdk = makeSdk({ openid: USER, store: Object.assign(tlStore(), { order_status_log: logs }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'timeline', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.events.length, 50);
  assert.ok(r.data.total > 50);
});

// 16b. timeline: 履约双确认阶段G事件须有中文 label(2026-10-15 真机缺陷: 字典缺失致显示裸状态码)
test('timeline: start_reject/finish_reject 等阶段G事件 → 中文 label 不裸码', async () => {
  const logs = {
    g1: { order_id: OID, from_status: 'S2', to_status: 'S2_6', action: 'start_apply', operator: PARTNER, created_at: 100, is_deleted: false },
    g2: { order_id: OID, from_status: 'S2_6', to_status: 'S2', action: 'start_reject', operator: USER, created_at: 200, is_deleted: false },
    g3: { order_id: OID, from_status: 'S3', to_status: 'S3_6', action: 'finish_apply', operator: PARTNER, created_at: 300, is_deleted: false },
    g4: { order_id: OID, from_status: 'S3_6', to_status: 'S3', action: 'finish_reject', operator: USER, created_at: 400, is_deleted: false }
  };
  const sdk = makeSdk({ openid: USER, store: Object.assign(tlStore(), { order_status_log: logs }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'timeline', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const labels = r.data.events.filter((e) => e.type === 'status').map((e) => e.label);
  assert.ok(labels.indexOf('发起履约申请') >= 0, 'start_apply 应中文');
  assert.ok(labels.indexOf('不同意开始履约') >= 0, 'start_reject 应中文');
  assert.ok(labels.indexOf('发起履约完毕确认') >= 0, 'finish_apply 应中文');
  assert.ok(labels.indexOf('不确认履约完毕') >= 0, 'finish_reject 应中文');
  assert.ok(labels.every((l) => l.indexOf('S2_6') < 0 && l.indexOf('S3_6') < 0), '不应出现中间态裸码');
});

// 17. complaint: 冻结位(爽约申诉在途) → oa_order_frozen(D2: 谁先发起谁冻结)
test('complaint: 订单已冻结 → oa_order_frozen', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S2', frozen: true }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_order_frozen');
});

// 18. user_confirm_start(需求B 二期 2026-10-14): 需求方 S3 带定位确认 → ok + 写 order_main.user_confirm
test('user_confirm_start: 需求方 S3 带定位确认 → ok + 写 user_confirm', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S3' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_confirm_start', order_id: OID, mock_openid: USER,
    user_confirm: { latitude: 30.5, longitude: 104.0, accuracy: 20, address: '成都市某地' } }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.status, 'S3');
  assert.strictEqual(r.data.user_confirm.latitude, 30.5);
  assert.ok((sdk.writes.order_main || []).length, '应写入 order_main.user_confirm');
});

// 19. user_confirm_start: 缺定位 → oa_user_location_required(仅该确认动作 fail-closed)
test('user_confirm_start: 缺定位 → oa_user_location_required', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S3' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_confirm_start', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_user_location_required');
});

// 20. user_confirm_start: 仅需求方可用 → 耍伴调用 oa_uc_perm
test('user_confirm_start: 耍伴调用 → oa_uc_perm', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: baseStore({ status: 'S3' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_confirm_start', order_id: OID, mock_openid: PARTNER,
    user_confirm: { latitude: 30.5, longitude: 104.0 } }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_uc_perm');
});

// 21. user_confirm_start: 非 S3 → oa_uc_status
test('user_confirm_start: 非 S3 → oa_uc_status', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({ status: 'S2' }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'user_confirm_start', order_id: OID, mock_openid: USER,
    user_confirm: { latitude: 30.5, longitude: 104.0 } }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_uc_status');
});

// 22. detail: 需求标题/详细描述透传(2026-10-16 新增展示) —— 拆分口径 = demand.remark 全角｜
//     A/B 侧 detail_ok 已按 KNOWN_EVOLUTION 登记(新增 demand_title/demand_desc 两键), 本例为其独立行为守护
test('detail: demand.remark「标题｜描述」→ 拆为 demand_title/demand_desc', async () => {
  const DID = 'b'.repeat(32);
  const sdk = makeSdk({ openid: USER, store: Object.assign(baseStore({ demand_id: DID }), {
    demand: { [DID]: { _id: DID, remark: '帮我遛狗｜每天两次，每次 30 分钟，小区内' } }
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'detail', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.demand_title, '帮我遛狗');
  assert.strictEqual(r.data.demand_desc, '每天两次，每次 30 分钟，小区内');
  assert.strictEqual(r.data.order_id, OID, '既有返回字段不受影响');
});

// 23. detail: 拆分口径边界 —— remark 无｜仅标题(desc 空) / 历史单无 demand_id(两值兜底空, 不抛错)
test('detail: remark 无｜ / 无 demand_id → 两字段兜底为空', async () => {
  const DID = 'c'.repeat(32);
  const sdk1 = makeSdk({ openid: USER, store: Object.assign(baseStore({ demand_id: DID }), {
    demand: { [DID]: { _id: DID, remark: '只填了标题' } }
  }) });
  const r1 = await loadIndex(sdk1).main({ action: 'detail', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.data.demand_title, '只填了标题');
  assert.strictEqual(r1.data.demand_desc, '');

  const sdk2 = makeSdk({ openid: USER, store: baseStore() });   // 历史单: order_main 无 demand_id
  const r2 = await loadIndex(sdk2).main({ action: 'detail', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.data.demand_title, '');
  assert.strictEqual(r2.data.demand_desc, '');
});

// 还原 Module._load，避免污染后续测试文件
test.after(() => { Module._load = origLoad; });
