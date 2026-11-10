// S2 变更 / 改期 + N-3/N-5 默认值 自动化回归（2026-11-05）
// 用 _shared/_mock_sdk 在进程内加载真实 order-action 入口，不触云、不写生产库（§38 R1：不 invoke 云函数）。
// 运行：node scripts/auto-test-s2-change.js   （已挂入 verify / verify:offline）
const assert = require('node:assert');
const Module = require('module');

const { makeSdk } = require('../cloudfunctions/_shared/_mock_sdk');
const { resolveModify, resolveS2Change } = require('../cloudfunctions/_shared/config_defaults');

const INDEX = require.resolve('../cloudfunctions/order-action/index.js');
let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadIndex(sdk) {
  activeSdk = sdk;
  delete require.cache[INDEX];
  return require(INDEX).main; // index.js 为 exports.main = async (event, context) => ...
}

const USER = 'u_openid_aaaaaaaaaaaaaaaaaaaa';
const PARTNER = 'p_openid_bbbbbbbbbbbbbbbbbb';
const OID = 'a'.repeat(32);
const CID = 'c'.repeat(32);
const H = 3600000;
const M = 60000;
const CN_OFFSET_MS = 8 * H;
// 改期需落在运营时段（默认中国时区 06:00–24:00）；把时间戳归一到当日 12:00 避免误触 oa_modify_redline
function shiftToNoon(ts) {
  const mins = new Date(ts + CN_OFFSET_MS).getUTCHours() * 60 + new Date(ts + CN_OFFSET_MS).getUTCMinutes();
  return ts + (720 - mins) * M;
}

function baseOrder(extra) {
  return Object.assign({
    _id: OID, order_no: 'TEST840710820T', status: 'S2',
    user_openid: USER, partner_openid: PARTNER,
    is_deleted: false, pay_status: 'paid',
    start_time: Date.now() + 3 * H,
    location: { name: '旧地点', address: '旧地址', latitude: 31.2, longitude: 121.5 },
    content_options: ['陪聊', '散步'],
    modify_count: 0, urge_count: 0
  }, extra || {});
}
function storeOf(orderDoc, extra) {
  return Object.assign({
    admin_config: { global: { env: 'prod' } },
    order_main: { [OID]: orderDoc }
  }, extra || {});
}
function pendingLocation(expireAt) {
  return {
    stage: 'S2', field: 'location',
    old_value: { name: '旧地点', address: '旧地址', latitude: 31.2, longitude: 121.5 },
    new_value: { name: '新地点', address: '新地址', latitude: 31.1, longitude: 121.2 },
    by_openid: USER, by_role: 'user', reason: '临时调整履约地点的说明',
    created_at: Date.now(), expire_at: expireAt, window: 'A', token: 'tok-1'
  };
}
function storeWithConfirm(pending) {
  const order = baseOrder({ pending_change: pending });
  return storeOf(order, {
    order_confirmations: {
      [CID]: {
        _id: CID, order_id: OID, is_deleted: false, version: 1,
        items: {
          time: { value: '明日12:00', user_ok: true, partner_ok: true },
          location: { value: order.location, user_ok: true, partner_ok: true },
          content: { value: order.content_options, user_ok: true, partner_ok: true },
          fee: { value: 10000, user_ok: true, partner_ok: true }
        }
      }
    }
  });
}
function firstWrite(sdk, col, kind) {
  const list = sdk.writes[col] || [];
  return list.find((w) => (kind === 'where' ? !!w.where : !!w.doc)) || null;
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e && e.message) || String(e) }); }
}

