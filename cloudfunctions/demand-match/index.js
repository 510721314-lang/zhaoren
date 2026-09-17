// 对应 PRD 章节：3.2 匹配机制 / 3.2.2 智能匹配算法(MVP简化版:信用分降序) / 3.2.3 定向邀约 / 3.2.4 广场广播
// demand-match 需求匹配 · 身份取自 getWXContext().OPENID
// 6 个 action: top5 / invite / broadcast / hall_list / apply / confirm_apply
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 进行中订单状态集合(S1/S0/S2/S3/S3.5)
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];
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
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { min_credit_take_order: 600 };
}

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = event.mock_openid || wxCtx.OPENID;  // 测试用:云端测试可传 mock_openid 模拟身份
  if (!openid) return { ok: false, code: 'match_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`demand-match action=${action} openid=${openid}`);

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
          partner_credit_score: _.gte(minCredit),
          is_deleted: false
        }).orderBy('partner_credit_score', 'desc')
          .orderBy('updated_at', 'desc')
          .limit(50)
          .get();
        partners = pr.data || [];
      } catch (e) {
        console.log(`match query partners fail: ${e.message}`);
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
          credit: p.partner_credit_score || 800,
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
        console.log(`match write candidates fail: ${e.message}`);
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
          console.log(`status query order fail: ${e.message}`);
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
      console.log(`demand invite: ${demand.demand_no} -> ${partner_openids.join(',')}`);
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
      console.log(`demand broadcast: ${demand.demand_no}`);
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
      let profile = await col('partner_profile').where({ openid, is_deleted: _.neq(true) }).limit(1).get()
        .then(r => (r.data && r.data[0]) || null).catch(() => null);
      if (profile && profile.is_deleted === undefined) {
        const patch = { is_deleted: false, updated_at: Date.now() };
        if (profile.accept_switch === undefined) patch.accept_switch = true;
        await col('partner_profile').doc(profile._id).update({ data: patch })
          .catch((e) => console.log(`[legacy heal] fail: ${e.message}`));
        profile = Object.assign(profile, { is_deleted: false });
        if (profile.accept_switch === undefined) profile.accept_switch = true;
      }
      if (!profile || profile.status !== 'approved') {
        return { ok: false, code: 'apply_not_partner', msg: '耍伴资料未审核通过' };
      }
      // 免责声明校验
      const scene = String(demand.scene || '');
      const signed = await col('disclaimer_signature').where({
        openid, role: 'partner', scene, is_deleted: false
      }).limit(1).get().catch(() => ({ data: [] }));
      if (!signed.data || !signed.data[0]) {
        return { ok: false, code: 'apply_disclaimer_required', msg: '请先签署该场景免责声明后再报名' };
      }
      // 防重复报名
      const applicants = Array.isArray(demand.applicants) ? demand.applicants : [];
      if (applicants.some(a => a.openid === openid)) {
        return { ok: false, code: 'apply_duplicate', msg: '你已报名该需求' };
      }
      // 追加报名者
      applicants.push({ openid, applied_at: Date.now(), status: 'pending' });
      await col('demand').doc(demand_id).update({ data: {
        applicants, updated_at: Date.now()
      }});
      console.log(`apply success: demand=${demand_id} partner=${openid}`);
      return { ok: true, data: { demand_id, applied: true, applicant_count: applicants.length } };
    }

    // 6. 需求者确认报名(选单模式)
    case 'confirm_apply': {
      const { demand_id, partner_openid } = event;
      if (!demand_id) return { ok: false, code: 'confirm_no_id', msg: '缺少需求 ID' };
      if (!partner_openid) return { ok: false, code: 'confirm_no_partner', msg: '缺少耍伴 ID' };

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
      const target = applicants.find(a => a.openid === partner_openid);
      if (!target) {
        return { ok: false, code: 'confirm_not_applicant', msg: '该耍伴未报名' };
      }
      // 设置已确认耍伴(CAS 防止重复确认)
      const cr = await col('demand').where({
        _id: demand_id, status: 'matching', matched_openid: null
      }).update({ data: {
        matched_openid: partner_openid, updated_at: Date.now()
      }});
      if (!cr.stats || cr.stats.updated !== 1) {
        return { ok: false, code: 'confirm_conflict', msg: '该需求已确认其他耍伴' };
      }
      console.log(`confirm_apply: demand=${demand_id} partner=${partner_openid}`);
      return { ok: true, data: { demand_id, confirmed_partner: partner_openid } };
    }

    // 4. 接单大厅列表(广场可接单需求)
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
          console.log(`hall lazy_expire: ${expiredRes.data.length} demands expired`);
        }
      } catch (e) { console.log(`hall lazy_expire fail: ${e.message}`); }

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
        console.log(`hall_list query fail: ${e.message}`);
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
