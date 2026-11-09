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
      const won = await casStatus(o._id, 'S1', { status: 'S6', updated_at: now, pending_change: _.remove() }, 'cancel');
      if (!won) { out.skipped.push(o.order_no + ':S1竞态'); return; }
      if (o.demand_id) {
        await col('demand').where({ _id: o.demand_id, status: 'matched' }).update({
          data: { status: 'matching', matched_openid: null, updated_at: now }
        }).catch((e) => log.w(`demand release fail(S1) ${o.order_no}: ${(e && e.message) || e}`));
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
    })).then((rs) => { rs.forEach((r) => { if (r.status === 'rejected') log.d(`s1 timeout notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); }); });
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
          data: { status: 'matching', matched_openid: null, updated_at: now }
        }).catch((e) => log.w(`demand release fail(S0) ${o.order_no}: ${(e && e.message) || e}`));
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
    })).then((rs) => { rs.forEach((r) => { if (r.status === 'rejected') log.d(`s0 timeout notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); }); });
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
        complaint_reason: '开始履约确认超时,系统自动转入争议',
        frozen: true, help_flag: true, updated_at: now
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
    })).then((rs) => { rs.forEach((r) => { if (r.status === 'rejected') log.d(`s2_6 dispute notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); }); });
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
        complaint_reason: '履约完毕确认超时,系统自动转入争议',
        frozen: true, help_flag: true, updated_at: now
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
    })).then((rs) => { rs.forEach((r) => { if (r.status === 'rejected') log.d(`s3_6 dispute notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); }); });
    ok.forEach(o => { out.finish_confirm_timeout.push(o.order_no); log.d(`timeout S3_6→S10.5: ${o.order_no}`); });
  } catch (e) { log.d(`s3_6 scan fail: ${e.message}`); }
}

// ── G3(2026-10-20): S2_6/S3_6 待确认窗口「超时前提醒」2 次 ──
// 依据 docs/prd-g3-timeout-reminder-20261019.md(《线下陪伴履约流程规范》§C8「提醒 2 次后转争议」)
//   渠道: 站内信(定时触发云调用订阅必报 -501001); 不新增状态转移、不改超时阈值。
//   幂等: 每档先条件更新订单标记位(仅当字段不存在时写), 抢到才发; 互斥(cancel 挂起/frozen)在纯规则内已跳过。
//   顺序: 本段须排在 processStartApplyTimeout/processFinishConfirmTimeout 之前(同轮内先提醒后超时)。
async function processStartApplyRemind(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, dueRemindStages, now, out, cfg } = ctx;
  try {
    const rows = await scanAll('order_main', () => ({ status: 'S2_6' }));
    trackBacklog('S2_6r', rows.length >= SCAN_MAX ? rows : []);
    const sent = [];
    await Promise.allSettled(rows.map(async (o) => {
      const stages = dueRemindStages(o, now, cfg);
      for (const s of stages) {
        const cond = { _id: o._id, status: 'S2_6' };
        cond[s.markField] = _.exists(false);   // 仅当该档标记位不存在时才抢（幂等防并发重复）
        const patch = { updated_at: now };
        patch[s.markField] = now;
        const upd = await col('order_main').where(cond).update({ data: patch });
        if (!upd.stats || upd.stats.updated !== 1) continue; // 已被抢先标记, 跳过本档
        if (o.user_openid) {
          await col('system_notice').add({ data: {
            to_openid: o.user_openid, order_id: o._id, type: 'remind_' + s.stage,
            title: s.title, body: s.body,
            action_key: 'jump_order', action_payload: { order_id: o._id },
            created_at: now, read: false
          }}).catch(() => {});
        }
        sent.push(o.order_no + ':' + s.stage);
        log.d(`remind ${s.stage} -> user: ${o.order_no}`);
      }
    }));
    out.start_apply_remind.push(...sent);
  } catch (e) { log.d(`s2_6 remind scan fail: ${e.message}`); }
}

