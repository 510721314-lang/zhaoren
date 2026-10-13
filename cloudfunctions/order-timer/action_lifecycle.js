// action_lifecycle.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

async function processInterruptPartial(ctx) {
  const { col, log, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out, interruptH } = ctx;
  // ───────── 3. S3.5 中断超 24 小时 → S4(部分完成) ─────────
  try {
    const iCut = now - interruptH * 3600 * 1000;
    const s35s = await scanAll('order_main', () => ({ status: 'S3.5' }));
    trackBacklog('S3.5', s35s.length >= SCAN_MAX ? s35s : []);
    const s35OK = [];
    await Promise.allSettled(s35s.map(async (o) => {
      const anchor = o.interrupted_at || o.updated_at || 0;
      if (anchor >= iCut) return;
      const won = await casStatus(o._id, 'S3.5', { status: 'S4', updated_at: now }, 'partial_agree');
      if (!won) { out.skipped.push(o.order_no + ':S3.5竞态'); return; }
      s35OK.push(o);
    }));
    await Promise.allSettled(s35OK.map(o => logStatus(o._id, 'S3.5', 'S4', 'timeout_interrupt_partial', 'system')));
    // 通知双方: 履约中断超时, 转部分完成待协商
    await Promise.allSettled(s35OK.flatMap(o => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid, order_id: o._id, type: 'interrupt_partial',
        title: '履约中断超时',
        body: '服务中断已超24小时,订单转部分完成,请双方协商确认',
        action_key: 'jump_order', action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    s35OK.forEach(o => { out.interrupt_partial.push(o.order_no); log.d(`timeout S3.5→S4: ${o.order_no}`); });
  } catch (e) { log.d(`s3.5 scan fail: ${e.message}`); }
}

async function processMilestoneConfirm(ctx) {
  const { col, log, trackBacklog, SCAN_MAX, scanAll, now, out, msConfirmMin } = ctx;
  // ───────── 3.5 里程碑自动确认:S3 状态提交超 15 分钟未确认 → 全部确认 ─────────
  try {
    const msCut = now - msConfirmMin * 60 * 1000;
    const s3s = await scanAll('order_main', () => ({ status: 'S3' }));
    trackBacklog('S3', s3s.length >= SCAN_MAX ? s3s : []);
    const msOK = [];
    await Promise.allSettled(s3s.map(async (o) => {
      const ms = o.milestone || {};
      const submittedAt = ms.submitted_at || 0;
      if (!submittedAt || submittedAt >= msCut) return;
      const confirmed = Array.isArray(ms.confirmed) ? ms.confirmed : [false, false, false];
      if (confirmed.every(Boolean)) return;
      await col('order_main').doc(o._id).update({
        data: { 'milestone.confirmed': [true, true, true], updated_at: now }
      });
      msOK.push(o);
    }));
    msOK.forEach(o => { out.milestone_auto_confirm.push(o.order_no); log.d(`milestone auto-confirm: ${o.order_no}`); });
  } catch (e) { log.d(`milestone auto-confirm fail: ${e.message}`); }
}

async function processAutoEval(ctx) {
  const { _, col, log, starCreditDelta, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out, evalH, defaultStar } = ctx;
  // ───────── 4. S5 完成超 48 小时未评价 → 系统默认 4 星 → S9 ─────────
  try {
    const eCut = now - evalH * 3600 * 1000;
    const s5s = await scanAll('order_main', () => ({ status: 'S5' }));
    trackBacklog('S5', s5s.length >= SCAN_MAX ? s5s : []);
    const evalResults = [];  // 收集需要写 status_log 的结果
    // creditDeltas: { partner_openid: [{ delta, order_id, order_no }] } 收集后聚合原子 inc
    const creditDeltas = {};
    const starDelta = starCreditDelta(defaultStar);

    await Promise.allSettled(s5s.map(async (o) => {
      const anchor = o.service_completed_at || o.updated_at || 0;
      if (anchor >= eCut) return;

      // 幂等: 已有评价记录但订单仍停在 S5(异常兜底) → 直接补转 S8
      const evR = await col('evaluation').where({ order_id: o._id, is_deleted: false }).limit(1).get();
      if (evR.data && evR.data[0]) {
        const won = await casStatus(o._id, 'S5', { status: 'S8', evaluated_at: evR.data[0].created_at || now, updated_at: now, eval_state: 'user_done',
          // Wave1 正交位 dual-write(§3.2): 评价达成 → 资金位 settle_state=ready(S5 单无历史退款)
          fund: { paid_fen: Number(o.total_fen) || 0, refunded_fen: 0, settle_state: 'ready', settled_at: 0 } }, 'evaluate');
        if (won) {
          evalResults.push({ o, from: 'S5', to: 'S8', action: 'timeout_eval_backfill' });
          log.d(`backfill S5→S8: ${o.order_no}`);
        }
        return;
      }

      const won = await casStatus(o._id, 'S5', { status: 'S9', evaluated_at: now, updated_at: now, eval_state: 'auto_done',
        // Wave1 正交位 dual-write(§3.2): 默认评价亦达成结算资格
        fund: { paid_fen: Number(o.total_fen) || 0, refunded_fen: 0, settle_state: 'ready', settled_at: 0 } }, 'evaluate');
      if (!won) { out.skipped.push(o.order_no + ':S5竞态'); return; }

      // 写系统默认评价(文案固定「系统默认评价」)
      await col('evaluation').add({ data: {
        order_id: o._id,
        from_openid: 'system',
        to_openid: o.partner_openid,
        star: defaultStar,
        content: '系统默认评价',
        is_system: true,
        created_at: now, updated_at: now, is_deleted: false
      }});

      // 信用分 delta 收集(不在单笔内部写, 避免同 partner 多订单并发事务冲突)
      if (starDelta !== 0 && o.partner_openid) {
        if (!creditDeltas[o.partner_openid]) creditDeltas[o.partner_openid] = [];
        creditDeltas[o.partner_openid].push({ delta: starDelta, order_id: o._id });
      }

      evalResults.push({ o, from: 'S5', to: 'S9', action: 'timeout_auto_eval' });
      out.auto_eval.push(o.order_no);
      log.d(`timeout S5→S9 auto-eval: ${o.order_no} star=${defaultStar}`);
    }));
    await Promise.allSettled(evalResults.map(x => logStatus(x.o._id, x.from, x.to, x.action, 'system')));

    // 按 partner 聚合后原子 inc, 避免同 partner 多订单并发事务冲突
    const partnerKeys = Object.keys(creditDeltas);
    if (partnerKeys.length > 0) {
      await Promise.allSettled(partnerKeys.map(async (pOpenid) => {
        const entries = creditDeltas[pOpenid];
        const totalDelta = entries.reduce((s, e) => s + e.delta, 0);
        if (totalDelta === 0) return;
        try {
          // _.inc 原子更新, 同 partner 只发 1 次请求
          await col('user_account').where({ openid: pOpenid }).update({
            data: { partner_credit_score: _.inc(totalDelta), updated_at: now }
          });
          // 批量写信用分 log(每笔一条, 保留审计链)
          await Promise.allSettled(entries.map(e => col('credit_score_log').add({ data: {
            openid: pOpenid, type: 'evaluation', is_system: true, delta: e.delta,
            order_id: e.order_id, created_at: now, updated_at: now, is_deleted: false
          }})));
        } catch (e) { log.d(`auto eval credit fail (${pOpenid}): ${e.message}`); }
      }));
    }
  } catch (e) { log.d(`s5 scan fail: ${e.message}`); }
}

async function processS8Archive(ctx) {
  const { log, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out, afterSaleDays } = ctx;
  // ───────── 4.5 S8 售后窗口届满 → S10 归档(Wave2 止血④): 给 S10 唯一合法生产方 ─────────
  try {
    const aCut = now - afterSaleDays * 24 * 3600 * 1000;
    const s8s = await scanAll('order_main', () => ({ status: 'S8' }));
    trackBacklog('S8', s8s.length >= SCAN_MAX ? s8s : []);
    const s8OK = [];
    await Promise.allSettled(s8s.map(async (o) => {
      const anchor = o.evaluated_at || o.updated_at || 0;
      if (!anchor || anchor >= aCut) return;
      // 争议/申诉冻结中的单不归档(解冻回主轴后再走)
      if (o.frozen === true || (o.dispute_state && o.dispute_state !== 'none')) return;
      // fund 合并: 保留已有字段, 仅标记结算完成(settle_state=done)
      const fund = Object.assign(
        { paid_fen: Number(o.total_fen) || 0, refunded_fen: 0, settle_state: 'done', settled_at: now },
        o.fund || {}, { settle_state: 'done', settled_at: now }
      );
      const won = await casStatus(o._id, 'S8', { status: 'S10', archived_at: now, fund, updated_at: now }, 'after_sale_expire');
      if (!won) { out.skipped.push(o.order_no + ':S8竞态'); return; }
      s8OK.push(o);
    }));
    await Promise.allSettled(s8OK.map(o => logStatus(o._id, 'S8', 'S10', 'after_sale_expire', 'system')));
    s8OK.forEach(o => { out.s8_archive.push(o.order_no); log.d(`archive S8→S10: ${o.order_no}`); });
  } catch (e) { log.d(`s8 scan fail: ${e.message}`); }
}

async function processS4Escalate(ctx) {
  const { col, log, trackBacklog, SCAN_MAX, scanAll, now, out, event, partialJudgeDays } = ctx;
  // ───────── 4.6 S4 部分完成裁定期届满 → 平台介入工单(Wave2 止血③): 防双方僵持永久滞留 ─────────
  try {
    const pCut = now - partialJudgeDays * 24 * 3600 * 1000;
    const s4s = await scanAll('order_main', () => ({ status: 'S4' }));
    trackBacklog('S4', s4s.length >= SCAN_MAX ? s4s : []);
    await Promise.allSettled(s4s.map(async (o) => {
      const anchor = o.updated_at || 0;
      if (!anchor || anchor >= pCut) return;
      if (o.s4_escalated_at) return;   // 已升级过, 防重复轰炸
      const upd = await col('order_main').where({ _id: o._id, status: 'S4' }).update({
        data: { s4_escalated_at: now, updated_at: now }
      });
      if (!upd.stats || upd.stats.updated !== 1) return;
      try {
        await col('platform_event').add({ data: {
          level: 'P1', type: 's4_stale_escalate', openid: o.user_openid || '',
          payload: { order_id: o._id, order_no: o.order_no, judge_days: partialJudgeDays },
          created_at: now, updated_at: now, is_deleted: false
        }});
      } catch (e) { log.d(`s4 escalate event fail: ${e.message}`); }
      out.s4_escalate.push(o.order_no);
      log.d(`escalate S4 stale: ${o.order_no}`);
    }));
  } catch (e) { log.d(`s4 scan fail: ${e.message}`); }
}

module.exports = {
  processInterruptPartial,
  processMilestoneConfirm,
  processAutoEval,
  processS8Archive,
  processS4Escalate,
};
