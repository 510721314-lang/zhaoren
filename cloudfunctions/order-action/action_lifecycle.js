// order-action · 生命周期分组（从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function cancel(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, getOrder: _g, logStatus, col, writeNotice, writeAudit } = ctx;
  const { reason } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

  if (order.status !== 'S1' && order.status !== 'S0') {
    return { ok: false, code: 'oa_cancel_status', msg: `订单当前状态(${order.status})不可取消` };
  }
  if (order.status === 'S0' && role !== 'user') {
    return { ok: false, code: 'oa_cancel_perm', msg: '待支付订单仅下单用户可取消' };
  }

  const now = Date.now();
  const fromStatus = order.status;
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, ['S1', 'S0'], {
    status: 'S6', cancel_at: now, updated_at: now
  }, 'cancel');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S6') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_cancel', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, idempotent: true, demand_released: false }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S6', demand_released: false, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }

  await logStatus(order_id, fromStatus, 'S6', role === 'user' ? 'user_cancel' : 'partner_cancel', openid);

  let demandReleased = false;
  if (fromStatus === 'S1' && order.demand_id) {
    try {
      const dr = await col('demand').where({ _id: order.demand_id, status: 'matched' }).update({
        data: { status: 'matching', updated_at: now }
      });
      demandReleased = !!(dr.stats && dr.stats.updated === 1);
      log.d(`demand released: ${order.demand_id} → matching (released=${demandReleased})`);
    } catch (e) {}
  }

  log.d(`order cancelled: ${order.order_no} ${fromStatus}→S6 by=${role}`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'cancel',
    title: '订单已取消',
    body: `${role === 'user' ? '发单人' : '耍伴'}取消了订单, 请查看详情`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_cancel', target_type: 'order', target_id: order_id, detail: { from_status: fromStatus, status: 'S6', demand_released: demandReleased, cancel_reason_type: String(reason || '').slice(0, 30) }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S6', demand_released: demandReleased } };
}

async function start_service(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_start_perm', msg: '仅耍伴可开始履约' };
  if (order.status !== 'S2') return { ok: false, code: 'oa_start_status', msg: `订单当前状态(${order.status})不可开始履约` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可开始履约' };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  // ── 需求B 开始履约留痕(强制, fail-closed): 1~3 张现场照片(客户端已叠地址+时间水印) + 耍伴实时精确位置 ──
  // 真实客户端必须传 start_evidence; 服务端自测链路(mock_openid 且无真实 OPENID)跳过, 与 order-create 接单同口径。
  const isMockCall = (wxCtx && !wxCtx.OPENID) && !!event.mock_openid;
  const se = event.start_evidence || {};
  const sePhotos = Array.isArray(se.photos)
    ? se.photos.filter((p) => p && typeof p.file_id === 'string' && p.file_id).slice(0, 3)
    : [];
  const seLoc = se.partner_location || {};
  const seLat = Number(seLoc.latitude);
  const seLng = Number(seLoc.longitude);
  if (!isMockCall) {
    if (!sePhotos.length) {
      return { ok: false, code: 'oa_start_evidence_required', msg: '开始履约需提交 1~3 张现场照片(带地址与时间水印)' };
    }
    if (!(seLat && seLng)) {
      return { ok: false, code: 'oa_start_location_required', msg: '开始履约需获取你的实时位置, 请授权定位后重试' };
    }
  }
  const won = await casStatus(order_id, 'S2', {
    status: 'S3', service_started_at: now, updated_at: now,
    milestone: { current: 0, confirmed: [false, false, false], evidence: [], submitted_at: null },
    service_start_evidence: {
      // 照片(云存储 fileID): kind=scene 周边环境 / closeup 局部; 客户端可选, 服务端仅归一化
      photos: sePhotos.map((p) => ({
        file_id: p.file_id,
        kind: p.kind === 'closeup' ? 'closeup' : 'scene',
        at: Number(p.at) || now
      })),
      // 耍伴端实时精确位置(客户端 wx.getLocation 采集, 含精度与逆地理地址)
      partner_location: (seLat && seLng) ? {
        latitude: seLat, longitude: seLng,
        accuracy: Math.round(Number(seLoc.accuracy) || 0),
        address: String(seLoc.address || '').slice(0, 200),
        at: Number(seLoc.at) || now
      } : null,
      // 需求的最终用户履约地点: 服务端自取订单 location(下单时来自需求), 客户端不可伪造
      site_location: order.location ? {
        name: String(order.location.name || '').slice(0, 100),
        address: String(order.location.address || order.location.name || '').slice(0, 200),
        latitude: Number(order.location.latitude) || 0,
        longitude: Number(order.location.longitude) || 0
      } : null,
      submitted_by: openid,
      submitted_at: now
    }
  }, 'start_service');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S3') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_service', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S3', service_started_at: latest.service_started_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S2', 'S3', 'start_service', openid);
  log.d(`service started: ${order.order_no} S2→S3`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'start',
    title: '耍伴已开始履约', body: `${order.partner_nickname || '耍伴'} 已到达服务地点, 履约开始`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_service', target_type: 'order', target_id: order_id, detail: { status: 'S3' }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3', service_started_at: now } };
}