(async () => {
  // ── 1. N-3/N-5 默认值单源与嵌套收口 ──────────────────────────────
  await t('N-3 resolveModify 空配置=默认 4/2/72/10(分钟)', async () => {
    assert.deepStrictEqual(resolveModify({}), { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmMinutes: 10 });
  });
  await t('N-3 resolveModify 顶层键覆盖生效', async () => {
    const r = resolveModify({ modifyMinLeadHours: 6, modifyMaxTimes: 1, modifyMaxSpanH: 48, modifyConfirmMinutes: 12 });
    assert.deepStrictEqual(r, { minLeadHours: 6, maxTimes: 1, maxSpanH: 48, confirmMinutes: 12 });
  });
  await t('N-5 旧 modify_config 嵌套已不再兜底', async () => {
    const r = resolveModify({ modify_config: { minLeadHours: 9, maxTimes: 5, maxSpanH: 96, confirmMinutes: 30 } });
    assert.deepStrictEqual(r, { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmMinutes: 10 });
  });
  await t('N-3 resolveS2Change 空配置=默认', async () => {
    assert.deepStrictEqual(resolveS2Change({}), {
      enabled: true, bMinHours: 1, aMinHours: 2, aConfirmMin: 120, bConfirmMin: 15, perFieldMax: 1, totalMax: 2
    });
  });
  await t('N-5 旧 s2_change 嵌套已不再兜底', async () => {
    const r = resolveS2Change({ s2_change: { b_min_hours: 5, a_min_hours: 5, enabled: true } });
    assert.strictEqual(r.bMinHours, 1);
    assert.strictEqual(r.aMinHours, 2);
  });
  await t('N-3 A 窗门槛被 B 窗下限钳制', async () => {
    const r = resolveS2Change({ s2ChangeBMinHours: 3, s2ChangeAMinHours: 1 });
    assert.strictEqual(r.bMinHours, 3);
    assert.strictEqual(r.aMinHours, 3);
  });
  await t('N-3 越界值回落默认', async () => {
    const r = resolveModify({ modifyMinLeadHours: 999, modifyMaxTimes: -1 });
    assert.strictEqual(r.minLeadHours, 4);
    assert.strictEqual(r.maxTimes, 2);
  });

  // ── 2. S2 变更发起分支 ────────────────────────────────────────────
  await t('S2-A窗 内容变更发起成功（window=A，窗口=120 分钟）', async () => {
    const now = Date.now();
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ start_time: now + 3 * H })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['陪聊', '散步', '做饭'], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.window, 'A');
    assert.ok(Math.abs(r.data.expire_at - (now + 120 * M)) < 5000, 'expire 应≈120 分钟');
    const w = firstWrite(sdk, 'order_main', 'where');
    assert.strictEqual(w.data.pending_change.field, 'content');
    assert.strictEqual(w.data.s2_change_counts._total, 1);
    assert.strictEqual(w.data.s2_change_counts.content, 1);
  });
  await t('S2-B窗 地点变更发起成功（window=B，窗口=15 分钟）', async () => {
    const now = Date.now();
    const sdk = makeSdk({ openid: PARTNER, store: storeOf(baseOrder({ start_time: now + 1.5 * H })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'location', value: { name: '新地点', latitude: 31.1, longitude: 121.2 }, reason: '临时调整履约地点的说明' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.window, 'B');
    assert.ok(Math.abs(r.data.expire_at - (now + 15 * M)) < 5000, 'expire 应≈15 分钟');
  });
  await t('S2-距履约不足 1 小时立即拒绝', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ start_time: Date.now() + 0.5 * H })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['陪聊'], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.code, 'oa_s2c_blocked');
  });
  await t('S2-同值（勾选顺序不同）拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder()) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['散步', '陪聊'], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.code, 'oa_s2c_same');
  });
  await t('S2-原因不足 10 字拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder()) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['陪聊', '做饭'], reason: '太短' });
    assert.strictEqual(r.code, 'oa_s2c_reason');
  });
  await t('S2-时间/费用不可走本通道', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder()) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'time', value: 123, reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.code, 'oa_s2c_field');
  });
  await t('S2-有在途改期时拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ pending_modify: { new_start_time: Date.now() + 5 * H } })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['陪聊', '做饭'], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.code, 'oa_s2c_busy');
  });
  await t('S2-单项次数上限拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ s2_change_counts: { content: 1 } })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['陪聊', '做饭'], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.code, 'oa_s2c_limit');
  });
  await t('S2-全单次数上限拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ s2_change_counts: { _total: 2 } })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['陪聊', '做饭'], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.code, 'oa_s2c_limit');
  });
  await t('S2-地点缺经纬度拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder()) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'location', value: { name: '新地点' }, reason: '临时调整履约地点的说明' });
    assert.strictEqual(r.code, 'oa_s2c_location_invalid');
  });
  await t('S2-内容空数组拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder()) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: [], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.code, 'oa_s2c_content_invalid');
  });

  // ── 3. S2 变更反馈分支 ────────────────────────────────────────────
  await t('S2-对方接受：只更新变更项+置双确认，其余确认位不动', async () => {
    const pending = pendingLocation(Date.now() + 10 * M);
    const sdk = makeSdk({ openid: PARTNER, store: storeWithConfirm(pending) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'accept', token: 'tok-1' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.accepted, true);
    const wo = firstWrite(sdk, 'order_main', 'where');
    assert.strictEqual(wo.data.location.name, '新地点');
    assert.ok(wo.data.pending_change && wo.data.pending_change.__sentinel === 'remove', '订单应清除 pending_change');
    const wc = (sdk.writes.order_confirmations || [])[0];
    assert.strictEqual(wc.data.items.location.value.name, '新地点');
    assert.strictEqual(wc.data.items.location.user_ok, true);
    assert.strictEqual(wc.data.items.location.partner_ok, true);
    assert.strictEqual(wc.data.items.time.user_ok, true, '时间确认位不应被重置');
    assert.strictEqual(wc.data.items.fee.partner_ok, true, '费用确认位不应被重置');
    assert.strictEqual(wc.data.version, 2);
  });
  await t('S2-发起人不能自己接受', async () => {
    const sdk = makeSdk({ openid: USER, store: storeWithConfirm(pendingLocation(Date.now() + 10 * M)) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'accept', token: 'tok-1' });
    assert.strictEqual(r.code, 'oa_s2c_self');
  });
  await t('S2-token 不一致拦截', async () => {
    const sdk = makeSdk({ openid: PARTNER, store: storeWithConfirm(pendingLocation(Date.now() + 10 * M)) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'accept', token: 'tok-x' });
    assert.strictEqual(r.code, 'oa_s2c_stale');
  });
  await t('S2-超时收口：清除在途并返回 expired', async () => {
    const sdk = makeSdk({ openid: PARTNER, store: storeWithConfirm(pendingLocation(Date.now() - 1000)) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'accept', token: 'tok-1' });
    assert.strictEqual(r.code, 'oa_s2c_expired');
    const wo = firstWrite(sdk, 'order_main', 'where');
    assert.ok(wo.data.pending_change && wo.data.pending_change.__sentinel === 'remove');
  });
  await t('S2-拒绝：值不变并清除在途', async () => {
    const sdk = makeSdk({ openid: PARTNER, store: storeWithConfirm(pendingLocation(Date.now() + 10 * M)) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'reject', token: 'tok-1' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.accepted, false);
    const wo = firstWrite(sdk, 'order_main', 'where');
    assert.ok(wo.data.pending_change && wo.data.pending_change.__sentinel === 'remove');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(wo.data, 'location'), false, '拒绝不应改值');
  });
  await t('S2-非法 decision 拦截', async () => {
    const sdk = makeSdk({ openid: PARTNER, store: storeWithConfirm(pendingLocation(Date.now() + 10 * M)) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'yes', token: 'tok-1' });
    assert.strictEqual(r.code, 'oa_bad_decision');
  });
  await t('S2-无在途变更拦截', async () => {
    const sdk = makeSdk({ openid: PARTNER, store: storeOf(baseOrder()) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'accept', token: 'tok-1' });
    assert.strictEqual(r.code, 'oa_s2c_none');
  });
  await t('S2-非参与方拦截', async () => {
    const sdk = makeSdk({ openid: 'o_stranger_xxxxxxxxxxxxxxxx', store: storeWithConfirm(pendingLocation(Date.now() + 10 * M)) });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_respond', order_id: OID, decision: 'accept', token: 'tok-1' });
    assert.strictEqual(r.code, 'oa_not_participant');
  });

  // ── 4. 改期分支 ──────────────────────────────────────────────────
  await t('改期-与当前服务时间相同拦截', async () => {
    const start = Date.now() + 5 * H;
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ start_time: start })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 'modify', order_id: OID, new_start_time: start, reason: '测试改期原因说明' });
    assert.strictEqual(r.code, 'oa_modify_same');
  });
  await t('改期-不足 4 小时门槛拦截', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ start_time: Date.now() + 5 * H })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 'modify', order_id: OID, new_start_time: Date.now() + 2 * H, reason: '测试改期原因说明' });
    assert.strictEqual(r.code, 'oa_modify_lead');
  });
  await t('改期-次数用完拦截', async () => {
    const start = Date.now() + 5 * H;
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ start_time: start, modify_count: 2 })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 'modify', order_id: OID, new_start_time: start + 24 * H, reason: '测试改期原因说明' });
    assert.strictEqual(r.code, 'oa_modify_exhausted');
  });
  await t('改期-幅度超过 72 小时拦截', async () => {
    const start = Date.now() + 5 * H;
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ start_time: start })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 'modify', order_id: OID, new_start_time: shiftToNoon(start + 96 * H), reason: '测试改期原因说明' });
    assert.strictEqual(r.code, 'oa_modify_span');
  });
  await t('改期-成功进入 S2_5', async () => {
    const start = Date.now() + 5 * H;
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder({ start_time: start })) });
    const main = loadIndex(sdk);
    const r = await main({ action: 'modify', order_id: OID, new_start_time: shiftToNoon(start + 24 * H), reason: '测试改期原因说明' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.status, 'S2_5');
    const wo = firstWrite(sdk, 'order_main', 'where');
    assert.strictEqual(wo.data.status, 'S2_5');
    assert.ok(Math.abs(wo.data.pending_modify.expire_at - (Date.now() + 10 * 60 * 1000)) < 5000, '确认窗口应≈10 分钟');
  });

  // ── 5. 上线清零清单 §3「可服务端自证」四项（2026-11-05 追加）──────────
  // 5.1 3.12 #144 S1 四确认变更回归（action_confirm.js update_item）
  // 造 S1 单 + 确认单（4 项 × user/partner 全 false，version 1）
  function s1Store() {
    const order = baseOrder({ status: 'S1' });
    return storeOf(order, {
      order_confirmations: {
        [CID]: {
          _id: CID, order_id: OID, is_deleted: false, version: 1,
          items: {
            time: { value: order.start_time, user_ok: false, partner_ok: false },
            location: { value: order.location, user_ok: false, partner_ok: false },
            content: { value: order.content_options, user_ok: false, partner_ok: false },
            fee: { value: 10000, user_ok: false, partner_ok: false }
          }
        }
      }
    });
  }
  await t('3.12 #144 S1 改「时间」→ 8 位全重置 + version 递增', async () => {
    const sdk = makeSdk({ openid: USER, store: s1Store() });
    const main = loadIndex(sdk);
    const newTs = Date.now() + 24 * H;
    const r = await main({ action: 'update_item', order_id: OID, item: 'time', value: newTs });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.reset, true);
    assert.strictEqual(r.data.confirmed_count, 0);
    const wc = (sdk.writes.order_confirmations || [])[0];
    assert.ok(wc, '应写入确认单');
    for (const f of ['time', 'location', 'content', 'fee']) {
      assert.strictEqual(wc.data.items[f].user_ok, false, f + '.user_ok 应重置');
      assert.strictEqual(wc.data.items[f].partner_ok, false, f + '.partner_ok 应重置');
    }
    assert.strictEqual(wc.data.version, 2, 'version 应从 1 递增到 2');
    const wo = firstWrite(sdk, 'order_main', 'where');
    assert.strictEqual(wo.data.start_time, newTs, 'S1 时间变更应同步订单服务时间');
  });
  await t('3.12 #144 确认项编辑入口仅 S1（S2 下拒绝）', async () => {
    const sdk = makeSdk({ openid: USER, store: storeOf(baseOrder()) });
    const main = loadIndex(sdk);
    const r = await main({ action: 'update_item', order_id: OID, item: 'content', value: ['陪聊', '做饭'] });
    assert.strictEqual(r.code, 'oa_not_editable');
  });
  await t('3.12 #144 S1 不出现 S2 变更入口（s2_change_apply 拒绝）', async () => {
    const sdk = makeSdk({ openid: USER, store: s1Store() });
    const main = loadIndex(sdk);
    const r = await main({ action: 's2_change_apply', order_id: OID, field: 'content', value: ['陪聊', '做饭'], reason: '临时调整服务内容的说明' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'oa_s2c_status'); // action_change_s2.js:67-69 仅 S2 放行
  });

  // 5.2 3.3/3.4 #133/#132 催办订阅消息（剩余额度 + 方案A 计数）
  // sub_msg 状态机口径见 _shared/sub_msg.js stateOf/softCanSend/sentPatch/exhaustedPatch
  const PID = 'p'.repeat(32);
  // 独立 sdk/store：保证 60 秒频控（system_notice 查询）互不影响；订单已过开始时间以避开 oa_urge_not_started
  function urgeSdk(subState, subMsgSend) {
    const order = baseOrder({ status: 'S2', start_time: Date.now() - 2 * H, urge_count: 0 });
    return makeSdk({
      openid: USER,
      subMsgSend,
      store: storeOf(order, {
        admin_config: {
          global: {
            env: 'prod', urge_max_count: 2,
            sub_msg_templates: { demand_urge: { tmpl_id: 'tmpl-1', miniprogram_state: 'trial', fields: { thing4: 'urge_content', time3: 'urge_time' } } }
          }
        },
        partner_profile: { [PID]: { _id: PID, openid: PARTNER, sub_msgs: { demand_urge: subState } } }
      })
    });
  }
  // 取 order_main 上所有 sub_msg_send_logs 推送项（_.push([entry]) 在 mock 里归一为哨兵）
  function pushedLogs(sdk) {
    const out = [];
    for (const w of (sdk.writes.order_main || [])) {
      const v = w.data && w.data.sub_msg_send_logs;
      if (!v) continue;
      if (v.__sentinel === 'push') out.push(...((v.args && v.args[0]) || []));
      else if (Array.isArray(v)) out.push(...v);
    }
    return out;
  }
  function profilePatch(sdk) {
    const w = (sdk.writes.partner_profile || []).find((x) => !!x.doc);
    // T-7.16: 点路径合并后 update 载荷键为 'sub_msgs.demand_urge'(仅本模板 key, 不再整对象覆盖)
    return w && w.data && (w.data['sub_msgs.demand_urge'] || (w.data.sub_msgs && w.data.sub_msgs.demand_urge));
  }
  await t('3.3 #133 存量布尔 authorized=true → 仍发送并留痕 cloud/ok', async () => {
    const sdk = urgeSdk({ authorized: true });  // 存量形态：无 granted_count/sent_count
    const main = loadIndex(sdk);
    const r = await main({ action: 'nudge_partner', order_id: OID });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.sub_sent, true, '存量布尔应经 softCanSend 放行');
    const logs = pushedLogs(sdk);
    const e = logs[logs.length - 1];
    assert.strictEqual(e.key, 'demand_urge');
    assert.strictEqual(e.channel, 'cloud');
    assert.strictEqual(e.status, 'ok');
  });
  await t('3.4 #132 发送成功消费 1 条（granted 2 → sent 1，仍 authorized）', async () => {
    const sdk = urgeSdk({ authorized: true, granted_count: 2, sent_count: 0 });
    const main = loadIndex(sdk);
    const r = await main({ action: 'nudge_partner', order_id: OID });
    assert.strictEqual(r.data.sub_sent, true);
    const st = profilePatch(sdk);
    assert.ok(st, '应写入 partner_profile.sub_msgs.demand_urge');
    assert.strictEqual(st.sent_count, 1, 'sentPatch 应 sent+1');
    assert.strictEqual(st.granted_count, 2);
    assert.strictEqual(st.authorized, true, 'granted>sent 应仍可发');
    assert.ok(typeof st.last_sent_at === 'number');
  });
  await t('3.3 云侧 43101 → exhaustedPatch + system_notice(sub_quota)', async () => {
    const sdk = urgeSdk({ authorized: true, granted_count: 1, sent_count: 0 },
      async () => { throw { errCode: 43101, errMsg: 'quota exhausted' }; });
    const main = loadIndex(sdk);
    const r = await main({ action: 'nudge_partner', order_id: OID });
    assert.strictEqual(r.data.sub_sent, false);
    assert.strictEqual(String(r.data.sub_err), '43101');
    const st = profilePatch(sdk);
    assert.strictEqual(st.authorized, false, 'exhaustedPatch 应关授权');
    assert.strictEqual(st.sent_count, 1, 'sent_count 应抬到 granted_count');
    assert.ok(typeof st.quota_empty_at === 'number');
    const notice = (sdk.writes.system_notice || []).find((w) => w.data && w.data.type === 'sub_quota');
    assert.ok(notice, '43101 应写 system_notice type=sub_quota');
    assert.strictEqual(notice.data.action_key, 'jump_accept_config');
  });
  await t('3.4 本地已无额度（granted>sent 不成立）→ NO_QUOTA 拦截且不云调用', async () => {
    let sentTimes = 0;
    const sdk = urgeSdk({ authorized: false, granted_count: 2, sent_count: 2 },
      async () => { sentTimes++; return { errMsg: 'send:ok' }; });
    const main = loadIndex(sdk);
    const r = await main({ action: 'nudge_partner', order_id: OID });
    assert.strictEqual(r.data.sub_sent, false);
    assert.strictEqual(r.data.sub_err, 'NO_QUOTA');
    assert.strictEqual(sentTimes, 0, '本地无额度不应发起云调用');
    const logs = pushedLogs(sdk);
    const e = logs[logs.length - 1];
    assert.strictEqual(e.channel, 'local');
    assert.strictEqual(e.status, 'fail');
    assert.strictEqual(e.errCode, 'NO_QUOTA');
  });
  await t('3.4 本地无授权（granted=0）→ NO_AUTH 拦截', async () => {
    const sdk = urgeSdk({ authorized: false, granted_count: 0, sent_count: 0 });
    const main = loadIndex(sdk);
    const r = await main({ action: 'nudge_partner', order_id: OID });
    assert.strictEqual(r.data.sub_sent, false);
    assert.strictEqual(r.data.sub_err, 'NO_AUTH');
    const logs = pushedLogs(sdk);
    assert.strictEqual(logs[logs.length - 1].errCode, 'NO_AUTH');
  });

  // 5.3 3.6 #141 云函数时间 +8：bjTimeStr（index.js:252）未导出，由催办订阅入参 time3 可观测
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  // 独立手算（不复用 index.js 的 bjTimeStr，避免自指）：时间戳 +8h 后取 UTC 分量
  function bjExpect(ts) {
    const d = new Date(Number(ts) + CN_OFFSET_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  await t('3.6 #141 催办 time3 = 发送时刻北京时间(+8)', async () => {
    let cap = null;
    const sdk = urgeSdk({ authorized: true, granted_count: 2, sent_count: 0 },
      async (opts) => { cap = opts; return { errMsg: 'send:ok' }; });
    const main = loadIndex(sdk);
    const before = bjExpect(Date.now());
    await main({ action: 'nudge_partner', order_id: OID });
    const after = bjExpect(Date.now());   // 容忍跨分钟边界：发送时刻落在 [before, after]
    assert.ok(cap, '应发起订阅消息');
    assert.ok([before, after].includes(cap.data.time3.value),
      `time3=${cap.data.time3 && cap.data.time3.value} 应≈${before}`);
    assert.strictEqual(cap.templateId, 'tmpl-1');
    assert.strictEqual(cap.miniprogramState, 'trial');
    assert.ok(String(cap.page).includes('orderId=' + OID), '落地页应带 orderId');
  });
  await t('3.6 #141 time3 格式为 YYYY-MM-DD HH:MM 且非订单 start_time', async () => {
    let cap = null;
    const sdk = urgeSdk({ authorized: true, granted_count: 2, sent_count: 0 },
      async (opts) => { cap = opts; return { errMsg: 'send:ok' }; });
    const main = loadIndex(sdk);
    await main({ action: 'nudge_partner', order_id: OID });
    assert.match(cap.data.time3.value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const startStr = bjExpect(sdk._store.order_main[OID].start_time); // start_time = now-2h
    assert.notStrictEqual(cap.data.time3.value, startStr, 'time3 应取发送时刻，而非服务开始时间');
  });

  // 5.4 3.7 #142 S2 到点文案：直接断言纯函数 miniprogram/utils/order-view.js computeNextStep（L78-89）
  const { computeNextStep } = require('../miniprogram/utils/order-view.js');
  await t('3.7 #142 S2 到点(用户) → 已到服务时间(warn)', async () => {
    const now = 1700000000000;
    const r = computeNextStep({ status: 'S2', my_role: 'user', start_time: now - 1, service_date: '10-12', service_time: '20:00' }, now);
    assert.strictEqual(r.title, '已到服务时间');
    assert.strictEqual(r.tone, 'warn');
  });
  await t('3.7 #142 S2 到点(耍伴) → 已到服务时间 + 引导开始履约', async () => {
    const now = 1700000000000;
    const r = computeNextStep({ status: 'S2', my_role: 'partner', start_time: now - 1, service_date: '10-12', service_time: '20:00' }, now);
    assert.strictEqual(r.title, '已到服务时间');
    assert.ok(r.subtitle.includes('开始履约'));
  });
  await t('3.7 #142 S2 未到点文案不变', async () => {
    const now = 1700000000000;
    const r = computeNextStep({ status: 'S2', my_role: 'user', start_time: now + H, service_date: '10-12', service_time: '20:00' }, now);
    assert.strictEqual(r.title, '等待服务开始');
    assert.ok(r.subtitle.includes('10-12 20:00'));
  });

  // ── 汇总 ────────────────────────────────────────────────────────
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  → ' + r.err}`));
  const fail = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY ${results.length - fail.length}/${results.length} PASS, ${fail.length} FAIL`);
  if (fail.length) process.exit(1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
