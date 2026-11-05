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
  await t('N-3 resolveModify 空配置=默认 4/2/72/24', async () => {
    assert.deepStrictEqual(resolveModify({}), { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 });
  });
  await t('N-3 resolveModify 顶层键覆盖生效', async () => {
    const r = resolveModify({ modifyMinLeadHours: 6, modifyMaxTimes: 1, modifyMaxSpanH: 48, modifyConfirmHours: 12 });
    assert.deepStrictEqual(r, { minLeadHours: 6, maxTimes: 1, maxSpanH: 48, confirmHours: 12 });
  });
  await t('N-5 旧 modify_config 嵌套已不再兜底', async () => {
    const r = resolveModify({ modify_config: { minLeadHours: 9, maxTimes: 5, maxSpanH: 96, confirmHours: 36 } });
    assert.deepStrictEqual(r, { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 });
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
    assert.ok(Math.abs(wo.data.pending_modify.expire_at - (Date.now() + 24 * H)) < 5000, '确认窗口应≈24 小时');
  });

  // ── 汇总 ────────────────────────────────────────────────────────
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  → ' + r.err}`));
  const fail = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY ${results.length - fail.length}/${results.length} PASS, ${fail.length} FAIL`);
  if (fail.length) process.exit(1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
