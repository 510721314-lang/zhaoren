// 对应 PRD 章节：PRD 3.6 标准化安全报备系统
// safety-report 安全报备与紧急求助 · 身份取自 getWXContext().OPENID
// 4 个 action:
//   sos      紧急求助:写 safety_report(active) + order_main.help_flag=true + platform_event(P0),返回本人紧急联系人
//   resolve  解除求助:参与方均可,active→resolved + help_flag=false + platform_event(P1)
//   checkin  安全报备(报平安,带位置):写 safety_report(done),不改 help_flag
//   status   订单安全状态:求助标记/进行中求助/最近报备/本人紧急联系人
// MVP 口径(rules.md 第五节第9条):点击后立即写 platform_event(P0) + 前端弹紧急联系人一键拨号 + 订单标记求助中;不做真实报警对接
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 可发起求助/报备的订单状态(赴约 ~ 待评价);终态(取消/退款/评价/关闭/争议)不可
const ACTIVE_ORDER_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5', 'S4', 'S5'];

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

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || event.mock_openid;
  if (!openid) return { ok: false, code: 'sr_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`safety-report action=${action} openid=${openid}`);

  if (['sos', 'resolve', 'checkin', 'status'].indexOf(action) < 0) {
    return { ok: false, code: 'sr_unknown_action', msg: '未知动作' };
  }

  const { order_id } = event;
  if (!isValidDocId(order_id)) {
    return { ok: false, code: 'sr_bad_order_id', msg: '订单 ID 格式不正确:请传入订单 _id(32位十六进制)' };
  }
  const order = await getOrder(order_id);
  if (!order) return { ok: false, code: 'sr_not_found', msg: '订单不存在' };
  const role = roleOf(order, openid);
  if (!role) return { ok: false, code: 'sr_not_participant', msg: '你不是该订单参与方' };

  const now = Date.now();

  // ───────── 1. 紧急求助 ─────────
  if (action === 'sos') {
    if (ACTIVE_ORDER_STATUS.indexOf(order.status) < 0) {
      return { ok: false, code: 'sr_status_not_allowed', msg: '订单当前状态不可发起求助' };
    }

    // 已有进行中的求助:幂等返回(不重复写事件)
    const exist = await col('safety_report')
      .where({ order_id, type: 'sos', status: 'active', is_deleted: false })
      .limit(1).get();
    if (exist.data && exist.data[0]) {
      const contacts = await getMyContacts(openid);
      return {
        ok: true,
        data: {
          idempotent: true,
          report_id: exist.data[0]._id,
          help_flag: true,
          my_contacts: contacts
        }
      };
    }

    const location = validLocation(event.location);
    const note = String(event.note || '').slice(0, 200);

    let reportId = '';
    try {
      const r = await col('safety_report').add({ data: {
        order_id,
        order_no: order.order_no || '',
        reporter_openid: openid,
        reporter_role: role,
        type: 'sos',
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
        order_id, order_no: order.order_no, role, location, note
      });

      console.log(`SOS triggered: order=${order.order_no} by=${role} loc=${location ? 'yes' : 'no'}`);
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

  // ───────── 2. 解除求助 ─────────
  if (action === 'resolve') {
    const active = await col('safety_report')
      .where({ order_id, type: 'sos', status: 'active', is_deleted: false })
      .limit(1).get();
    if (!active.data || !active.data[0]) {
      return { ok: false, code: 'sr_no_active_sos', msg: '该订单没有进行中的求助' };
    }

    try {
      await col('safety_report').doc(active.data[0]._id).update({ data: {
        status: 'resolved', resolved_at: now, resolved_by: openid, updated_at: now
      }});
      await col('order_main').doc(order_id).update({ data: {
        help_flag: false, updated_at: now
      }});
      await logEvent('P1', 'safety_sos_resolved', openid, {
        order_id, order_no: order.order_no, role,
        sos_reporter: active.data[0].reporter_openid
      });
      console.log(`SOS resolved: order=${order.order_no} by=${role}`);
      return { ok: true, data: { order_id, help_flag: false } };
    } catch (e) {
      console.log(`resolve fail: ${e.message}`);
      return { ok: false, code: 'sr_resolve_fail', msg: '解除失败,请稍后重试' };
    }
  }

  // ───────── 3. 安全报备(报平安) ─────────
  if (action === 'checkin') {
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
          location
        }
      };
    } catch (e) {
      console.log(`checkin fail: ${e.message}`);
      return { ok: false, code: 'sr_checkin_fail', msg: '报备失败,请稍后重试' };
    }
  }

  // ───────── 4. 订单安全状态 ─────────
  if (action === 'status') {
    const [sosR, checkinR] = await Promise.all([
      col('safety_report')
        .where({ order_id, type: 'sos', status: 'active', is_deleted: false })
        .orderBy('created_at', 'desc').limit(1).get(),
      col('safety_report')
        .where({ order_id, type: 'checkin', is_deleted: false })
        .orderBy('created_at', 'desc').limit(5).get()
    ]);

    let activeSos = null;
    if (sosR.data && sosR.data[0]) {
      const s = sosR.data[0];
      activeSos = {
        report_id: s._id,
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

    const contacts = await getMyContacts(openid);

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
