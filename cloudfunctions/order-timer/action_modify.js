// action_modify.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

async function processModifyTimeout(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, logStatus, casStatus, now, out, modifyConfirmMin } = ctx;
  // ───────── 3.6 S2.5 改期确认超时(默认 10 分钟) → 自动拒绝, 回原状态, 不改服务时间 ─────────
  try {
    const m25s = await scanAll('order_main', () => ({ status: 'S2_5' }));
    trackBacklog('S2_5', m25s.length >= SCAN_MAX ? m25s : []);
    const mOK = [];
    await Promise.allSettled(m25s.map(async (o) => {
      const pm = o.pending_modify || {};
      const deadline = pm.expire_at || ((o.modify_at || 0) + modifyConfirmMin * 60000);
      if (!deadline || deadline >= now) return;
      // 存量兼容(2026-10-07 口径), 勿删此分支: 新发起的改期 from_status 只会是 'S2';
      // 原 S3 发起的在途申请(from_status='S3')保留回退 S3, 按原逻辑走完(不追溯, 避免卡死)
      const toStatus = pm.from_status === 'S3' ? 'S3' : 'S2';
      const won = await casStatus(o._id, 'S2_5', {
        status: toStatus,
        pending_modify: _.remove(),
        modify_auto_rejected_at: now,
        updated_at: now
      }, 'modify');
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
    })).then((rs) => { rs.forEach((r) => { if (r.status === 'rejected') log.d(`modify_reject notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); }); });
    mOK.forEach(x => { out.modify_auto_reject.push(x.o.order_no); log.d(`timeout S2_5→${x.toStatus} modify auto-reject: ${x.o.order_no}`); });
  } catch (e) { log.d(`s2.5 scan fail: ${e.message}`); }
}

async function processExtendTimeout(ctx) {
  const { _, col, log, trackBacklog, SCAN_MAX, scanAll, logStatus, now, out, extendConfirmMin } = ctx;
  // ───────── 3.7 S3 加时申请 expire_at 到期 → 自动拒绝(不加时, 服务时长不变) ─────────
  // 承诺来源: 详情页「…超时自动拒绝」+ 状态机 no.11 timeout 列; 期限以申请时写入的 expire_at 为准
  try {
    const s3s = await scanAll('order_main', () => ({ status: 'S3' }));
    trackBacklog('S3_extend', s3s.length >= SCAN_MAX ? s3s : []);   // 仅取满单轮上限才算积压
    const eOK = [];
    await Promise.allSettled(s3s.map(async (o) => {
      const pe = o.pending_extend;
      if (!pe) return;
      if (o.frozen) return;   // 争议/申诉冻结中不推进
      const deadline = pe.expire_at || ((pe.created_at || o.updated_at || 0) + extendConfirmMin * 60000);
      if (!deadline || deadline >= now) return;
      // 加时的确认/拒绝都「不改 status」(仍 S3), 仅靠 status 无法区分「刚被对方处理」与「超时」→ 需乐观锁。
      // 批1.4: 首选申请时写入的顶层 pending_extend_token 精确锁定本次申请(不受其他写操作刷新 updated_at 干扰);
      // 历史无 token 的在途申请回退 updated_at 等价条件(对方一旦处理就刷新它 → 本条件更新落空 → 留待对方结果生效)。
      const tok = Number(o.pending_extend_token) || 0;
      const r = await col('order_main')
        .where(tok
          ? { _id: o._id, status: 'S3', pending_extend_token: tok }
          : { _id: o._id, status: 'S3', updated_at: o.updated_at })
        .update({ data: { pending_extend: _.remove(), pending_extend_token: 0, extend_auto_rejected_at: now, updated_at: now } });
      if (!r.stats || r.stats.updated !== 1) { out.skipped.push(o.order_no + ':S3加时竞态'); return; }
      eOK.push({ o, pe });
    }));
    await Promise.allSettled(eOK.map(x => logStatus(x.o._id, 'S3', 'S3', 'timeout_extend_auto_reject', 'system')));
    // 只通知发起人(与手动拒绝口径一致); type 必须是 extend_reject —— 详情页 8s notice_poll 命中即震动+弹窗
    const rsExtend = await Promise.allSettled(eOK.filter(x => x.pe.by_openid).map(x => col('system_notice').add({ data: {
      to_openid: x.pe.by_openid,
      order_id: x.o._id,
      type: 'extend_reject',
      title: '加时申请已超时自动拒绝',
      body: '你的加时申请因对方超时未确认,已自动拒绝,服务时长不变',
      action_key: 'jump_order',
      action_payload: { order_id: x.o._id },
      created_at: now, read: false
    }})));
    rsExtend.forEach((r) => { if (r.status === 'rejected') log.d(`extend_reject notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); });
    eOK.forEach(x => { out.extend_auto_reject.push(x.o.order_no); log.d(`timeout S3 extend auto-reject: ${x.o.order_no}`); });
  } catch (e) { log.d(`s3 extend scan fail: ${e.message}`); }
}

// ───────── 3.7 S1 变更协商超时(2026-11-04)：对方逾时未反馈 → 自动拒绝，值不变、8 位确认保留 ─────────
async function processChangeTimeout(ctx) {
  const { _, col, log, logStatus, trackBacklog, SCAN_MAX, scanAll, now, out } = ctx;
  try {
    const s1s = await scanAll('order_main', () => ({ status: 'S1', pending_change: _.exists(true) }));
    trackBacklog('S1_change', s1s.length >= SCAN_MAX ? s1s : []);
    const okList = [];
    await Promise.allSettled(s1s.map(async (o) => {
      const pc = o.pending_change || {};
      const deadline = Number(pc.expire_at) || 0;
      if (!deadline || deadline >= now) return;
      // token 精确锁定本次申请，避免与对方刚提交的接受/拒绝竞态
      const r = await col('order_main')
        .where({ _id: o._id, status: 'S1', 'pending_change.token': pc.token })
        .update({ data: { pending_change: _.remove(), change_auto_rejected_at: now, updated_at: now } });
      if (!r.stats || r.stats.updated !== 1) { out.skipped.push(o.order_no + ':S1变更竞态'); return; }
      okList.push({ o, pc });
    }));
    // 2026-11-04: 超时自动拒绝留状态流水(S1→S1, 系统口径; 与 S3 加时超时同款, 不写 audit_log 避免断开审计哈希链)
    await Promise.allSettled(okList.map(x => logStatus(x.o._id, 'S1', 'S1', 'timeout_change_auto_reject', 'system')));
    // 通知双方(发起人/接收人文案区分)；type=change_reject 供详情页 notice_poll 命中震动
    const rs = await Promise.allSettled(okList.flatMap(({ o, pc }) => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid,
        order_id: o._id,
        type: 'change_reject',
        title: '变更申请已超时拒绝',
        body: openid === pc.by_openid
          ? '你的变更申请因对方超时未反馈,已自动拒绝,原内容不变'
          : '对方的变更申请已超时自动拒绝,原内容不变',
        action_key: 'jump_order',
        action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    rs.forEach((r) => { if (r.status === 'rejected') log.d(`change_reject notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); });
    okList.forEach(({ o, pc }) => { out.change_auto_reject.push(o.order_no); log.d(`timeout S1 change auto-reject: ${o.order_no} field=${pc.field}`); });
  } catch (e) { log.d(`s1 change scan fail: ${e.message}`); }
}

// ───────── 3.8 S2 已支付待履约「地点/内容」变更超时(2026-11-05)：对方逾时未反馈 → 自动拒绝，值不变 ─────────
// 与 S1 段的差别：只处理 stage='S2' 的 pending_change，避免与 S1 在途变更串扫；
// 订单状态保持 S2（不变状态、不动确认位），仅清字段 + 双向通知 + 写状态流水。
async function processS2ChangeTimeout(ctx) {
  const { _, col, log, logStatus, trackBacklog, SCAN_MAX, scanAll, now, out } = ctx;
  try {
    const s2s = await scanAll('order_main', () => ({ status: 'S2', pending_change: _.exists(true) }));
    trackBacklog('S2_change', s2s.length >= SCAN_MAX ? s2s : []);
    const okList = [];
    await Promise.allSettled(s2s.map(async (o) => {
      const pc = o.pending_change || {};
      if (pc.stage !== 'S2') return;
      const deadline = Number(pc.expire_at) || 0;
      if (!deadline || deadline >= now) return;
      const r = await col('order_main')
        .where({ _id: o._id, status: 'S2', 'pending_change.token': pc.token })
        .update({ data: { pending_change: _.remove(), s2_change_auto_rejected_at: now, updated_at: now } });
      if (!r.stats || r.stats.updated !== 1) { out.skipped.push(o.order_no + ':S2变更竞态'); return; }
      okList.push({ o, pc });
    }));
    await Promise.allSettled(okList.map(x => logStatus(x.o._id, 'S2', 'S2', 'timeout_s2_change_auto_reject', 'system')));
    const rs = await Promise.allSettled(okList.flatMap(({ o, pc }) => {
      const receivers = [o.user_openid, o.partner_openid].filter(Boolean);
      return receivers.map(openid => col('system_notice').add({ data: {
        to_openid: openid,
        order_id: o._id,
        type: 'change_reject',
        title: '变更申请已超时拒绝',
        body: openid === pc.by_openid
          ? '你的变更申请因对方超时未反馈,已自动拒绝,请按原信息履约'
          : '对方的变更申请已超时自动拒绝,请按原信息履约',
        action_key: 'jump_order',
        action_payload: { order_id: o._id },
        created_at: now, read: false
      }}));
    }));
    rs.forEach((r) => { if (r.status === 'rejected') log.d(`s2_change_reject notice fail: ${(r.reason && (r.reason.message || r.reason)) || ''}`); });
    okList.forEach(({ o, pc }) => { out.s2_change_auto_reject.push(o.order_no); log.d(`timeout S2 change auto-reject: ${o.order_no} field=${pc.field}`); });
  } catch (e) { log.d(`s2 change scan fail: ${e.message}`); }
}

module.exports = {
  processModifyTimeout,
  processExtendTimeout,
  processChangeTimeout,
  processS2ChangeTimeout,
};
