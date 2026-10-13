// action_account.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

async function processSuspendRestore(ctx) {
  const { col, log, trackBacklog, SCAN_MAX, scanAll, now, out } = ctx;
  // ───────── 3.8 账号停用到期恢复(2026-10-12 批1.2) ─────────
  // 此前只有 user-login 的「登录惰性恢复」: 被停用用户不登录则永远停在 suspended。
  // 字段口径与 user-login/index.js:209-229 maybeRestoreSuspend 完全一致(含 suspend_until 缺失视为已到期的历史异常数据)。
  try {
    const susp = await scanAll('user_account', () => ({ status: 'suspended' }));
    trackBacklog('user_suspended', susp.length >= SCAN_MAX ? susp : []);
    const due = susp.filter((u) => (Number(u.suspend_until) || 0) <= now);
    await Promise.allSettled(due.map(async (u) => {
      let r = null;
      try {
        r = await col('user_account').where({ _id: u._id, status: 'suspended' }).update({ data: {
          status: 'normal', suspend_restored_at: now, updated_at: now
        }});
      } catch (e) { log.d(`suspend restore fail: ${e && e.message}`); return; }
      if (!r || !r.stats || r.stats.updated !== 1) return;   // 并发(登录惰性恢复/管理员操作)已处理 → 不重复通知
      try {
        await col('system_notice').add({ data: {
          to_openid: u.openid, type: 'account_restored',
          title: '账号已恢复', body: '账号停用期已结束,已恢复',
          read: false, created_at: now, updated_at: now, is_deleted: false
        }});
      } catch (e) {}
      out.account_restored.push(u.openid || String(u._id));
      log.d(`suspend auto-restored: openid_len=${String(u.openid || '').length}`);
    }));
  } catch (e) { log.d(`suspend restore scan fail: ${e.message}`); }
}

async function processDisputeEscalate(ctx) {
  const { col, log, scanAll, errorScan, now, out, event, disputeEscDays } = ctx;
  // ───────── 4.8 争议单超期升级(2026-10-13 留存负债闭环): 争议发起超 dispute_escalate_d 天未裁决 → P1 平台事件 ─────────
  // 语义: 仅「升级信号」——幂等标记 dispute_escalated_at + 写 P1 platform_event(由 §5 errorScan 立即推送全体管理员);
  //   裁决仍是人工唯一路径(admin 端 dispute_list), 不做自动裁决。
  // 覆盖两类在途争议: 投诉(status=S10.5, 时间锚 complaint_at)与爽约申诉(冻结中, 时间锚 dispute_opened_at)。
  try {
    const escCut = now - disputeEscDays * 24 * 3600 * 1000;
    const opens = await scanAll('order_main', () => ({ dispute_state: 'open' }));
    await Promise.allSettled(opens.map(async (o) => {
      if (o.dispute_escalated_at) return;   // 已升级过, 防重复轰炸
      const anchor = Number(o.dispute_opened_at) || Number(o.complaint_at) || Number(o.updated_at) || 0;
      if (!anchor || anchor >= escCut) return;
      const upd = await col('order_main').where({ _id: o._id, dispute_state: 'open' }).update({
        data: { dispute_escalated_at: now, updated_at: now }
      });
      if (!upd.stats || upd.stats.updated !== 1) return;
      try {
        await col('platform_event').add({ data: {
          level: 'P1', type: 'dispute_escalate_overdue', openid: o.user_openid || '',
          payload: { order_id: o._id, order_no: o.order_no, dispute_type: o.dispute_type || '', opened_at: anchor, escalate_days: disputeEscDays },
          created_at: now, updated_at: now, is_deleted: false
        }});
      } catch (e) { log.d(`dispute escalate event fail: ${e.message}`); }
      out.dispute_escalate.push(o.order_no);
      log.d(`escalate dispute overdue: ${o.order_no}`);
    }));
  } catch (e) { log.d(`dispute escalate scan fail: ${e.message}`); }
}

module.exports = {
  processSuspendRestore,
  processDisputeEscalate,
};
