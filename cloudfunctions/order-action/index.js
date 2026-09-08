// 对应 PRD 章节：3.3 四确认机制 / 3.5 订单交易系统 / 附录G 状态机 / 8.3 超时规则 / 1.7.1 青少年保护
// order-action 订单动作(四确认 + 取消) · 身份取自 getWXContext().OPENID
// 4 个 action: get_confirmation / update_item / confirm_item / cancel
// 四确认 SSOT:时间/地点/内容/费用四项,用户与耍伴双方各确认一次共 8 位;
//   8 位全完成 → S1→S0(待支付,30 分钟支付时限);任一方修改任一项 → 8 位全部重置。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const CONFIRM_FIELDS = ['time', 'location', 'content', 'fee'];

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { s0_timeout_min: 30, youth_limit_fen: 20000, platform_fee_rate_fen: 1000 };
}

async function getOrder(orderId) {
  try {
    return (await col('order_main').doc(orderId).get()).data || null;
  } catch (e) {
    return null;
  }
}

async function getConfirmation(orderId) {
  const r = await col('order_confirmations').where({ order_id: orderId, is_deleted: false }).limit(1).get();
  return (r.data && r.data[0]) || null;
}

async function logStatus(orderId, from, to, action, operator) {
  await col('order_status_log').add({ data: {
    order_id: orderId, from_status: from, to_status: to,
    action, operator,
    created_at: Date.now(), updated_at: Date.now(), is_deleted: false
  }});
}

// 判定调用者在订单中的角色
function roleOf(order, openid) {
  if (order.user_openid === openid) return 'user';
  if (order.partner_openid === openid) return 'partner';
  return null;
}

