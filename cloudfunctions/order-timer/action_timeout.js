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

// ── 阶段G(2026-10-15): 履约双确认两中间态超时 → S10.5 争议(状态机 no.26 / no.30) ──
// 语义: 时间锚(start_apply_at / finish_apply_at)超阈值未获响应 → 状态迁移 S2_6/S3_6→S10.5
//   + 争议正交位(dispute_state='open' / dispute_type / dispute_opened_at);
//   no.26/no.30 的 money="资金冻结待裁定"本期不做(沿用阶段F「不动结算」), 冻结位由 mapStatus 对 S10.5 强制表达。
// @VERIFIED 2026-10-18 已真机验证：order-timer 超时扫描段 processStartApplyTimeout/processFinishConfirmTimeout（S2.6 开始履约申请 15min / S3.6 完毕确认 30min 未响应 → S10.5 + 双方站内信；阈值后台可配，T-7.1.1/1.2/1.3/1.4 全子项真机通过）
async function processStartApplyTimeout(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out, startApplyMin } = ctx;
  try {
    const cut = now - startApplyMin * 60 * 1000;
    const rows = await scanAll('order_main', () => ({ status: 'S2_6', start_apply_at: _.lt(cut) }));
    trackBacklog('S2_6', rows.length >= SCAN_MAX ? rows : []);
    const ok = [];
    await Promise.allSettled(rows.map(async (o) => {
      if (!(o.start_apply_at && o.start_apply_at < cut)) return;
      const won = await casStatus(o._id, 'S2_6', {
        status: 'S10.5', dispute_state: 'open', dispute_type: 'start_timeout',
        dispute_opened_at: now, complaint_at: now, complaint_by: '',
        complaint_from_status: 'S2_6', complaint_withdrawn_at: 0, complaint_withdrawn_by: '',
        updated_at: now
      }, 'start_apply_timeout');
      if (!won) { out.skipped.push(o.order_no + ':S2_6竞态'); return; }
      ok.push(o);
    }));
    await Promise.allSettled(ok.map(o => logStatus(o._id, 'S2_6', 'S10.5', 'timeout_start_apply', 'system')));
    // 通知双方: 开始履约申请超时, 转平台争议处理
    await Promise.allSettled(ok.flatMap(o => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid, order_id: o._id, type: 'dispute_open',
        title: '开始履约确认超时,已转平台处理',
        body: `开始履约申请 ${startApplyMin} 分钟未获响应,订单已转争议,平台将介入核实`,
        action_key: 'jump_order', action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    ok.forEach(o => { out.start_apply_timeout.push(o.order_no); log.d(`timeout S2_6→S10.5: ${o.order_no}`); });
  } catch (e) { log.d(`s2_6 scan fail: ${e.message}`); }
}

async function processFinishConfirmTimeout(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out, finishConfirmMin } = ctx;
  try {
    const cut = now - finishConfirmMin * 60 * 1000;
    const rows = await scanAll('order_main', () => ({ status: 'S3_6', finish_apply_at: _.lt(cut) }));
    trackBacklog('S3_6', rows.length >= SCAN_MAX ? rows : []);
    const ok = [];
    await Promise.allSettled(rows.map(async (o) => {
      if (!(o.finish_apply_at && o.finish_apply_at < cut)) return;
      const won = await casStatus(o._id, 'S3_6', {
        status: 'S10.5', dispute_state: 'open', dispute_type: 'finish_timeout',
        dispute_opened_at: now, complaint_at: now, complaint_by: '',
        complaint_from_status: 'S3_6', complaint_withdrawn_at: 0, complaint_withdrawn_by: '',
        updated_at: now
      }, 'finish_confirm_timeout');
      if (!won) { out.skipped.push(o.order_no + ':S3_6竞态'); return; }
      ok.push(o);
    }));
    await Promise.allSettled(ok.map(o => logStatus(o._id, 'S3_6', 'S10.5', 'timeout_finish_confirm', 'system')));
    // 通知双方: 履约完毕确认超时, 转平台争议处理
    await Promise.allSettled(ok.flatMap(o => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid, order_id: o._id, type: 'dispute_open',
        title: '履约完毕确认超时,已转平台处理',
        body: `履约完毕确认 ${finishConfirmMin} 分钟未获响应,订单已转争议,平台将介入核实`,
        action_key: 'jump_order', action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    ok.forEach(o => { out.finish_confirm_timeout.push(o.order_no); log.d(`timeout S3_6→S10.5: ${o.order_no}`); });
  } catch (e) { log.d(`s3_6 scan fail: ${e.message}`); }
}

module.exports = {
  processS1Timeout,
  processS0Timeout,
  processStartApplyTimeout,
  processFinishConfirmTimeout,
};
