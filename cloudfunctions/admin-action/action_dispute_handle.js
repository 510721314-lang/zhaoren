// admin-action · 争议裁决 dispute_handle（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function dispute_handle(ctx) {
  const { event, isDocId, fail, col, _, genPayNo, openid, now, log, logEvent, ok } = ctx;
  const { order_id, decision, note } = event;
  if (!isDocId(order_id)) return fail('dispute_bad_id', '订单 ID 格式不正确');
  let order;
  try { order = (await col('order_main').doc(order_id).get()).data; } catch (e) { order = null; }
  if (!order) return fail('dispute_not_found', '订单不存在');
  const before = order.status;
  let after;
  if (decision === 'open') {
    if (before !== 'S10') return fail('dispute_bad_transition', '仅 S10 已关闭订单可登记争议');
    after = 'S10.5';
  } else if (decision === 'refund') {
    if (before !== 'S10.5') return fail('dispute_bad_transition', '仅争议处理中订单可裁决');
    after = 'S7';
  } else if (decision === 'complete') {
    if (before !== 'S10.5') return fail('dispute_bad_transition', '仅争议处理中订单可裁决');
    const from = order.complaint_from_status || '';
    const alreadyEvaluated = (from === 'S8' || from === 'S9' ||
      order.eval_state === 'user_done' || order.eval_state === 'auto_done');
    after = alreadyEvaluated ? 'S8' : 'S5';
  } else {
    return fail('dispute_bad_decision', 'decision 必须为 open/refund/complete');
  }
  if (!note || !String(note).trim()) return fail('dispute_no_note', '请填写处置说明');
  const noteText = String(note).trim();
  let refFen = 0;
  let refNo = '';
  let totalFen = 0;
  let alreadyRefunded = 0;
  if (decision === 'refund') {
    totalFen = Number(order.total_fen) || 0;
    try {
      const paid = await col('pay_transaction').where({
        order_id, type: 'refund', status: 'success', is_deleted: _.neq(true)
      }).limit(50).get();
      alreadyRefunded = (paid.data || []).reduce((s, t) => s + (Number(t.amount_fen) || 0), 0);
    } catch (e) {}
    const refFenMax = Math.max(0, totalFen - alreadyRefunded);
    const raw = event.refund_fen;
    refFen = (raw === undefined || raw === null || raw === '') ? totalFen : Number(raw);
    if (!Number.isInteger(refFen) || refFen <= 0) {
      return fail('dispute_bad_amount', '退款金额须为正整数(单位:分)');
    }
    if (refFen > refFenMax) {
      return fail('dispute_amount_exceed', `退款金额不得超过可退上限 ¥${(refFenMax / 100).toFixed(2)}`);
    }
    refNo = genPayNo('REF');
  }
  const patch = {
    status: after, admin_note: noteText,
    dispute_handled_by: openid, dispute_handled_at: now, updated_at: now,
    dispute_state: 'resolved', frozen: false
  };
  if (decision === 'open') { patch.dispute_opened_at = now; patch.dispute_state = 'open'; patch.frozen = true; }
  if (decision === 'refund') {
    patch.refund_fen = refFen;
    patch.refund_no = refNo;
    patch.refund_source = 'dispute';
    patch.refund_by = openid;
    patch.refunded_at = now;
    patch.fund = { paid_fen: totalFen, refunded_fen: alreadyRefunded + refFen, settle_state: 'pending', settled_at: 0 };
  }
  const dcr = await col('order_main').where({ _id: order_id, status: before }).update({ data: patch });
  if (!dcr.stats || dcr.stats.updated !== 1) {
    return fail('dispute_conflict', '订单状态已变化,请刷新后重试');
  }
  if (decision === 'refund') {
    try {
      await col('pay_transaction').add({ data: {
        pay_no: refNo, order_id, order_no: order.order_no, type: 'refund',
        amount_fen: refFen, channel: 'mock', is_mock: true, status: 'success',
        source: 'dispute', operator_openid: openid, note: noteText,
        paid_at: now, created_at: now, updated_at: now, is_deleted: false
      }});
    } catch (e) {
      log.w(`dispute_refund txn write fail: ${e.message}; compensating order ${order_id} → ${before}`);
      await col('order_main').where({ _id: order_id, status: 'S7' }).update({
        data: { status: before, refunded_at: 0, refund_fen: 0, refund_no: '', updated_at: Date.now() }
      }).catch(() => {});
      return fail('refund_db_fail', '退款流水写入失败,请重试');
    }
  }
  try {
    await col('order_status_log').add({ data: {
      order_id, order_no: order.order_no, from_status: before, to_status: after,
      actor: 'admin', actor_openid: openid, action: 'dispute_' + decision,
      note: decision === 'refund' ? `${noteText}（退款 ¥${(refFen / 100).toFixed(2)}）` : noteText,
      created_at: now, updated_at: now, is_deleted: false
    }});
  } catch (e) {}
  if (decision === 'refund') {
    const amtYuan = (refFen / 100).toFixed(2);
    await Promise.allSettled([
      col('system_notice').add({ data: {
        to_openid: order.user_openid, order_id, type: 'refund',
        title: '退款成功', body: `争议裁决退款 ¥${amtYuan}，金额将原路返回`,
        action_key: 'jump_order', action_payload: { order_id },
        created_at: now, read: false
      }}),
      col('system_notice').add({ data: {
        to_openid: order.partner_openid, order_id, type: 'refund',
        title: '订单已退款', body: `该订单经争议裁决退款 ¥${amtYuan}`,
        action_key: 'jump_order', action_payload: { order_id },
        created_at: now, read: false
      }})
    ]);
  }
  await logEvent('P2', 'dispute_' + decision, openid, {
    order_id, order_no: order.order_no, before, after, note: noteText,
    refund_fen: decision === 'refund' ? refFen : undefined,
    refund_no: decision === 'refund' ? refNo : undefined
  });
  return ok({ order_id, before, after, refund_fen: decision === 'refund' ? refFen : undefined, refund_no: decision === 'refund' ? refNo : undefined });
}

module.exports = { dispute_handle };