// ── 履约双确认 · 阶段C-1(2026-10-14, 依据《线下陪伴履约流程规范与流程图》§2.2) ──
// 开始履约申请的定位阈值(规范 §五 默认值: 距离 200m / 精度 ≤50m; 阶段 H 后台化前先用常量兜底, 与前端 CONFIG.FULFILL 同值)
const FULFILL_DISTANCE_MAX_M = 200;
const FULFILL_ACCURACY_MAX_M = 50;
// 需求方「不同意」后可重发的冷却窗(规范 §C9: 允许重发, 冷却 60 秒)
const START_APPLY_COOLDOWN_MS = 60 * 1000;

// 开始履约申请(耍伴发起, S2→S2_6): 凭证前置(2026-10-15 需求变更)——定位快照 + 现场照片(1~3 张)同一次 CAS 落库 + 存证先行;
// 需求方确认(阶段D)后才进入 S3 真正开始履约。旧 start_service(no.5 直连 S2→S3)保留共存, 待前端切换后收口。
async function start_apply(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit, haversineKm } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_start_apply_perm', msg: '仅耍伴可发起履约申请' };
  if (order.status !== 'S2') return { ok: false, code: 'oa_start_apply_status', msg: `订单当前状态(${order.status})不可发起履约申请` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可发起履约申请' };

  const now = Date.now();
  // 冷却(规范 §C9): 需求方刚「不同意」后 60 秒内不可重发申请
  const lastReject = Number(order.start_reject_at) || 0;
  if (lastReject && (now - lastReject) < START_APPLY_COOLDOWN_MS) {
    const left = Math.ceil((START_APPLY_COOLDOWN_MS - (now - lastReject)) / 1000);
    return { ok: false, code: 'oa_start_apply_cooldown', msg: `对方刚拒绝, 请 ${left} 秒后再试` };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  // 定位快照(fail-closed): 真实客户端必须传 start_location; 服务端自测链路(mock_openid 且无真实 OPENID)跳过, 与 start_service 同口径
  const isMockCall = (wxCtx && !wxCtx.OPENID) && !!event.mock_openid;
  const sl = event.start_location || {};
  const rawLat = Number(sl.latitude);
  const rawLng = Number(sl.longitude);
  const rawAcc = Number(sl.accuracy);
  if (!isMockCall) {
    if (!(isFinite(rawLat) && isFinite(rawLng) && rawLat && rawLng)) {
      return { ok: false, code: 'oa_start_apply_location_required', msg: '发起履约申请需获取你的实时位置, 请授权定位后重试' };
    }
    if (!(isFinite(rawAcc) && rawAcc > 0) || rawAcc > FULFILL_ACCURACY_MAX_M) {
      return { ok: false, code: 'oa_start_apply_accuracy_low', msg: `当前定位精度不足(需≤${FULFILL_ACCURACY_MAX_M}米), 请到开阔处重试` };
    }
    // 履约地有有效坐标才做距离校验; 无坐标=存量/手输地址订单 → 放行兜底(与前端 geo-guard no_site 同口径, 评审 2/2 确认)
    const site = order.location || {};
    const siteLat = Number(site.latitude);
    const siteLng = Number(site.longitude);
    if (isFinite(siteLat) && isFinite(siteLng) && !(siteLat === 0 && siteLng === 0)) {
      const distM = Math.round(haversineKm(rawLat, rawLng, siteLat, siteLng) * 1000);
      if (distM > FULFILL_DISTANCE_MAX_M) {
        return { ok: false, code: 'oa_start_apply_too_far', msg: '请确认是否到达履约地点, 或联系用户确认地点' };
      }
    }
  }

  // 凭证前置(2026-10-15 需求变更): 现场照片(1~3 张, 客户端已叠地址+时间水印)必须随申请一并提交
  // 真实客户端必须传 start_evidence; 服务端自测链路(mock_openid 且无真实 OPENID)跳过, 与 start_service 同口径。
  const se = event.start_evidence || {};
  const sePhotos = Array.isArray(se.photos)
    ? se.photos.filter((p) => p && typeof p.file_id === 'string' && p.file_id).slice(0, 3)
    : [];
  if (!isMockCall && !sePhotos.length) {
    return { ok: false, code: 'oa_start_evidence_required', msg: '发起履约申请需先上传 1~3 张现场照片(带地址与时间水印)' };
  }
  const seLoc = se.partner_location || {};
  const seLat = Number(seLoc.latitude);
  const seLng = Number(seLoc.longitude);
  const hasSeLoc = isFinite(seLat) && isFinite(seLng) && !!seLat && !!seLng;

  // 存证先行(规范 §2.4 FULFILL_EVIDENCE_FIELDS 口径): 定位快照先落库, 再推消息
  const evidence = {
    order_id,
    role: 'partner',
    stage: 'start',
    lat: isFinite(rawLat) ? rawLat : 0,
    lng: isFinite(rawLng) ? rawLng : 0,
    coord_system: 'GCJ-02',
    accuracy: Math.round(isFinite(rawAcc) ? rawAcc : 0),
    address: String(sl.address || '').slice(0, 200),
    server_time: now,
    photo_urls: sePhotos.map((p) => p.file_id), // 2026-10-15 需求变更: 照片随申请前置提交(原为空数组, 照片原在需求方同意后拍)
    threshold_used: FULFILL_DISTANCE_MAX_M    // 发起瞬间快照的阈值(后台改配不影响存量订单)
  };
  const won = await casStatus(order_id, 'S2', {
    status: 'S2_6', start_apply_at: now, updated_at: now,
    start_apply_evidence: evidence,
    // 凭证前置(2026-10-15 需求变更): 现场照片+定位随申请同一次 CAS 原子落库, 需求方在 S2_6 看着照片确认
    service_start_evidence: {
      // 照片(云存储 fileID): kind=scene 周边环境 / closeup 局部; 客户端可选, 服务端仅归一化
      photos: sePhotos.map((p) => ({
        file_id: p.file_id,
        kind: p.kind === 'closeup' ? 'closeup' : 'scene',
        at: Number(p.at) || now
      })),
      // 优先取照片水印定位(采集瞬间), 缺失时回退已校验的申请定位快照
      partner_location: {
        latitude: hasSeLoc ? seLat : (isFinite(rawLat) ? rawLat : 0),
        longitude: hasSeLoc ? seLng : (isFinite(rawLng) ? rawLng : 0),
        accuracy: Math.round((hasSeLoc ? Number(seLoc.accuracy) : rawAcc) || 0),
        address: String((hasSeLoc ? seLoc.address : sl.address) || '').slice(0, 200),
        at: Number(seLoc.at) || now
      },
      // 需求的最终用户履约地点: 服务端自取订单 location(下单时来自需求), 客户端不可伪造
      site_location: order.location ? {
        name: String(order.location.name || '').slice(0, 100),
        address: String(order.location.address || order.location.name || '').slice(0, 200),
        latitude: Number(order.location.latitude) || 0,
        longitude: Number(order.location.longitude) || 0
      } : null,
      submitted_by: openid,
      submitted_at: now
    }
  }, 'start_apply');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S2_6') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_apply', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S2_6', start_apply_at: latest.start_apply_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S2', 'S2_6', 'start_apply', openid);
  log.d(`start apply: ${order.order_no} S2→S2_6`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'start_apply',
    title: '耍伴已到达履约点',
    body: `${order.partner_nickname || '耍伴'} 已到达指定履约点, 请确认是否开始履约`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_apply', target_type: 'order', target_id: order_id, detail: { status: 'S2_6', accuracy: evidence.accuracy }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S2_6', start_apply_at: now } };
}

