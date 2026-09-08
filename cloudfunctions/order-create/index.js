// 对应 PRD 章节：3.5 订单交易系统 / 3.5.2 订单创建 / 附录G 状态机 / 8.1 信用分 / 1.7.1 青少年保护
// order-create 订单创建 · 耍伴接单(create_from_take) · 身份取自 getWXContext().OPENID
// 1 个 action: create_from_take · 订单初始状态 S1(待确认/四确认阶段)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 进行中订单状态集合(用于"无进行中订单"校验)
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return {
    platform_fee_rate_fen: 1000,
    min_credit_take_order: 600,
    min_credit_place_order: 600,
    youth_limit_fen: 20000
  };
}

async function getUser(openid) {
  const r = await col('user_account').where({ openid }).limit(1).get();
  return (r.data && r.data[0]) || null;
}

async function getPartnerProfile(openid) {
  const r = await col('partner_profile').where({ openid, is_deleted: false }).limit(1).get();
  return (r.data && r.data[0]) || null;
}

// 接单被拒写 P3 事件,便于排查
async function logReject(openid, demand_id, reason) {
  try {
    await col('platform_event').add({ data: {
      level: 'P3', type: 'take_rejected', openid,
      payload: { demand_id, reason },
      created_at: Date.now(), updated_at: Date.now(), is_deleted: false
    }});
    console.log(`take_rejected: openid=${openid} demand=${demand_id} reason=${reason}`);
  } catch (e) {
    console.log(`logReject fail: ${e.message}`);
  }
}

