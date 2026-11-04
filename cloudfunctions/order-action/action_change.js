// order-action · 四确认变更协商（S1：发起 → 对方反馈 → 闭环）
// 2026-11-04 用户裁定（推荐口径 D1-D6 全采纳）：
//   D1「其他」不计确认位：接受后写 order.extra_note + 审计，不重置 8 位；
//   D2 S2/S3 不开放地点/内容/费用变更（时间走 pending_modify、加时走 pending_extend）；
//   D3 拒绝/超时：值不变、8 个确认位原样保留；只有接受生效才重置；
//   D4 变更不顺延 S1 15 分钟：expire_at = min(发起+15min, created_at+S1 时限)；
//   D5 次数：每项 ≤2 次/单，全单 ≤4 次；
//   D6 费用变更 S1 内直接改总额（无补差）。
// 共享符号经 ctx 注入，禁 require('./index')。
const CHANGE_FIELDS = ['time', 'location', 'content', 'fee', 'other'];
const CHANGE_MAX_PER_FIELD = 2;
const CHANGE_MAX_TOTAL = 4;
const CHANGE_RESPOND_MIN = 15;
const CN_OFF_MS = 8 * 3600 * 1000;

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
// 变更值的人类可读文案（站内通知用）
function valueText(field, v) {
  if (field === 'time') {
    const d = new Date(Number(v) + CN_OFF_MS);
    if (!isNaN(d.getTime())) return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    return '';
  }
  if (field === 'fee') return '¥' + Math.round(Number(v) / 100);
  if (field === 'location') return String((v && v.name) || '').slice(0, 20);
  if (field === 'content') return (Array.isArray(v) ? v.join('/') : String(v || '')).slice(0, 20);
  return String(v || '').slice(0, 20);
}
function newToken(now) {
  return String(now) + '-' + Math.random().toString(36).slice(2, 8);
}
// 取订单当前值（发起时快照，供对方对比与拒绝回显）
function currentValue(order, field) {
  if (field === 'time') return order.start_time || 0;
  if (field === 'location') return order.location || null;
  if (field === 'content') return order.content_options || [];
  if (field === 'fee') return order.total_fen || 0;
  return order.extra_note || '';
}
// 2026-11-05：判断新旧值是否等价（数组先排序，避免勾选顺序不同被误判为"已变更"；对象按 key 浅比较）
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
// 校验变更值 → { ok, orderPatch } 或 { ok:false, code, msg }
async function validateValue(ctx, order, field, value, config) {
  const { col, splitOrderAmount, now, reasonMaxLen } = ctx;
  if (field === 'time') {
    const ts = Number(value);
    if (!ts || ts <= now) return { ok: false, code: 'oa_time_future', msg: '服务时间必须是未来时间' };
    return { ok: true, orderPatch: { start_time: ts } };
  }
  if (field === 'location') {
    if (!value || !value.name || !value.latitude || !value.longitude) {
      return { ok: false, code: 'oa_location_invalid', msg: '地点信息不完整' };
    }
    return { ok: true, orderPatch: { location: value } };
  }
  if (field === 'content') {
    if (!Array.isArray(value) || !value.length) {
      return { ok: false, code: 'oa_content_invalid', msg: '服务内容格式有误' };
    }
    return { ok: true, orderPatch: { content_options: value } };
  }
  if (field === 'fee') {
    const fee = Number(value);
    if (!Number.isInteger(fee)) return { ok: false, code: 'oa_fee_invalid', msg: '费用必须是整数(分)' };
    const rateMin = config.rate_min_fen || 3000;
    const rateMax = config.rate_max_fen || 10000;
    if (fee < rateMin || fee > rateMax) {
      // 变更是协商：不再“自动调整”，只告知合法区间（原 update_item 文案误导，此处不复用）
      return { ok: false, code: 'oa_fee_out_of_range',
        msg: `费用超出耍伴时薪区间(${Math.round(rateMin / 100)}元-${Math.round(rateMax / 100)}元/小时),请修改后再发起` };
    }
    const youthLimit = config.youth_limit_fen || 20000;
    const [u, p] = await Promise.all([
      col('user_account').where({ openid: order.user_openid }).limit(1).get(),
      col('user_account').where({ openid: order.partner_openid }).limit(1).get()
    ]);
    const isYouth = (d) => d && d.age !== null && d.age !== undefined && d.age >= 18 && d.age <= 22;
    const uYouth = u.data && u.data[0] && isYouth(u.data[0]);
    const pYouth = p.data && p.data[0] && isYouth(p.data[0]);
    if ((uYouth || pYouth) && fee > youthLimit) {
      return { ok: false, code: 'oa_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
    }
    const { feeFen } = splitOrderAmount(fee, config.platform_fee_rate_fen);
    return { ok: true, orderPatch: { total_fen: fee, fee_fen: feeFen, partner_income_fen: fee - feeFen } };
  }
  // other：自由文本，长度上限复用 order_reason_max_len
  const txt = String(value || '').trim();
  const max = reasonMaxLen(config); // 与改期/加时同源(order_reason_max_len)
  if (!txt || txt.length > max) {
    return { ok: false, code: 'oa_other_invalid', msg: `其他事项需填写，且不超过 ${max} 字` };
  }
  return { ok: true, orderPatch: { extra_note: txt } };
}

// ── 发起变更：change_apply ─────────────────────────────────────────────
async function change_apply(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, getConfig, col, _, log, writeAudit, checkText,
    BLOCK_WORDS_FALLBACK, writeNotice, sendCommSub, FIELD_CN, db, wxCtx, reasonMaxLen } = ctx;
  const { field, value, reason } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (CHANGE_FIELDS.indexOf(field) < 0) {
    return { ok: false, code: 'oa_bad_item', msg: '变更项只能是 时间/地点/内容/费用/其他' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S1') {
    return { ok: false, code: 'oa_not_editable', msg: '订单当前状态不可发起变更' };
  }
  if (isFrozen(order)) return { ok: false, code: 'oa_frozen', msg: '订单争议处理中，暂不可变更' };

  // 单订单仅一条在途变更
  const pcNow = order.pending_change;
  if (pcNow) {
    return { ok: false, code: 'oa_change_pending',
      msg: pcNow.by_openid === openid ? '你有一条变更待对方反馈，请等待或撤回后再发起' : '对方正在申请变更，请先处理' };
  }
  // 次数上限（按“发起次数”计，拒绝/超时同样消耗，防反复重置确认位）
  const counts = order.change_counts || {};
  if ((counts._total || 0) >= CHANGE_MAX_TOTAL) {
    return { ok: false, code: 'oa_change_limit', msg: `本单变更次数已达上限(${CHANGE_MAX_TOTAL}次)` };
  }
  if ((counts[field] || 0) >= CHANGE_MAX_PER_FIELD) {
    return { ok: false, code: 'oa_change_limit', msg: `「${FIELD_CN[field] || field}」变更次数已达上限(${CHANGE_MAX_PER_FIELD}次)` };
  }

  const config = await getConfig();
  const max = reasonMaxLen(config);
  const now = Date.now();
  const s1Min = Number(config.s1_timeout_min) > 0 ? Number(config.s1_timeout_min) : 15;
  // D4：不顺延 S1 窗口，取两者较小
  const expireAt = Math.min(now + CHANGE_RESPOND_MIN * 60000, (Number(order.created_at) || now) + s1Min * 60000);
  // 2026-11-05：窗口已无剩余时间时禁止发起，避免生成"一出生就超时"的空变更（白占配额+白推超时通知）
  if (expireAt <= now) {
    return { ok: false, code: 'oa_change_window_closed', msg: '四确认窗口即将结束，请直接确认或取消订单' };
  }

  const rv = await validateValue(ctx, order, field, value, config);
  if (!rv.ok) return rv;

  // 2026-11-05：与原值相同视为未变更，直接拒绝且不占次数（弹层里勾了又取消常会提交相同内容）
  const oldValue = currentValue(order, field);
  if (sameValue(oldValue, value)) {
    return { ok: false, code: 'oa_change_same', msg: '与原内容相同，无需提交变更' };
  }

  // 内容安全：content / other 是自由文本，必须过 msgSecCheck（降级词库 fail-closed）
  if (field === 'content' || field === 'other') {
    const txt = field === 'content' ? value.join('/') : String(value);
    const chk = await checkText(openid, txt, BLOCK_WORDS_FALLBACK);
    if (!chk.pass) return { ok: false, code: 'oa_content_blocked', msg: chk.reason || '内容不合规' };
  }

  const token = newToken(now);
  const pending = {
    field,
    old_value: oldValue,
    new_value: value,
    by_openid: openid,
    by_role: role,
    reason: String(reason || '').slice(0, max),
    created_at: now,
    expire_at: expireAt,
    token
  };
  const nextCounts = Object.assign({}, counts, { _total: (counts._total || 0) + 1 });
  nextCounts[field] = (counts[field] || 0) + 1;

  // 并发保护：仅当无在途变更时写入（_.exists(false)）
  let won = false;
  try {
    const r = await col('order_main').where({ _id: order_id, status: 'S1', pending_change: _.exists(false) })
      .update({ data: { pending_change: pending, change_counts: nextCounts, updated_at: now } });
    won = !!(r.stats && r.stats.updated === 1);
  } catch (e) {
    log.d(`change_apply fail: ${e.message}`);
    return { ok: false, code: 'oa_update_fail', msg: '发起变更失败,请稍后重试' };
  }
  if (!won) return { ok: false, code: 'oa_conflict', msg: '订单刚被对方更新,请刷新后重试' };

  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_change_apply',
    target_type: 'order', target_id: order_id,
    detail: { field, old_value: pending.old_value, new_value: value, expire_at: expireAt },
    result: 'ok', client_ip: clientIp, device });

  const to = role === 'user' ? order.partner_openid : order.user_openid;
  await writeNotice({
    to_openid: to, order_id, type: 'change_apply',
    title: '对方申请变更',
    body: `对方申请变更「${FIELD_CN[field] || field}」为 ${valueText(field, value)}，请在 ${Math.round((expireAt - now) / 60000)} 分钟内反馈`,
    action_key: 'jump_chat', action_payload: { order_id }
  });
  if (role === 'user') {
    try { await sendCommSub(order, config, field); } catch (e) { log.w(`change comm sub fail: ${e && (e.errMsg || e.message)}`); }
  }
  log.d(`change apply: order=${order.order_no} field=${field} by=${role} expire=${expireAt}`);
  return { ok: true, data: { field, expire_at: expireAt, token } };
}

