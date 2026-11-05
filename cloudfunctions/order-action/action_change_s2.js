// order-action · S2 已支付待履约阶段「地点/内容」变更协商（2026-11-05 新增）
// 口径（用户 2026-11-05 拍板）：
//   - 仅 S2 可发起；费用与时间一律不在本通道（时间走 pending_modify 改期、费用禁止）
//   - T = start_time - now：T > A(默认2h) → A 窗；B(默认1h) ≤ T ≤ A → B 窗；T < B → 禁止
//   - A 窗确认窗口 min(A确认分钟, start_time-15min)；B 窗 min(B确认分钟, start_time-15min)
//   - 次数：每项 / 全单 可后台配；发起即计入（拒绝/超时同样消耗）
//   - 接受即双方达成一致：变更项写新值并置双确认，其余确认位保持原状（不重置）
// 共享符号经 ctx 注入，禁 require('./index')。
const S2_CHANGE_FIELDS = ['location', 'content'];

function valueText(field, v) {
  if (field === 'location') return String((v && v.name) || '').slice(0, 20);
  if (field === 'content') return (Array.isArray(v) ? v.join('/') : String(v || '')).slice(0, 20);
  return String(v || '').slice(0, 20);
}
function newToken(now) { return String(now) + '-' + Math.random().toString(36).slice(2, 8); }
function currentValue(order, field) {
  if (field === 'location') return order.location || null;
  if (field === 'content') return order.content_options || [];
  return null;
}
// 新旧值等价判断（数组排序后比较，避免勾选顺序不同被误判为已变更）
function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a.slice().sort() : [];
    const y = Array.isArray(b) ? b.slice().sort() : [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
  }
  return false;
}
// 后台可配项（admin_config.modify_config），全部带安全兜底
function s2Cfg(config) {
  const m = (config && config.modify_config) || {};
  const num = (v, d) => { const n = Number(v); return (isFinite(n) && n >= 0) ? n : d; };
  const bMinH = num(m.s2ChangeBMinHours, 1);
  return {
    enabled: m.s2ChangeEnabled === undefined ? true : Number(m.s2ChangeEnabled) === 1,
    bMinH,
    aMinH: Math.max(bMinH, num(m.s2ChangeAMinHours, 2)),
    aConfirmMin: Math.min(1440, Math.max(1, num(m.s2ChangeAConfirmMin, 120))),
    bConfirmMin: Math.min(1440, Math.max(1, num(m.s2ChangeBConfirmMin, 15))),
    perFieldMax: num(m.s2ChangePerFieldMax, 1),
    totalMax: num(m.s2ChangeTotalMax, 2)
  };
}
// 值校验：地点需 name+经纬度；内容需非空数组（与 S1 同口径）
function validateValue(field, value) {
  if (field === 'location') {
    if (!value || !value.name || !value.latitude || !value.longitude) {
      return { ok: false, code: 'oa_s2c_location_invalid', msg: '地点信息不完整' };
    }
    return { ok: true };
  }
  if (!Array.isArray(value) || !value.length) {
    return { ok: false, code: 'oa_s2c_content_invalid', msg: '服务内容格式有误' };
  }
  return { ok: true };
}