// 生成订单编号 ORD + yyyymmdd + 6位随机
function genOrderNo() {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const r = Math.floor(100000 + Math.random() * 900000);
  return `ORD${ymd}${r}`;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return { ok: false, code: 'order_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`order-create action=${action} openid=${openid}`);

  if (action !== 'create_from_take') {
    return { ok: false, code: 'order_unknown_action', msg: '未知动作' };
  }

  const { demand_id } = event;
  if (!demand_id) return { ok: false, code: 'order_no_demand', msg: '缺少需求 ID' };

  const config = await getConfig();

  // ── 取耍伴身份 ──
  const partnerUser = await getUser(openid);
  if (!partnerUser) {
    await logReject(openid, demand_id, 'partner_no_user');
    return { ok: false, code: 'order_no_user', msg: '用户不存在' };
  }
  if (!(partnerUser.roles || []).includes('partner')) {
    await logReject(openid, demand_id, 'not_partner');
    return { ok: false, code: 'order_not_partner', msg: '你还不是耍伴,请先申请入驻' };
  }
  if (partnerUser.status === 'frozen') {
    await logReject(openid, demand_id, 'partner_frozen');
    return { ok: false, code: 'order_frozen', msg: '账号已冻结,不可接单' };
  }

  // ── 耍伴资料:审核通过 + 接单开关 ──
  const profile = await getPartnerProfile(openid);
  if (!profile || profile.status !== 'approved') {
    await logReject(openid, demand_id, 'partner_not_approved');
    return { ok: false, code: 'order_not_approved', msg: '耍伴资料未审核通过' };
  }
  if (!profile.accept_switch) {
    await logReject(openid, demand_id, 'switch_off');
    return { ok: false, code: 'order_switch_off', msg: '接单开关已关闭' };
  }

  // ── 耍伴信用分 ──
  if ((partnerUser.partner_credit_score || 800) < (config.min_credit_take_order || 600)) {
    await logReject(openid, demand_id, 'partner_credit_low');
    return { ok: false, code: 'order_credit_low', msg: '信用分低于接单门槛' };
  }

  // ── 无进行中订单 ──
  try {
    const busy = await col('order_main').where({
      partner_openid: openid, status: _.in(BUSY_STATUS), is_deleted: false
    }).limit(1).get();
    if (busy.data && busy.data.length > 0) {
      await logReject(openid, demand_id, 'partner_busy');
      return { ok: false, code: 'order_busy', msg: '你有进行中订单,不可同时接单' };
    }
  } catch (e) {
    return { ok: false, code: 'order_busy_check_fail', msg: '系统繁忙,请稍后重试' };
  }

  // ── 取需求 ──
  let demand;
  try {
    demand = (await col('demand').doc(demand_id).get()).data;
  } catch (e) {
    await logReject(openid, demand_id, 'demand_not_found');
    return { ok: false, code: 'order_demand_not_found', msg: '需求不存在' };
  }
  if (!demand) {
    await logReject(openid, demand_id, 'demand_not_found');
    return { ok: false, code: 'order_demand_not_found', msg: '需求不存在' };
  }

  // 不能接自己的单
  if (demand.creator_openid === openid) {
    await logReject(openid, demand_id, 'own_demand');
    return { ok: false, code: 'order_own_demand', msg: '不能接自己发布的需求' };
  }

  // 需求状态
  if (demand.status !== 'matching') {
    await logReject(openid, demand_id, `demand_status_${demand.status}`);
    return { ok: false, code: 'order_demand_closed', msg: '该需求已不可接单' };
  }

  // 需求未过期
  if (demand.expire_at && demand.expire_at < Date.now()) {
    await logReject(openid, demand_id, 'demand_expired');
    return { ok: false, code: 'order_demand_expired', msg: '该需求已过期' };
  }

  // 广播或在邀约名单中
  const invited = demand.invited || [];
  if (!demand.broadcast && invited.indexOf(openid) < 0) {
    await logReject(openid, demand_id, 'not_invited_or_broadcast');
    return { ok: false, code: 'order_not_allowed', msg: '你不在该需求的接单范围' };
  }

  // ── 场景须在耍伴接受范围内 ──
  if (!(profile.accept_scenes || []).includes(demand.scene)) {
    await logReject(openid, demand_id, 'scene_not_accepted');
    return { ok: false, code: 'order_scene_not_accepted', msg: '你未开通该场景的接单' };
  }

  // ── 创建者校验:存在 + 未冻结 + 信用分 ──
  const creator = await getUser(demand.creator_openid);
  if (!creator) {
    await logReject(openid, demand_id, 'creator_not_found');
    return { ok: false, code: 'order_creator_not_found', msg: '需求发布者状态异常' };
  }
  if (creator.status === 'frozen') {
    await logReject(openid, demand_id, 'creator_frozen');
    return { ok: false, code: 'order_creator_frozen', msg: '对方账号已冻结' };
  }
  if ((creator.user_credit_score || 800) < (config.min_credit_place_order || 600)) {
    await logReject(openid, demand_id, 'creator_credit_low');
    return { ok: false, code: 'order_creator_credit_low', msg: '对方信用分不足,暂不能接单' };
  }

  // ── 青少年保护:双方任一 18-22 岁,总价 <= youth_limit_fen ──
  const youthLimit = config.youth_limit_fen || 20000;
  const isYouth = (u) => u && u.age !== null && u.age !== undefined && u.age >= 18 && u.age <= 22;
  if ((isYouth(partnerUser) || isYouth(creator)) && demand.total_fen > youthLimit) {
    await logReject(openid, demand_id, 'youth_limit');
    return { ok: false, code: 'order_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
  }

  // ── 创建订单 ──
  const now = Date.now();
  const orderNo = genOrderNo();
  const totalFen = demand.total_fen;
  const feeFen = Math.round(totalFen * (config.platform_fee_rate_fen || 1000) / 10000);
  const partnerIncomeFen = totalFen - feeFen;

  const orderData = {
    order_no: orderNo,
    demand_id,
    demand_no: demand.demand_no || '',
    user_openid: demand.creator_openid,
    partner_openid: openid,
    scene: demand.scene,
    start_time: demand.start_time,
    duration_h: demand.duration_h,
    location: demand.location,
    content_options: demand.content_options || [],
    rate_fen: demand.rate_fen,
    total_fen: totalFen,
    fee_fen: feeFen,
    partner_income_fen: partnerIncomeFen,
    aa_tier: demand.aa_tier,
    aa_promise_signed: !!demand.aa_promise_signed,
    status: 'S1',               // 待确认(四确认阶段)
    pay_expire_at: null,        // 四确认完成进入 S0 时设置 now+30min
    help_flag: false,           // 紧急求助标记
    created_at: now,
    updated_at: now,
    is_deleted: false
  };

  try {
    const addRes = await col('order_main').add({ data: orderData });
    const orderId = addRes._id;

    // 四确认文档:8 个确认位,初值取自需求,任一方修改则全部重置(下一模块实现)
    await col('order_confirmations').add({ data: {
      order_id: orderId,
      items: {
        time:     { value: demand.start_time,              user_ok: false, partner_ok: false },
        location: { value: demand.location,                user_ok: false, partner_ok: false },
        content:  { value: demand.content_options || [],   user_ok: false, partner_ok: false },
        fee:      { value: totalFen,                       user_ok: false, partner_ok: false }
      },
      version: 1,
      created_at: now, updated_at: now, is_deleted: false
    }});

    // 需求状态 → matched
    await col('demand').doc(demand_id).update({ data: {
      status: 'matched', updated_at: now
    }});

    // 状态流水
    await col('order_status_log').add({ data: {
      order_id: orderId, from_status: null, to_status: 'S1',
      action: 'create_from_take', operator: openid,
      created_at: now, updated_at: now, is_deleted: false
    }});

    console.log(`order created: ${orderNo} demand=${demand.demand_no} partner=${openid}`);
    return {
      ok: true,
      data: {
        order_id: orderId, order_no: orderNo,
        status: 'S1', total_fen: totalFen, fee_fen: feeFen, partner_income_fen: partnerIncomeFen
      }
    };
  } catch (e) {
    console.log(`order create fail: ${e.message}`);
    return { ok: false, code: 'order_db_fail', msg: '订单创建失败' };
  }
};
