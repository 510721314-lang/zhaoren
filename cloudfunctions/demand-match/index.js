// 对应 PRD 章节：3.2 匹配机制 / 3.2.2 智能匹配算法(MVP简化版:信用分降序) / 3.2.3 定向邀约 / 3.2.4 广场广播
// demand-match 需求匹配 · 身份取自 getWXContext().OPENID
// 3 个 action: top5 / invite / broadcast
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 进行中订单状态集合(S1/S0/S2/S3/S3.5)
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

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
  const openid = wxCtx.OPENID;
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

      // 写入 demand.match_candidates
      try {
        await col('demand').doc(demand_id).update({ data: {
          match_candidates: candidates, updated_at: Date.now()
        }});
      } catch (e) {
        console.log(`match write candidates fail: ${e.message}`);
      }

      return { ok: true, data: { candidates, total: candidates.length } };
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

    default:
      return { ok: false, code: 'match_unknown_action', msg: '未知动作' };
  }
};