// ── 发起变更：s2_change_apply ───────────────────────────────────────────
async function s2_change_apply(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, getConfig, col, _, log, writeAudit, checkText,
    BLOCK_WORDS_FALLBACK, writeNotice, FIELD_CN, db, wxCtx, reasonMaxLen } = ctx;
  const { field, value, reason } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (S2_CHANGE_FIELDS.indexOf(field) < 0) {
    return { ok: false, code: 'oa_s2c_field', msg: '已支付订单仅支持变更「地点」「内容」' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S2') {
    return { ok: false, code: 'oa_s2c_status', msg: '订单当前状态不可发起变更' };
  }
  if (isFrozen(order)) return { ok: false, code: 'oa_frozen', msg: '订单争议处理中，暂不可变更' };

  const config = await getConfig();
  const c = s2Cfg(config);
  if (!c.enabled) return { ok: false, code: 'oa_s2c_off', msg: '该阶段变更功能未开启' };

  // 单订单仅一条在途变更；改期(S2_5)/开始履约(S2_6) 由 status 拦截，这里再兜底残留字段
  if (order.pending_change) {
    return { ok: false, code: 'oa_s2c_busy',
      msg: order.pending_change.by_openid === openid ? '你有一条变更待对方反馈' : '对方正在申请变更，请先处理' };
  }
  if (order.pending_modify || order.pending_extend) {
    return { ok: false, code: 'oa_s2c_busy', msg: '当前有在途的改期/加时申请，请先处理' };
  }

  const now = Date.now();
  const startTime = Number(order.start_time) || 0;
  const T = startTime - now;
  // 时间窗：T < B 禁止；T > A 为 A 窗；其余为 B 窗
  if (T < c.bMinH * 3600000) {
    return { ok: false, code: 'oa_s2c_blocked', msg: '临近履约时间，请按原信息履约或申请取消订单' };
  }
  const win = T > c.aMinH * 3600000 ? 'A' : 'B';
  const confirmMin = win === 'A' ? c.aConfirmMin : c.bConfirmMin;

  // 频率上限（发起即计数，拒绝/超时同样消耗）
  const counts = order.s2_change_counts || {};
  if ((counts._total || 0) >= c.totalMax) {
    return { ok: false, code: 'oa_s2c_limit', msg: `本单变更次数已达上限(${c.totalMax}次)` };
  }
  if ((counts[field] || 0) >= c.perFieldMax) {
    return { ok: false, code: 'oa_s2c_limit', msg: `「${FIELD_CN[field] || field}」变更次数已达上限(${c.perFieldMax}次)` };
  }

  const rv = validateValue(field, value);
  if (!rv.ok) return rv;

  const oldValue = currentValue(order, field);
  if (sameValue(oldValue, value)) {
    return { ok: false, code: 'oa_s2c_same', msg: '与原内容相同，无需提交变更' };
  }

  // 原因必填 ≥10 字（临期变更留痕，便于客服追溯）
  const max = reasonMaxLen(config);
  const reasonTxt = String(reason || '').trim().slice(0, max);
  if (reasonTxt.length < 10) {
    return { ok: false, code: 'oa_s2c_reason', msg: '请填写变更原因(不少于 10 字)' };
  }

  // 内容为自由文本，必须过内容安全检测
  if (field === 'content') {
    const chk = await checkText(openid, value.join('/'), BLOCK_WORDS_FALLBACK);
    if (!chk.pass) return { ok: false, code: 'oa_content_blocked', msg: chk.reason || '内容不合规' };
  }

  // 确认窗口不晚于履约前 15 分钟，避免挂起跨过履约时间
  const expireAt = Math.min(now + confirmMin * 60000, startTime - 15 * 60000);
  if (expireAt <= now) {
    return { ok: false, code: 'oa_s2c_window_closed', msg: '距履约时间过近，已无法发起变更' };
  }

  const token = newToken(now);
  const pending = {
    stage: 'S2',
    field,
    old_value: oldValue,
    new_value: value,
    by_openid: openid,
    by_role: role,
    reason: reasonTxt,
    created_at: now,
    expire_at: expireAt,
    window: win,
    token
  };
  const nextCounts = Object.assign({}, counts, { _total: (counts._total || 0) + 1 });
  nextCounts[field] = (counts[field] || 0) + 1;

  // 并发保护：无在途变更、无改期/加时才写入
  let won = false;
  try {
    const r = await col('order_main').where({
      _id: order_id, status: 'S2',
      pending_change: _.exists(false),
      pending_modify: _.exists(false),
      pending_extend: _.exists(false)
    }).update({ data: { pending_change: pending, s2_change_counts: nextCounts, updated_at: now } });
    won = !!(r.stats && r.stats.updated === 1);
  } catch (e) {
    log.d(`s2_change_apply fail: ${e.message}`);
    return { ok: false, code: 'oa_update_fail', msg: '发起变更失败,请稍后重试' };
  }
  if (!won) return { ok: false, code: 'oa_conflict', msg: '订单刚被对方更新,请刷新后重试' };

  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_s2_change_apply',
    target_type: 'order', target_id: order_id,
    detail: { field, old_value: pending.old_value, new_value: value, window: win, expire_at: expireAt },
    result: 'ok', client_ip: clientIp, device });

  const to = role === 'user' ? order.partner_openid : order.user_openid;
  await writeNotice({
    to_openid: to, order_id, type: 'change_apply',
    title: '对方申请变更',
    body: `对方申请变更「${FIELD_CN[field] || field}」为 ${valueText(field, value)}，请在 ${Math.round((expireAt - now) / 60000)} 分钟内反馈`,
    action_key: 'jump_chat', action_payload: { order_id }
  });
  log.d(`s2 change apply: order=${order.order_no} field=${field} by=${role} win=${win} expire=${expireAt}`);
  return { ok: true, data: { field, expire_at: expireAt, token, window: win } };
}

