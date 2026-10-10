// order-action · nudge 分组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。
async function nudge_partner(ctx) {
  const { getOrder, getConfig, canManualUrge, col, _, writeNotice, sendUrgeSub, log, openid, order_id } = ctx;
  // 用户催办履约（Wave2 止血⑥ 升级）：限 S2 且 start_time 过后；每单 urge_max_count 次；耍伴收加急（站内+订阅双通道）
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  if (order.user_openid !== openid) return { ok: false, code: 'oa_not_owner', msg: '仅用户可催办' };
  const config = await getConfig();
  const now = Date.now();
  const gate = canManualUrge(order, now, config);
  if (!gate.ok) {
    const map = {
      oa_urge_status: `当前状态(${order.status})不可催办`,
      oa_urge_not_started: '服务尚未到开始时间，暂不可催办',
      oa_urge_cancel_pending: '取消申请处理中，暂不可催办',
      oa_urge_frozen: '订单处理中，暂不可催办',
      oa_urge_limit: `已达催办上限(${gate.max || 0}次)`
    };
    return { ok: false, code: gate.code, msg: map[gate.code] || '不可催办' };
  }
  const max = gate.max;
  // 频控：60 秒内同单只催 1 次（防连点）
  const recent = await col('system_notice').where({
    to_openid: order.partner_openid, order_id, type: 'nudge',
    created_at: _.gte(now - 60 * 1000)
  }).count().catch(() => ({ total: 0 }));
  if ((recent.total || 0) > 0) {
    return { ok: false, code: 'oa_nudge_too_frequent', msg: '操作过于频繁，请稍后再试' };
  }
  // CAS 占坑：仅当 urge_count 仍 < max（或字段不存在）时才 inc，防并发超额
  const upd = await col('order_main').where(Object.assign(
    { _id: order_id, status: 'S2' },
    { urge_count: _.or([_.lt(max), _.exists(false)]) }
  )).update({ data: { urge_count: _.inc(1), urge_logs: _.push([{ at: now, by: 'user' }]), updated_at: now } });
  if (!upd.stats || upd.stats.updated !== 1) {
    return { ok: false, code: 'oa_urge_limit', msg: `已达催办上限(${max}次)` };
  }
  const used = (Number(order.urge_count) || 0) + 1;
  // 站内通知（必达）
  writeNotice({
    to_openid: order.partner_openid, order_id, type: 'nudge',
    title: '📢 用户催办履约',
    body: `发单人催办（第${used}次），请尽快开始履约`,
    action_key: 'jump_order',
    action_payload: { order_id }
  });
  // 订阅消息（小程序端触发云调用有效；未授权/未配模板/失败一律降级，不阻断）
  try { await sendUrgeSub(order, config, now, used); } catch (e) { log.w(`urge sub fail: ${e && (e.errMsg || e.message)}`); }
  return { ok: true, data: { urge_count: used, urge_max: max, remaining: max - used } };
}

module.exports = { nudge_partner };