async function complete_service(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_complete_perm', msg: '仅耍伴可完成履约' };
  if (order.status !== 'S3') return { ok: false, code: 'oa_complete_status', msg: `订单当前状态(${order.status})不可完成履约` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可完成履约' };

  const ms = order.milestone || { current: 0 };
  if (ms.current < 3) {
    return { ok: false, code: 'oa_milestone_required', msg: `请先提交履约进度到100%(当前${ms.current}/3)再完成履约` };
  }

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S3', {
    status: 'S5', service_completed_at: now, updated_at: now
  }, 'complete');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S5') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complete_service', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S5', service_completed_at: latest.service_completed_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3', 'S5', 'complete_service', openid);
  log.d(`service completed: ${order.order_no} S3→S5`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'finish',
    title: '履约已完成', body: '耍伴已完成全部履约, 请对服务进行评价',
    action_key: 'jump_evaluate', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_complete_service', target_type: 'order', target_id: order_id, detail: { status: 'S5', total_fen: Number(order.total_fen) || 0 }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S5', service_completed_at: now } };
}

async function milestone_submit(ctx) {
  const { event, order_id, openid, getOrder, roleOf, checkText, col, wxCtx, db, log, writeNotice, writeAudit } = ctx;
  const MS_LABEL = { 1: '30%', 2: '60%', 3: '100%' };
  const { note, location } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_ms_perm', msg: '仅耍伴可提交履约进度' };
  if (order.status !== 'S3') return { ok: false, code: 'oa_ms_status', msg: `订单当前状态(${order.status})不可提交进度` };

  const ms = order.milestone || { current: 0, confirmed: [false, false, false], evidence: [] };
  if (ms.current >= 3) return { ok: false, code: 'oa_ms_done', msg: '履约进度已提交到100%,无需重复提交' };

  const next = ms.current + 1;
  if (note) {
    const chk = await checkText(openid, note);
    if (!chk.pass) return { ok: false, code: 'oa_text_unsafe', msg: chk.reason };
  }
  const evidence = Array.isArray(ms.evidence) ? ms.evidence : [];
  evidence.push({
    milestone: next,
    label: MS_LABEL[next],
    note: note || '',
    location: location || null,
    submitted_by: openid,
    submitted_at: Date.now()
  });

  const casRes = await col('order_main').where({
    _id: order_id, status: 'S3', 'milestone.current': ms.current
  }).update({
    data: {
      'milestone.current': next,
      'milestone.evidence': evidence,
      'milestone.submitted_at': Date.now(),
      updated_at: Date.now()
    }
  });
  if (!casRes.stats || casRes.stats.updated !== 1) {
    return { ok: false, code: 'oa_ms_conflict', msg: '进度状态已变化,请刷新后重试' };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  log.d(`milestone ${next}/3 submitted: ${order.order_no}`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'milestone',
    title: `履约进度 ${MS_LABEL[next]}`, body: `耍伴提交了履约进度 ${MS_LABEL[next]}, 可在订单详情查看`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_milestone_submit', target_type: 'order', target_id: order_id, detail: { milestone: next, label: MS_LABEL[next] }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, milestone: next, label: MS_LABEL[next] } };
}

async function milestone_confirm(ctx) {
  const { event, order_id, openid, getOrder, roleOf, col, _, wxCtx, db, log, writeAudit } = ctx;
  const { milestone } = event;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  if (![1, 2, 3].includes(milestone)) return { ok: false, code: 'oa_ms_invalid', msg: 'milestone 须为 1/2/3' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'user') return { ok: false, code: 'oa_ms_confirm_perm', msg: '仅需求者可确认履约进度' };

  const ms = order.milestone || { current: 0, confirmed: [false, false, false] };
  if (ms.current < milestone) return { ok: false, code: 'oa_ms_not_submitted', msg: '该进度尚未提交' };

  const idx = milestone - 1;
  const casCond = { _id: order_id };
  casCond[`milestone.confirmed.${idx}`] = _.neq(true);
  const casData = { updated_at: Date.now() };
  casData[`milestone.confirmed.${idx}`] = true;
  const casRes = await col('order_main').where(casCond).update({ data: casData });
  if (!casRes.stats || casRes.stats.updated !== 1) {
    return { ok: false, code: 'oa_ms_already_confirmed', msg: '该进度已确认,无需重复操作' };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  log.d(`milestone ${milestone} confirmed by user: ${order.order_no}`);
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_milestone_confirm', target_type: 'order', target_id: order_id, detail: { milestone, confirmed: true }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, milestone, confirmed: true } };
}

async function resume_service(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (order.status !== 'S3.5') {
    return { ok: false, code: 'oa_resume_status', msg: `订单当前状态(${order.status})不可恢复履约` };
  }
  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S3.5', {
    status: 'S3', resumed_at: now, resumed_by: openid, updated_at: now
  }, 'resume');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S3') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_resume_service', target_type: 'order', target_id: order_id, detail: { status: 'S3', idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S3', idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3.5', 'S3', role === 'user' ? 'user_resume' : 'partner_resume', openid);
  log.d(`order resume: ${order.order_no} S3.5→S3`);
  writeNotice({
    to_openid: role === 'user' ? order.partner_openid : order.user_openid,
    order_id, type: 'resume',
    title: '履约已恢复', body: `${role === 'user' ? '发单人' : '耍伴'}恢复了履约, 可继续服务`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_resume_service', target_type: 'order', target_id: order_id, detail: { status: 'S3' }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3' } };
}

// 需求B 二期(2026-10-14): 需求方到场定位确认 —— 仅"确认"动作时要求定位(不点不拦主流程, 与 B1 耍伴侧 fail-closed 不同)
// 与 B1 对称: S3 内由需求方自主确认, 写入 order_main.user_confirm(不出新集合); 幂等 + CAS 防并发重复。
async function user_confirm_start(ctx) {
  const { event, order_id, openid, getOrder, roleOf, col, _, wxCtx, db, log, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'user') return { ok: false, code: 'oa_uc_perm', msg: '仅需求方可确认到场' };
  if (order.status !== 'S3') return { ok: false, code: 'oa_uc_status', msg: `订单当前状态(${order.status})不可确认到场` };

  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  // 幂等: 已确认过 → 返回首次结果
  if (order.user_confirm && order.user_confirm.at) {
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_user_confirm_start', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: order.status, user_confirm: order.user_confirm, idempotent: true } };
  }

  // 仅"确认"动作时要求定位(fail-closed): 缺经纬度即拒
  const uc = event.user_confirm || {};
  const lat = Number(uc.latitude);
  const lng = Number(uc.longitude);
  if (!(lat && lng)) {
    return { ok: false, code: 'oa_user_location_required', msg: '确认到场需获取你的实时位置, 请授权定位后重试' };
  }
  const now = Date.now();
  const payload = {
    latitude: lat, longitude: lng,
    accuracy: Math.round(Number(uc.accuracy) || 0),
    address: String(uc.address || '').slice(0, 200),
    at: now, by: openid
  };
  // CAS: 仅当尚未确认时写入(防并发重复); 复用 col/_ 原子条件
  const res = await col('order_main').where({ _id: order_id, status: 'S3', 'user_confirm.at': _.exists(false) }).update({
    data: { user_confirm: payload, updated_at: now }
  });
  if (!res.stats || res.stats.updated !== 1) {
    const latest = await getOrder(order_id);
    if (latest && latest.user_confirm && latest.user_confirm.at) {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_user_confirm_start', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: latest.status, user_confirm: latest.user_confirm, idempotent: true } };
    }
    return { ok: false, code: 'oa_uc_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  log.d(`user confirm start: ${order.order_no} (user_confirm)`);
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_user_confirm_start', target_type: 'order', target_id: order_id, detail: { status: 'S3', has_location: true }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3', user_confirm: payload } };
}

// ── 履约双确认 · 阶段D(2026-10-14, 规范 §2.2): 需求方确认「耍伴已到场」 ──
// start_confirm: S2_6→S3(no.24, 可带用户定位留痕, 复用 B2 的 user_confirm 字段)
// start_reject : S2_6→S2(no.25, 60s 冷却; 连续 2 次→争议属阶段G(no.26), 本轮仅计数留证不升级)
async function start_confirm(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'user') return { ok: false, code: 'oa_start_confirm_perm', msg: '仅需求方可确认耍伴到场' };
  if (order.status !== 'S2_6') return { ok: false, code: 'oa_start_confirm_status', msg: `订单当前状态(${order.status})不可确认` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可确认' };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const ul = event.user_location || {};
  const uLat = Number(ul.latitude);
  const uLng = Number(ul.longitude);
  const uAcc = Number(ul.accuracy);
  const hasLoc = !!(isFinite(uLat) && isFinite(uLng) && uLat && uLng);

  const patch = {
    status: 'S3', service_started_at: now, updated_at: now,
    milestone: { current: 0, confirmed: [false, false, false], evidence: [], submitted_at: null }
  };
  // 规范 no.24 guard「同意(可带用户定位留痕)」: 有定位才留痕, 未带则留空
  if (hasLoc) {
    patch.user_confirm = {
      latitude: uLat, longitude: uLng,
      accuracy: Math.round(isFinite(uAcc) ? uAcc : 0),
      address: String(ul.address || '').slice(0, 200),
      at: now, by: openid
    };
  }
  const won = await casStatus(order_id, 'S2_6', patch, 'start_confirm');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S3') {
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_start_confirm', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S3', service_started_at: latest.service_started_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S2_6', 'S3', 'start_confirm', openid);
  log.d(`start confirmed: ${order.order_no} S2_6→S3`);
  writeNotice({
    to_openid: order.partner_openid, order_id, type: 'start_confirm',
    title: '对方已确认你到场',
    body: '需求方已确认你已到达履约点, 请拍摄现场照片开始履约',
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_start_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S3', has_location: hasLoc }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3', service_started_at: now } };
}

async function start_reject(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'user') return { ok: false, code: 'oa_start_reject_perm', msg: '仅需求方可拒绝' };
  if (order.status !== 'S2_6') return { ok: false, code: 'oa_start_reject_status', msg: `订单当前状态(${order.status})不可拒绝` };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const rejectCount = (Number(order.start_reject_count) || 0) + 1;
  // ── 阶段G(G1, 2026-10-15): 连续 2 次「不同意」不再回 S2, 直接转 S10.5 争议(状态机 no.26 guard「15min 超时未响应(或连续2次拒绝)」) ──
  const escalated = rejectCount >= 2;
  const won = await casStatus(order_id, 'S2_6', escalated ? {
    status: 'S10.5', start_reject_at: now, start_reject_count: rejectCount,
    dispute_state: 'open', dispute_type: 'start_timeout', dispute_opened_at: now, updated_at: now
  } : {
    status: 'S2', start_reject_at: now, start_reject_count: rejectCount, updated_at: now
  }, escalated ? 'start_apply_timeout' : 'start_reject');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && (latest.status === 'S2' || latest.status === 'S10.5')) {
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_start_reject', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: latest.status, start_reject_count: latest.start_reject_count || rejectCount, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  if (escalated) {
    await logStatus(order_id, 'S2_6', 'S10.5', 'start_apply_timeout', openid);
    log.d(`start reject escalated: ${order.order_no} S2_6→S10.5 (count=${rejectCount})`);
    writeNotice({
      to_openid: order.partner_openid, order_id, type: 'dispute_open',
      title: '连续未获确认,已转平台处理',
      body: '需求方连续 2 次未确认开始履约, 订单已转争议, 平台将介入核实',
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_start_reject', target_type: 'order', target_id: order_id, detail: { status: 'S10.5', reject_count: rejectCount, escalated: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S10.5', start_reject_count: rejectCount, escalated: true } };
  }
  await logStatus(order_id, 'S2_6', 'S2', 'start_reject', openid);
  log.d(`start rejected: ${order.order_no} S2_6→S2 (count=${rejectCount})`);
  writeNotice({
    to_openid: order.partner_openid, order_id, type: 'start_reject',
    title: '对方未同意开始履约',
    body: '需求方暂未确认你到场, 60 秒后可重新发起申请',
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_start_reject', target_type: 'order', target_id: order_id, detail: { status: 'S2', reject_count: rejectCount }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S2', start_reject_count: rejectCount } };
}

