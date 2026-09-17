// 对应 PRD 章节：PRD 3.6 标准化安全报备系统
// safety-report 安全报备与紧急求助 · 身份取自 getWXContext().OPENID
// 7 个 action:
//   sos               紧急求助:写 safety_report(active) + order_main.help_flag=true + platform_event(P0),返回本人紧急联系人
//   silent_sos        静默求助:同 sos,另存 sub_type='silent'(可被发起人本人撤销)
//   cancel_silent_sos 撤销静默求助:仅发起人本人且 sub_type='silent',active→cancelled + help_flag=false
//   resolve_sos       客服解除:admin_config.admin_openids 白名单,active→resolved + help_flag=false
//   resolve           解除求助:订单参与方均可,active→resolved + help_flag=false + platform_event(P1)
//   checkin           安全报备(报平安,带位置):写 safety_report(done),不改 help_flag
//   status            订单安全状态:求助标记/进行中求助/最近报备/本人紧急联系人
// MVP 口径(rules.md 第五节第9条):点击后立即写 platform_event(P0) + 前端弹紧急联系人一键拨号 + 订单标记求助中;不做真实报警对接
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 可发起求助/报备的订单状态(赴约 ~ 待评价);终态(取消/退款/评价/关闭/争议)不可
const ACTIVE_ORDER_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5', 'S4', 'S5'];

// 管理员白名单兜底(与 partner-action review 同源 admin_config.admin_openids)
const FALLBACK_ADMIN_OPENIDS = ['oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c'];

async function getOrder(orderId) {
  try {
    return (await col('order_main').doc(orderId).get()).data || null;
  } catch (e) {
    return null;
  }
}

function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

function roleOf(order, openid) {
  if (order.user_openid === openid) return 'user';
  if (order.partner_openid === openid) return 'partner';
  return null;
}

async function getAdminOpenids() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    const list = r.data && r.data[0] && r.data[0].admin_openids;
    if (Array.isArray(list) && list.length > 0) return list;
  } catch (e) {}
  return FALLBACK_ADMIN_OPENIDS;
}

// 取本人紧急联系人(真实号码,仅本人可读,用于 SOS 一键拨号)
async function getMyContacts(openid) {
  try {
    const r = await col('emergency_contact')
      .where({ openid, is_deleted: false })
      .limit(2)
      .get();
    return (r.data || []).map((c) => ({ name: c.name, phone: c.phone, relation: c.relation || '' }));
  } catch (e) {
    return [];
  }
}

function validLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < 3 || lat > 54 || lng < 73 || lng > 136) return null;  // 中国经纬度范围粗校
  return { latitude: lat, longitude: lng };
}

async function logEvent(level, type, openid, payload) {
  const now = Date.now();
  try {
    await col('platform_event').add({ data: {
      level, type, openid, payload,
      created_at: now, updated_at: now, is_deleted: false
    }});
  } catch (e) {
    console.log(`platform_event write fail: ${e.message}`);
  }
}

