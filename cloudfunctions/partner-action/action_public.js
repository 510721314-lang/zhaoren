// action_public.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 5. 耍伴详情（C端公开）
async function detailAction(ctx) {
  const { event, openid, clientIp, device, _, col, creditLevelOf, formatTimeAgo } = ctx;
      const { partner_openid } = event;
      if (!partner_openid) return { ok: false, code: 'pa_no_target', msg: '缺少耍伴标识' };

      const r = await col('partner_profile').where({ openid: partner_openid, status: 'approved', is_deleted: false }).limit(1).get();
      if (!r.data || !r.data[0]) return { ok: false, code: 'pa_not_found', msg: '耍伴不存在或未认证' };
      const p = r.data[0];

      // 拉 user_account 拿昵称头像 + 动态信用分(partner_credit_score 为真值源)
      let nickname = p.nickname || '微信用户', avatar = '', creditScore = 800;
      try {
        const ua = await col('user_account').where({ openid: partner_openid }).limit(1).get();
        if (ua.data && ua.data[0]) {
          nickname = ua.data[0].nickname || nickname;
          avatar = ua.data[0].avatar || '';
          const cs = Number(ua.data[0].partner_credit_score);
          if (Number.isFinite(cs) && cs > 0) creditScore = cs;
        }
      } catch (e) {}

      // 订单统计
      let totalOrders = 0, completedOrders = 0;
      try {
        const tr = await col('order_main').where({ partner_openid, is_deleted: false }).count();
        totalOrders = tr.total || 0;
        const cr = await col('order_main').where({ partner_openid, status: _.in(['S5','S8','S9','S10']), is_deleted: false }).count();
        completedOrders = cr.total || 0;
      } catch (e) {}

      // 最近 3 条评价
      let evaluations = [];
      try {
        const er = await col('evaluation').where({ partner_openid, is_deleted: false }).orderBy('created_at', 'desc').limit(3).get();
        evaluations = (er.data || []).map(ev => ({
          stars: ev.stars || 5,
          tags: ev.tags || [],
          content: ev.content || '',
          at: formatTimeAgo(ev.created_at)
        }));
      } catch (e) {}

      return {
        ok: true,
        data: {
          partner: {
            _id: p._id, openid: p.openid,
            nickname, avatar,
            accept_scenes: p.accept_scenes || [],
            scene_rates: p.scene_rates || {},
            city: p.city,
            home_location: p.home_location ? {
              name: p.home_location.name || '',
              address: p.home_location.address || ''
            } : null,
            score: creditScore,
            level: creditLevelOf(creditScore),
            accept_switch: p.accept_switch !== false,
            real_name_verified: !!p.real_name_verified,
            face_verified: !!p.face_verified,
            intro: p.intro || '这个耍伴还没写自我介绍~',
            certified_scenes: p.accept_scenes || [],
            // 耍伴资料: 展示端只读审核通过快照(未过审/审核中一律不上线, fail-closed)
            bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
            skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || [],
            service_highlights: (p.profile_audited_snapshot && p.profile_audited_snapshot.highlights) || [],
            // 资质证书 / 荣誉 其他(展示端只读审核通过快照)
            qualifications: (p.profile_audited_snapshot && p.profile_audited_snapshot.qualifications) || { titles: [], photos: [] },
            honors: (p.profile_audited_snapshot && p.profile_audited_snapshot.honors) || { titles: [], photos: [] }
          },
          stats: { total_orders: totalOrders, completed_orders: completedOrders },
          evaluations
        }
      };
}

    // 6. 路线规划（C端公开）: 耍伴日常位置 → 浏览者当前位置的距离与驾车/公交/骑行耗时
    //    腾讯 Direction API 并行查询, 任一方式失败独立降级为直线估算
async function routePlanAction(ctx) {
  const { event, openid, clientIp, device, col, log, getTencentMapKey, sanitizeHomeLocation, haversineMeters, estimateMinutes, fetchTencentRoute } = ctx;
      const myLat = Number(event.latitude);
      const myLng = Number(event.longitude);
      if (!event.partner_openid) return { ok: false, code: 'pa_no_target', msg: '缺少耍伴标识' };
      if (!isFinite(myLat) || !isFinite(myLng) || myLat < 3 || myLat > 54 || myLng < 73 || myLng > 136) {
        return { ok: false, code: 'pa_bad_coord', msg: '当前坐标无效' };
      }

      const r = await col('partner_profile').where({
        openid: event.partner_openid, status: 'approved', is_deleted: false
      }).limit(1).get();
      const p = r.data && r.data[0];   // where().get() 返回数组, 必须取 [0]
      if (!p) return { ok: false, code: 'pa_not_found', msg: '耍伴不存在或未认证' };
      const h = sanitizeHomeLocation(p.home_location);
      if (!h) return { ok: false, code: 'pa_no_home', msg: '该耍伴未设置日常位置' };

      const from = { lat: h.latitude, lng: h.longitude }; // 从耍伴日常位置出发
      const to = { lat: myLat, lng: myLng };
      const straightM = Math.round(haversineMeters(h.latitude, h.longitude, myLat, myLng));

      const mapKey = await getTencentMapKey();
      const modeDefs = [['drive', 'driving'], ['transit', 'transit'], ['bike', 'bicycling']];
      const results = await Promise.all(modeDefs.map(async ([key, mode]) => {
        if (!mapKey) {
          return { key, minutes: estimateMinutes(key, straightM), source: 'estimate', distance_m: null };
        }
        try {
          const rr = await fetchTencentRoute(mode, from, to, mapKey);
          return { key, minutes: rr.minutes, source: 'tencent', distance_m: rr.distance_m };
        } catch (e) {
          log.d(`route_plan ${mode} fail: ${e.message}`);
          return { key, minutes: estimateMinutes(key, straightM), source: 'estimate', distance_m: null };
        }
      }));

      const modes = {};
      results.forEach((t) => {
        modes[t.key] = { minutes: t.minutes, source: t.source, distance_m: t.distance_m };
      });
      // 展示距离: 优先驾车路线里程, 无则直线距离
      const distanceM = (modes.drive && modes.drive.distance_m) || straightM;

      return {
        ok: true,
        data: {
          home: { name: h.name, address: h.address },
          straight_m: straightM,
          distance_m: distanceM,
          modes
        }
      };
}

module.exports = {
  detail: detailAction,
  route_plan: routePlanAction,
};