// 8 个确认位是否全部完成
function allConfirmed(items) {
  for (const f of CONFIRM_FIELDS) {
    const it = items[f];
    if (!it || !it.user_ok || !it.partner_ok) return false;
  }
  return true;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return { ok: false, code: 'oa_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`order-action action=${action} openid=${openid}`);

  // ───────── 1. 查询四确认状态 ─────────
  if (action === 'get_confirmation') {
    const { order_id } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    // 统计已确认位数(供前端展示进度)
    let confirmedCount = 0;
    const fields = {};
    for (const f of CONFIRM_FIELDS) {
      const it = conf.items[f] || {};
      if (it.user_ok) confirmedCount++;
      if (it.partner_ok) confirmedCount++;
      fields[f] = { value: it.value, user_ok: !!it.user_ok, partner_ok: !!it.partner_ok };
    }

    return {
      ok: true,
      data: {
        order_id,
        order_no: order.order_no,
        status: order.status,
        role,
        items: fields,
        confirmed_count: confirmedCount,   // 0-8
        total_count: 8,
        all_confirmed: allConfirmed(conf.items),
        version: conf.version || 1
      }
    };
  }

  // ───────── 2. 修改某一项(8 位全重置) ─────────
  if (action === 'update_item') {
    const { order_id, item, value } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    if (CONFIRM_FIELDS.indexOf(item) < 0) {
      return { ok: false, code: 'oa_bad_item', msg: '确认项只能是 时间/地点/内容/费用' };
    }
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S1') {
      return { ok: false, code: 'oa_not_editable', msg: '订单当前状态不可修改确认项' };
    }

    const config = await getConfig();
    const now = Date.now();

    // 各项 value 校验
    let updateOrder = null;   // 若改费用需同步订单金额
    if (item === 'time') {
      const ts = Number(value);
      if (!ts || ts <= now) return { ok: false, code: 'oa_time_future', msg: '服务时间必须是未来时间' };
    } else if (item === 'location') {
      if (!value || !value.name || !value.latitude || !value.longitude) {
        return { ok: false, code: 'oa_location_invalid', msg: '地点信息不完整' };
      }
    } else if (item === 'content') {
      if (!Array.isArray(value)) return { ok: false, code: 'oa_content_invalid', msg: '服务内容格式有误' };
    } else if (item === 'fee') {
      const fee = Number(value);
      if (!fee || fee <= 0 || !Number.isInteger(fee)) {
        return { ok: false, code: 'oa_fee_invalid', msg: '费用金额格式有误' };
      }
      // 青少年保护:改后总价仍受 200 元上限约束
      const youthLimit = config.youth_limit_fen || 20000;
      // 取双方年龄(订单里没存年龄,查用户)
      const [u, p] = await Promise.all([
        col('user_account').where({ openid: order.user_openid }).limit(1).get(),
        col('user_account').where({ openid: order.partner_openid }).limit(1).get()
      ]);
      const isYouth = (doc) => doc && doc.age !== null && doc.age !== undefined && doc.age >= 18 && doc.age <= 22;
      const uYouth = u.data && u.data[0] && isYouth(u.data[0]);
      const pYouth = p.data && p.data[0] && isYouth(p.data[0]);
      if ((uYouth || pYouth) && fee > youthLimit) {
        return { ok: false, code: 'oa_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
      }
      const feeFen = Math.round(fee * (config.platform_fee_rate_fen || 1000) / 10000);
      updateOrder = { total_fen: fee, fee_fen: feeFen, partner_income_fen: fee - feeFen };
    }

    // 重置 8 位 + 更新该项 value
    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    const newItems = {};
    for (const f of CONFIRM_FIELDS) {
      newItems[f] = {
        value: f === item ? value : conf.items[f].value,
        user_ok: false,
        partner_ok: false
      };
    }

    try {
      await col('order_confirmations').doc(conf._id).update({ data: {
        items: newItems,
        version: (conf.version || 1) + 1,
        updated_at: now
      }});

      // 改费用同步订单金额与时间
      const orderPatch = { updated_at: now };
      if (item === 'fee') Object.assign(orderPatch, updateOrder);
      if (item === 'time') orderPatch.start_time = Number(value);
      if (item === 'location') orderPatch.location = value;
      if (item === 'content') orderPatch.content_options = value;
      await col('order_main').doc(order_id).update({ data: orderPatch });

      console.log(`confirm item updated: order=${order.order_no} item=${item} by=${role}, all reset`);
      return {
        ok: true,
        data: { item, reset: true, version: (conf.version || 1) + 1, confirmed_count: 0, total_count: 8 }
      };
    } catch (e) {
      console.log(`update_item fail: ${e.message}`);
      return { ok: false, code: 'oa_update_fail', msg: '修改失败,请稍后重试' };
    }
  }

  // ───────── 3. 确认某一项(置本方 ok) ─────────
  if (action === 'confirm_item') {
    const { order_id, item } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    if (CONFIRM_FIELDS.indexOf(item) < 0) {
      return { ok: false, code: 'oa_bad_item', msg: '确认项只能是 时间/地点/内容/费用' };
    }
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S1') {
      return { ok: false, code: 'oa_not_confirmable', msg: '订单当前状态不可确认' };
    }

    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    const okKey = role + '_ok';   // user_ok / partner_ok
    // 幂等:本方已确认该项,直接返回当前状态
    if (conf.items[item][okKey]) {
      let cnt = 0;
      for (const f of CONFIRM_FIELDS) {
        if (conf.items[f].user_ok) cnt++;
        if (conf.items[f].partner_ok) cnt++;
      }
      return { ok: true, data: { item, idempotent: true, confirmed_count: cnt, total_count: 8, all_confirmed: allConfirmed(conf.items), status: order.status } };
    }

    // 置本方 ok(只改这一位,不动其他位)
    const newItems = JSON.parse(JSON.stringify(conf.items));
    newItems[item][okKey] = true;

    try {
      await col('order_confirmations').doc(conf._id).update({ data: {
        items: newItems, updated_at: Date.now()
      }});

      // 统计
      let cnt = 0;
      for (const f of CONFIRM_FIELDS) {
        if (newItems[f].user_ok) cnt++;
        if (newItems[f].partner_ok) cnt++;
      }
      const done = allConfirmed(newItems);

      // 8 位全完成 → S1 → S0(待支付,30 分钟支付时限)
      let newStatus = order.status;
      if (done) {
        const config = await getConfig();
        const payExpire = Date.now() + (config.s0_timeout_min || 30) * 60 * 1000;
        await col('order_main').doc(order_id).update({ data: {
          status: 'S0', pay_expire_at: payExpire, updated_at: Date.now()
        }});
        await logStatus(order_id, 'S1', 'S0', 'four_confirm_done', openid);
        newStatus = 'S0';
        console.log(`four confirm done: order=${order.order_no} → S0, pay_expire=${payExpire}`);
      }

      return {
        ok: true,
        data: {
          item, role, confirmed_count: cnt, total_count: 8,
          all_confirmed: done, status: newStatus
        }
      };
    } catch (e) {
      console.log(`confirm_item fail: ${e.message}`);
      return { ok: false, code: 'oa_confirm_fail', msg: '确认失败,请稍后重试' };
    }
  }

  // ───────── 4. 取消订单(S1/S0 → S6) ─────────
  if (action === 'cancel') {
    const { order_id, reason } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    if (order.status !== 'S1' && order.status !== 'S0') {
      return { ok: false, code: 'oa_cancel_status', msg: `订单当前状态(${order.status})不可取消` };
    }
    // S0(待支付)仅用户可取消;S1(待确认)双方均可
    if (order.status === 'S0' && role !== 'user') {
      return { ok: false, code: 'oa_cancel_perm', msg: '待支付订单仅下单用户可取消' };
    }

    const now = Date.now();
    try {
      await col('order_main').doc(order_id).update({ data: {
        status: 'S6', updated_at: now
      }});
      await logStatus(order_id, order.status, 'S6', role === 'user' ? 'user_cancel' : 'partner_cancel', openid);

      // S1 阶段取消:释放需求回 matching,可被其他耍伴接
      if (order.status === 'S1' && order.demand_id) {
        try {
          await col('demand').doc(order.demand_id).update({ data: {
            status: 'matching', updated_at: now
          }});
          console.log(`demand released: ${order.demand_id} → matching`);
        } catch (e) {}
      }

      console.log(`order cancelled: ${order.order_no} ${order.status}→S6 by=${role}`);
      return { ok: true, data: { order_id, status: 'S6', demand_released: order.status === 'S1' } };
    } catch (e) {
      console.log(`cancel fail: ${e.message}`);
      return { ok: false, code: 'oa_cancel_fail', msg: '取消失败' };
    }
  }

  return { ok: false, code: 'oa_unknown_action', msg: '未知动作' };
};
