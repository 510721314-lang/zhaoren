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
const log = require('./logger');

const BATCH = 50; // 单次每类状态最多处理笔数, 防止超时

async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) return r.data;   // doc().get() 返回单个对象(非数组)
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

// ───────── error_scan 巡检(D7): 聚合窗口内异常 → 推管理员 system_notice ─────────
// 窗口 = 上次扫描以来(admin_config.error_scan_last_at; 缺省回看 1h, 单次最多 24h 防首次轰炸)。
// 游标推进天然去重: 持续存在的旧异常只在进入窗口那一刻报一次, 不逐 5 分钟重复轰炸。
// 巡检项: ①P0/P1 平台事件 ②audit_log result=fail ③卡死提现(processing 超 48h) ④网关鉴权失败突增(窗口≥3 次, 防单次误输噪声)
async function errorScan(now, cfg, adminOpenids) {
  const lastAt = Number(cfg.error_scan_last_at) || now - 3600 * 1000;
  const windowStart = Math.max(lastAt, now - 24 * 3600 * 1000);
  const issues = {};
  // 1. P0/P1 平台事件
  try {
    const r = await col('platform_event').where({ level: _.in(['P0', 'P1']), created_at: _.gt(windowStart) })
      .orderBy('created_at', 'asc').limit(50).get();
    const list = r.data || [];
    if (list.length) issues.platform_events = list.map((e) => `${e.level}/${e.type}`);
  } catch (e) { log.d(`error_scan platform_event fail: ${e.message}`); }
  // 2. 审计失败(写操作失败留证; 集中突增通常意味着资金/鉴权链路异常)
  try {
    const r = await col('audit_log').where({ result: 'fail', at: _.gt(windowStart) }).count();
    if ((r.total || 0) > 0) issues.audit_fails = r.total;
  } catch (e) { log.d(`error_scan audit_log fail: ${e.message}`); }
  // 3. 卡死提现: processing 超 48h(mock T+1 到账回写依赖钱包入口触发, 超时即链路异常)
  try {
    const r = await col('withdraw_record')
      .where({ status: 'processing', created_at: _.lt(now - 48 * 3600 * 1000), is_deleted: false }).count();
    if ((r.total || 0) > 0) issues.stuck_withdrawals = r.total;
  } catch (e) { log.d(`error_scan withdraw fail: ${e.message}`); }
  // 4. 网关鉴权失败突增: admin-web 对 bad_key/missing_key 拒绝时写 platform_event(P2, type=gateway_bad_key)
  //    聚合窗口内次数, ≥3 才报(单次误输/端口扫描噪声不轰炸); 连续突增通常意味着密钥泄露或被暴力尝试
  try {
    const r = await col('platform_event').where({ type: 'gateway_bad_key', created_at: _.gt(windowStart) }).count();
    const gwN = r.total || 0;
    if (gwN >= 3) issues.gateway_bad_keys = gwN;
  } catch (e) { log.d(`error_scan gateway fail: ${e.message}`); }

  const issueCount = (issues.platform_events ? issues.platform_events.length : 0)
    + (issues.audit_fails || 0) + (issues.stuck_withdrawals || 0) + (issues.gateway_bad_keys || 0);
  if (issueCount > 0 && adminOpenids.length) {
    const body = [
      issues.platform_events ? `P0/P1事件 ${issues.platform_events.length} 条: ${issues.platform_events.slice(0, 5).join(', ')}` : '',
      issues.audit_fails ? `审计失败 ${issues.audit_fails} 条` : '',
      issues.stuck_withdrawals ? `卡死提现(>48h在途) ${issues.stuck_withdrawals} 笔` : '',
      issues.gateway_bad_keys ? `网关鉴权失败突增 ${issues.gateway_bad_keys} 次` : ''
    ].filter(Boolean).join('; ');
    await Promise.allSettled(adminOpenids.map((openid) => col('system_notice').add({ data: {
      to_openid: openid, order_id: '', type: 'error_scan',
      title: `巡检报告: 发现 ${issueCount} 条异常`,
      body,
      action_key: '', action_payload: {},
      created_at: now, read: false
    }})));
  }
  // 游标推进(无论有无异常) + 心跳: 供门禁自观测「巡检是否在跑」(观测断层补丁, 见 docs/verification/tech-review-20261006.md P1)
  await col('admin_config').doc('global').update({ data: { error_scan_last_at: now, error_scan_heartbeat_at: now, updated_at: now } }).catch(() => {});
  return { issue_count: issueCount, issues };
}

