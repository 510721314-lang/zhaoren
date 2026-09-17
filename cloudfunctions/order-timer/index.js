// 对应 PRD 章节：PRD 8.3 订单超时与梯度退款统一规则 / 附录G 状态机
// order-timer 超时自动流转 · 定时触发器(每5分钟) + 云端测试(action=run)
// 规则(rules.md §14):
//   S1 待确认 15 分钟未完成四确认 → 自动 S6 并释放需求回 matching
//   S0 待支付 30 分钟未支付(pay_expire_at) → 自动 S6
//   S3.5 中断超过 24 小时 → 默认转 S4(部分完成)
//   S2.5 改期申请超过确认时限(默认2小时)未确认 → 自动拒绝, 回原状态 S2/S3, 不改服务时间
//   S5 完成后 48 小时未评价 → 系统默认 4 星评价转 S9, 耍伴信用分 +1
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const BATCH = 50; // 单次每类状态最多处理笔数, 防止超时

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { s1_timeout_min: 15, s0_timeout_min: 30, interrupt_timeout_h: 24, eval_window_h: 48, default_star: 4 };
}

function num(v, fallback) {
  const n = Number(v);
  return (v === undefined || v === null || Number.isNaN(n)) ? fallback : n;
}

async function logStatus(orderId, from, to, action, operator) {
  await col('order_status_log').add({ data: {
    order_id: orderId, from_status: from, to_status: to,
    action, operator,
    created_at: Date.now(), updated_at: Date.now(), is_deleted: false
  }});
}

// 条件更新(防并发/防重复跑): 仅当订单仍处于 expectStatus 时更新, 返回是否"抢到"
async function casStatus(orderId, expectStatus, patch) {
  try {
    const r = await col('order_main').where({ _id: orderId, status: expectStatus }).update({ data: patch });
    return r.stats && r.stats.updated === 1;
  } catch (e) {
    return false;
  }
}