// 查询该订单进行中的求助(type=sos 涵盖一键/静默)
async function getActiveSos(orderId) {
  const r = await col('safety_report')
    .where({ order_id: orderId, type: 'sos', status: 'active', is_deleted: false })
    .orderBy('created_at', 'desc').limit(1).get();
  return (r.data && r.data[0]) || null;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const { resolveOpenid } = require('../_shared/openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'sr_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`safety-report action=${action} openid=${openid}`);

  if (['sos', 'silent_sos', 'cancel_silent_sos', 'resolve_sos', 'resolve', 'checkin', 'status'].indexOf(action) < 0) {
    return { ok: false, code: 'sr_unknown_action', msg: '未知动作' };
  }

  const { order_id } = event;
  if (!isValidDocId(order_id)) {
    return { ok: false, code: 'sr_bad_order_id', msg: '订单 ID 格式不正确:请传入订单 _id(32位十六进制)' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'sr_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);

  const now = Date.now();

  // ───────── 1. 紧急求助 / 静默求助(sos / silent_sos 共用) ─────────
  if (action === 'sos' || action === 'silent_sos') {
    if (!role) return { ok: false, code: 'sr_not_participant', msg: '你不是该订单参与方' };
    if (ACTIVE_ORDER_STATUS.indexOf(order.status) < 0) {
      return { ok: false, code: 'sr_status_not_allowed', msg: '订单当前状态不可发起求助' };
    }

    // 已有进行中的求助:幂等返回(不重复写事件)
    const exist = await getActiveSos(order_id);
    if (exist) {
      const contacts = await getMyContacts(openid);
      return {
        ok: true,
        data: {
          idempotent: true,
          report_id: exist._id,
          help_flag: true,
          my_contacts: contacts
        }
      };
    }

    const location = validLocation(event.location);
    const note = String(event.note || '').slice(0, 200);
    const subType = action === 'silent_sos' ? 'silent' : '';  // silent=静默求助(可被本人撤销)

    let reportId = '';
    try {
      const r = await col('safety_report').add({ data: {
        order_id,
        order_no: order.order_no || '',
        reporter_openid: openid,
        reporter_role: role,
        type: 'sos',
        sub_type: subType,
        status: 'active',
        location,
        note,
        resolved_at: null,
        resolved_by: '',
        created_at: now,
        updated_at: now,
        is_deleted: false
      }});
      reportId = r._id;

      await col('order_main').doc(order_id).update({ data: {
        help_flag: true, help_at: now, updated_at: now
      }});

      await logEvent('P0', 'safety_sos', openid, {
        order_id, order_no: order.order_no, role, sub_type: subType, location, note
      });

      console.log(`SOS triggered(${subType || 'normal'}): order=${order.order_no} by=${role} loc=${location ? 'yes' : 'no'}`);
    } catch (e) {
      console.log(`sos fail: ${e.message}`);
      return { ok: false, code: 'sr_sos_fail', msg: '求助提交失败,请直接拨打 110' };
    }

    const contacts = await getMyContacts(openid);
    return {
      ok: true,
      data: {
        report_id: reportId,
        help_flag: true,
        my_contacts: contacts,
        tip: '已记录紧急求助并通知平台,请立即联系紧急联系人或拨打 110/120'
      }
    };
  }

  // ───────── 2. 撤销静默求助(仅发起人本人,仅静默类型) ─────────
  if (action === 'cancel_silent_sos') {
    if (!role) return { ok: false, code: 'sr_not_participant', msg: '你不是该订单参与方' };
    const active = await getActiveSos(order_id);
    if (!active) return { ok: false, code: 'sr_no_active_sos', msg: '该订单没有进行中的求助' };
    if (active.reporter_openid !== openid) {
      return { ok: false, code: 'sr_not_reporter', msg: '只能撤销自己发起的求助' };
    }
    if (active.sub_type !== 'silent') {
      return { ok: false, code: 'sr_not_silent', msg: '一键求助不可自行撤销,请联系客服' };
    }
    try {
      await col('safety_report').doc(active._id).update({ data: {
        status: 'cancelled', cancelled_at: now, updated_at: now
      }});
      await col('order_main').doc(order_id).update({ data: {
        help_flag: false, updated_at: now
      }});
      await logEvent('P1', 'safety_sos_cancelled', openid, {
        order_id, order_no: order.order_no, role, sos_report_id: active._id
      });
      console.log(`silent SOS cancelled: order=${order.order_no} by=${role}`);
      return { ok: true, data: { order_id, help_flag: false } };
    } catch (e) {
      console.log(`cancel_silent_sos fail: ${e.message}`);
      return { ok: false, code: 'sr_cancel_fail', msg: '撤销失败,请稍后重试' };
    }
  }

  // ───────── 3. 客服解除(管理员白名单) ─────────
  if (action === 'resolve_sos') {
    const adminList = await getAdminOpenids();
    if (adminList.indexOf(openid) < 0) {
      return { ok: false, code: 'sr_not_admin', msg: '无管理员权限' };
    }
    const active = await getActiveSos(order_id);
    if (!active) return { ok: false, code: 'sr_no_active_sos', msg: '该订单没有进行中的求助' };
    try {
      await col('safety_report').doc(active._id).update({ data: {
        status: 'resolved', resolved_at: now, resolved_by: openid, resolved_role: 'admin', updated_at: now
      }});
      await col('order_main').doc(order_id).update({ data: {
        help_flag: false, updated_at: now
      }});
      await logEvent('P1', 'safety_sos_resolved', openid, {
        order_id, order_no: order.order_no, by_admin: true,
        sos_reporter: active.reporter_openid
      });
      console.log(`SOS resolved by admin: order=${order.order_no}`);
      return { ok: true, data: { order_id, help_flag: false, resolved_by: 'admin' } };
    } catch (e) {
      console.log(`resolve_sos fail: ${e.message}`);
      return { ok: false, code: 'sr_resolve_fail', msg: '解除失败,请稍后重试' };
    }
  }

  // ───────── 4. 解除求助(订单参与方) ─────────
  if (action === 'resolve') {
    if (!role) return { ok: false, code: 'sr_not_participant', msg: '你不是该订单参与方' };
    const active = await getActiveSos(order_id);
    if (!active) return { ok: false, code: 'sr_no_active_sos', msg: '该订单没有进行中的求助' };

    try {
      await col('safety_report').doc(active._id).update({ data: {
        status: 'resolved', resolved_at: now, resolved_by: openid, updated_at: now
      }});
      await col('order_main').doc(order_id).update({ data: {
        help_flag: false, updated_at: now
      }});
      await logEvent('P1', 'safety_sos_resolved', openid, {
        order_id, order_no: order.order_no, role,
        sos_reporter: active.reporter_openid
      });
      console.log(`SOS resolved: order=${order.order_no} by=${role}`);
      return { ok: true, data: { order_id, help_flag: false } };
    } catch (e) {
      console.log(`resolve fail: ${e.message}`);
      return { ok: false, code: 'sr_resolve_fail', msg: '解除失败,请稍后重试' };
    }
  }

  // ───────── 5. 安全报备(报平安) ─────────
  if (action === 'checkin') {
    if (!role) return { ok: false, code: 'sr_not_participant', msg: '你不是该订单参与方' };
    if (ACTIVE_ORDER_STATUS.indexOf(order.status) < 0) {
      return { ok: false, code: 'sr_status_not_allowed', msg: '订单当前状态不可报备' };
    }
    const location = validLocation(event.location);
    const note = String(event.note || '').slice(0, 200);

    try {
      const r = await col('safety_report').add({ data: {
        order_id,
        order_no: order.order_no || '',
        reporter_openid: openid,
        reporter_role: role,
        type: 'checkin',
        status: 'done',
        location,
        note,
        resolved_at: null,
        resolved_by: '',
        created_at: now,
        updated_at: now,
        is_deleted: false
      }});
      return {
        ok: true,
        data: {
          report_id: r._id,
          type: 'checkin',
          reporter_role: role,
          created_at: now,
          location,
          // W1 就医陪诊:每30分钟报备一次,返回下次报备时间(超时5分钟预警由 order-timer 处理)
          next_checkin_at: order.scene === 'W1' ? now + 30 * 60 * 1000 : null
        }
      };
    } catch (e) {
      console.log(`checkin fail: ${e.message}`);
      return { ok: false, code: 'sr_checkin_fail', msg: '报备失败,请稍后重试' };
    }
  }

  // ───────── 6. 订单安全状态 ─────────
  if (action === 'status') {
    // 仅订单参与方可读(含进行中求助的精确位置, 防 IDOR)
    if (!role) return { ok: false, code: 'sr_not_participant', msg: '你不是该订单参与方' };
    // sos + checkin + 紧急联系人 3 个独立查询合并为 1 批
    const [sosR, checkinR, contacts] = await Promise.all([
      col('safety_report')
        .where({ order_id, type: 'sos', status: 'active', is_deleted: false })
        .orderBy('created_at', 'desc').limit(1).get(),
      col('safety_report')
        .where({ order_id, type: 'checkin', is_deleted: false })
        .orderBy('created_at', 'desc').limit(5).get(),
      getMyContacts(openid)
    ]);

    let activeSos = null;
    if (sosR.data && sosR.data[0]) {
      const s = sosR.data[0];
      activeSos = {
        report_id: s._id,
        sub_type: s.sub_type || '',
        reporter_role: s.reporter_role,
        created_at: s.created_at,
        location: s.location || null,
        note: s.note || ''
      };
    }

    const checkins = (checkinR.data || []).map((c) => ({
      reporter_role: c.reporter_role,
      created_at: c.created_at,
      has_location: !!c.location,
      note: c.note || ''
    }));

    return {
      ok: true,
      data: {
        order_id,
        help_flag: !!order.help_flag,
        active_sos: activeSos,
        checkins,
        my_contacts: contacts
      }
    };
  }

  return { ok: false, code: 'sr_unknown_action', msg: '未知动作' };
};
