// 对应 PRD 章节：3.5 订单交易系统 / 3.5.2 订单创建 / 附录G 状态机 / 8.1 信用分 / 1.7.1 青少年保护
// order-create 订单创建 · 耍伴接单(create_from_take) · 免责声明签署(sign_disclaimer)
// 2 个 action: create_from_take / sign_disclaimer · 订单初始状态 S1(待确认/四确认阶段)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

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

// 容错读取耍伴资料: is_deleted 缺省(历史坏文档)视为有效并惰性治愈(见 ./heal)
const { getHealedPartnerProfile } = require('./heal');
async function getPartnerProfile(openid) {
  return getHealedPartnerProfile(col, _, openid);
}

async function getDemand(demandId) {
  try {
    return (await col('demand').doc(demandId).get()).data || null;
  } catch (e) {
    return null;
  }
}

// 接单被拒写 P3 事件,便于排查
async function logReject(openid, demand_id, reason) {
  try {
    await col('platform_event').add({ data: {
      level: 'P3', type: 'take_rejected', openid,
      payload: { demand_id, reason },
      created_at: Date.now(), updated_at: Date.now(), is_deleted: false
    }});
    log.d(`take_rejected: openid=${openid} demand=${demand_id} reason=${reason}`);
  } catch (e) {
    log.d(`logReject fail: ${e.message}`);
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

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制(拦截需求编号/占位符)
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

// 接单距离上限(公里): 耍伴接单时实际位置与履约地点直线距离
const TAKE_MAX_DISTANCE_KM = 50;

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'order_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`order-create action=${action} openid=${openid}`);

  // ── 耍伴签署场景免责声明(code.html 第一道防线·接单前置) ──
  if (action === 'sign_disclaimer') {
    const { scene } = event;
    if (!scene) return { ok: false, code: 'sign_no_scene', msg: '缺少场景' };
    const disclaimerType = {
      W1: 'medical_disclaimer', W2: 'general_disclaimer', W8: 'general_disclaimer',
      W10: 'general_disclaimer', W11: 'online_disclaimer'
    }[scene] || 'general_disclaimer';

    // 已签同场景则幂等返回
    const exist = await col('disclaimer_signature').where({
      openid, role: 'partner', scene, is_deleted: false
    }).limit(1).get().catch(() => ({ data: [] }));
    if (exist.data && exist.data[0]) {
      return { ok: true, data: { scene, signed: true, idempotent: true } };
    }

    const now = Date.now();
    await col('disclaimer_signature').add({ data: {
      openid, role: 'partner', scene, disclaimer_type: disclaimerType,
      signed_at: now, signature_hash: `sig_${openid}_${scene}_${now}`,
      created_at: now, updated_at: now, is_deleted: false
    }});
    log.d(`partner signed disclaimer: openid=${openid} scene=${scene}`);
    return { ok: true, data: { scene, signed: true } };
  }

  if (action !== 'create_from_take') {
    return { ok: false, code: 'order_unknown_action', msg: '未知动作' };
  }

  const { demand_id } = event;
  if (!demand_id) return { ok: false, code: 'order_no_demand', msg: '缺少需求 ID' };
  if (!isValidDocId(demand_id)) return { ok: false, code: 'order_bad_demand_id', msg: '需求 ID 格式不正确:请传入需求 _id(32位十六进制),不是需求编号(DR 开头)' };

  // 并行预取(配置/耍伴账号/耍伴资料/需求互不依赖, 缩短串行耗时规避 3s 超时)
  const [config, partnerUser, profile, demand] = await Promise.all([
    getConfig(),
    getUser(openid),
    getPartnerProfile(openid),
    getDemand(demand_id)
  ]);

  // ── 取耍伴身份 ──
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
  if (!profile || profile.status !== 'approved') {
    await logReject(openid, demand_id, 'partner_not_approved');
    return { ok: false, code: 'order_not_approved', msg: '耍伴资料未审核通过' };
  }
  if (!profile.accept_switch) {
    await logReject(openid, demand_id, 'switch_off');
    return { ok: false, code: 'order_switch_off', msg: '接单开关已关闭' };
  }

  // ── W1 就医陪诊:耍伴需通过国标专项考核(>=80分) ──
  if (demand.scene === 'W1') {
    const w1Score = Number(profile.exam_scores && profile.exam_scores.W1);
    if (!w1Score || w1Score < 80) {
      await logReject(openid, demand_id, 'w1_exam_failed');
      return { ok: false, code: 'order_w1_exam_required', msg: '就医陪诊场景需通过国标专项考核(>=80分)' };
    }
  }

  // ── 耍伴信用分 ──
  if ((partnerUser.partner_credit_score || 800) < (config.min_credit_take_order || 600)) {
    await logReject(openid, demand_id, 'partner_credit_low');
    return { ok: false, code: 'order_credit_low', msg: '信用分低于接单门槛' };
  }

  // ── 需求(已并行预取) ──
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

  // ── 免责声明双签校验(code.html 第一道防线):耍伴必须已签同场景声明 ──
  const demandScene = String(demand.scene || '');
  const signed = await col('disclaimer_signature').where({
    openid, role: 'partner', scene: demandScene, is_deleted: false
  }).limit(1).get().catch(() => ({ data: [] }));
  if (!signed.data || !signed.data[0]) {
    await logReject(openid, demand_id, 'disclaimer_not_signed');
    return { ok: false, code: 'order_disclaimer_required', msg: '请先签署该场景免责声明后再接单' };
  }

  // 接单范围校验: 抢单模式需 broadcast 或在邀约名单; 选单模式跳过(由 apply/confirm_apply 控制)
  const demandMatchMode = demand.match_mode || 'broadcast';
  if (demandMatchMode !== 'select') {
    const invited = demand.invited || [];
    if (!demand.broadcast && invited.indexOf(openid) < 0) {
      await logReject(openid, demand_id, 'not_invited_or_broadcast');
      return { ok: false, code: 'order_not_allowed', msg: '你不在该需求的接单范围' };
    }
  }

  // ── 接单距离校验: 耍伴接单时实际位置与履约地点直线距离 ≤ 50km(产品反馈硬规则) ──
  // 真实客户端必须传 partner_location(前端 wx.getLocation);
  // 服务端自测链路(mock_openid 且无真实 OPENID)无定位, 跳过以免阻断自测。
  let takeDistanceKm = null;
  const isMockCall = !wxCtx.OPENID && !!event.mock_openid;
  const pl = event.partner_location;
  const partnerLoc = (pl && Number(pl.latitude) && Number(pl.longitude))
    ? { lat: Number(pl.latitude), lng: Number(pl.longitude) } : null;
  if (!isMockCall) {
    if (!partnerLoc) {
      await logReject(openid, demand_id, 'no_partner_location');
      return { ok: false, code: 'order_location_required', msg: '接单需要获取你的实时位置，请授权定位后重试' };
    }
    const site = demand.location;
    if (site && site.latitude && site.longitude) {
      takeDistanceKm = haversineKm(partnerLoc.lat, partnerLoc.lng, site.latitude, site.longitude);
      if (takeDistanceKm > TAKE_MAX_DISTANCE_KM) {
        await logReject(openid, demand_id, `too_far_${Math.round(takeDistanceKm)}km`);
        return {
          ok: false,
          code: 'order_too_far',
          msg: `你当前位置距履约地点约 ${Math.round(takeDistanceKm)} 公里，超过 ${TAKE_MAX_DISTANCE_KM} 公里，无法接单`
        };
      }
      takeDistanceKm = Math.round(takeDistanceKm * 10) / 10;
    }
  }

  // ── 并行: 创建者资料 + 耍伴进行中订单(时间重叠校验用, 互不依赖) ──
  const [creator, myOrdersRes] = await Promise.all([
    getUser(demand.creator_openid),
    col('order_main').where({
      partner_openid: openid,
      status: _.in(BUSY_STATUS),
      is_deleted: false
    }).limit(50).get().catch(() => null)
  ]);
  if (myOrdersRes === null) {
    log.d('time overlap query fail');
    return { ok: false, code: 'order_busy_check_fail', msg: '系统繁忙,请稍后重试' };
  }

  // ── 时间重叠校验:该耍伴有效订单中,时间段不可与新订单重叠(端点相接不算冲突) ──
  const newStart = demand.start_time;
  const newEnd = demand.start_time + (demand.duration_h || 1) * 3600 * 1000;
  for (const o of myOrdersRes.data) {
    const oStart = o.start_time;
    const oEnd = o.start_time + (o.duration_h || 1) * 3600 * 1000;
    if (newStart < oEnd && oStart < newEnd) {
      await logReject(openid, demand_id, 'time_overlap');
      return { ok: false, code: 'order_time_conflict', msg: '该时段你已有订单,时间冲突无法接单' };
    }
  }

  // ── 场景须在耍伴接受范围内 ──
  const acceptScenes = Array.isArray(profile.accept_scenes) ? profile.accept_scenes : [];
  const sceneHit = acceptScenes.includes(demandScene);
  log.d(`[ORDER_DEBUG] demand.scene=${JSON.stringify(demandScene)} profile.accept_scenes=${JSON.stringify(acceptScenes)} hit=${sceneHit}`);
  if (!sceneHit) {
    await logReject(openid, demand_id, 'scene_not_accepted');
    return { ok: false, code: 'order_scene_not_accepted', msg: `你未开通该场景的接单(需求场景:${demandScene},你已开通:${acceptScenes.join(',')})` };
  }

  // ── 创建者校验(已并行预取):存在 + 未冻结 + 信用分 ──
  if (!creator) {
    await logReject(openid, demand_id, 'creator_not_found');
    return { ok: false, code: 'order_creator_not_found', msg: '需求发布者状态异常' };
  }
  if (creator.status === 'frozen') {
    await logReject(openid, demand_id, 'creator_frozen');
    return { ok: false, code: 'order_creator_frozen', msg: '对方账号已冻结' };
  }
  if (creator.status === 'banned') {
    await logReject(openid, demand_id, 'creator_banned');
    return { ok: false, code: 'order_creator_banned', msg: '对方账号已封禁' };
  }
  if (creator.status === 'closed') {
    await logReject(openid, demand_id, 'creator_closed');
    return { ok: false, code: 'order_creator_closed', msg: '对方账号已注销' };
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
    publish_location: demand.publish_location || null,   // 发布地址(留痕, 来自需求)
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
    take_distance_km: takeDistanceKm,   // 接单时耍伴实际位置距履约地点(公里, 自测链路为 null)
    created_at: now,
    updated_at: now,
    is_deleted: false
  };

  // W1 就医陪诊:订单级责任险(mock,真实支付替换时对接保险公司API)
  if (demand.scene === 'W1') {
    orderData.insurance = {
      policy_no: 'INS' + Date.now(),
      type: 'W1_caregiver',
      amount_fen: 5000000,   // 50万保额(mock)
      is_mock: true,
      created_at: now
    };
  }

  // ① 抢占需求: 抢单模式 CAS matching→matched(防超卖); 选单模式仅被确认的耍伴可接
  let casRes;
  try {
    if (demandMatchMode === 'select') {
      // 选单模式:仅 demand.matched_openid 等于当前耍伴才可接单
      if (demand.matched_openid !== openid) {
        await logReject(openid, demand_id, 'select_not_confirmed');
        return { ok: false, code: 'order_select_not_confirmed', msg: '你未被需求者确认,无法接单' };
      }
      casRes = await col('demand').where({
        _id: demand_id, status: 'matching', matched_openid: openid
      }).update({
        data: { status: 'matched', matched_at: now, updated_at: now }
      });
    } else {
      // 抢单模式: matching→matched 原子条件更新, 并发接单仅一方成功(防超卖)
      casRes = await col('demand').where({ _id: demand_id, status: 'matching' }).update({
        data: { status: 'matched', matched_at: now, updated_at: now }
      });
    }
  } catch (e) {
    log.d(`order create cas fail: ${e.message}`);
    return { ok: false, code: 'order_db_fail', msg: '订单创建失败' };
  }
  if (!casRes.stats || casRes.stats.updated !== 1) {
    await logReject(openid, demand_id, 'demand_cas_lost');
    return { ok: false, code: 'order_demand_closed', msg: '手慢了,该需求已被其他耍伴接单' };
  }

  // ② 事务建单: order_main + order_confirmations + 状态流水 同成同败
  let orderId = '';
  try {
    await db.runTransaction(async (t) => {
      const addRes = await t.collection('order_main').add({ data: orderData });
      orderId = addRes._id;

      // 四确认文档:8 个确认位,初值取自需求,任一方修改则全部重置
      await t.collection('order_confirmations').add({ data: {
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

      // 状态流水
      await t.collection('order_status_log').add({ data: {
        order_id: orderId, from_status: null, to_status: 'S1',
        action: 'create_from_take', operator: openid,
        created_at: now, updated_at: now, is_deleted: false
      }});

      // 需求者免责声明签署凭证(双签入库 · code.html 第一道防线)
      await t.collection('disclaimer_signature').add({ data: {
        openid: demand.creator_openid, role: 'user', scene: demandScene,
        disclaimer_type: demand.disclaimer_type || 'general_disclaimer',
        demand_id, order_id: orderId,
        signed_at: demand.disclaimer_signed_at || now,
        signature_hash: `sig_user_${demand.creator_openid}_${demandScene}_${orderId}`,
        created_at: now, updated_at: now, is_deleted: false
      }});
    });
  } catch (e) {
    // 补偿: 事务失败则释放需求回 matching, 供其他耍伴再接
    log.d(`order txn fail: ${e.message}; compensating demand ${demand_id} → matching`);
    await col('demand').where({ _id: demand_id, status: 'matched' }).update({
      data: { status: 'matching', updated_at: Date.now() }
    }).catch((ce) => log.d(`demand compensate fail: ${ce.message}`));
    return { ok: false, code: 'order_db_fail', msg: '订单创建失败' };
  }

  log.d(`order created: ${orderNo} demand=${demand.demand_no} partner=${openid}`);
  // 抢单成功通知发单人 A: 有人接单了, 可进入聊天开始四确认
  col('system_notice').add({ data: {
    to_openid: demand.creator_openid,
    order_id: orderId,
    type: 'accept',
    title: '有人接单了',
    body: `耍伴 ${demand.partner_nickname || ''} 已承接你的需求, 请进入聊天完成四确认`,
    action_key: 'jump_order',
    action_payload: { order_id: orderId },
    created_at: Date.now(),
    read: false
  }}).catch((e) => log.d('[notice] accept write fail:', e.message));
  return {
    ok: true,
    data: {
      order_id: orderId, order_no: orderNo,
      status: 'S1', total_fen: totalFen, fee_fen: feeFen, partner_income_fen: partnerIncomeFen,
      insurance: orderData.insurance || null
    }
  };
};
