// 对应 PRD 章节：3.2 匹配机制 / 3.2.2 智能匹配算法(MVP简化版:信用分降序) / 3.2.3 定向邀约 / 3.2.4 广场广播
// demand-match 需求匹配 · 身份取自 getWXContext().OPENID
// 6 个 action: top5 / invite / broadcast / hall_list / apply / confirm_apply / applicant_list
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');
const { getHealedPartnerProfile } = require('./heal');

// 进行中订单状态集合(S1/S0/S2/S3/S3.5)
// 评审修复(2026-11-19 R3-2): 补瞬态 S2_5/S2_6/S3_6(与 order-create BUSY_STATUS 同口径) ——
// 改期/履约确认窗口内原被 top5"无进行中订单"过滤放行
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S2_5', 'S2_6', 'S3', 'S3_6', 'S3.5'];
// 已完成订单状态集合(计入耍伴累计履约单数)
const DONE_STATUS = ['S5', 'S8', 'S9', 'S10'];

// 耍伴等级文案(MVP: 按累计履约单数)
function partnerLevel(completedOrders) {
  if (completedOrders >= 20) return { code: 'L3', name: '金牌耍伴' };
  if (completedOrders >= 5) return { code: 'L2', name: '熟练耍伴' };
  return { code: 'L1', name: '新手耍伴' };
}

// 取运营参数
async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) return r.data;   // doc().get() 返回单个对象(非数组)
  } catch (e) { log.d('demand-match getConfig fail: ' + (e && e.message || e)); }
  return { min_credit_take_order: 600 };
}

// 2026-11-15 选单模式立项: 单个需求报名人数上限(与即时推送阈值 20 对齐, 防 applicants 数组膨胀)
const APPLICANT_CAP = 20;

