// action_timeout.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

async function processS1Timeout(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out, s1Min } = ctx;
  // ───────── 1. S1 待确认超时(created_at 起 15 分钟未完成四确认) → S6 + 释放需求 ─────────
  try {
    const s1Cut = now - s1Min * 60 * 1000;
    const s1s = await scanAll('order_main', () => ({ status: 'S1', created_at: _.lt(s1Cut) }));
    trackBacklog('S1', s1s.length >= SCAN_MAX ? s1s : []);
    const s1OK = [];
    await Promise.allSettled(s1s.map(async (o) => {
      const won = await casStatus(o._id, 'S1', { status: 'S6', updated_at: now }, 'cancel');
      if (!won) { out.skipped.push(o.order_no + ':S1竞态'); return; }
      if (o.demand_id) {
        await col('demand').where({ _id: o.demand_id, status: 'matched' }).update({
          data: { status: 'matching', updated_at: now }
        }).catch(() => {});
      }
      s1OK.push(o);
    }));
    await Promise.allSettled(s1OK.map(o => logStatus(o._id, 'S1', 'S6', 'timeout_s1_cancel', 'system')));
    // 通知双方: 四确认超时自动取消
    await Promise.allSettled(s1OK.flatMap(o => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid, order_id: o._id, type: 'timeout_cancel',
        title: '四确认超时,订单已取消',
        body: '双方未在15分钟内完成四确认,订单已自动取消,需求已重新开放',
        action_key: 'jump_order', action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    s1OK.forEach(o => { out.s1_cancel.push(o.order_no); log.d(`timeout S1→S6: ${o.order_no}`); });
  } catch (e) { log.d(`s1 scan fail: ${e.message}`); }
}

async function processS0Timeout(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out } = ctx;
  // ───────── 2. S0 待支付超时(pay_expire_at 已过) → S6 + 释放需求(与 S1 对称, 修 D12) ─────────
  try {
    const q = { status: 'S0', pay_expire_at: _.lt(now) };
    const s0s = await scanAll('order_main', () => q);
    trackBacklog('S0', s0s.length >= SCAN_MAX ? s0s : []);
    const s0OK = [];
    await Promise.allSettled(s0s.map(async (o) => {
      if (!(o.pay_expire_at && o.pay_expire_at < now)) return;
      const won = await casStatus(o._id, 'S0', { status: 'S6', updated_at: now }, 'cancel');
      if (!won) { out.skipped.push(o.order_no + ':S0竞态'); return; }
      // Wave2 止血①(D12): S0 超时同样释放需求回 matching, 否则需求被已取消订单永久占用
      if (o.demand_id) {
        await col('demand').where({ _id: o.demand_id, status: 'matched' }).update({
          data: { status: 'matching', updated_at: now }
        }).catch(() => {});
      }
      s0OK.push(o);
    }));
    await Promise.allSettled(s0OK.map(o => logStatus(o._id, 'S0', 'S6', 'timeout_s0_close', 'system')));
    // 通知双方: 支付超时自动取消
    await Promise.allSettled(s0OK.flatMap(o => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid, order_id: o._id, type: 'timeout_cancel',
        title: '支付超时,订单已取消',
        body: '未在30分钟内完成支付,订单已自动取消,需求已重新开放',
        action_key: 'jump_order', action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    s0OK.forEach(o => { out.s0_close.push(o.order_no); log.d(`timeout S0→S6: ${o.order_no}`); });
  } catch (e) { log.d(`s0 scan fail: ${e.message}`); }
}

module.exports = {
  processS1Timeout,
  processS0Timeout,
};