// ── 履约双确认 · 阶段E(2026-10-14, 规范 §2.2 第6条 / §2.4 / §F3) ──
// 取服务端时间戳: 前端在拍照前调用, 供照片水印使用(规范 §F3「水印时间一律取服务端时间戳」, 禁用客户端时间)。
// 只读、不涉订单, 无 order_id 预检; 经 HANDLERS 分发表自动注册。
async function server_now() {
  return { ok: true, data: { server_time: Date.now() } };
}

// 现场照片存证: 需求方确认到场后, 耍伴在 S3 内拍摄上传(规范 §2.2 第6条)。
// 不改订单状态(阶段E 是 S3 内的证据落库, 非状态迁移); 写 order_main.service_start_evidence,
// 结构沿用需求B一期(B1)口径 → 复用 detail 回传 / 前端 refreshOrder 映射 / WXML「履约留痕」卡, 零渲染改动。
async function start_photo(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, _, col, db, log, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_start_photo_perm', msg: '仅耍伴可上传履约现场照片' };
  if (order.status !== 'S3') return { ok: false, code: 'oa_start_photo_status', msg: `订单当前状态(${order.status})不可上传现场照片` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可上传现场照片' };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  // 幂等(§C1): 已有留痕即返回首次结果不覆盖(前端入口在留痕存在时隐藏, 此处兜底防重复提交)
  if (order.service_start_evidence) {
    await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_photo', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S3', idempotent: true } };
  }

  // fail-closed(与服务端 B1 start_service 同口径): 真实客户端须传 1~3 张有效照片 + 实时位置;
  // 服务端自测链路(mock_openid 且无真实 OPENID)跳过, 与 order-create/start_service 同约定。
  const isMockCall = (wxCtx && !wxCtx.OPENID) && !!event.mock_openid;
  const se = event.start_evidence || {};
  const photos = Array.isArray(se.photos)
    ? se.photos.filter((p) => p && typeof p.file_id === 'string' && p.file_id).slice(0, 3)
    : [];
  const loc = se.partner_location || {};
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (!isMockCall) {
    if (!photos.length) return { ok: false, code: 'oa_start_photo_required', msg: '请至少拍摄 1 张现场照片(带地址与时间水印)' };
    if (!(isFinite(lat) && isFinite(lng) && lat && lng)) return { ok: false, code: 'oa_start_photo_location_required', msg: '上传现场照片需获取你的实时位置, 请授权定位后重试' };
  }

  // 时间一律服务端时间戳(规范 §F3): 照片 at / 位置 at / submitted_at 全部取 now, 忽略客户端上报时间
  const evidence = {
    photos: photos.map((p) => ({ file_id: p.file_id, kind: p.kind === 'closeup' ? 'closeup' : 'scene', at: now })),
    partner_location: (isFinite(lat) && isFinite(lng) && lat && lng) ? {
      latitude: lat, longitude: lng,
      accuracy: Math.round(Number(loc.accuracy) || 0),
      address: String(loc.address || '').slice(0, 200),
      at: now
    } : null,
    // 履约地: 服务端自取订单 location(下单时来自需求), 客户端不可伪造
    site_location: order.location ? {
      name: String(order.location.name || '').slice(0, 100),
      address: String(order.location.address || order.location.name || '').slice(0, 200),
      latitude: Number(order.location.latitude) || 0,
      longitude: Number(order.location.longitude) || 0
    } : null,
    submitted_by: openid,
    submitted_at: now
  };

  // CAS 写: 仅 S3 且尚无留痕时落库(防并发重复写); status 字段不动(阶段E 非状态迁移)
  const res = await col('order_main').where({
    _id: order_id, status: 'S3', service_start_evidence: _.exists(false)
  }).update({ data: { service_start_evidence: evidence, updated_at: now } });
  if (!res.stats || res.stats.updated !== 1) {
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化或留痕已存在,请刷新后重试' };
  }

  log.d(`start photo evidence stored: ${order.order_no} (photos=${evidence.photos.length})`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'start_photo',
    title: '耍伴已上传现场照片',
    body: `${order.partner_nickname || '耍伴'} 已上传履约现场照片, 可在订单详情查看`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_start_photo', target_type: 'order', target_id: order_id, detail: { status: 'S3', photos: evidence.photos.length }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3', photos: evidence.photos.length } };
}

