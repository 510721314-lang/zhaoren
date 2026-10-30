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

// confirm_comm 订阅消息夹具(2026-10-17): S1 订单 + 未确认确认单 + 已授权 confirm_comm 的耍伴档案
// cfg 可选, 合并进 admin_config.global(如 { sub_msg_templates: { confirm_comm: { tmpl_id: 'x' } } })
function commStore(cfg = {}) {
  const CID = 'c'.repeat(32);
  return {
    admin_config: { global: Object.assign({ env: 'dev', dev_until: DEV_UNTIL }, cfg) },
    order_main: {
      [OID]: { _id: OID, status: 'S1', user_openid: USER, partner_openid: PARTNER, order_no: 'ORD_TEST_1', version: 1, is_deleted: false }
    },
    order_confirmations: {
      [CID]: { _id: CID, order_id: OID, version: 1, is_deleted: false, items: {
        time: { value: Date.now() + 3600000, user_ok: false, partner_ok: false },
        location: { value: null, user_ok: false, partner_ok: false },
        content: { value: [], user_ok: false, partner_ok: false },
        fee: { value: 5000, user_ok: false, partner_ok: false }
      } }
    },
    partner_profile: { p1: { _id: 'p1', openid: PARTNER, sub_msgs: { confirm_comm: { authorized: true, updated_at: 1 } } } }
  };
}

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

