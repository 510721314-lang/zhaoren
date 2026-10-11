// admin-action · 爽约申诉裁定 no_show_decide（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function no_show_decide(ctx) {
  const { event, isDocId, fail, VERDICTS, col, _, REPORT_STATUS, openid, config, noShowCfg, logEvent, log, verdictOutcome, DAY_MS, ok } = ctx;
  const { report_id, verdict, note } = event;
  if (!isDocId(report_id)) return fail('ns_bad_id', 'ID 格式不正确');
  if (VERDICTS.indexOf(verdict) < 0) return fail('ns_bad_verdict', 'verdict 须为 upheld/rejected');
  const noteText = String(note || '').trim();
  if (!noteText) return fail('ns_no_note', '请填写裁定说明');
  let rpt = null;
  try { rpt = (await col('no_show_report').doc(report_id).get()).data; } catch (e) { rpt = null; }
  if (!rpt) return fail('ns_not_found', '申诉记录不存在');
  if (rpt.status === REPORT_STATUS.DECIDED) {
    return ok({ report_id, status: REPORT_STATUS.DECIDED, verdict: rpt.verdict, idempotent: true, penalty_applied: rpt.penalty_applied || null });
  }
  const now = Date.now();
  const cfg = noShowCfg(config);
  const dcr = await col('no_show_report').where({
    _id: report_id, status: _.in([REPORT_STATUS.RECEIVED, REPORT_STATUS.DEFENSE])
  }).update({ data: {
    status: REPORT_STATUS.DECIDED, verdict,
    decided_by: openid, decided_at: now, decided_reason: noteText, updated_at: now
  }});
  if (!dcr.stats || dcr.stats.updated !== 1) {
    const again = await col('no_show_report').doc(report_id).get().catch(() => ({ data: null }));
    if (again && again.data && again.data.status === REPORT_STATUS.DECIDED) {
      return ok({ report_id, status: REPORT_STATUS.DECIDED, verdict: again.data.verdict, idempotent: true, penalty_applied: again.data.penalty_applied || null });
    }
    return fail('ns_conflict', '状态已变化,请刷新后重试');
  }
  let penaltyApplied = { score_delta: 0, suspend_until: null, applied_at: now, times: 0 };
  if (verdict === 'upheld') {
    const dupR = await col('no_show_report').where({
      order_id: rpt.order_id, target_openid: rpt.target_openid,
      status: REPORT_STATUS.DECIDED, verdict: 'upheld',
      _id: _.neq(report_id), is_deleted: _.neq(true)
    }).count().catch(() => ({ total: 0 }));
    if ((dupR.total || 0) > 0) {
      penaltyApplied = { score_delta: 0, suspend_until: null, applied_at: now, times: 0, skipped: 'dup_order_target' };
      await logEvent('P2', 'no_show_decide_dup_skip', openid, { report_id, order_id: rpt.order_id, target_openid: rpt.target_openid });
    } else {
      const scoreType = rpt.target_role === 'partner' ? 'partner' : 'user';
      const field = scoreType === 'partner' ? 'partner_credit_score' : 'user_credit_score';
      let targetU = null;
      try { targetU = (await col('user_account').where({ openid: rpt.target_openid }).limit(1).get()).data[0] || null; } catch (e) { targetU = null; }
      if (!targetU) {
        await logEvent('P1', 'no_show_target_missing', openid, { report_id, target_openid: rpt.target_openid });
        return fail('ns_target_missing', '被诉方账号不存在:裁定已记录,处罚未执行');
      }
      const windowStart = now - cfg.countWindowDays * DAY_MS;
      const cntR = await col('credit_score_log').where({
        openid: rpt.target_openid, type: 'no_show', is_deleted: _.neq(true), created_at: _.gte(windowStart)
      }).count().catch(() => ({ total: 0 }));
      const outcome = verdictOutcome(cfg, cntR.total || 0, now);
      const before = targetU[field] || 800;
      const after = Math.max(0, Math.min(1000, before + outcome.scoreDelta));
      await col('user_account').doc(targetU._id).update({ data: {
        [field]: after, no_show_count: outcome.times, updated_at: now
      }});
      try {
        await col('credit_score_log').add({ data: {
          openid: rpt.target_openid, type: 'no_show', score_type: scoreType,
          delta: outcome.scoreDelta, score: after,
          reason: `爽约申诉裁定成立 订单#${rpt.order_no || ''}`.trim(),
          order_id: rpt.order_id, report_id,
          is_system: false, admin_openid: openid,
          created_at: now, updated_at: now, is_deleted: false
        }});
      } catch (e) { log.d('no_show credit log fail:', e && e.message); }
      penaltyApplied = { score_delta: outcome.scoreDelta, suspend_until: null, applied_at: now, times: outcome.times };
      if (outcome.suspend) {
        await col('user_account').doc(targetU._id).update({ data: {
          status: 'suspended', suspend_until: outcome.suspendUntil,
          suspend_reason: `累计 ${outcome.times} 次爽约裁定成立`, suspend_at: now, suspend_by: openid, updated_at: now
        }});
        await col('partner_profile').where({ openid: rpt.target_openid })
          .update({ data: { accept_switch: false, updated_at: now } }).catch(() => {});
        penaltyApplied.suspend_until = outcome.suspendUntil;
        await logEvent('P1', 'penalty_no_show_suspend', openid, {
          report_id, target_openid: rpt.target_openid, times: outcome.times,
          suspend_days: cfg.suspendDays, suspend_until: outcome.suspendUntil
        });
        const d = new Date(outcome.suspendUntil + 8 * 3600000);
        try {
          await col('system_notice').add({ data: {
            to_openid: rpt.target_openid, order_id: rpt.order_id || '', type: 'account_suspended',
            title: '账号已停用',
            body: `信用分累计 ${outcome.times} 次爽约，账号停用 ${cfg.suspendDays} 天，将于 ${d.getUTCMonth() + 1}月${d.getUTCDate()}日自动恢复`,
            read: false, created_at: now, updated_at: now, is_deleted: false
          }});
        } catch (e) {}
      }
      await col('no_show_report').doc(report_id).update({ data: { penalty_applied: penaltyApplied, updated_at: now } });
    }
  }
  if (rpt.order_id) {
    try {
      await col('order_main').where({ _id: rpt.order_id }).update({ data: { frozen: false, updated_at: now } });
    } catch (e) {}
  }
  const noticeTo = async (to, title, body) => {
    if (!to) return;
    try {
      await col('system_notice').add({ data: {
        to_openid: to, order_id: rpt.order_id || '', type: 'no_show_decided',
        title, body, action_key: 'jump_order', action_payload: { order_id: rpt.order_id, report_id },
        read: false, created_at: now, updated_at: now, is_deleted: false
      }});
    } catch (e) {}
  };
  if (verdict === 'upheld') {
    await noticeTo(rpt.reporter_openid, '爽约申诉已裁定：成立', '已按规则处理');
    await noticeTo(rpt.target_openid, '爽约申诉已裁定：成立',
      `已扣 ${Math.abs(penaltyApplied.score_delta)} 分` + (penaltyApplied.suspend_until ? `；账号停用 ${cfg.suspendDays} 天` : ''));
  } else {
    await noticeTo(rpt.reporter_openid, '爽约申诉已裁定：不成立', '本次申诉未获支持');
    await noticeTo(rpt.target_openid, '爽约申诉已裁定：不成立', '本次申诉未获支持');
  }
  await logEvent('P2', 'no_show_decide', openid, {
    report_id, order_id: rpt.order_id, verdict,
    times: penaltyApplied.times || 0, suspend: !!penaltyApplied.suspend_until
  });
  return ok({ report_id, status: REPORT_STATUS.DECIDED, verdict, penalty_applied: penaltyApplied });
}

module.exports = { no_show_decide };