exports.main = async (event, context) => {
  // 定时触发器调用无 action; 云端测试面板传 {"action":"run"}
  if (event.action && event.action !== 'run') {
    return { ok: false, code: 'ot_unknown_action', msg: '未知动作, 定时器或传 action=run' };
  }
  const cfg = await getConfig();
  const now = Date.now();

  // 阈值(admin_config 为准; 事件入参可覆盖, 供云端测试立即触发)
  const s1Min = num(event.s1_timeout_min, cfg.s1_timeout_min || 15);
  const interruptH = num(event.interrupt_timeout_h, cfg.interrupt_timeout_h || 24);
  const evalH = num(event.eval_window_h, cfg.eval_window_h || 48);
  const defaultStar = num(cfg.default_star, 4);
  const s0Force = !!event.s0_force; // 测试用: 跳过 pay_expire_at 检查
  const msConfirmMin = num(event.milestone_confirm_min, 15); // 里程碑提交后15分钟自动确认
  const modifyConfirmH = num(event.modify_confirm_h, 2); // 改期申请确认时限(小时), 超时自动拒绝

  const out = { s1_cancel: [], s0_close: [], interrupt_partial: [], modify_auto_reject: [], milestone_auto_confirm: [], auto_eval: [], skipped: [] };
  console.log(`order-timer run: s1=${s1Min}min interrupt=${interruptH}h eval=${evalH}h star=${defaultStar} s0Force=${s0Force}`);

  // ───────── 1. S1 待确认超时(created_at 起 15 分钟未完成四确认) → S6 + 释放需求 ─────────
  try {
    const s1Cut = now - s1Min * 60 * 1000;
    const s1s = (await col('order_main').where({ status: 'S1', created_at: _.lt(s1Cut) }).limit(BATCH).get()).data || [];
    const s1OK = [];
    await Promise.allSettled(s1s.map(async (o) => {
      const won = await casStatus(o._id, 'S1', { status: 'S6', updated_at: now });
      if (!won) { out.skipped.push(o.order_no + ':S1竞态'); return; }
      if (o.demand_id) {
        await col('demand').where({ _id: o.demand_id, status: 'matched' }).update({
          data: { status: 'matching', updated_at: now }
        }).catch(() => {});
      }
      s1OK.push(o);
    }));
    await Promise.allSettled(s1OK.map(o => logStatus(o._id, 'S1', 'S6', 'timeout_s1_cancel', 'system')));
    s1OK.forEach(o => { out.s1_cancel.push(o.order_no); console.log(`timeout S1→S6: ${o.order_no}`); });
  } catch (e) { console.log(`s1 scan fail: ${e.message}`); }

  // ───────── 2. S0 待支付超时(pay_expire_at 已过) → S6 ─────────
  try {
    const q = s0Force ? { status: 'S0' } : { status: 'S0', pay_expire_at: _.lt(now) };
    const s0s = (await col('order_main').where(q).limit(BATCH).get()).data || [];
    const s0OK = [];
    await Promise.allSettled(s0s.map(async (o) => {
      if (!s0Force && !(o.pay_expire_at && o.pay_expire_at < now)) return;
      const won = await casStatus(o._id, 'S0', { status: 'S6', updated_at: now });
      if (!won) { out.skipped.push(o.order_no + ':S0竞态'); return; }
      s0OK.push(o);
    }));
    await Promise.allSettled(s0OK.map(o => logStatus(o._id, 'S0', 'S6', 'timeout_s0_close', 'system')));
    s0OK.forEach(o => { out.s0_close.push(o.order_no); console.log(`timeout S0→S6: ${o.order_no}`); });
  } catch (e) { console.log(`s0 scan fail: ${e.message}`); }

  // ───────── 3. S3.5 中断超 24 小时 → S4(部分完成) ─────────
  try {
    const iCut = now - interruptH * 3600 * 1000;
    const s35s = (await col('order_main').where({ status: 'S3.5' }).limit(BATCH).get()).data || [];
    const s35OK = [];
    await Promise.allSettled(s35s.map(async (o) => {
      const anchor = o.interrupted_at || o.updated_at || 0;
      if (anchor >= iCut) return;
      const won = await casStatus(o._id, 'S3.5', { status: 'S4', updated_at: now });
      if (!won) { out.skipped.push(o.order_no + ':S3.5竞态'); return; }
      s35OK.push(o);
    }));
    await Promise.allSettled(s35OK.map(o => logStatus(o._id, 'S3.5', 'S4', 'timeout_interrupt_partial', 'system')));
    s35OK.forEach(o => { out.interrupt_partial.push(o.order_no); console.log(`timeout S3.5→S4: ${o.order_no}`); });
  } catch (e) { console.log(`s3.5 scan fail: ${e.message}`); }

  // ───────── 3.6 S2.5 改期确认超时(默认2小时) → 自动拒绝, 回原状态, 不改服务时间 ─────────
  try {
    const m25s = (await col('order_main').where({ status: 'S2_5' }).limit(BATCH).get()).data || [];
    const mOK = [];
    await Promise.allSettled(m25s.map(async (o) => {
      const pm = o.pending_modify || {};
      const deadline = pm.expire_at || ((o.modify_at || 0) + modifyConfirmH * 3600000);
      if (!deadline || deadline >= now) return;
      const toStatus = pm.from_status === 'S3' ? 'S3' : 'S2';
      const won = await casStatus(o._id, 'S2_5', {
        status: toStatus,
        pending_modify: _.remove(),
        modify_auto_rejected_at: now,
        updated_at: now
      });
      if (!won) { out.skipped.push(o.order_no + ':S2_5竞态'); return; }
      mOK.push({ o, toStatus });
    }));
    await Promise.allSettled(mOK.map(x => logStatus(x.o._id, 'S2_5', x.toStatus, 'timeout_modify_auto_reject', 'system')));
    mOK.forEach(x => { out.modify_auto_reject.push(x.o.order_no); console.log(`timeout S2_5→${x.toStatus} modify auto-reject: ${x.o.order_no}`); });
  } catch (e) { console.log(`s2.5 scan fail: ${e.message}`); }

  // ───────── 3.5 里程碑自动确认:S3 状态提交超 15 分钟未确认 → 全部确认 ─────────
  try {
    const msCut = now - msConfirmMin * 60 * 1000;
    const s3s = (await col('order_main').where({ status: 'S3' }).limit(BATCH).get()).data || [];
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
    msOK.forEach(o => { out.milestone_auto_confirm.push(o.order_no); console.log(`milestone auto-confirm: ${o.order_no}`); });
  } catch (e) { console.log(`milestone auto-confirm fail: ${e.message}`); }

  // ───────── 4. S5 完成超 48 小时未评价 → 系统默认 4 星 → S9 ─────────
  try {
    const eCut = now - evalH * 3600 * 1000;
    const s5s = (await col('order_main').where({ status: 'S5' }).limit(BATCH).get()).data || [];
    const evalResults = [];  // 收集需要写 status_log 的结果
    // creditDeltas: { partner_openid: [{ delta, order_id, order_no }] } 收集后聚合原子 inc
    const creditDeltas = {};
    const starDelta = defaultStar >= 5 ? 2 : defaultStar === 4 ? 1 : defaultStar === 3 ? 0 : defaultStar === 2 ? -2 : -5;

    await Promise.allSettled(s5s.map(async (o) => {
      const anchor = o.service_completed_at || o.updated_at || 0;
      if (anchor >= eCut) return;

      // 幂等: 已有评价记录但订单仍停在 S5(异常兜底) → 直接补转 S8
      const evR = await col('evaluation').where({ order_id: o._id, is_deleted: false }).limit(1).get();
      if (evR.data && evR.data[0]) {
        const won = await casStatus(o._id, 'S5', { status: 'S8', evaluated_at: evR.data[0].created_at || now, updated_at: now });
        if (won) {
          evalResults.push({ o, from: 'S5', to: 'S8', action: 'timeout_eval_backfill' });
          console.log(`backfill S5→S8: ${o.order_no}`);
        }
        return;
      }

      const won = await casStatus(o._id, 'S5', { status: 'S9', evaluated_at: now, updated_at: now });
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
      console.log(`timeout S5→S9 auto-eval: ${o.order_no} star=${defaultStar}`);
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
        } catch (e) { console.log(`auto eval credit fail (${pOpenid}): ${e.message}`); }
      }));
    }
  } catch (e) { console.log(`s5 scan fail: ${e.message}`); }

  return {
    ok: true,
    data: {
      ran_at: now,
      thresholds: { s1_timeout_min: s1Min, interrupt_timeout_h: interruptH, eval_window_h: evalH, default_star: defaultStar, s0_force: s0Force, modify_confirm_h: modifyConfirmH },
      s1_cancel: out.s1_cancel,
      s0_close: out.s0_close,
      interrupt_partial: out.interrupt_partial,
      modify_auto_reject: out.modify_auto_reject,
      milestone_auto_confirm: out.milestone_auto_confirm,
      auto_eval: out.auto_eval,
      skipped: out.skipped,
      counts: {
        s1_cancel: out.s1_cancel.length,
        s0_close: out.s0_close.length,
        interrupt_partial: out.interrupt_partial.length,
        modify_auto_reject: out.modify_auto_reject.length,
        milestone_auto_confirm: out.milestone_auto_confirm.length,
        auto_eval: out.auto_eval.length
      }
    }
  };
};
