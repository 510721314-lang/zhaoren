// action_take.js — create_from_take 接单建单体, 从 index.js 物理抽出, 行为逐字不变
// 共享符号经 ctx 注入, 禁止 require('./index') 以免循环依赖

// 唯一索引冲突判定(2026-10-21): 仅本事务涉及的唯一索引是 order_main.uk_order_no
// (order_confirmations / order_status_log / disclaimer_signature 均无唯一索引), 故任意 dup-key 均可安全重试
function isDupKeyErr(e) {
  if (!e) return false;
  const code = String(e.errCode || e.code || '');
  const msg = String(e.message || e.errMsg || '');
  return code === '11000' || /E11000|duplicate key|duplicate_key|uk_order_no/i.test(msg);
}

async function createFromTakeAction(ctx) {
  const { event, openid, wxCtx, clientIp, device, crypto, db, _, col, log, writeAudit, BUSY_STATUS, acquireTakeLock, releaseTakeLock, getConfig, isServiceTimeAllowed, readRateRange, readTotalRange, slotCovers, cnDayStart, DAY_MS, suspendLeftDays, haversineKm, TAKE_MAX_DISTANCE_KM, splitOrderAmount, isTestPair, getUser, getPartnerProfile, getDemand, logReject, genOrderNo, isValidDocId, buildCheckboxEvidence } = ctx;

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

  // 平台总开关: 核心交易维护中, 阻断接单建单
  if (config.switch_access === false) {
    return { ok: false, code: 'access_disabled', msg: '平台交易功能维护中,暂无法接单,请稍后再试' };
  }

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
  // 断链②修复(第三批爽约): 停用中拦截「新接单」; 到期/缺 suspend_until 视为已恢复按 normal 放行
  const partnerSuspendDays = suspendLeftDays(partnerUser);
  if (partnerSuspendDays > 0) {
    await logReject(openid, demand_id, 'partner_suspended');
    return { ok: false, code: 'order_suspended', msg: `账号停用中,${partnerSuspendDays}天后自动恢复` };
  }

  // ── 实名门禁(接单前必须完成实名; 测试期可在「实名认证」页模拟通过) ──
  if (!partnerUser.is_realname_done) {
    await logReject(openid, demand_id, 'partner_not_realname');
    return { ok: false, code: 'order_realname_required', msg: '请先完成实名认证后再接单' };
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

  // ── 紧急联系人门禁(批3b', 2026-10-23 用户批准): 接单前必须已填 EC; 申请链不拦(C-3.26) ──
  const ecR = await col('emergency_contact').where({ openid, is_deleted: false }).limit(1).get().catch(() => ({ data: [] }));
  if (!(ecR.data && ecR.data.length)) {
    await logReject(openid, demand_id, 'ec_missing');
    return { ok: false, code: 'order_ec_required', msg: '接单前请先填写紧急联系人' };
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

  // ── 接单考试校验(需求存在后才校验): 动态读 exam_bank(admin-action 管理), FALLBACK 兜底 ──
  // 通用规则: 科目 code='base' 全员前置; 场景 code 若存在同名科目则按该科目 requires+pass_line 校验
  // SSOT: FALLBACK 与 partner-action EXAM_BANK_FALLBACK / admin-action EXAM_BANK_FALLBACK 同源
  const EXAM_FALLBACK = { base: { pass_line: 100 }, W1: { pass_line: 100, requires: ['base'] } };
  let examBank = null;
  try {
    const er = await col('exam_bank').where({ is_deleted: _.neq(true), enabled: true }).limit(100).get();
    const docs = (er.data || []).filter((d) => Array.isArray(d.questions) && d.questions.length > 0);
    if (docs.length > 0) {
      examBank = {};
      for (const d of docs) examBank[d.code] = { pass_line: Number(d.pass_line) || 100, requires: Array.isArray(d.requires) ? d.requires : [] };
    }
  } catch (e) { /* 读失败走 FALLBACK */ }
  const bank = examBank || EXAM_FALLBACK;
  const passGate = (code) => Number((profile.exam_scores && profile.exam_scores[code]) || 0) >= (bank[code] ? bank[code].pass_line : 100);
  // base 通用前置
  const baseMeta = bank.base;
  if (baseMeta && !passGate('base')) {
    await logReject(openid, demand_id, 'base_exam_failed');
    return { ok: false, code: 'order_base_exam_required', msg: '需先通过耍伴基础考试(接单配置页可去考试)' };
  }
  // 场景同名科目专项前置(通用化: W1→陪诊, 新增场景科目自动生效)
  const sceneMeta = bank[demand.scene];
  if (sceneMeta && (sceneMeta.requires || []).length > 0) {
    for (const r of sceneMeta.requires) {
      if (!passGate(r)) {
        await logReject(openid, demand_id, `${demand.scene}_exam_prereq_failed`);
        return { ok: false, code: 'order_scene_exam_required', msg: `该场景接单需先通过「${r}」考试` };
      }
    }
  }
  if (sceneMeta && !passGate(demand.scene)) {
    await logReject(openid, demand_id, `${demand.scene}_exam_failed`);
    return { ok: false, code: 'order_scene_exam_required', msg: `该场景接单需通过对应考试(${sceneMeta.pass_line}分)` };
  }

  // 不能接自己的单
  if (demand.creator_openid === openid) {
    await logReject(openid, demand_id, 'own_demand');
    return { ok: false, code: 'order_own_demand', msg: '不能接自己发布的需求' };
  }

  // 服务端时间红线(R1, 与前端 redline.js 同口径, 防绕过): 00:00-06:00 不可履约
  // close_min=0 语义为全天开放; 东八区折算(云函数 UTC, 直接 getHours 少 8 小时)
  if (!isServiceTimeAllowed(demand.start_time, config)) {
    await logReject(openid, demand_id, 'time_redline');
    return { ok: false, code: 'order_time_redline', msg: '该需求服务时间在 00:00-06:00 休息时段,无法接单' };
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

  // ── W9 宠物照料授权凭证校验(PRD R9: 无凭证视为未授权, 不得履约) ──
  if (demandScene === 'W9' && demand.pet_auth_signed !== true) {
    await logReject(openid, demand_id, 'pet_auth_missing');
    return { ok: false, code: 'order_pet_auth_required', msg: '该宠物陪伴需求缺少宠物照料授权凭证,无法履约' };
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
      // 阈值 = min(耍伴接单配置的最大接单距离, 平台上限 admin_config.take_distance_max_km), 缺省 50km
      const capKm = Number(config.take_distance_max_km) || TAKE_MAX_DISTANCE_KM;
      let effMaxKm = capKm;
      try {
        const ppr = await col('partner_profile').where({ openid, is_deleted: _.neq(true) }).limit(1).get();
        const pMax = Number(ppr.data && ppr.data[0] && ppr.data[0].max_distance_km);
        if (isFinite(pMax) && pMax > 0) effMaxKm = Math.min(pMax, capKm);
      } catch (e) {}
      takeDistanceKm = haversineKm(partnerLoc.lat, partnerLoc.lng, site.latitude, site.longitude);
      if (takeDistanceKm > effMaxKm) {
        await logReject(openid, demand_id, `too_far_${Math.round(takeDistanceKm)}km`);
        return {
          ok: false,
          code: 'order_too_far',
          msg: `你当前位置距履约地点约 ${Math.round(takeDistanceKm)} 公里，超过 ${effMaxKm} 公里，无法接单`
        };
      }
      takeDistanceKm = Math.round(takeDistanceKm * 10) / 10;
    }
  }

  // ── 接单互斥锁: 串行化「重叠/日上限检查 → CAS → 建单」整段(以 try/finally 保证任何路径都释放) ──
  const takeToken = 'TK' + Date.now() + crypto.randomBytes(4).toString('hex');
  const takeLocked = await acquireTakeLock(openid, takeToken);
  if (!takeLocked) {
    await logReject(openid, demand_id, 'take_lock_busy');
    return { ok: false, code: 'order_take_busy', msg: '操作太频繁,请稍后重试' };
  }
  // 修复(拆分前既有块作用域越界): 成功路径后置段(finally 之后的 log/审计/通知/return)需要这些值,
  // 必须在外层 try 之外声明; try 内仅赋值。原写法为 try 内 const/let → 成功时 finally 后 ReferenceError。
  let orderNo = '';
  let totalFen = 0;
  let feeFen = 0;
  let partnerIncomeFen = 0;
  let orderData = null;
  let orderId = '';
  let userEvidenceId = '';
  try {
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

  // ── 接单价格区间(耍伴在接单配置设的区间; 未设置=不限) ──
  // 计价分支: hourly 走时薪区间(readRateRange); fixed 走客单价区间(readTotalRange); 公益单豁免价格区间
  const isFixedDemand = demand.pricing_type === 'fixed';
  const isWelfareDemand = demand.project_attr === 'public_welfare';
  if (!isWelfareDemand) {
    if (isFixedDemand) {
      const [totalLo, totalHi] = readTotalRange(profile);
      const demandTotal = Number(demand.total_fen) || 0;
      if (totalLo !== null && demandTotal < totalLo) {
        await logReject(openid, demand_id, 'total_below_min');
        return { ok: false, code: 'order_total_out_of_range', msg: `该需求一口价 ¥${demandTotal / 100}，低于你的最低客单价 ¥${totalLo / 100}，可在接单配置调整` };
      }
      if (totalHi !== null && demandTotal > totalHi) {
        await logReject(openid, demand_id, 'total_above_max');
        return { ok: false, code: 'order_total_out_of_range', msg: `该需求一口价 ¥${demandTotal / 100}，高于你的最高客单价 ¥${totalHi / 100}，可在接单配置调整` };
      }
    } else {
      const [rateLo, rateHi] = readRateRange(profile, config);
      const demandRate = Number(demand.rate_fen) || 0;
      if (rateLo !== null && demandRate < rateLo) {
        await logReject(openid, demand_id, 'rate_below_min');
        return { ok: false, code: 'order_rate_out_of_range', msg: `该需求单价 ¥${demandRate / 100}/小时，低于你的最低单价 ¥${rateLo / 100}/小时，可在接单配置调整` };
      }
      if (rateHi !== null && demandRate > rateHi) {
        await logReject(openid, demand_id, 'rate_above_max');
        return { ok: false, code: 'order_rate_out_of_range', msg: `该需求单价 ¥${demandRate / 100}/小时，高于你的最高单价 ¥${rateHi / 100}/小时，可在接单配置调整` };
      }
    }
  }

  // ── 接单时段(服务时间段必须完全落在你启用的时段内; 未设置=不限) ──
  if (!slotCovers(profile.weekly_slots, newStart, newEnd)) {
    await logReject(openid, demand_id, 'slot_not_covered');
    return { ok: false, code: 'order_slot_not_covered', msg: '该服务时段不在你启用的接单时段内，可在接单配置调整' };
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
  // 断链②修复(第三批爽约): 停用中发布者的需求不再产生新订单(不追溯在途订单)
  const creatorSuspendDays = suspendLeftDays(creator);
  if (creatorSuspendDays > 0) {
    await logReject(openid, demand_id, 'creator_suspended');
    return { ok: false, code: 'order_creator_suspended', msg: '对方账号停用中,暂不可接单' };
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

  // ── 每日接单上限(后台统一配置 admin_config.partner_daily_take_limit; 由平台设定, 耍伴不可改) ──
  const dailyLimit = Number(config.partner_daily_take_limit) || 5;
  {
    const d0 = cnDayStart(Date.now());
    let todayCount = -1;
    try {
      const cr = await col('order_main').where({
        partner_openid: openid,
        is_deleted: false,
        status: _.nin(['S6']),                 // 已取消不计入, 防"接了退"刷量
        created_at: _.gte(d0).and(_.lt(d0 + DAY_MS))
      }).count();
      todayCount = cr.total || 0;
    } catch (e) {
      log.d(`daily limit count fail: ${e.message}`);
      return { ok: false, code: 'order_busy_check_fail', msg: '系统繁忙,请稍后重试' };
    }
    if (todayCount >= dailyLimit) {
      await logReject(openid, demand_id, 'daily_limit');
      return { ok: false, code: 'order_daily_limit', msg: `今日接单已达上限 ${dailyLimit} 单，明天再来` };
    }
  }

  // ── 创建订单 ──
  const now = Date.now();
  orderNo = genOrderNo();
  totalFen = demand.total_fen;
  ({ feeFen, partnerIncomeFen } = splitOrderAmount(totalFen, config.platform_fee_rate_fen));

  orderData = {
    order_no: orderNo,
    demand_id,
    demand_no: demand.demand_no || '',
    user_openid: demand.creator_openid,
    partner_openid: openid,
    is_test: isTestPair(config, demand.creator_openid, openid),   // D4-5 测试白名单打标(任一方命中即整单)
    scene: demand.scene,
    start_time: demand.start_time,
    duration_h: demand.duration_h,
    location: demand.location,
    publish_location: demand.publish_location || null,   // 发布地址(留痕, 来自需求)
    content_options: demand.content_options || [],
    pricing_type: demand.pricing_type || 'hourly',   // 计价快照(hourly/fixed; fixed 含公益)
    project_attr: demand.project_attr || 'commercial',
    rate_fen: demand.rate_fen,            // hourly=分; fixed=null
    total_fen: totalFen,
    fee_fen: feeFen,
    partner_income_fen: partnerIncomeFen,
    headcount: demand.headcount || 1,   // 人数(统一订单概要用)
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
      // 必须写入 matched_openid: 幂等捞回/check_take_result 依赖它归属当前耍伴(曾漏写致重试无法捞回)
      casRes = await col('demand').where({ _id: demand_id, status: 'matching' }).update({
        data: { status: 'matched', matched_openid: openid, matched_at: now, updated_at: now }
      });
    }
  } catch (e) {
    log.d(`order create cas fail: ${e.message}`);
    return { ok: false, code: 'order_db_fail', msg: '订单创建失败' };
  }
  if (!casRes.stats || casRes.stats.updated !== 1) {
    // 幂等捞回: CAS 失败可能是"自己上一笔超时已建单"(网络错误后重试)而非被他人抢走
    // 需求已匹配给当前耍伴 → 查已有订单返回(半成品自愈), 无订单 → 补偿回 matching 供重新接单
    try {
      const cur = await col('demand').doc(demand_id).get();
      if (cur.data && cur.data.matched_openid === openid) {
        const ex = await col('order_main').where({ demand_id, is_deleted: _.neq(true) }).limit(1).get();
        if (ex.data && ex.data.length) {
          const o = ex.data[0];
          log.d(`take idempotent recover: demand=${demand_id} order=${o._id}`);
          await writeAudit(db, log, {
            openid, role: 'partner', category: 'business', action: 'order_take',
            target_type: 'order', target_id: o._id,
            detail: { order_no: o.order_no, demand_id, idempotent_recover: true, cause: 'cas_lost_but_matched_me' },
            result: 'ok', client_ip: clientIp, device
          }).catch(() => {});
          return { ok: true, data: { order_id: o._id, order_no: o.order_no, status: o.status, idempotent: true } };
        }
        // 卡死半成品(事务被杀且补偿未执行): 自愈释放回 matching
        await col('demand').where({ _id: demand_id, status: 'matched' }).update({
          data: { status: 'matching', matched_openid: null, matched_at: null, updated_at: Date.now() }
        }).catch(() => {});
        return { ok: false, code: 'order_demand_closed', msg: '接单中断,该需求已释放,请重试' };
      }
    } catch (e) {
      log.d(`take idempotent recover fail: ${e.message}`);
    }
    await logReject(openid, demand_id, 'demand_cas_lost');
    return { ok: false, code: 'order_demand_closed', msg: '手慢了,该需求已被其他耍伴接单' };
  }

  // ② 事务建单: order_main + order_confirmations + 状态流水 同成同败
  // P1 留证预构建: 需求者侧场景免责声明(勾选同意型)文档全文+SHA-256, 在事务内随订单一起落库
  const userEvidence = buildCheckboxEvidence({
    openid: demand.creator_openid, role: 'user', scene: demandScene,
    disclaimerType: demand.disclaimer_type || 'general_disclaimer',
    config, demandId: demand_id,
    signedAt: demand.disclaimer_signed_at || now
  });
  userEvidence.created_at = now;
  userEvidence.updated_at = now;

  // 订单号唯一冲突自动重试(2026-10-21 加固): 唯一索引 uk_order_no 冲突时重新生成单号,
  // 最多重试 2 次(共 3 次尝试); 事务原子, 失败尝试不会残留半成品。其余失败仍走补偿释放需求。
  let created = false;
  let txnErr = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
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

      // 需求者免责声明签署凭证(双签入库 · code.html 第一道防线; P1 留证: 文档全文+SHA-256)
      const ueRes = await t.collection('disclaimer_signature').add({ data: Object.assign({}, userEvidence, { order_id: orderId }) });
      userEvidenceId = (ueRes && ueRes._id) || '';
    });
    created = true;
  } catch (e) {
    txnErr = e;
    if (isDupKeyErr(e) && attempt < 2) {
      log.w(`order_no 冲突, 重试 #${attempt + 1}: ${orderNo} 作废重新生成`);
      orderNo = genOrderNo();
      orderData.order_no = orderNo;
      continue;
    }
    break;
  }
  }
  if (!created) {
    // 补偿: 事务失败则释放需求回 matching, 供其他耍伴再接(同时清 matched_openid)
    log.d(`order txn fail: ${(txnErr && txnErr.message) || ''}; compensating demand ${demand_id} → matching`);
    await col('demand').where({ _id: demand_id, status: 'matched' }).update({
      data: { status: 'matching', matched_openid: null, matched_at: null, updated_at: Date.now() }
    }).catch((ce) => log.d(`demand compensate fail: ${ce.message}`));
    return { ok: false, code: 'order_db_fail', msg: '订单创建失败' };
  }
  } finally {
    await releaseTakeLock(openid, takeToken);
  }

  log.d(`order created: ${orderNo} demand=${demand.demand_no} partner=${openid}`);
  await writeAudit(db, log, {
    openid, role: 'partner', category: 'business', action: 'order_take',
    target_type: 'order', target_id: orderId,
    detail: {
      order_no: orderNo, demand_id, demand_no: demand.demand_no, scene: demandScene,
      total_fen: totalFen, take_distance_km: takeDistanceKm,
      user_evidence_id: userEvidenceId
    },
    evidence_id: (signed.data[0] && signed.data[0]._id) || '',
    doc_hash: (signed.data[0] && signed.data[0].signature_hash) || '',
    result: 'ok', client_ip: clientIp, device
  });
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
}

module.exports = { create_from_take: createFromTakeAction };