// ── 履约双确认 · 阶段F(2026-10-15, 规范 §2.3 履约完毕流程 / §2.4 存证) ──
// 发起履约完毕确认(耍伴, S3→S3_6): 凭证前置(规范 §2.3 第3条「先上传完成照片+定位快照, 再发起确认」),
// 单次调用同时落 service_finish_evidence 并迁移状态(存证先行); evidence 结构与阶段E start_photo 同源, 供前端复用渲染。
// 旧 complete_service(no.13 直连 S3→S5)保留共存, 待前端切换后另行收口(收口属状态机改动, 须单独授权)。
async function finish_apply(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit, haversineKm } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'partner') return { ok: false, code: 'oa_finish_apply_perm', msg: '仅耍伴可发起履约完毕确认' };
  if (order.status !== 'S3') return { ok: false, code: 'oa_finish_apply_status', msg: `订单当前状态(${order.status})不可发起完毕确认` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可发起完毕确认' };

  // 里程碑门槛(沿用旧 complete_service 口径): 须先提交到 100%
  const ms = order.milestone || { current: 0 };
  if (ms.current < 3) {
    return { ok: false, code: 'oa_finish_apply_milestone', msg: `请先提交履约进度到100%(当前${ms.current}/3)再发起完毕确认` };
  }

  const now = Date.now();
  // 冷却(规范 §2.3 第7条「不确认后冷却可重发」): 复用 60s 冷却窗
  const lastReject = Number(order.finish_reject_at) || 0;
  if (lastReject && (now - lastReject) < START_APPLY_COOLDOWN_MS) {
    const left = Math.ceil((START_APPLY_COOLDOWN_MS - (now - lastReject)) / 1000);
    return { ok: false, code: 'oa_finish_apply_cooldown', msg: `对方刚未确认, 请 ${left} 秒后再试` };
  }
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  // 凭证前置(fail-closed): 真实客户端须传 1~3 张完成照片 + 实时位置; mock 自测链路旁路(与 start_photo 同口径)
  const isMockCall = (wxCtx && !wxCtx.OPENID) && !!event.mock_openid;
  const fe = event.finish_evidence || {};
  const photos = Array.isArray(fe.photos)
    ? fe.photos.filter((p) => p && typeof p.file_id === 'string' && p.file_id).slice(0, 3)
    : [];
  const loc = fe.partner_location || {};
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  const rawAcc = Number(loc.accuracy);
  if (!isMockCall) {
    if (!photos.length) return { ok: false, code: 'oa_finish_apply_photo_required', msg: '发起完毕确认前请先拍摄 1~3 张完成照片(带地址与时间水印)' };
    if (!(isFinite(lat) && isFinite(lng) && lat && lng)) return { ok: false, code: 'oa_finish_apply_location_required', msg: '发起完毕确认需获取你的实时位置, 请授权定位后重试' };
    if (!(isFinite(rawAcc) && rawAcc > 0) || rawAcc > FULFILL_ACCURACY_MAX_M) {
      return { ok: false, code: 'oa_finish_apply_accuracy_low', msg: `当前定位精度不足(需≤${FULFILL_ACCURACY_MAX_M}米), 请到开阔处重试` };
    }
    // 履约地有有效坐标才做距离校验; 无坐标=存量/手输地址订单 → 放行兜底(与 start_apply 同口径)
    const site = order.location || {};
    const siteLat = Number(site.latitude);
    const siteLng = Number(site.longitude);
    if (isFinite(siteLat) && isFinite(siteLng) && !(siteLat === 0 && siteLng === 0)) {
      const distM = Math.round(haversineKm(lat, lng, siteLat, siteLng) * 1000);
      if (distM > FULFILL_DISTANCE_MAX_M) {
        return { ok: false, code: 'oa_finish_apply_too_far', msg: '请确认是否在履约地点, 或联系用户确认地点' };
      }
    }
  }

  // 时间一律服务端时间戳(规范 §F3): 照片 at / 位置 at / submitted_at 全部取 now, 忽略客户端上报时间
  const evidence = {
    photos: photos.map((p) => ({ file_id: p.file_id, kind: p.kind === 'closeup' ? 'closeup' : 'scene', at: now })),
    partner_location: (isFinite(lat) && isFinite(lng) && lat && lng) ? {
      latitude: lat, longitude: lng,
      accuracy: Math.round(isFinite(rawAcc) ? rawAcc : 0),
      address: String(loc.address || '').slice(0, 200),
      at: now
    } : null,
    // 履约地: 服务端自取订单 location(下单时来自需求), 客户端不可伪造
    site_location: order.location ? {
      name: String(order.location.name || '').slice(0, 100),
      address: String(order.location.address || order.location.name || '').slice(0, 200),
      latitude: Number(order.location.latitude) || 0,
      longitude: Number(order.location.longitude) || 0
    } : null,
    stage: 'finish',
    submitted_by: openid,
    submitted_at: now
  };

  // 存证先行 + 状态迁移同 CAS 完成(规范 §2.3): S3→S3_6 且同时落 service_finish_evidence
  const won = await casStatus(order_id, 'S3', {
    status: 'S3_6', finish_apply_at: now, updated_at: now,
    service_finish_evidence: evidence
  }, 'finish_apply');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S3_6') {
      await writeAudit(db, log, { openid, role, category: 'business', action: 'order_finish_apply', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S3_6', finish_apply_at: latest.finish_apply_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3', 'S3_6', 'finish_apply', openid);
  log.d(`finish apply: ${order.order_no} S3→S3_6`);
  writeNotice({
    to_openid: order.user_openid, order_id, type: 'finish_apply',
    title: '耍伴已履约完毕',
    body: `${order.partner_nickname || '耍伴'} 已发起履约完毕确认, 请查看履约凭证后确认`,
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'business', action: 'order_finish_apply', target_type: 'order', target_id: order_id, detail: { status: 'S3_6', photos: evidence.photos.length }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3_6', finish_apply_at: now } };
}

// 确认履约完毕(需求方, S3_6→S5): 完毕确认即结算, 结算口径沿用既有 evaluate→S8→settle 链路(阶段F 决策 F2: 本 handler 只做状态迁移)
async function finish_confirm(ctx) {
  const { event, order_id, openid, getOrder, roleOf, isFrozen, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'user') return { ok: false, code: 'oa_finish_confirm_perm', msg: '仅需求方可确认履约完毕' };
  if (order.status !== 'S3_6') return { ok: false, code: 'oa_finish_confirm_status', msg: `订单当前状态(${order.status})不可确认完毕` };
  if (isFrozen(order)) return { ok: false, code: 'oa_order_frozen', msg: '订单争议/申诉处理中,暂不可确认' };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const won = await casStatus(order_id, 'S3_6', {
    status: 'S5', service_completed_at: now, updated_at: now
  }, 'finish_confirm');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && latest.status === 'S5') {
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_finish_confirm', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: 'S5', service_completed_at: latest.service_completed_at || now, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  await logStatus(order_id, 'S3_6', 'S5', 'finish_confirm', openid);
  log.d(`finish confirmed: ${order.order_no} S3_6→S5`);
  writeNotice({
    to_openid: order.partner_openid, order_id, type: 'finish',
    title: '对方已确认履约完毕',
    body: '需求方已确认你完成履约, 订单已完成',
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_finish_confirm', target_type: 'order', target_id: order_id, detail: { status: 'S5' }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S5', service_completed_at: now } };
}

// 不确认履约完毕(需求方, S3_6→S3): 维持履约中, 耍伴 60 秒后可重发(规范 §2.3 第7条)
async function finish_reject(ctx) {
  const { event, order_id, openid, getOrder, roleOf, wxCtx, db, log, casStatus, logStatus, writeNotice, writeAudit } = ctx;
  if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
  if (role !== 'user') return { ok: false, code: 'oa_finish_reject_perm', msg: '仅需求方可拒绝' };
  if (order.status !== 'S3_6') return { ok: false, code: 'oa_finish_reject_status', msg: `订单当前状态(${order.status})不可拒绝` };

  const now = Date.now();
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);
  const rejectCount = (Number(order.finish_reject_count) || 0) + 1;
  // ── 阶段G(G1, 2026-10-15): 连续 2 次「不确认」不再回 S3, 直接转 S10.5 争议(状态机 no.30 guard「30min 超时未响应(或连续2次不确认)」) ──
  const escalated = rejectCount >= 2;
  const won = await casStatus(order_id, 'S3_6', escalated ? {
    status: 'S10.5', finish_reject_at: now, finish_reject_count: rejectCount,
    dispute_state: 'open', dispute_type: 'finish_timeout', dispute_opened_at: now, updated_at: now
  } : {
    status: 'S3', finish_reject_at: now, finish_reject_count: rejectCount, updated_at: now
  }, escalated ? 'finish_confirm_timeout' : 'finish_reject');
  if (!won) {
    const latest = await getOrder(order_id);
    if (latest && (latest.status === 'S3' || latest.status === 'S10.5')) {
      await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_finish_reject', target_type: 'order', target_id: order_id, detail: { idempotent: true }, result: 'ok', client_ip: clientIp, device });
      return { ok: true, data: { order_id, status: latest.status, finish_reject_count: latest.finish_reject_count || rejectCount, idempotent: true } };
    }
    return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
  }
  if (escalated) {
    await logStatus(order_id, 'S3_6', 'S10.5', 'finish_confirm_timeout', openid);
    log.d(`finish reject escalated: ${order.order_no} S3_6→S10.5 (count=${rejectCount})`);
    writeNotice({
      to_openid: order.partner_openid, order_id, type: 'dispute_open',
      title: '连续未获确认,已转平台处理',
      body: '需求方连续 2 次未确认履约完毕, 订单已转争议, 平台将介入核实',
      action_key: 'jump_order', action_payload: { order_id }
    });
    await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_finish_reject', target_type: 'order', target_id: order_id, detail: { status: 'S10.5', reject_count: rejectCount, escalated: true }, result: 'ok', client_ip: clientIp, device });
    return { ok: true, data: { order_id, status: 'S10.5', finish_reject_count: rejectCount, escalated: true } };
  }
  await logStatus(order_id, 'S3_6', 'S3', 'finish_reject', openid);
  log.d(`finish rejected: ${order.order_no} S3_6→S3 (count=${rejectCount})`);
  writeNotice({
    to_openid: order.partner_openid, order_id, type: 'finish_reject',
    title: '对方暂未确认履约完毕',
    body: '需求方暂未确认履约完毕, 60 秒后可重新发起',
    action_key: 'jump_order', action_payload: { order_id }
  });
  await writeAudit(db, log, { openid, role, category: 'consent', action: 'order_finish_reject', target_type: 'order', target_id: order_id, detail: { status: 'S3', reject_count: rejectCount }, result: 'ok', client_ip: clientIp, device });
  return { ok: true, data: { order_id, status: 'S3', finish_reject_count: rejectCount } };
}

module.exports = { cancel, start_service, complete_service, milestone_submit, milestone_confirm, resume_service, user_confirm_start, start_apply, start_confirm, start_reject, server_now, start_photo, finish_apply, finish_confirm, finish_reject };