async function processFinishConfirmRemind(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, dueRemindStages, now, out, cfg } = ctx;
  try {
    const rows = await scanAll('order_main', () => ({ status: 'S3_6' }));
    trackBacklog('S3_6r', rows.length >= SCAN_MAX ? rows : []);
    const sent = [];
    await Promise.allSettled(rows.map(async (o) => {
      const stages = dueRemindStages(o, now, cfg);
      for (const s of stages) {
        const cond = { _id: o._id, status: 'S3_6' };
        cond[s.markField] = _.exists(false);
        const patch = { updated_at: now };
        patch[s.markField] = now;
        const upd = await col('order_main').where(cond).update({ data: patch });
        if (!upd.stats || upd.stats.updated !== 1) continue;
        if (o.user_openid) {
          await col('system_notice').add({ data: {
            to_openid: o.user_openid, order_id: o._id, type: 'remind_' + s.stage,
            title: s.title, body: s.body,
            action_key: 'jump_order', action_payload: { order_id: o._id },
            created_at: now, read: false
          }}).catch(() => {});
        }
        sent.push(o.order_no + ':' + s.stage);
        log.d(`remind ${s.stage} -> user: ${o.order_no}`);
      }
    }));
    out.finish_confirm_remind.push(...sent);
  } catch (e) { log.d(`s3_6 remind scan fail: ${e.message}`); }
}

// ── ISS-011(2026-10-31): 爽约申诉举证逾期 → 标记逾期 + 升级管理员(不自动裁定) ──
// 口径(N2, 见 _shared/no_show_rules.js defenseDeadlineOf 注释): 逾期不自动关闭、不自动裁定,
//   管理员仍可径行裁定。本段只做两件保守动作:
//   ① 对 status in [received, defense] 且 evidence_deadline < now 的申诉打一次性逾期标记
//      (overdue_escalated_at 作幂等位, 条件更新仅当字段不存在才写, 防并发/重复轮次重复通知);
//   ② 给 admin_openids 发 system_notice 提示运营核实后人工裁定; 不改申诉状态、不动订单、不扣分。
// 注: 状态常量与 _shared/no_show_rules.js REPORT_STATUS 同值(received/defense);
//   微信云开发单函数目录打包禁跨目录 require, 故此处内联。
const NS_OPEN_STATUSES = ['received', 'defense'];
async function processNoShowDefenseOverdue(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, now, out, adminOpenids } = ctx;
  try {
    const rows = await scanAll('no_show_report', () => ({
      status: _.in(NS_OPEN_STATUSES),
      evidence_deadline: _.lt(now),
      overdue_escalated_at: _.exists(false),
      is_deleted: _.neq(true)
    }));
    trackBacklog('no_show_report', rows.length >= SCAN_MAX ? rows : []);
    const marked = [];
    await Promise.allSettled(rows.map(async (r) => {
      if (!(r.evidence_deadline && r.evidence_deadline < now)) return;
      // 幂等: 仅当逾期标记位不存在时抢到, 已被标记(含并发轮次)则跳过
      const upd = await col('no_show_report').where({ _id: r._id, overdue_escalated_at: _.exists(false) })
        .update({ data: { overdue_escalated_at: now, updated_at: now } });
      if (!upd.stats || upd.stats.updated !== 1) return;
      marked.push(r);
      // 仅站内信(定时器无小程序上下文, 云调用订阅消息必报 -501001); 收件人=管理员
      const rsOverdue = await Promise.allSettled((adminOpenids || []).map((openid) => col('system_notice').add({ data: {
        to_openid: openid, order_id: r.order_id || '', type: 'no_show_overdue',
        title: '爽约申诉举证逾期,待裁定',
        body: '举证窗口已过,请运营核实后裁定(可径行裁定,系统不自动裁决)',
        action_key: '', action_payload: { report_id: r._id },
        created_at: now, read: false
        }})));
      rsOverdue.forEach((x) => { if (x.status === 'rejected') log.d(`no_show overdue notice fail: ${(x.reason && (x.reason.message || x.reason)) || ''}`); });
    }));
    out.no_show_overdue.push(...marked.map((r) => r._id));
    marked.forEach((r) => log.d(`no_show overdue escalate: ${r._id}`));
  } catch (e) { log.d(`no_show overdue scan fail: ${e.message}`); }
}