// ── 对方反馈：s2_change_respond（accept / reject / 超时收口）───────────────
async function s2_change_respond(ctx) {
  const { event, order_id, openid, getOrder, roleOf, col, _, log, writeAudit, getConfirmation,
    writeNotice, FIELD_CN, db, wxCtx } = ctx;
  const { decision, token } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (decision !== 'accept' && decision !== 'reject') {
    return { ok: false, code: 'oa_bad_decision', msg: '反馈只能是 接受/拒绝' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S2') {
    return { ok: false, code: 'oa_s2c_status', msg: '订单当前状态不可处理变更' };
  }
  const pc = order.pending_change;
  if (!pc) return { ok: false, code: 'oa_s2c_none', msg: '当前没有待处理的变更' };
  if (pc.stage !== 'S2') return { ok: false, code: 'oa_s2c_none', msg: '该变更不属于本阶段,请刷新' };
  if (pc.by_openid === openid) return { ok: false, code: 'oa_s2c_self', msg: '不能处理自己发起的变更' };
  if (token && pc.token !== token) return { ok: false, code: 'oa_s2c_stale', msg: '该变更已失效,请刷新' };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const proposer = pc.by_openid;

  // 超时收口：过期按拒绝处理（值不变）
  if ((pc.expire_at || 0) && now > pc.expire_at) {
    const r = await col('order_main')
      .where({ _id: order_id, status: 'S2', 'pending_change.token': pc.token })
      .update({ data: { pending_change: _.remove(), s2_change_auto_rejected_at: now, updated_at: now } });
    if (r.stats && r.stats.updated === 1) {
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_s2_change_expire',
        target_type: 'order', target_id: order_id,
        detail: { field: pc.field, token: pc.token, by_openid: proposer },
        result: 'ok', client_ip: clientIp, device });
      await notifyBoth(ctx, order, pc, 'expire', now);
    } else {
      return { ok: false, code: 'oa_conflict', msg: '该变更已被处理,请刷新' };
    }
    return { ok: false, code: 'oa_s2c_expired', msg: '该变更已超时,已自动拒绝' };
  }

  if (decision === 'reject') {
    const r = await col('order_main')
      .where({ _id: order_id, status: 'S2', 'pending_change.token': pc.token })
      .update({ data: { pending_change: _.remove(), s2_change_last_rejected_at: now, updated_at: now } });
    if (!r.stats || r.stats.updated !== 1) return { ok: false, code: 'oa_conflict', msg: '该变更已被处理,请刷新' };
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_s2_change_reject',
      target_type: 'order', target_id: order_id, detail: { field: pc.field, token: pc.token },
      result: 'ok', client_ip: clientIp, device });
    await writeNotice({
      to_openid: proposer, order_id, type: 'change_reject',
      title: '变更申请被拒绝',
      body: `对方拒绝了「${FIELD_CN[pc.field] || pc.field}」的变更,原内容保持不变`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    log.d(`s2 change reject: order=${order.order_no} field=${pc.field} by=${role}`);
    return { ok: true, data: { field: pc.field, accepted: false } };
  }

  // 接受：确认单只更新变更项并置双确认（其余确认位保持原状，已支付订单不再要求重复确认）
  const conf = await getConfirmation(order_id);
  if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };
  const items = Object.assign({}, conf.items);
  const it = Object.assign({}, items[pc.field] || {});
  it.value = pc.new_value;
  it.user_ok = true;
  it.partner_ok = true;
  items[pc.field] = it;
  const v = conf.version || 1;
  const occ = await col('order_confirmations').where({ _id: conf._id, version: v })
    .update({ data: { items, version: v + 1, updated_at: now } });
  if (!occ.stats || occ.stats.updated !== 1) {
    return { ok: false, code: 'oa_conflict', msg: '确认信息刚被对方更新,请刷新后重试' };
  }
  const confPrev = { id: conf._id, version: v + 1, items: conf.items };

  const orderPatch = pc.field === 'location'
    ? { location: pc.new_value }
    : { content_options: pc.new_value };
  const patch = Object.assign({ updated_at: now, pending_change: _.remove(), s2_change_applied_at: now }, orderPatch);
  const r = await col('order_main')
    .where({ _id: order_id, status: 'S2', 'pending_change.token': pc.token })
    .update({ data: patch });
  if (!r.stats || r.stats.updated !== 1) {
    // 订单未落库 → 回滚确认单（避免「确认单已是新值、订单仍旧值」）
    await col('order_confirmations').where({ _id: confPrev.id, version: confPrev.version })
      .update({ data: { items: confPrev.items, version: confPrev.version + 1, updated_at: now } })
      .catch(() => {});
    return { ok: false, code: 'oa_conflict', msg: '该变更已被处理,请刷新' };
  }

  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_s2_change_accept',
    target_type: 'order', target_id: order_id,
    detail: { field: pc.field, old_value: pc.old_value, new_value: pc.new_value },
    result: 'ok', client_ip: clientIp, device });

  // 生效通知双方：请按新信息履约
  await notifyBoth(ctx, order, pc, 'accept', now);
  log.d(`s2 change accept: order=${order.order_no} field=${pc.field} by=${role}`);
  return { ok: true, data: { field: pc.field, accepted: true, window: pc.window || '' } };
}

// 变更超时/生效的双向站内通知
async function notifyBoth(ctx, order, pc, kind, now) {
  const { col } = ctx;
  const label = (ctx.FIELD_CN && ctx.FIELD_CN[pc.field]) || pc.field;
  const receivers = [
    { openid: order.user_openid },
    { openid: order.partner_openid }
  ].filter(r => r.openid);
  await Promise.allSettled(receivers.map(r => {
    const isProposer = pc.by_openid && r.openid === pc.by_openid;
    const body = kind === 'accept'
      ? `「${label}」变更已生效,请按新的${label}信息履约`
      : (isProposer ? '你的变更申请因对方超时未反馈,已自动拒绝,原内容不变' : '对方的变更申请已超时自动拒绝,原内容不变');
    return col('system_notice').add({ data: {
      to_openid: r.openid, order_id: order._id, type: kind === 'accept' ? 'change_accept' : 'change_reject',
      title: kind === 'accept' ? '变更已生效' : '变更申请已超时拒绝',
      body,
      action_key: 'jump_order', action_payload: { order_id: order._id },
      created_at: now, read: false
    }});
  }));
}

module.exports = { s2_change_apply, s2_change_respond };