// ───────── audit_log 留存清理(P2): 每日 UTC 19 点(≈北京 03:00)删除 90 天前 audit_log ─────────
// 幂等: admin_config.audit_prune_last_day 记已执行 UTC 日期, 同一天只清一次(定时器每 5 分钟可能命中多次 19 点档)。
// 安全: 默认 dry-run 只统计(admin_config.audit_prune_dry_run 缺省 true); 人工确认数量合理后经 config_set 置 false 才真删。
// 真删: 分页取 _id 批量删, 单次上限 5000 防跑飞。
const PRUNE_DAYS = 90;
const PRUNE_CAP = 5000;
async function auditPrune(now, cfg) {
  const gmtHour = new Date(now).getUTCHours();
  if (gmtHour !== 19) return { pruned: 0, dry_run: null, matched: 0, skipped: 'not_utc19' };
  const dayKey = new Date(now).toISOString().slice(0, 10);
  if (cfg.audit_prune_last_day === dayKey) return { pruned: 0, dry_run: null, matched: 0, skipped: 'already_today' };
  const cutoff = now - PRUNE_DAYS * 86400000;
  const dryRun = cfg.audit_prune_dry_run !== false; // 缺省 dry-run(不删)
  let matched = 0;
  try {
    const cnt = await col('audit_log').where({ at: _.lt(cutoff) }).count();
    matched = cnt.total || 0;
  } catch (e) { log.d(`auditPrune count fail: ${e.message}`); }
  if (dryRun) {
    // dry-run 不记 last_day, 置 false 后下一个 UTC 19 点档立即真删
    return { pruned: 0, dry_run: true, matched, skipped: '' };
  }
  let pruned = 0;
  try {
    while (pruned < PRUNE_CAP) {
      const r = await col('audit_log').where({ at: _.lt(cutoff) }).limit(100).get();
      const list = r.data || [];
      if (!list.length) break;
      await Promise.allSettled(list.map((d) => col('audit_log').doc(d._id).remove()));
      pruned += list.length;
      if (list.length < 100) break;
    }
  } catch (e) { log.d(`auditPrune delete fail: ${e.message}`); }
  await col('admin_config').doc('global').update({ data: { audit_prune_last_day: dayKey, updated_at: now } }).catch(() => {});
  return { pruned, dry_run: false, matched, skipped: '' };
}