// ── 对方反馈：change_respond（accept / reject / 超时收口）───────────────
async function change_respond(ctx) {
  const { event, order_id, openid, getOrder, roleOf, getConfig, col, _, log, writeAudit,
    getConfirmation, writeNotice, FIELD_CN, db, wxCtx, CONFIRM_FIELDS,
    splitOrderAmount, reasonMaxLen } = ctx;
  const { decision, token } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (decision !== 'accept' && decision !== 'reject') {
    return { ok: false, code: 'oa_bad_decision', msg: '反馈只能是 接受/拒绝' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S1') {
    return { ok: false, code: 'oa_not_editable', msg: '订单当前状态不可处理变更' };
  }
  const pc = order.pending_change;
  if (!pc) return { ok: false, code: 'oa_no_pending', msg: '当前没有待处理的变更' };
  if (pc.by_openid === openid) return { ok: false, code: 'oa_change_self', msg: '不能处理自己发起的变更' };
  if (token && pc.token !== token) return { ok: false, code: 'oa_change_stale', msg: '该变更已失效,请刷新' };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const proposer = pc.by_openid;

  // 超时收口：过期按拒绝处理（不改值、不清确认位）
  if ((pc.expire_at || 0) && now > pc.expire_at) {
    const r = await col('order_main')
      .where({ _id: order_id, status: 'S1', 'pending_change.token': pc.token })
      .update({ data: { pending_change: _.remove(), change_auto_rejected_at: now, updated_at: now } });
    if (r.stats && r.stats.updated === 1) {
      // 2026-11-04: 超时收口同样留审计（与发起/接受/拒绝四条链路对齐）
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_change_expire',
        target_type: 'order', target_id: order_id,
        detail: { field: pc.field, token: pc.token, by_openid: pc.by_openid },
        result: 'ok', client_ip: clientIp, device });
      await writeNoticesForChange(ctx, order, pc, 'expire', now);
    } else {
      // 2026-11-04: CAS 落空说明对方刚处理完或订单已转态，不能声称"已超时拒绝"
      return { ok: false, code: 'oa_conflict', msg: '该变更已被处理,请刷新' };
    }
    return { ok: false, code: 'oa_change_expired', msg: '该变更已超时,已自动拒绝' };
  }

  if (decision === 'reject') {
    const r = await col('order_main')
      .where({ _id: order_id, status: 'S1', 'pending_change.token': pc.token })
      .update({ data: { pending_change: _.remove(), change_last_rejected_at: now, updated_at: now } });
    if (!r.stats || r.stats.updated !== 1) return { ok: false, code: 'oa_conflict', msg: '该变更已被处理,请刷新' };
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_change_reject',
      target_type: 'order', target_id: order_id, detail: { field: pc.field, token: pc.token },
      result: 'ok', client_ip: clientIp, device });
    await writeNotice({
      to_openid: proposer, order_id, type: 'change_reject',
      title: '变更申请被拒绝',
      body: `对方拒绝了「${FIELD_CN[pc.field] || pc.field}」的变更,原内容保持不变`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    log.d(`change reject: order=${order.order_no} field=${pc.field} by=${role}`);
    return { ok: true, data: { field: pc.field, accepted: false } };
  }

  // 接受：先落确认单（重置 8 位），再落订单字段（CAS token）
  let confPrev = null; // 2026-11-04: 订单 CAS 落空时回滚确认单，防「确认单已是新值、订单仍旧值」
  if (pc.field !== 'other') {
    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };
    const newItems = {};
    for (const f of CONFIRM_FIELDS) {
      newItems[f] = {
        value: f === pc.field ? pc.new_value : conf.items[f].value,
        user_ok: false,
        partner_ok: false
      };
    }
    const v = conf.version || 1;
    const occ = await col('order_confirmations').where({ _id: conf._id, version: v })
      .update({ data: { items: newItems, version: v + 1, updated_at: now } });
    if (!occ.stats || occ.stats.updated !== 1) {
      return { ok: false, code: 'oa_conflict', msg: '确认信息刚被对方更新,请刷新后重试' };
    }
    confPrev = { id: conf._id, version: v + 1, items: conf.items };
  }

  // 订单字段：沿用发起时校验过的值，接受时重建 patch（配置口径可能已变，费用按当前配置重算）
  const config = await getConfig();
  let orderPatch;
  if (pc.field === 'fee') {
    const { feeFen } = splitOrderAmount(Number(pc.new_value), config.platform_fee_rate_fen);
    orderPatch = { total_fen: Number(pc.new_value), fee_fen: feeFen, partner_income_fen: Number(pc.new_value) - feeFen };
  } else if (pc.field === 'time') {
    orderPatch = { start_time: Number(pc.new_value) };
  } else if (pc.field === 'location') {
    orderPatch = { location: pc.new_value };
  } else if (pc.field === 'content') {
    orderPatch = { content_options: pc.new_value };
  } else {
    orderPatch = { extra_note: String(pc.new_value).slice(0, 200) };
  }
  const patch = Object.assign({ updated_at: now, pending_change: _.remove() }, orderPatch);
  const r = await col('order_main')
    .where({ _id: order_id, status: 'S1', 'pending_change.token': pc.token })
    .update({ data: patch });
  if (!r.stats || r.stats.updated !== 1) {
    // 2026-11-04: 订单未落库则回滚刚才的确认单重置（CAS 自己刚写出的 version，避免覆盖他人写入）
    if (confPrev) {
      await col('order_confirmations').where({ _id: confPrev.id, version: confPrev.version })
        .update({ data: { items: confPrev.items, version: confPrev.version + 1, updated_at: now } })
        .catch(() => {});
    }
    return { ok: false, code: 'oa_conflict', msg: '该变更已被处理,请刷新' };
  }

  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_change_accept',
    target_type: 'order', target_id: order_id,
    detail: { field: pc.field, new_value: pc.new_value, bits_reset: pc.field !== 'other' },
    result: 'ok', client_ip: clientIp, device });

  // 生效通知：发起人需重新确认（其他项不涉及确认位）
  if (pc.field !== 'other') {
    await writeNotice({
      to_openid: proposer, order_id, type: 'change_accept',
      title: '变更已生效',
      body: `对方接受了「${FIELD_CN[pc.field] || pc.field}」的变更,四项确认已重置,请重新确认`,
      action_key: 'jump_chat', action_payload: { order_id }
    });
  } else {
    await writeNotice({
      to_openid: proposer, order_id, type: 'change_accept',
      title: '补充说明已记录',
      body: '对方已接受你补充的「其他」事项,已记入订单备注',
      action_key: 'jump_order', action_payload: { order_id }
    });
  }
  log.d(`change accept: order=${order.order_no} field=${pc.field} by=${role} bits_reset=${pc.field !== 'other'}`);
  return { ok: true, data: { field: pc.field, accepted: true, bits_reset: pc.field !== 'other' } };
}

// 超时自动拒绝的双向站内通知（发起人/接收人文案区分）
async function writeNoticesForChange(ctx, order, pc, kind, now) {
  const { col } = ctx;
  const receivers = [
    { openid: order.user_openid, role: 'user' },
    { openid: order.partner_openid, role: 'partner' }
  ].filter(r => r.openid);
  await Promise.allSettled(receivers.map(r => {
    const isProposer = pc.by_openid && r.openid === pc.by_openid;
    return col('system_notice').add({ data: {
      to_openid: r.openid, order_id: order._id, type: 'change_reject',
      title: '变更申请已超时拒绝',
      body: isProposer ? '你的变更申请因对方超时未反馈,已自动拒绝,原内容不变' : '对方的变更申请已超时自动拒绝,原内容不变',
      action_key: 'jump_order', action_payload: { order_id: order._id },
      created_at: now, read: false
    }});
  }));
}

module.exports = { change_apply, change_respond, CHANGE_FIELDS };
