// 对应 PRD 章节：3.3 四确认机制 / 3.5 订单交易系统 / 附录G 状态机 / 8.3 超时规则 / 1.7.1 青少年保护
// order-action 订单动作(四确认 + 取消 + 状态机扩展) · 身份取自 getWXContext().OPENID
// 14 个 action: get_confirmation / update_item / confirm_item / confirm_all /
//              cancel / start_service / complete_service / milestone_submit / milestone_confirm /
//              modify / modify_confirm / modify_reject / resume_service / partial_confirm / ratio_confirm / complaint /
//              detail / my_orders / my_counts
// 四确认 SSOT:时间/地点/内容/费用四项,用户与耍伴双方各确认一次共 8 位;
//   8 位全完成 → S1→S0(待支付,30 分钟支付时限);任一方修改任一项 → 8 位全部重置。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

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

/**
 * 写一条系统通知到 system_notice 集合(不阻塞主流程, try-catch 吞掉)
 * @param {object} opt
 * @param {string} opt.to_openid - 收件人
 * @param {string} opt.order_id - 关联订单(可选)
 * @param {string} opt.type - 通知类型枚举: accept/pay/start/modify/modify_confirm/modify_reject/cancel/milestone/finish/evaluate/settle/pause/resume/custom
 * @param {string} opt.title - 标题
 * @param {string} opt.body - 正文
 * @param {string} opt.action_key - 点击后续动作: jump_order/jump_chat/jump_pay/jump_accept_modify/jump_wallet/jump_evaluate
 * @param {object} opt.action_payload - 动作参数(如 {order_id})
 */