// 2026-11-15 选单模式立项: 报名者令牌(不向发布者回传原始 openid, 确认时用令牌反解)
function partnerToken(demandId, openid) {
  return crypto.createHash('sha256').update(String(demandId) + ':' + openid).digest('hex').slice(0, 24);
}

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'match_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`demand-match action=${action} openid=${openid}`);

  switch (action) {

    // 1. Top5 候选耍伴(信用分降序,前 5)
    case 'top5': {
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'match_no_id', msg: '缺少需求 ID' };

      // 取需求
      let demand;
      try {
        const dr = await col('demand').doc(demand_id).get();
        demand = dr.data;
        if (!demand) return { ok: false, code: 'match_demand_not_found', msg: '需求不存在' };
      } catch (e) {
        return { ok: false, code: 'match_demand_not_found', msg: '需求不存在' };
      }

      if (demand.creator_openid !== openid) {
        return { ok: false, code: 'match_not_owner', msg: '只有需求创建者可查看候选' };
      }
      if (demand.status !== 'matching') {
        return { ok: false, code: 'match_demand_closed', msg: `需求已${demand.status === 'expired' ? '过期' : '关闭'},不可匹配` };
      }

      const config = await getConfig();
      const minCredit = config.min_credit_take_order || 600;
      const scene = demand.scene;

      // ── 查耍伴:审核通过 + 接单开关 + 城市含成都 + 接受该场景 + 信用分达标 ──
      let partners;
      try {
        const pr = await col('partner_profile').where({
          status: 'approved',
          accept_switch: true,
          accept_scenes: scene,           // 数组含场景
          credit_score: _.gte(minCredit),   // P3-59(2026-11-17): partner_profile 字段是 credit_score 非 partner_credit_score
          is_deleted: false
        }).orderBy('credit_score', 'desc')
          .orderBy('updated_at', 'desc')
          .limit(50)
          .get();
        partners = pr.data || [];
      } catch (e) {
        log.d(`match query partners fail: ${e.message}`);
        return { ok: false, code: 'match_query_fail', msg: '查询候选失败' };
      }

      // ── 逐个过滤"无进行中订单" ──
      const candidates = [];
      for (const p of partners) {
        if (candidates.length >= 5) break;
        // 排除需求发布者自己(不能邀约/接自己的单)
        if (p.openid === demand.creator_openid) continue;
        // 城市:partner_profile.city 是数组
        if (!Array.isArray(p.city) || p.city.indexOf('成都') < 0) continue;

        // 检查是否有进行中订单(S0/S1/S2/S3/S3.5)
        let busy = false;
        try {
          const or = await col('order_main').where({
            partner_openid: p.openid,
            status: _.in(BUSY_STATUS),
            is_deleted: false
          }).limit(1).get();
          busy = or.data && or.data.length > 0;
        } catch (e) { /* 查询失败保守跳过 */ }
        if (busy) continue;

        candidates.push({
          openid: p.openid,
          nickname: p.nickname || '耍伴',
          credit: p.credit_score || 800,   // P3-63(2026-11-18): p 来自 partner_profile, 字段为 credit_score 而非 partner_credit_score
          // 候选时薪:按需求场景从 scene_rates 取;无则取 rate_fen 兼容旧字段
          rate_fen: (p.scene_rates && p.scene_rates[scene]) || p.rate_fen || demand.rate_fen,
          avatar: p.avatar || ''
        });
      }

      // ── 并行统计每位候选的累计履约单数(S5/S8/S9/S10)并派生等级 ──
      await Promise.all(candidates.map(async (c) => {
        let done = 0;
        try {
          const cr = await col('order_main').where({
            partner_openid: c.openid,
            status: _.in(DONE_STATUS),
            is_deleted: false
          }).count();
          done = (cr && cr.total) || 0;
        } catch (e) { /* 统计失败按 0 处理 */ }
        c.completed_orders = done;
        const lv = partnerLevel(done);
        c.level_code = lv.code;
        c.level_name = lv.name;
      }));

      // 写入 demand.match_candidates
      try {
        await col('demand').doc(demand_id).update({ data: {
          match_candidates: candidates, updated_at: Date.now()
        }});
      } catch (e) {
        log.d(`match write candidates fail: ${e.message}`);
      }

      // 需求摘要(供匹配页展示上下文)
      const sceneCfg = (config.scene_list || []).find((s) => s.code === scene);
      const demandBrief = {
        scene,
        scene_name: sceneCfg ? sceneCfg.name : scene,
        content_options: demand.content_options && demand.content_options.length
          ? demand.content_options
          : (demand.content_option ? [demand.content_option] : []),
        start_time: demand.start_time,
        duration_h: demand.duration_h,
        location_name: (demand.location && demand.location.name) || '',
        rate_fen: demand.rate_fen,
        total_fen: demand.total_fen,
        aa_tier: demand.aa_tier || '',
        invited: demand.invited || [],
        broadcast: !!demand.broadcast,
        status: demand.status,
        expire_at: demand.expire_at || null
      };

      return { ok: true, data: { candidates, total: candidates.length, demand: demandBrief } };
    }

    // 1.5 需求状态轮询(匹配页每 15 秒): matched 时回带订单 ID 供跳转 IM
    case 'status': {
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'status_no_id', msg: '缺少需求 ID' };

      let demand;
      try {
        const dr = await col('demand').doc(demand_id).get();
        demand = dr.data;
        if (!demand) return { ok: false, code: 'status_not_found', msg: '需求不存在' };
      } catch (e) {
        return { ok: false, code: 'status_not_found', msg: '需求不存在' };
      }
      if (demand.creator_openid !== openid) {
        return { ok: false, code: 'status_not_owner', msg: '只有需求创建者可查询' };
      }

      const out = {
        status: demand.status,
        broadcast: !!demand.broadcast,
        invited: demand.invited || [],
        expire_at: demand.expire_at || null,
        order_id: '',
        order_no: ''
      };

      // 已被接单 → 查订单(接单时 demand.status 置为 matched)
      if (demand.status === 'matched') {
        try {
          const or = await col('order_main').where({
            demand_id, is_deleted: false
          }).orderBy('created_at', 'desc').limit(1).get();
          if (or.data && or.data[0]) {
            out.order_id = or.data[0]._id;
            out.order_no = or.data[0].order_no || '';
            out.order_status = or.data[0].status;
          }
        } catch (e) {
          log.d(`status query order fail: ${e.message}`);
        }
      }

      return { ok: true, data: out };
    }

    // 2. 定向邀约(1-3 人,必须来自候选)
    case 'invite': {
      const { demand_id, partner_openids } = event;
      if (!demand_id) return { ok: false, code: 'invite_no_id', msg: '缺少需求 ID' };
      if (!Array.isArray(partner_openids) || partner_openids.length === 0 || partner_openids.length > 3) {
        return { ok: false, code: 'invite_count', msg: '邀约人数需 1-3 人' };
      }

      let demand;
      try {
        const dr = await col('demand').doc(demand_id).get();
        demand = dr.data;
        if (!demand) return { ok: false, code: 'invite_demand_not_found', msg: '需求不存在' };
      } catch (e) {
        return { ok: false, code: 'invite_demand_not_found', msg: '需求不存在' };
      }
      if (demand.creator_openid !== openid) {
        return { ok: false, code: 'invite_not_owner', msg: '只有需求创建者可邀约' };
      }
      if (demand.status !== 'matching') {
        return { ok: false, code: 'invite_demand_closed', msg: `需求已${demand.status === 'expired' ? '过期' : '关闭'}` };
      }

      // 必须来自候选(若 match_candidates 为空,先提示运行 top5)
      const candIds = (demand.match_candidates || []).map(c => c.openid);
      if (candIds.length === 0) {
        return { ok: false, code: 'invite_no_candidates', msg: '请先调用 top5 生成候选' };
      }
      for (const pid of partner_openids) {
        if (candIds.indexOf(pid) < 0) {
          return { ok: false, code: 'invite_not_in_candidates', msg: '邀约对象必须来自候选列表' };
        }
      }

      // 合并去重写入 invited
      const invited = (demand.invited || []).slice();
      for (const pid of partner_openids) {
        if (invited.indexOf(pid) < 0) invited.push(pid);
      }
      await col('demand').doc(demand_id).update({ data: {
        invited, updated_at: Date.now()
      }});
      log.d(`demand invite: ${demand.demand_no} -> ${partner_openids.join(',')}`);
      return { ok: true, data: { invited } };
    }

    // 3. 广场广播(置 demand.broadcast=true)
    case 'broadcast': {
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'broadcast_no_id', msg: '缺少需求 ID' };

      let demand;
      try {
        const dr = await col('demand').doc(demand_id).get();
        demand = dr.data;
        if (!demand) return { ok: false, code: 'broadcast_not_found', msg: '需求不存在' };
      } catch (e) {
        return { ok: false, code: 'broadcast_not_found', msg: '需求不存在' };
      }
      if (demand.creator_openid !== openid) {
        return { ok: false, code: 'broadcast_not_owner', msg: '只有需求创建者可广播' };
      }
      if (demand.status !== 'matching') {
        return { ok: false, code: 'broadcast_closed', msg: `需求已${demand.status === 'expired' ? '过期' : '关闭'}` };
      }

      await col('demand').doc(demand_id).update({ data: {
        broadcast: true, match_mode: 'broadcast', updated_at: Date.now()
      }});
      log.d(`demand broadcast: ${demand.demand_no}`);
      return { ok: true, data: { broadcast: true } };
    }

    // 5. 耍伴报名(选单模式 · match_mode=select)
    case 'apply': {
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'apply_no_id', msg: '缺少需求 ID' };

      let demand;
      try {
        const dr = await col('demand').doc(demand_id).get();
        demand = dr.data;
        if (!demand) return { ok: false, code: 'apply_not_found', msg: '需求不存在' };
      } catch (e) {
        return { ok: false, code: 'apply_not_found', msg: '需求不存在' };
      }
      // 仅选单模式可报名
      if ((demand.match_mode || 'broadcast') !== 'select') {
        return { ok: false, code: 'apply_mode_invalid', msg: '该需求为抢单模式,请直接接单' };
      }
      if (demand.status !== 'matching') {
        return { ok: false, code: 'apply_closed', msg: '该需求已不可报名' };
      }
      if (demand.creator_openid === openid) {
        return { ok: false, code: 'apply_own', msg: '不能报名自己发布的需求' };
      }
      // 耍伴身份校验(is_deleted 缺省的历史坏文档视为有效并惰性治愈, 仅显式 true 拒绝)
      const profile = await getHealedPartnerProfile(col, _, openid);
      if (!profile || profile.status !== 'approved') {
        return { ok: false, code: 'apply_not_partner', msg: '耍伴资料未审核通过' };
      }
      // 2026-11-15 P3-37: 接单开关关闭者不可报名(与 order-create.action_take 的 order_switch_off 同口径;
      // 字段缺省视为开, 与 partner-action action_config.js 的 switchOn 判断一致)。
      // 此前仅前端 take-order 探针拦截, 绕过前端直调云函数可报名成功, 致发布者候选名单混入已暂停接单者。
      if (profile.accept_switch === false) {
        return { ok: false, code: 'apply_switch_off', msg: '接单开关已关闭,请开启后再报名' };
      }
      // 免责声明校验
      const scene = String(demand.scene || '');
      const signed = await col('disclaimer_signature').where({
        openid, role: 'partner', scene, is_deleted: false
      }).limit(1).get().catch(() => ({ data: [] }));
      if (!signed.data || !signed.data[0]) {
        return { ok: false, code: 'apply_disclaimer_required', msg: '请先签署该场景免责声明后再报名' };
      }
      // 2026-11-15 选单模式立项: 报名资格轻量预检(实名+信用分)
      // 权威门禁(紧急联系人/考试证书/场景/时段/价格/每日上限)仍在 order-create.action_take 复核
      // 2026-11-15 修复: 实名/信用分改读 user_account(与 order-create.getUser 同口径);
      // 此前误读不存在的 partner_user 集合, 致 partnerUser 恒为空、所有报名被 apply_realname_required 拦下
      const puRes = await col('user_account').where({ openid }).limit(1).get().catch(() => ({ data: [] }));
      const partnerUser = (puRes.data && puRes.data[0]) || {};
      if (!partnerUser.is_realname_done) {
        return { ok: false, code: 'apply_realname_required', msg: '请先完成实名认证后再报名' };
      }
      const applyCfg = await getConfig();
      if ((partnerUser.partner_credit_score || 800) < (applyCfg.min_credit_take_order || 600)) {
        return { ok: false, code: 'apply_credit_low', msg: '信用分不足,暂不可报名' };
      }
      // 防重复报名(友好前置校验; 并发兜底由下面的 CAS 完成)
      const applicants = Array.isArray(demand.applicants) ? demand.applicants : [];
      if (applicants.length >= APPLICANT_CAP) {
        return { ok: false, code: 'apply_full', msg: '报名人数已满' };
      }
      if (applicants.some(a => a.openid === openid)) {
        return { ok: false, code: 'apply_duplicate', msg: '你已报名该需求' };
      }
      // 原子 push + CAS: 需求仍 matching 且 applicants 中无本人(字段缺省的历史文档也视为未报名)才命中,
      // 杜绝读-改-写并发丢报名/重复报名
      const appliedAt = Date.now();
      const addRes = await col('demand').where({
        _id: demand_id,
        status: 'matching',
        'applicants.openid': _.neq(openid)
      }).update({ data: {
        applicants: _.push({ each: [{ openid, applied_at: appliedAt, status: 'pending' }] }),
        updated_at: appliedAt
      }});
      if (!addRes.stats || addRes.stats.updated !== 1) {
        return { ok: false, code: 'apply_conflict', msg: '报名失败,该需求可能已关闭或你已报名' };
      }
      // 2026-11-15 选单模式立项: 报名成功通知发布者(此前报名全程无通知, 发布者无感知)
      try {
        await col('system_notice').add({ data: {
          to_openid: demand.creator_openid,
          order_id: '',
          type: 'select_apply',
          title: '有耍伴报名',
          body: `有人报名「${String(demand.remark || '你的需求').split('｜')[0]}」, 请进入需求详情选择`,
          action_key: 'jump_demand',
          action_payload: { demand_id },
          created_at: Date.now(),
          read: false
        }});
      } catch (e) { log.d('[notice] select_apply fail: ' + (e && e.message || e)); }
      log.d(`apply success: demand=${demand_id} partner=${openid}`);
      return { ok: true, data: { demand_id, applied: true, applicant_count: applicants.length + 1 } };
    }

    // 6. 需求者确认报名(选单模式)
    case 'confirm_apply': {
      const { demand_id, partner_openid } = event;
      if (!demand_id) return { ok: false, code: 'confirm_no_id', msg: '缺少需求 ID' };
      if (!partner_openid && !event.partner_token) return { ok: false, code: 'confirm_no_partner', msg: '缺少耍伴 ID' };

      let demand;
      try {
        const dr = await col('demand').doc(demand_id).get();
        demand = dr.data;
        if (!demand) return { ok: false, code: 'confirm_not_found', msg: '需求不存在' };
      } catch (e) {
        return { ok: false, code: 'confirm_not_found', msg: '需求不存在' };
      }
      if (demand.creator_openid !== openid) {
        return { ok: false, code: 'confirm_not_owner', msg: '只有需求创建者可确认报名' };
      }
      if ((demand.match_mode || 'broadcast') !== 'select') {
        return { ok: false, code: 'confirm_mode_invalid', msg: '该需求不是选单模式' };
      }
      if (demand.status !== 'matching') {
        return { ok: false, code: 'confirm_closed', msg: '该需求已不可确认' };
      }
      const applicants = Array.isArray(demand.applicants) ? demand.applicants : [];
      // 2026-11-15 选单模式立项: 前端只持有 partner_token, 在此反解为 openid(兼容旧的直传 partner_openid)
      let targetOpenid = partner_openid || '';
      if (!targetOpenid && event.partner_token) {
        const hit = applicants.find(a => partnerToken(demand_id, a.openid) === event.partner_token);
        if (hit) targetOpenid = hit.openid;
      }
      const target = applicants.find(a => a.openid === targetOpenid);
      if (!target) {
        return { ok: false, code: 'confirm_not_applicant', msg: '该耍伴未报名' };
      }
      // 设置已确认耍伴(CAS 防止重复确认)
      // 2026-11-15 选单模式立项: 落 matched_confirm_at 供 order-timer 超时释放扫描
      const confirmedAt = Date.now();
      const cr = await col('demand').where({
        _id: demand_id, status: 'matching', matched_openid: null
      }).update({ data: {
        matched_openid: targetOpenid, matched_confirm_at: confirmedAt, updated_at: confirmedAt
      }});
      if (!cr.stats || cr.stats.updated !== 1) {
        return { ok: false, code: 'confirm_conflict', msg: '该需求已确认其他耍伴' };
      }
      // 2026-11-15: 通知被选中的耍伴尽快接单(此前确认后对方无感知, 需求会卡住)
      try {
        await col('system_notice').add({ data: {
          to_openid: targetOpenid,
          order_id: '',
          type: 'select_confirmed',
          title: '你被选中了',
          body: `发布者已选择你承接「${String(demand.remark || '该需求').split('｜')[0]}」, 请尽快确认接单`,
          action_key: 'jump_demand',
          action_payload: { demand_id },
          created_at: Date.now(),
          read: false
        }});
      } catch (e) { log.d('[notice] select_confirmed fail: ' + (e && e.message || e)); }
      log.d(`confirm_apply: demand=${demand_id} partner=${targetOpenid}`);
      return { ok: true, data: { demand_id, confirmed: true } };
    }

    // 7. 发布者查看报名名单(选单模式; 仅需求创建者, 不下发原始 openid)
    case 'applicant_list': {
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'applicant_no_id', msg: '缺少需求 ID' };
      let demand;
      try {
        const dr = await col('demand').doc(demand_id).get();
        demand = dr.data;
      } catch (e) {
        return { ok: false, code: 'applicant_not_found', msg: '需求不存在' };
      }
      if (!demand) return { ok: false, code: 'applicant_not_found', msg: '需求不存在' };
      if (demand.creator_openid !== openid) {
        return { ok: false, code: 'applicant_not_owner', msg: '只有需求创建者可查看报名' };
      }
      const list = Array.isArray(demand.applicants) ? demand.applicants.slice(0, APPLICANT_CAP) : [];
      const openids = list.map(a => a.openid);
      let profiles = [];
      if (openids.length) {
        const pr = await col('partner_profile').where({ openid: _.in(openids) }).limit(APPLICANT_CAP).get().catch(() => ({ data: [] }));
        profiles = pr.data || [];
      }
      const byOpenid = {};
      profiles.forEach(p => { byOpenid[p.openid] = p; });
      // 履约单数为派生值(partner_profile 不落库), 与 top5 同口径按 S5/S8/S9/S10 统计
      const data = await Promise.all(list.map(async (a) => {
        const p = byOpenid[a.openid] || {};
        let completed = 0;
        try {
          const cr = await col('order_main').where({
            partner_openid: a.openid, status: _.in(DONE_STATUS), is_deleted: false
          }).count();
          completed = (cr && cr.total) || 0;
        } catch (e) { /* 统计失败按 0 处理 */ }
        return {
          partner_token: partnerToken(demand_id, a.openid),
          nickname: p.nickname || '耍伴',
          avatar: p.avatar || '',
          credit: p.credit_score || 800,   // P3-63(2026-11-18): p 来自 partner_profile, 字段为 credit_score 而非 partner_credit_score
          level: partnerLevel(completed).name,
          completed_orders: completed,
          applied_at: a.applied_at || 0,
          is_confirmed: demand.matched_openid === a.openid
        };
      }));
      return { ok: true, data: {
        demand_id,
        applicant_count: data.length,
        matched_confirm_at: demand.matched_confirm_at || 0,
        list: data
      }};
    }

    // 4. 接单大厅列表(广场可接单需求)
    // deprecated: 前端广场已走 home-action.square(含耍伴价格区间过滤), 此 action 仅保留兼容
    case 'hall_list': {
      // lazy_expire:把已过期的 matching 需求置为 expired
      try {
        const expiredRes = await col('demand').where({
          status: 'matching',
          expire_at: _.lt(Date.now()),
          is_deleted: false
        }).limit(50).get();
        if (expiredRes.data && expiredRes.data.length > 0) {
          for (const d of expiredRes.data) {
            // CAS: 仅 matching→expired, 不覆盖刚被接单(matched)的需求
            try {
              await col('demand').where({ _id: d._id, status: 'matching' }).update({
                data: { status: 'expired', expired_at: Date.now(), updated_at: Date.now() }
              });
            } catch (e) {}
          }
          log.d(`hall lazy_expire: ${expiredRes.data.length} demands expired`);
        }
      } catch (e) { log.d(`hall lazy_expire fail: ${e.message}`); }

      let list;
      try {
        // 仅展示已广场广播(broadcast=true)的需求; 未广播需求处于定向邀约阶段, 不上大厅
        const r = await col('demand').where({
          status: 'matching',
          broadcast: true,
          is_deleted: _.neq(true)
        }).orderBy('created_at', 'desc').limit(50).get();
        list = r.data || [];
      } catch (e) {
        log.d(`hall_list query fail: ${e.message}`);
        return { ok: false, code: 'hall_query_fail', msg: '加载接单列表失败' };
      }

      // 取场景中文名(从 config)
      const config = await getConfig();
      const sceneList = config.scene_list || [];
      const sceneName = (code) => {
        const s = sceneList.find(x => x.code === code);
        return s ? s.name : code;
      };

      const data = list.map(d => ({
        demand_id: d._id,
        demand_no: d.demand_no,
        scene: d.scene,
        scene_name: sceneName(d.scene),
        content_options: d.content_options || [],
        remark: d.remark || '',
        location_name: (d.location && d.location.name) || '',
        start_time: d.start_time,
        duration_h: d.duration_h,
        rate_fen: d.rate_fen,
        total_fen: d.total_fen,
        aa_tier: d.aa_tier || '',
        created_at: d.created_at,
        is_mine: d.creator_openid === openid
      }));

      return { ok: true, data: { list: data, total: data.length } };
    }

    default:
      return { ok: false, code: 'match_unknown_action', msg: '未知动作' };
  }
};