exports.main = async (event, context) => {
  const { resolveOpenid, warmEnv } = require('./openid');
  await warmEnv(cloud); // 环境门控日志预热

  // ── 鉴权: 仅定时触发器或管理员可调 ──
  const wxCtx = cloud.getWXContext();
  const isTimer = !!(context && context.TRIGGER_NAME);
  const openid = await resolveOpenid(cloud, event);
  const cfg = await getConfig();
  const adminOpenids = cfg.admin_openids || [];
  const isAdmin = !!openid && adminOpenids.indexOf(openid) >= 0;

  if (!isTimer && !isAdmin) {
    return { ok: false, code: 'ot_forbidden', msg: '无权限, 仅定时器或管理员可调用' };
  }

  // 管理员手动触发时可传 action=run 表明意图(默认也放行, 但拒绝其他 action)
  if (event.action && event.action !== 'run') {
    return { ok: false, code: 'ot_unknown_action', msg: '未知动作, 定时器或传 action=run' };
  }

  // 阈值一律只读 admin_config, 拒绝 event 覆盖(防恶意篡改超时窗口)
  const now = Date.now();

  // ── 注错演练(D7, 仅管理员): 写入一条 P1 演练事件 → 本次巡检立即捕获并推送, 验证巡检链路 ──
  if (event.drill && isAdmin) {
    try {
      await col('platform_event').add({ data: {
        level: 'P1', type: 'error_scan_drill', openid: openid || 'unknown',
        payload: { drill: true, at: now },
        created_at: now, updated_at: now, is_deleted: false
      }});
      log.d('error_scan drill event injected');
    } catch (e) { log.d(`drill inject fail: ${e.message}`); }
  }
  const s1Min = num(cfg.s1_timeout_min, 15);
  const interruptH = num(cfg.interrupt_timeout_h, 24);
  const evalH = num(cfg.eval_window_h, 48);
  const defaultStar = num(cfg.default_star, 4);
  const msConfirmMin = num(cfg.milestone_confirm_min, 15); // 里程碑提交后自动确认时限(分钟)
  // 改期确认时限: 统一读 admin_config.modify_config.confirmHours(与 order-action 创建时算死 expire_at 同一口径)
  // 不再读独立键 modify_confirm_h(admin-action 白名单已移除, 存量历史无 expire_at 的订单仍走此兜底)
  const mcDefaults = { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 };
  const modifyConfirmH = num(Object.assign({}, mcDefaults, cfg.modify_config || {}).confirmHours, 24);

  const out = { s1_cancel: [], s0_close: [], interrupt_partial: [], modify_auto_reject: [], milestone_auto_confirm: [], auto_eval: [], skipped: [] };
  log.d(`order-timer run: s1=${s1Min}min interrupt=${interruptH}h eval=${evalH}h star=${defaultStar} mode=${isTimer ? 'timer' : 'admin'}`);

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

  // ───────── 2. S0 待支付超时(pay_expire_at 已过) → S6 ─────────
  try {
    const q = { status: 'S0', pay_expire_at: _.lt(now) };
    const s0s = (await col('order_main').where(q).limit(BATCH).get()).data || [];
    const s0OK = [];
    await Promise.allSettled(s0s.map(async (o) => {
      if (!(o.pay_expire_at && o.pay_expire_at < now)) return;
      const won = await casStatus(o._id, 'S0', { status: 'S6', updated_at: now });
      if (!won) { out.skipped.push(o.order_no + ':S0竞态'); return; }
      s0OK.push(o);
    }));
    await Promise.allSettled(s0OK.map(o => logStatus(o._id, 'S0', 'S6', 'timeout_s0_close', 'system')));
    // 通知双方: 支付超时自动取消
    await Promise.allSettled(s0OK.flatMap(o => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid, order_id: o._id, type: 'timeout_cancel',
        title: '支付超时,订单已取消',
        body: '未在30分钟内完成支付,订单已自动取消',
        action_key: 'jump_order', action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    s0OK.forEach(o => { out.s0_close.push(o.order_no); log.d(`timeout S0→S6: ${o.order_no}`); });
  } catch (e) { log.d(`s0 scan fail: ${e.message}`); }

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
    // 通知双方: 改期超时自动拒绝, 服务时间不变(发起人/接收人文案区分)
    await Promise.allSettled(mOK.flatMap(x => {
      const o = x.o;
      const pm = o.pending_modify || {};
      const notices = [];
      const receivers = [
        { openid: o.user_openid, role: 'user' },
        { openid: o.partner_openid, role: 'partner' }
      ].filter(r => r.openid);
      receivers.forEach(r => {
        const isProposer = pm.by_openid && r.openid === pm.by_openid;
        notices.push(col('system_notice').add({ data: {
          to_openid: r.openid,
          order_id: o._id,
          type: 'modify_reject',
          title: '改期申请已超时拒绝',
          body: isProposer
            ? '你的改期申请因对方超时未确认,已自动拒绝,服务时间不变'
            : '对方发起的改期申请已超时自动拒绝,服务时间不变',
          action_key: 'jump_order',
          action_payload: { order_id: o._id },
          created_at: now, read: false
        }}));
      });
      return notices;
    }));
    mOK.forEach(x => { out.modify_auto_reject.push(x.o.order_no); log.d(`timeout S2_5→${x.toStatus} modify auto-reject: ${x.o.order_no}`); });
  } catch (e) { log.d(`s2.5 scan fail: ${e.message}`); }

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
    msOK.forEach(o => { out.milestone_auto_confirm.push(o.order_no); log.d(`milestone auto-confirm: ${o.order_no}`); });
  } catch (e) { log.d(`milestone auto-confirm fail: ${e.message}`); }

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
          log.d(`backfill S5→S8: ${o.order_no}`);
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

  // ───────── 5. error_scan 巡检(D7) ─────────
  let errorScanResult = null;
  try { errorScanResult = await errorScan(now, cfg, adminOpenids); }
  catch (e) { log.d(`error_scan fail: ${e.message}`); }

  // ───────── 6. audit_log 留存清理(P2, 每日 UTC 19 点, 默认 dry-run) ─────────
  let auditPruneResult = null;
  try { auditPruneResult = await auditPrune(now, cfg); }
  catch (e) { log.d(`audit_prune fail: ${e.message}`); }

  return {
    ok: true,
    data: {
      ran_at: now,
      error_scan: errorScanResult,
      audit_prune: auditPruneResult,
      thresholds: { s1_timeout_min: s1Min, interrupt_timeout_h: interruptH, eval_window_h: evalH, default_star: defaultStar, milestone_confirm_min: msConfirmMin, modify_confirm_h: modifyConfirmH },
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