// 12e. complaint_withdraw: 争议升级(complaint_by='') 需求方可撤 → 恢复 S2_6
test('complaint_withdraw: complaint_by空串 需求方撤 → restore S2_6 且 frozen=false', async () => {
  const sdk = makeSdk({ openid: USER, store: baseStore({
    status: 'S10.5', complaint_by: '', complaint_from_status: 'S2_6',
    dispute_state: 'open', dispute_type: 'start_timeout', frozen: true,
    complaint_at: Date.now() - 60000, complaint_withdrawn_at: 0, complaint_withdrawn_by: ''
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint_withdraw', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true, `需求方应可撤争议升级: ${JSON.stringify(r)}`);
  assert.strictEqual(r.data.status, 'S2_6');
  const upd = (sdk.writes.order_main || []).find((w) => w.where && w.where._id === OID);
  assert.ok(upd, '应 CAS 回写 order_main');
  assert.strictEqual(upd.data.frozen, false, '撤回后应解冻');
  assert.strictEqual(upd.data.dispute_state, 'resolved', '撤回后 dispute_state 应 resolved');
});

// 12f. complaint_withdraw: 争议升级(complaint_by='') 耍伴方同样可撤 → 恢复 S3_6
test('complaint_withdraw: complaint_by空串 耍伴方撤 → restore S3_6(双方可撤)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: baseStore({
    status: 'S10.5', complaint_by: '', complaint_from_status: 'S3_6',
    dispute_state: 'open', dispute_type: 'finish_timeout', frozen: true,
    complaint_at: Date.now() - 60000, complaint_withdrawn_at: 0, complaint_withdrawn_by: ''
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint_withdraw', order_id: OID, mock_openid: PARTNER }, {});
  assert.strictEqual(r.ok, true, `耍伴应可撤争议升级: ${JSON.stringify(r)}`);
  assert.strictEqual(r.data.status, 'S3_6');
});

// 12g. complaint_withdraw: 主动投诉(complaint_by=USER) 耍伴方不可撤 → oa_not_complaint_owner
test('complaint_withdraw: complaint_by=USER 耍伴撤 → oa_not_complaint_owner(仅发起人可撤)', async () => {
  const sdk = makeSdk({ openid: PARTNER, store: baseStore({
    status: 'S10.5', complaint_by: USER, complaint_from_status: 'S2',
    dispute_state: 'open', dispute_type: 'complaint', frozen: true,
    complaint_at: Date.now() - 60000, complaint_withdrawn_at: 0, complaint_withdrawn_by: ''
  }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'complaint_withdraw', order_id: OID, mock_openid: PARTNER }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'oa_not_complaint_owner');
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

// 24. my_orders: 订单含 demand_id → 批量反查 demand 拆出 demand_title/demand_desc(2026-10-17 新增展示)
//     A/B 侧 my_orders_* 已按 KNOWN_EVOLUTION 登记(列表项新增两键), 本例为其独立行为守护
test('my_orders: 订单含 demand_id → demand.remark 拆为 demand_title/demand_desc', async () => {
  const DID = 'd'.repeat(32);
  const sdk = makeSdk({ openid: USER, store: {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER, created_at: 1, content_options: ['遛狗'], demand_id: DID, is_deleted: false } },
    demand: { [DID]: { _id: DID, remark: '帮我遛狗｜每天两次，每次 30 分钟，小区内' } }
  } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'my_orders', role: 'user', filter: 'all', page: 1, page_size: 20, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const item = (r.data.list || []).find((x) => x.item_type === 'order');
  assert.ok(item, '应返回订单项');
  assert.strictEqual(item.demand_title, '帮我遛狗');
  assert.strictEqual(item.demand_desc, '每天两次，每次 30 分钟，小区内');
  assert.strictEqual(item.order_id, OID, '既有字段不受影响');
});

// 25. my_orders: 无 demand_id / demand 查不到 → 标题兜底 content_options[0]、描述空(不抛错)
test('my_orders: 无 demand_id → 标题兜底 content_options[0]、描述空', async () => {
  const sdk = makeSdk({ openid: USER, store: {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER, created_at: 1, content_options: ['遛狗', '喂食'], is_deleted: false } }
  } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'my_orders', role: 'user', filter: 'all', page: 1, page_size: 20, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const item = (r.data.list || []).find((x) => x.item_type === 'order');
  assert.ok(item);
  assert.strictEqual(item.demand_title, '遛狗');
  assert.strictEqual(item.demand_desc, '');
});

// 25b. my_orders 承接视角细分 tab(2026-10-28 新增): confirm=S1 / done=S5,S8,S9 / canceled=S6
test('my_orders: 承接视角 filter confirm/done/canceled 状态映射', async () => {
  const mk = (id, status) => ({ _id: id, status, user_openid: USER, partner_openid: PARTNER, created_at: 1, content_options: ['遛狗'], is_deleted: false });
  const store = {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    order_main: {
      ['a1'.repeat(16)]: mk('a1'.repeat(16), 'S1'),
      ['b2'.repeat(16)]: mk('b2'.repeat(16), 'S5'),
      ['c3'.repeat(16)]: mk('c3'.repeat(16), 'S8'),
      ['d4'.repeat(16)]: mk('d4'.repeat(16), 'S9'),
      ['e5'.repeat(16)]: mk('e5'.repeat(16), 'S6'),
      ['f6'.repeat(16)]: mk('f6'.repeat(16), 'S3')
    }
  };
  const sdk = makeSdk({ openid: PARTNER, store });
  const { main } = loadIndex(sdk);
  const statusesOf = async (filter) => {
    const r = await main({ action: 'my_orders', role: 'partner', filter, page: 1, page_size: 20, mock_openid: PARTNER }, {});
    assert.strictEqual(r.ok, true);
    return (r.data.list || []).filter((x) => x.item_type === 'order').map((x) => x.status).sort();
  };
  assert.deepStrictEqual(await statusesOf('confirm'), ['S1'], '待确认 = S1');
  assert.deepStrictEqual(await statusesOf('done'), ['S5', 'S8', 'S9'], '已完成 = S5 + 终态 S8/S9');
  assert.deepStrictEqual(await statusesOf('canceled'), ['S6'], '已取消 = S6');
});

// 26. notice_list: 通知关联订单含 demand_id → 反查 demand 拆出 demand_title/demand_desc(2026-10-17)
//     A/B 侧 notice_list 已按 KNOWN_EVOLUTION 登记(新增两键), 本例为其独立行为守护
test('notice_list: 通知关联订单 → demand.remark 拆为 demand_title/demand_desc', async () => {
  const DID = 'd'.repeat(32);
  const NID = 'n'.repeat(32);
  const sdk = makeSdk({ openid: USER, store: {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    system_notice: { [NID]: { _id: NID, to_openid: USER, order_id: OID, title: '抢单提醒', read: false, created_at: 1 } },
    order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER, content_options: ['遛狗'], demand_id: DID } },
    demand: { [DID]: { _id: DID, remark: '帮我遛狗｜每天两次' } }
  } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_list', limit: 20, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const n = (r.data.list || [])[0];
  assert.ok(n, '应返回通知条目');
  assert.strictEqual(n.demand_title, '帮我遛狗');
  assert.strictEqual(n.demand_desc, '每天两次');
  assert.strictEqual(n.title, '抢单提醒', '既有字段不受影响');
});

test('notice_list: error_scan 巡检通知不展示且不计未读', async () => {
  const sdk = makeSdk({ openid: USER, store: {
    admin_config: { global: { env: 'dev', dev_until: DEV_UNTIL } },
    system_notice: {
      e1: { _id: 'e1', to_openid: USER, order_id: '', type: 'error_scan', title: '巡检报告', read: false, created_at: 2 },
      d1: { _id: 'd1', to_openid: USER, order_id: '', type: 'demand_grab', title: '有新需求可接单', read: false, created_at: 1 }
    }
  } });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'notice_list', limit: 20, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.list.length, 1);
  assert.strictEqual(r.data.list[0].type, 'demand_grab');
  const c = sdk.calls.find((x) => x.method === 'where.count' && x.name === 'system_notice');
  assert.ok(c, '应发起未读 count');
  assert.strictEqual(c.query.type.__sentinel, 'neq', '未读计数须排除 error_scan');
  assert.strictEqual(c.query.type.args[0], 'error_scan');
});

// 27. update_item 成功路径(发单人改「时间」) + confirm_comm 已配模板且耍伴已授权 → 订阅消息真发 1 次(2026-10-17)
//     覆盖 §10「成功路径必须走通」: 断言返回值 + 副作用(订阅发送被调用), 不只覆盖错误码分支
test('update_item: 发单人改时间 → 落库成功且向耍伴发 confirm_comm 订阅消息', async () => {
  const sdk = makeSdk({ openid: USER, store: commStore({
    sub_msg_templates: { confirm_comm: { tmpl_id: 'TMPL_CONFIRM_COMM', fields: { thing1: 'comm_item', time2: 'comm_time' } } }
  }) });
  let sent = 0; let sentTo = ''; let sentPage = '';
  sdk.openapi.subscribeMessage.send = async (o) => { sent++; sentTo = o.touser; sentPage = o.page; return { errMsg: 'send:ok' }; };
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'update_item', order_id: OID, item: 'time', value: Date.now() + 3600000, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.reset, true);
  assert.strictEqual(sent, 1, '应发出 1 条订阅消息');
  assert.strictEqual(sentTo, PARTNER, '收件人应为耍伴');
  assert.ok(String(sentPage).indexOf('chat') >= 0, '落地页应指向聊天页');
});

// 28. 未配 confirm_comm 模板 → 静默降级: 不阻断主流程、不发订阅(端内弹窗仍生效)
test('update_item: 未配 confirm_comm → 静默降级不发订阅消息', async () => {
  const sdk = makeSdk({ openid: USER, store: commStore() });
  let sent = 0;
  sdk.openapi.subscribeMessage.send = async () => { sent++; return { errMsg: 'send:ok' }; };
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'update_item', order_id: OID, item: 'time', value: Date.now() + 3600000, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(sent, 0, '未配模板不应调用订阅发送');
});

// 26. chat_poll(2026-10-26 用量治理): 四确认 + 未读通知合并为 1 次调用, 供聊天页 60s 轮询
test('chat_poll: with_confirm+with_notice → 一次返回确认单与未读通知', async () => {
  const store = commStore();
  store.system_notice = {
    n1: { _id: 'n1', to_openid: USER, order_id: OID, read: false, type: 'paid', title: '对方已支付', body: '', created_at: 100, is_deleted: false },
    n2: { _id: 'n2', to_openid: USER, order_id: OID, read: true, type: 'tip', title: '旧通知', body: '', created_at: 90, is_deleted: false }
  };
  const sdk = makeSdk({ openid: USER, store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'chat_poll', order_id: OID, with_confirm: true, with_notice: true, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.confirmation.order_id, OID, '应带回四确认数据');
  assert.strictEqual(r.data.notices.has_new, true);
  assert.strictEqual(r.data.notices.list.length, 1, '只返回未读通知');
  assert.strictEqual(r.data.notices.list[0].id, 'n1');
});

test('chat_poll: 不带开关 → 不查确认单/通知, 返回空 data', async () => {
  const sdk = makeSdk({ openid: USER, store: commStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'chat_poll', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data, {});
});

// 27. writeNotice 去重合并(2026-10-30): 同收件人+同单+同类型未读通知再次触发 → update 顺延 created_at(列表可置顶)
test('writeNotice: 合并更新顺延 created_at, 通知列表可置顶', async () => {
  const NID = 'n'.repeat(32);
  const OLD = Date.now() - 30 * 60 * 1000;
  const store = baseStore();
  store.system_notice = {
    [NID]: { _id: NID, to_openid: PARTNER, order_id: OID, type: 'nudge', read: false, title: '旧催办', body: '旧', created_at: OLD, updated_at: OLD }
  };
  const sdk = makeSdk({ openid: USER, store });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'nudge_partner', order_id: OID, mock_openid: USER }, {});
  assert.strictEqual(r.ok, true);
  const upd = (sdk.writes.system_notice || []).find((w) => w.doc === NID);
  assert.ok(upd, '同类型未读通知应走 doc.update 合并');
  assert.strictEqual(typeof upd.data.created_at, 'number');
  assert.ok(upd.data.created_at > OLD, 'created_at 应顺延为最近一次提醒时间');
});

// 还原 Module._load，避免污染后续测试文件
test.after(() => { Module._load = origLoad; });