// ── 批2(2026-11-01): 到点未履约 → 提醒双方"可提交爽约申诉"(只提醒, 不判定) ──
// 缺口: 申诉窗口=约定开始后 no_show_report_window_h(默认 48h), 但此前只有"对方已提交申诉"才有通知
//   (order-action action_dispute 给被诉方发举证提醒), 受害方无人提醒 ⇒ 错过窗口.
// 口径: 仅 status='S2'(已支付未开始) 且 start_time 已过 grace 分钟; 不改状态/不冻结/不扣分/不自动裁定;
//   幂等位 no_show_guide_at(条件更新抢到才发, 与 ISS-011 overdue_escalated_at 同一范式, 一生仅一次).
async function processNoShowGuide(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, now, out, noShowGraceMin, cfg, num } = ctx;
  try {
    const graceMin = noShowGraceMin > 0 ? noShowGraceMin : 30;
    const cut = now - graceMin * 60 * 1000;
    // 只提醒"刚过点"的单: 下界锚定申诉窗口(no_show_report_window_h, 默认 48h) ——
    //   超出申诉窗口的历史 S2 单再提醒已无意义(且会误报"已过 30 分钟"), 一律不发。
    const winH = num(cfg && cfg.no_show_report_window_h, 48);
    const floor = cut - winH * 60 * 60 * 1000;
    const rows = await scanAll('order_main', () => ({
      status: 'S2',
      start_time: _.gte(floor).and(_.lt(cut)),
      no_show_guide_at: _.exists(false),
      frozen: _.neq(true),
      is_deleted: _.neq(true)
    }));
    trackBacklog('order_main', rows.length >= SCAN_MAX ? rows : []);
    const sent = [];
    await Promise.allSettled(rows.map(async (o) => {
      if (!(o.start_time && o.start_time < cut && o.start_time >= floor)) return; // 二次守卫
      const upd = await col('order_main').where({ _id: o._id, no_show_guide_at: _.exists(false) })
        .update({ data: { no_show_guide_at: now, updated_at: now } });
      if (!upd.stats || upd.stats.updated !== 1) return; // 已被并发轮次提醒过 → 跳过
      // 双方各 1 条中性文案(不指名谁爽约); 定时器无小程序上下文, 只发站内信
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      const rsGuide = await Promise.allSettled(receivers.map((openid) => col('system_notice').add({ data: {
        to_openid: openid, order_id: o._id, type: 'no_show_guide',
        title: '已过约定开始时间',
        body: `约定时间已过 ${graceMin} 分钟。若对方未到场，可在申诉时限内提交爽约申诉，平台会核实处理`,
        action_key: 'jump_order', action_payload: { order_id: o._id },
        created_at: now, read: false
        }})));
      rsGuide.forEach((x) => { if (x.status === 'rejected') log.d(`no_show guide notice fail: ${(x.reason && (x.reason.message || x.reason)) || ''}`); });
      sent.push(o.order_no || o._id);
      log.d(`no_show guide -> ${o.order_no || o._id}`);
    }));
    out.no_show_guide.push(...sent);
  } catch (e) { log.d(`no_show guide scan fail: ${e.message}`); }
}

module.exports = {
  processS1Timeout,
  processS0Timeout,
  processStartApplyTimeout,
  processFinishConfirmTimeout,
  processStartApplyRemind,
  processFinishConfirmRemind,
  processNoShowDefenseOverdue,
  processNoShowGuide,
};