async function writeNotice(opt) {
  try {
    await col('system_notice').add({
      data: {
        to_openid: opt.to_openid,
        order_id: opt.order_id || '',
        type: opt.type || 'custom',
        title: opt.title,
        body: opt.body || '',
        action_key: opt.action_key || '',
        action_payload: opt.action_payload || {},
        created_at: Date.now(),
        read: false
      }
    });
  } catch (e) {
    log.d('[notice] write failed:', opt.to_openid, opt.type, e.message);
  }
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制
// 拦截订单号(ORD 开头)、<ORDER_ID> 占位符、含空格/截断的非法 ID,避免 doc() 抛错被吞成"订单不存在"
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// Haversine 球面距离(公里) · 两经纬度间直线距离
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 通勤估算:步行 5km/h、骑行 15km/h、公交 20km/h(含等车)、驾车 30km/h(城市道路含红绿灯)
function estimateCommute(km) {
  const walk = Math.round(km / 5 * 60);
  const bike = Math.round(km / 15 * 60);
  const bus = Math.round(km / 20 * 60);
  const drive = Math.round(km / 30 * 60);
  return {
    distance_km: Math.round(km * 10) / 10,
    walk_min: walk,
    bike_min: bike,
    bus_min: bus,
    drive_min: drive
  };
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

// CAS 条件更新: 仅当订单仍处于期望状态(字符串或数组)时更新, 防止并发/重复流转
// 与 order-timer.casStatus 同构; 返回是否"抢到"
async function casStatus(orderId, expect, patch) {
  try {
    const cond = Array.isArray(expect) ? _.in(expect) : expect;
    const r = await col('order_main').where({ _id: orderId, status: cond }).update({ data: patch });
    return !!(r.stats && r.stats.updated === 1);
  } catch (e) {
    log.d(`casStatus fail: ${e.message}`);
    return false;
  }
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
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'oa_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`order-action action=${action} openid=${openid}`);

  // 需要订单 _id 的动作统一做格式预检(避免 doc(非法ID) 抛错被吞成"订单不存在")
  // 订单 ID 解析: 支持 32 位 hex _id 或 ORD 开头订单号(后者查 order_main 反查 _id)
  let order_id = event.order_id;
  const ORDER_ID_ACTIONS = ['get_confirmation', 'update_item', 'confirm_item', 'confirm_all', 'cancel', 'start_service', 'complete_service', 'detail', 'modify', 'modify_confirm', 'modify_reject', 'resume_service', 'partial_confirm', 'ratio_confirm', 'complaint'];
  if (ORDER_ID_ACTIONS.indexOf(action) >= 0) {
    if (!order_id) {
      return { ok: false, code: 'oa_bad_order_id', msg: '缺少 order_id' };
    }
    if (isValidDocId(order_id)) {
      // 32 位 hex, 直接当 _id 用
    } else if (typeof order_id === 'string' && /^ORD[0-9]+$/.test(order_id)) {
      // ORD 订单号, 反查 _id
      try {
        const lookup = await col('order_main').where({ order_no: order_id }).limit(1).get();
        if (!lookup.data || !lookup.data[0]) {
          return { ok: false, code: 'oa_bad_order_id', msg: '订单号 ' + order_id + ' 未找到对应订单' };
        }
        order_id = lookup.data[0]._id;
      } catch (e) {
        return { ok: false, code: 'oa_bad_order_id', msg: '反查订单号失败: ' + e.message };
      }
    } else {
      return { ok: false, code: 'oa_bad_order_id', msg: '订单 ID 格式不正确:请传入 32 位十六进制 _id 或 ORD 开头订单号' };
    }
  }

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
    if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
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

    // OCC 乐观锁: 以 version 为条件整单替换; 期间若有并发确认(version+1)则放弃, 避免静默吃掉确认位
    const v = conf.version || 1;
    let occRes;
    try {
      occRes = await col('order_confirmations').where({ _id: conf._id, version: v }).update({ data: {
        items: newItems,
        version: v + 1,
        updated_at: now
      }});
    } catch (e) {
      log.d(`update_item occ fail: ${e.message}`);
      return { ok: false, code: 'oa_update_fail', msg: '修改失败,请稍后重试' };
    }
    if (!occRes.stats || occRes.stats.updated !== 1) {
      return { ok: false, code: 'oa_conflict', msg: '确认信息刚被对方更新,请刷新后重试' };
    }

    // 改费用同步订单金额与时间; CAS: 仅订单仍在 S1 时写入(已取消/超时则不动)
    const orderPatch = { updated_at: now };
    if (item === 'fee') Object.assign(orderPatch, updateOrder);
    if (item === 'time') orderPatch.start_time = Number(value);
    if (item === 'location') orderPatch.location = value;
    if (item === 'content') orderPatch.content_options = value;
    const orderWon = await casStatus(order_id, 'S1', orderPatch);
    if (!orderWon) {
      return { ok: false, code: 'oa_conflict', msg: '订单状态已变化,请刷新后重试' };
    }

    log.d(`confirm item updated: order=${order.order_no} item=${item} by=${role}, all reset`);
    return {
      ok: true,
      data: { item, reset: true, version: v + 1, confirmed_count: 0, total_count: 8 }
    };
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
    if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
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

    // 原子置本方 ok: 只写这一位(点路径) + version+1, 避免双方并发确认整对象覆盖丢位
    const now = Date.now();
    try {
      await col('order_confirmations').doc(conf._id).update({ data: {
        ['items.' + item + '.' + okKey]: true,
        version: _.inc(1),
        updated_at: now
      }});
    } catch (e) {
      log.d(`confirm_item fail: ${e.message}`);
      return { ok: false, code: 'oa_confirm_fail', msg: '确认失败,请稍后重试' };
    }

    // 重读确认单统计(不基于写前快照, 保证并发下计数正确)
    const fresh = await getConfirmation(order_id);
    const freshItems = (fresh && fresh.items) || conf.items;
    let cnt = 0;
    for (const f of CONFIRM_FIELDS) {
      if (freshItems[f].user_ok) cnt++;
      if (freshItems[f].partner_ok) cnt++;
    }
    const done = allConfirmed(freshItems);

    // 8 位全完成 → CAS S1→S0(待支付,30 分钟支付时限); 并发的最后一笔确认仅一方抢到
    let newStatus = order.status;
    if (done) {
      const config = await getConfig();
      const payExpire = now + (config.s0_timeout_min || 30) * 60 * 1000;
      const won = await casStatus(order_id, 'S1', {
        status: 'S0', pay_expire_at: payExpire, updated_at: now
      });
      if (won) {
        await logStatus(order_id, 'S1', 'S0', 'four_confirm_done', openid);
        newStatus = 'S0';
        log.d(`four confirm done: order=${order.order_no} → S0, pay_expire=${payExpire}`);
      } else {
        // 未抢到: 多为并发确认/定时器取消; S0 视为幂等成功, 其余报冲突
        const latest = await getOrder(order_id);
        newStatus = latest ? latest.status : 'S1';
        if (newStatus !== 'S0') {
          return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
        }
      }
    }

    return {
      ok: true,
      data: {
        item, role, confirmed_count: cnt, total_count: 8,
        all_confirmed: done, status: newStatus
      }
    };
  }

  // ───────── 3.5 一键确认本方全部 4 项(测试便捷用) ─────────
  if (action === 'confirm_all') {
    const { order_id } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: `你不是该订单参与方(你的:${openid},user:${order.user_openid},partner:${order.partner_openid})` };
    if (order.status !== 'S1') {
      return { ok: false, code: 'oa_not_confirmable', msg: '订单当前状态不可确认' };
    }
    const conf = await getConfirmation(order_id);
    if (!conf) return { ok: false, code: 'oa_no_confirm_doc', msg: '确认单不存在' };

    const okKey = role + '_ok';

    // 原子置本方 4 位(点路径, 一次更新) + version+1
    const now = Date.now();
    const bitPatch = { version: _.inc(1), updated_at: now };
    for (const f of CONFIRM_FIELDS) { bitPatch['items.' + f + '.' + okKey] = true; }
    try {
      await col('order_confirmations').doc(conf._id).update({ data: bitPatch });
    } catch (e) {
      log.d(`confirm_all fail: ${e.message}`);
      return { ok: false, code: 'oa_confirm_fail', msg: '确认失败' };
    }

    // 重读统计
    const fresh = await getConfirmation(order_id);
    const freshItems = (fresh && fresh.items) || conf.items;
    let cnt = 0;
    for (const f of CONFIRM_FIELDS) {
      if (freshItems[f].user_ok) cnt++;
      if (freshItems[f].partner_ok) cnt++;
    }
    const done = allConfirmed(freshItems);
    let newStatus = order.status;
    if (done) {
      const config = await getConfig();
      const payExpire = now + (config.s0_timeout_min || 30) * 60 * 1000;
      const won = await casStatus(order_id, 'S1', { status: 'S0', pay_expire_at: payExpire, updated_at: now });
      if (won) {
        await logStatus(order_id, 'S1', 'S0', 'four_confirm_done', openid);
        newStatus = 'S0';
      } else {
        const latest = await getOrder(order_id);
        newStatus = latest ? latest.status : 'S1';
        if (newStatus !== 'S0') {
          return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
        }
      }
    }
    return { ok: true, data: { role, confirmed_count: cnt, total_count: 8, all_confirmed: done, status: newStatus } };
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
    const fromStatus = order.status;
    // CAS: 仅 S1/S0 → S6, 与定时器/并发取消/支付互斥
    const won = await casStatus(order_id, ['S1', 'S0'], {
      status: 'S6', cancel_at: now, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S6') {
        return { ok: true, data: { order_id, status: 'S6', demand_released: false, idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }

    await logStatus(order_id, fromStatus, 'S6', role === 'user' ? 'user_cancel' : 'partner_cancel', openid);

    // S1 阶段取消:条件释放需求(仅 matched→matching, 不覆盖已过期/取消的需求)
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
    return { ok: true, data: { order_id, status: 'S6', demand_released: demandReleased } };
  }

  // 开始履约:S2 → S3(耍伴发起)
  if (action === 'start_service') {
    const { order_id } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (role !== 'partner') return { ok: false, code: 'oa_start_perm', msg: '仅耍伴可开始履约' };
    if (order.status !== 'S2') return { ok: false, code: 'oa_start_status', msg: `订单当前状态(${order.status})不可开始履约` };

    const now = Date.now();
    // CAS S2→S3, 防重复开始
    const won = await casStatus(order_id, 'S2', {
      status: 'S3', service_started_at: now, updated_at: now,
      milestone: { current: 0, confirmed: [false, false, false], evidence: [], submitted_at: null }
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S3') {
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
    return { ok: true, data: { order_id, status: 'S3', service_started_at: now } };
  }

  // 完成履约:S3 → S5(耍伴发起)
  if (action === 'complete_service') {
    const { order_id } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (role !== 'partner') return { ok: false, code: 'oa_complete_perm', msg: '仅耍伴可完成履约' };
    if (order.status !== 'S3') return { ok: false, code: 'oa_complete_status', msg: `订单当前状态(${order.status})不可完成履约` };

    // 里程碑校验:需提交到100%(current===3)才可完成履约
    const ms = order.milestone || { current: 0 };
    if (ms.current < 3) {
      return { ok: false, code: 'oa_milestone_required', msg: `请先提交履约进度到100%(当前${ms.current}/3)再完成履约` };
    }

    const now = Date.now();
    // CAS S3→S5, 防重复完成
    const won = await casStatus(order_id, 'S3', {
      status: 'S5', service_completed_at: now, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S5') {
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
    return { ok: true, data: { order_id, status: 'S5', service_completed_at: now } };
  }

  // ───────── 里程碑三段式:耍伴提交 30%→60%→100% ─────────
  // current: 0=待开始 1=30% 2=60% 3=100%待验收; complete_service 要求 current===3
  const MS_LABEL = { 1: '30%', 2: '60%', 3: '100%' };
  if (action === 'milestone_submit') {
    const { order_id, note, location } = event;
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
    const evidence = Array.isArray(ms.evidence) ? ms.evidence : [];
    evidence.push({
      milestone: next,
      label: MS_LABEL[next],
      note: note || '',
      location: location || null,
      submitted_by: openid,
      submitted_at: Date.now()
    });

    await col('order_main').doc(order_id).update({
      data: {
        'milestone.current': next,
        'milestone.evidence': evidence,
        'milestone.submitted_at': Date.now(),
        updated_at: Date.now()
      }
    });
    log.d(`milestone ${next}/3 submitted: ${order.order_no}`);
    writeNotice({
      to_openid: order.user_openid, order_id, type: 'milestone',
      title: `履约进度 ${MS_LABEL[next]}`, body: `耍伴提交了履约进度 ${MS_LABEL[next]}, 可在订单详情查看`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    return { ok: true, data: { order_id, milestone: next, label: MS_LABEL[next] } };
  }

  // 需求者确认里程碑(可手动确认;15分钟自动确认由 order-timer 处理)
  if (action === 'milestone_confirm') {
    const { order_id, milestone } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    if (![1, 2, 3].includes(milestone)) return { ok: false, code: 'oa_ms_invalid', msg: 'milestone 须为 1/2/3' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (role !== 'user') return { ok: false, code: 'oa_ms_confirm_perm', msg: '仅需求者可确认履约进度' };

    const ms = order.milestone || { current: 0, confirmed: [false, false, false] };
    if (ms.current < milestone) return { ok: false, code: 'oa_ms_not_submitted', msg: '该进度尚未提交' };
    const confirmed = Array.isArray(ms.confirmed) ? [...ms.confirmed] : [false, false, false];
    confirmed[milestone - 1] = true;

    await col('order_main').doc(order_id).update({
      data: { 'milestone.confirmed': confirmed, updated_at: Date.now() }
    });
    log.d(`milestone ${milestone} confirmed by user: ${order.order_no}`);
    return { ok: true, data: { order_id, milestone, confirmed: true } };
  }

  // ───────── P0 扩展:状态机补齐 ─────────

  // 改期业务常量(与小程序 config/index.js MODIFY/TIME_REDLINE 对齐; admin_config.modify_config 可覆盖)
  const MODIFY_DEFAULTS = { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 2 };
  const REDLINE_CLOSE_MIN = 23 * 60;   // 23:00 起不可服务
  const REDLINE_OPEN_MIN = 6 * 60;     // 06:00 恢复

  // 时间红线: 服务开始时间(本地时区 HH:mm)不得落在 23:00-06:00
  function isModifyTimeAllowed(ts) {
    const d = new Date(ts);
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= REDLINE_OPEN_MIN && mins < REDLINE_CLOSE_MIN;
  }

  // 改期发起:S2/S3 → S2_5(改期处理中, 等待对方确认; 超时由 order-timer 自动拒绝)
  // 注意: 确认前不改写 start_time, 新时间暂存 pending_modify; modify_count 在确认通过时才消耗
  if (action === 'modify') {
    const { order_id, new_start_time, reason } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const newTs = Number(new_start_time);
    if (!newTs || newTs <= Date.now()) {
      return { ok: false, code: 'oa_modify_time_invalid', msg: '新时间必须是未来时间' };
    }
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    // 改期前置:已支付(S2)或履约中(S3), 且不能已有在途改期
    if (order.status !== 'S2' && order.status !== 'S3') {
      return { ok: false, code: 'oa_modify_status', msg: `订单当前状态(${order.status})不可改期` };
    }
    const config = await getConfig();
    const modifyConfig = Object.assign({}, MODIFY_DEFAULTS);
    try { Object.assign(modifyConfig, config.modify_config || {}); } catch (e) {}
    const currentModifyCount = Number(order.modify_count) || 0;
    if (currentModifyCount >= modifyConfig.maxTimes) {
      return { ok: false, code: 'oa_modify_exhausted', msg: `改期次数已用完(${modifyConfig.maxTimes}次)` };
    }
    // 提前量: 至少提前 4 小时
    if (newTs - Date.now() < modifyConfig.minLeadHours * 3600000) {
      return { ok: false, code: 'oa_modify_lead', msg: `须提前${modifyConfig.minLeadHours}小时申请改期` };
    }
    // 时间红线: 23:00-06:00 不可约
    if (!isModifyTimeAllowed(newTs)) {
      return { ok: false, code: 'oa_modify_redline', msg: '服务时间须在 06:00-23:00 之间' };
    }
    // 幅度上限 72h(相对原服务时间)
    const span = Math.abs(newTs - Number(order.start_time)) / 3600000;
    if (span > modifyConfig.maxSpanH) {
      return { ok: false, code: 'oa_modify_span', msg: `改期幅度超过上限(${modifyConfig.maxSpanH}小时)` };
    }

    const now = Date.now();
    const fromStatus = order.status;
    const won = await casStatus(order_id, ['S2', 'S3'], {
      status: 'S2_5',
      pending_modify: {
        from_status: fromStatus,
        new_start_time: newTs,
        reason: String(reason || '').slice(0, 200),
        by_openid: openid,
        by_role: role,
        created_at: now,
        expire_at: now + modifyConfig.confirmHours * 3600000
      },
      modify_at: now,
      updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S2_5' && latest.pending_modify && latest.pending_modify.by_openid === openid) {
        return { ok: true, data: { order_id, status: 'S2_5', idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, fromStatus, 'S2_5', role === 'user' ? 'user_modify' : 'partner_modify', openid);
    log.d(`order modify: ${order.order_no} ${fromStatus}→S2_5 newStart=${newTs} expire=${modifyConfig.confirmHours}h`);
    writeNotice({
      to_openid: role === 'user' ? order.partner_openid : order.user_openid,
      order_id, type: 'modify',
      title: `${role === 'user' ? '发单人' : '耍伴'}发起改期`, body: `请在 ${modifyConfig.confirmHours} 小时内确认或拒绝`,
      action_key: 'jump_accept_modify', action_payload: { order_id }
    });
    return { ok: true, data: { order_id, status: 'S2_5', new_start_time: newTs } };
  }

  // 改期确认: 仅对方(非发起人)可操作, S2_5 → pending.from_status, 通过才改写 start_time/消耗次数
  if (action === 'modify_confirm' || action === 'modify_reject') {
    const { order_id } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    // 幂等: pending_modify 已消失且订单回到 S2/S3 → 按结果返回成功
    if (order.status === 'S2' || order.status === 'S3') {
      if (!order.pending_modify) {
        return { ok: true, data: { order_id, status: order.status, idempotent: true } };
      }
    }
    if (order.status !== 'S2_5' || !order.pending_modify) {
      return { ok: false, code: 'oa_modify_status', msg: '订单当前没有待确认的改期申请' };
    }
    const pending = order.pending_modify;
    if (pending.by_openid === openid) {
      return { ok: false, code: 'oa_modify_self', msg: '只能由对方确认或拒绝改期' };
    }
    const toStatus = pending.from_status === 'S3' ? 'S3' : 'S2';
    const now = Date.now();

    if (action === 'modify_reject') {
      const won = await casStatus(order_id, 'S2_5', {
        status: toStatus,
        pending_modify: _.remove(),
        modify_rejected_at: now,
        modify_rejected_by: openid,
        updated_at: now
      });
      if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      await logStatus(order_id, 'S2_5', toStatus, role === 'user' ? 'user_modify_reject' : 'partner_modify_reject', openid);
      log.d(`modify rejected: ${order.order_no} S2_5→${toStatus} by=${role}`);
      writeNotice({
        to_openid: pending.by_openid, order_id, type: 'modify_reject',
        title: '改期已被拒绝', body: `${role === 'user' ? '发单人' : '耍伴'}拒绝了你的改期申请`,
        action_key: 'jump_order', action_payload: { order_id }
      });
      return { ok: true, data: { order_id, status: toStatus, modify_rejected: true } };
    }

    // 确认前再兜底校验: 新时间仍合法(未来/提前量/红线)
    const config = await getConfig();
    const modifyConfig = Object.assign({}, MODIFY_DEFAULTS);
    try { Object.assign(modifyConfig, config.modify_config || {}); } catch (e) {}
    if (!pending.new_start_time || pending.new_start_time <= now) {
      return { ok: false, code: 'oa_modify_expired', msg: '改期时间已过期,请重新发起' };
    }
    if (!isModifyTimeAllowed(pending.new_start_time)) {
      return { ok: false, code: 'oa_modify_redline', msg: '服务时间不在 06:00-23:00 之间' };
    }
    const won = await casStatus(order_id, 'S2_5', {
      status: toStatus,
      start_time: pending.new_start_time,
      modify_count: (Number(order.modify_count) || 0) + 1,
      pending_modify: _.remove(),
      modify_confirmed_at: now,
      modify_confirmed_by: openid,
      updated_at: now
    });
    if (!won) return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    await logStatus(order_id, 'S2_5', toStatus, role === 'user' ? 'user_modify_confirm' : 'partner_modify_confirm', openid);
    log.d(`modify confirmed: ${order.order_no} S2_5→${toStatus} newStart=${pending.new_start_time} by=${role}`);
    writeNotice({
      to_openid: pending.by_openid, order_id, type: 'modify_confirm',
      title: '改期已确认', body: `新时间已生效, 订单状态回到${toStatus === 'S3' ? '履约中' : '待履约'}`,
      action_key: 'jump_order', action_payload: { order_id }
    });
    return { ok: true, data: { order_id, status: toStatus, start_time: pending.new_start_time, modify_confirmed: true } };
  }


  // 恢复履约:S3.5 → S3(双向确认, 任一方发起即可)
  if (action === 'resume_service') {
    const { order_id } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S3.5') {
      return { ok: false, code: 'oa_resume_status', msg: `订单当前状态(${order.status})不可恢复履约` };
    }
    const now = Date.now();
    const won = await casStatus(order_id, 'S3.5', {
      status: 'S3', resumed_at: now, resumed_by: openid, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S3') {
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
    return { ok: true, data: { order_id, status: 'S3' } };
  }

  // 转部分完成:S3.5 → S4(双向确认, 任一方发起即可)
  if (action === 'partial_confirm') {
    const { order_id } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S3.5') {
      return { ok: false, code: 'oa_partial_status', msg: `订单当前状态(${order.status})不可转部分完成` };
    }
    const now = Date.now();
    const won = await casStatus(order_id, 'S3.5', {
      status: 'S4', partial_confirmed_at: now, partial_confirmed_by: openid, updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S4') {
        return { ok: true, data: { order_id, status: 'S4', idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S3.5', 'S4', role === 'user' ? 'user_partial_confirm' : 'partner_partial_confirm', openid);
    log.d(`order partial confirm: ${order.order_no} S3.5→S4`);
    return { ok: true, data: { order_id, status: 'S4' } };
  }

  // 比例确认:S4 → S5(一般用户确认, 也允许耍伴确认)
  if (action === 'ratio_confirm') {
    const { order_id, ratio } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (order.status !== 'S4') {
      return { ok: false, code: 'oa_ratio_status', msg: `订单当前状态(${order.status})不可确认比例` };
    }
    // ratio 口径: 仅收 0-100 的整数百分比(如 50=50%), 消除 1 被误解释为 100% 的歧义
    let ratioFen = 100;   // 不传默认 100% 全额
    if (ratio !== undefined && ratio !== null && ratio !== '') {
      const r = Number(ratio);
      if (!Number.isInteger(r) || r < 0 || r > 100) {
        return { ok: false, code: 'oa_ratio_invalid', msg: '比例须为 0-100 的整数(百分比, 如 50 表示 50%)' };
      }
      ratioFen = r;
    }
    const now = Date.now();
    const won = await casStatus(order_id, 'S4', {
      status: 'S5',
      ratio_confirmed_at: now,
      ratio_confirmed_by: openid,
      ratio_fen: ratioFen,
      updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S5') {
        return { ok: true, data: { order_id, status: 'S5', ratio_fen: latest.ratio_fen || ratioFen, idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, 'S4', 'S5', role === 'user' ? 'user_ratio_confirm' : 'partner_ratio_confirm', openid);
    log.d(`order ratio confirm: ${order.order_no} S4→S5 ratio=${ratioFen}%`);
    return { ok: true, data: { order_id, status: 'S5', ratio_fen: ratioFen } };
  }

  // 发起争议:S5/S8/S9 → S10.5(售后窗口内, 双方可发起)
  if (action === 'complaint') {
    const { order_id, reason } = event;
    if (!order_id) return { ok: false, code: 'oa_no_order', msg: '缺少订单 ID' };
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };
    if (!['S5', 'S8', 'S9'].includes(order.status)) {
      return { ok: false, code: 'oa_complaint_status', msg: `订单当前状态(${order.status})不可发起争议` };
    }
    const now = Date.now();
    const fromStatus = order.status;
    const won = await casStatus(order_id, ['S5', 'S8', 'S9'], {
      status: 'S10.5',
      help_flag: true,
      complaint_at: now,
      complaint_by: openid,
      complaint_reason: reason || '',
      updated_at: now
    });
    if (!won) {
      const latest = await getOrder(order_id);
      if (latest && latest.status === 'S10.5') {
        return { ok: true, data: { order_id, status: 'S10.5', idempotent: true } };
      }
      return { ok: false, code: 'oa_status_conflict', msg: '订单状态已变化,请刷新后重试' };
    }
    await logStatus(order_id, fromStatus, 'S10.5', role === 'user' ? 'user_complaint' : 'partner_complaint', openid);

    // 写 complaint 集合(仲裁跟踪用)
    try {
      await col('complaint').add({ data: {
        order_id, order_no: order.order_no,
        initiator_openid: openid, initiator_role: role,
        target_openid: role === 'user' ? order.partner_openid : order.user_openid,
        reason: reason || '',
        status: 'pending',   // pending → processing → resolved/rejected
        created_at: now, updated_at: now, is_deleted: false
      }});
    } catch (e) {
      log.d(`complaint record fail: ${e.message}`);   // 不阻断状态流转
    }

    log.d(`complaint filed: ${order.order_no} ${fromStatus}→S10.5 by=${role}`);
    return { ok: true, data: { order_id, status: 'S10.5' } };
  }

  // ───────── 订单详情(全字段 + 四确认状态 + 评价, 仅参与方可读) ─────────
  if (action === 'detail') {
    const { order_id } = event;
    const order = await getOrder(order_id);
    if (!order) return { ok: false, code: 'oa_not_found', msg: '订单不存在' };
    const role = roleOf(order, openid);
    if (!role) return { ok: false, code: 'oa_not_participant', msg: '你不是该订单参与方' };

    const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

    // 并行:6 个独立查询(确认单 + 评价 + 双昵称 + sos + checkin)合并为 1 批, 冷启动压到 2s 内
    const [conf, evR, uR, pR, sosR, ckR] = await Promise.all([
      getConfirmation(order_id),
      col('evaluation').where({ order_id, is_deleted: false }).limit(1).get().catch(() => ({ data: [] })),
      col('user_account').where({ openid: order.user_openid }).limit(1).get().catch(() => ({ data: [] })),
      col('user_account').where({ openid: order.partner_openid }).limit(1).get().catch(() => ({ data: [] })),
      col('safety_report').where({ order_id, type: 'sos', status: 'active', is_deleted: false }).orderBy('created_at', 'desc').limit(1).get().catch(() => ({ data: [] })),
      col('safety_report').where({ order_id, type: 'checkin', is_deleted: false }).orderBy('created_at', 'desc').limit(3).get().catch(() => ({ data: [] }))
    ]);

    // 确认单
    let confirm = null;
    if (conf) {
      const fields = {};
      let confirmedCount = 0;
      for (const f of CONFIRM_FIELDS) {
        const it = conf.items[f] || {};
        if (it.user_ok) confirmedCount++;
        if (it.partner_ok) confirmedCount++;
        fields[f] = { value: it.value, user_ok: !!it.user_ok, partner_ok: !!it.partner_ok };
      }
      confirm = { items: fields, confirmed_count: confirmedCount, total_count: 8, all_confirmed: allConfirmed(conf.items), version: conf.version || 1 };
    }

    // 评价
    let evaluation = null;
    if (evR.data && evR.data[0]) {
      evaluation = { star: evR.data[0].star, content: evR.data[0].content || '' };
    }

    // 昵称
    let userNickname = '发单人', partnerNickname = '耍伴';
    if (uR.data && uR.data[0] && uR.data[0].nickname) userNickname = uR.data[0].nickname;
    if (pR.data && pR.data[0] && pR.data[0].nickname) partnerNickname = pR.data[0].nickname;

    // safety
    const safety = { help_flag: !!order.help_flag, active_sos: null, checkins: [] };
    const activeSos = sosR.data && sosR.data[0];
    if (activeSos) safety.active_sos = { reporter_role: activeSos.reporter_role || '', created_at: activeSos.created_at || null };
    safety.checkins = (ckR.data || []).map(r => ({
      reporter_role: r.reporter_role || '', created_at: r.created_at || null, location: r.location || null
    }));

    return {
      ok: true,
      data: {
        order_id,
        order_no: order.order_no,
        demand_no: order.demand_no || '',
        scene: order.scene,
        scene_name: SCENE_NAME[order.scene] || order.scene,
        content_options: order.content_options || [],
        location: order.location || null,
        start_time: order.start_time,
        duration_h: order.duration_h,
        total_fen: order.total_fen,
        fee_fen: order.fee_fen,
        partner_income_fen: order.partner_income_fen,
        tip_total_fen: order.tip_total_fen || 0,
        aa_tier: order.aa_tier || '',
        status: order.status,
        role,
        pay_expire_at: order.pay_expire_at || null,
        service_started_at: order.service_started_at || null,
        service_completed_at: order.service_completed_at || null,
        evaluated_at: order.evaluated_at || null,
        created_at: order.created_at || null,
        confirm,
        evaluation,
        safety,
        user_nickname: userNickname,
        partner_nickname: partnerNickname,
        milestone: order.milestone || null,
        modify_count: Number(order.modify_count) || 0,
        pending_modify: order.pending_modify || null
      }
    };
  }

  // ───────── 我的订单列表(耍伴视角含相邻订单通勤; 发单人视角额外聚合"待接单需求") ─────────
  if (action === 'my_orders') {
    const role = event.role === 'user' ? 'user' : 'partner';
    const queryField = role === 'partner' ? 'partner_openid' : 'user_openid';
    const SCENE_NAME = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

    let orders = [];
    try {
      const r = await col('order_main').where({
        [queryField]: openid, is_deleted: false
      }).orderBy('start_time', 'asc').limit(50).get();
      orders = r.data || [];
    } catch (e) {
      log.d(`my_orders query fail: ${e.message}`);
      return { ok: false, code: 'oa_list_fail', msg: '订单查询失败' };
    }

    // 发单人视角: 订单在耍伴接单后才生成, 已发布但仍待接单(matching)的需求需一并展示
    let pendingDemands = [];
    if (role === 'user') {
      try {
        const dr = await col('demand').where({
          creator_openid: openid, status: 'matching', is_deleted: false
        }).orderBy('created_at', 'desc').limit(20).get();
        pendingDemands = (dr.data || []).map((d) => ({
          item_type: 'demand',
          order_id: d._id,
          demand_id: d._id,
          order_no: d.demand_no,
          scene: d.scene,
          scene_name: SCENE_NAME[d.scene] || d.scene,
          content_options: d.content_options || (d.content_option ? [d.content_option] : []),
          location_name: (d.location && d.location.name) || '',
          location_lat: (d.location && d.location.latitude) || null,
          location_lng: (d.location && d.location.longitude) || null,
          start_time: d.start_time,
          duration_h: d.duration_h,
          total_fen: d.total_fen,
          status: 'PENDING',   // 前端映射为"待接单"
          commute: null
        }));
      } catch (e) {
        log.d(`my_orders pending demands query fail: ${e.message}`);
      }
    }

    const ACTIVE_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

    const orderItems = orders.map((o, idx) => {
      const item = {
        item_type: 'order',
        order_id: o._id,
        order_no: o.order_no,
        scene: o.scene,
        scene_name: SCENE_NAME[o.scene] || o.scene,
        content_options: o.content_options || [],
        location_name: (o.location && o.location.name) || '',
        location_lat: (o.location && o.location.latitude) || null,
        location_lng: (o.location && o.location.longitude) || null,
        start_time: o.start_time,
        duration_h: o.duration_h,
        end_time: o.start_time + (o.duration_h || 1) * 3600 * 1000,
        total_fen: o.total_fen,
        status: o.status,
        // 改期待确认红点: 订单处于 S2_5 且改期发起人不是当前查看者
        need_confirm: o.status === 'S2_5' && !!(o.pending_modify && o.pending_modify.by_openid !== openid),
        commute: null
      };

      // 计算到下一单的通勤(当前单结束 → 下一单开始)
      const next = orders[idx + 1];
      if (next && o.location && next.location &&
          o.location.latitude && next.location.latitude) {
        const km = haversineKm(
          o.location.latitude, o.location.longitude,
          next.location.latitude, next.location.longitude
        );
        const est = estimateCommute(km);
        const gapMin = Math.round((next.start_time - item.end_time) / 60000);
        // 预警:间隔时间小于最快通勤方式(驾车)所需时间
        const tight = gapMin < est.drive_min;
        item.commute = {
          to_location: (next.location && next.location.name) || '',
          gap_min: gapMin,
          distance_km: est.distance_km,
          walk_min: est.walk_min,
          bike_min: est.bike_min,
          bus_min: est.bus_min,
          drive_min: est.drive_min,
          tight
        };
      }
      return item;
    });

    // 待接单需求置顶, 其后为订单(按开始时间升序)
    const list = [...pendingDemands, ...orderItems];
    return { ok: true, data: { role, list } };
  }

  // ───────── my_counts: 订单四宫格计数 ─────────
  // 按 role(user/partner) 返回对应视角计数
  if (action === 'my_counts') {
    const role = event.role === 'partner' ? 'partner' : 'user';
    const openidField = role === 'partner' ? 'partner_openid' : 'user_openid';
    const COL = col('order_main');
    // 6 次独立 count 合并为 1 批, 冷启动压到 1s 内
    const [pay, doing, eval, afterSale] = await Promise.all([
      // 待支付 S0 只属于 user 视角(partner 看不到)
      COL.where({ user_openid: openid, status: 'S0', is_deleted: false }).count().catch(() => ({ total: 0 })),
      // 进行中
      COL.where({ [openidField]: openid, status: _.in(['S1','S2','S2_5','S3','S3.5']), is_deleted: false }).count().catch(() => ({ total: 0 })),
      // 待评价
      COL.where({ [openidField]: openid, status: 'S5', is_deleted: false }).count().catch(() => ({ total: 0 })),
      // 售后(双方都能看)
      COL.where({
        $or: [{ user_openid: openid }, { partner_openid: openid }],
        status: _.in(['S6','S7','S9','S10','S10.5']),
        is_deleted: false
      }).count().catch(() => ({ total: 0 }))
    ]);
    return { ok: true, data: {
      role,
      pending_pay: pay.total || 0,
      in_progress: doing.total || 0,
      pending_eval: eval.total || 0,
      after_sales: afterSale.total || 0
    }};
  }

  // ───────── 通知:列表 ─────────
  if (action === 'notice_list') {
    const limit = Math.min(Number(event.limit) || 50, 100);
    const skip = Number(event.skip) || 0;
    const list = await col('system_notice')
      .where({ to_openid: openid })
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(limit)
      .get();
    // 未读数
    const unread = await col('system_notice').where({ to_openid: openid, read: false }).count();
    return { ok: true, data: { list: list.data, unread: unread.total } };
  }

  // ───────── 通知:标记已读(单条或全部) ─────────
  if (action === 'notice_read') {
    if (event.notice_id) {
      await col('system_notice').doc(event.notice_id).update({ data: { read: true, read_at: Date.now() } });
      return { ok: true };
    }
    // 批量标记: not_empty
    await col('system_notice').where({ to_openid: openid, read: false })
      .update({ data: { read: true, read_at: Date.now() } });
    return { ok: true };
  }

  return { ok: false, code: 'oa_unknown_action', msg: '未知动作' };
};
