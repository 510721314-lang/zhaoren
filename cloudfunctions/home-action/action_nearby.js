// action_nearby.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

      // ───────── 附近可接单池(耍伴端首页 + 附近列表页, 按发布时间倒序) ─────────
      // 过滤: 匹配中 + 场景白名单 + 非定向(match_mode!=='direct') + 未超 take_distance_max_km + 排除已删/自己的需求
      // 排序: created_at 降序(最新发布在前); 复用 square 的 mapDemand 卡片映射 + 距离过滤(仅剔除阈值外)
      // 分页: page 从 1 起, page_size 默认 10(首页用), 附近列表页可传 20(≤50)
async function nearbyAction(ctx) {
  const { event, clientIp, device, action, cloud, _, col, SCENE_FALLBACK, loadSceneList, mapDemand, fillPublisherSurname, priceRangeWhere, loadVisitorPartner, loadTakeDistanceCap, haversineKm } = ctx;
        const page = Math.max(1, parseInt(event.page, 10) || 1);
        const pageSize = Math.min(Math.max(parseInt(event.page_size, 10) || 10, 1), 50);
        const skip = (page - 1) * pageSize;
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 附近可接单依赖耍伴日常位置(复用接单配置里的 home_location, 不新增定位授权)
        const openid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(openid);
        if (!vp || !vp.home) {
          return { ok: true, data: { list: [], need_home_location: true, page, page_size: pageSize, has_more: false } };
        }

        // 接单价格区间过滤(与广场同口径; 非耍伴/未设置 → 不过滤)
        const vRange = vp.range;
        const priceWhere = priceRangeWhere(vRange);

        // 场景白名单(与首页宫格同源 admin_config.scene_list)
        const { scenes } = await loadSceneList();
        const sceneCodes = scenes.map((s) => s.code).filter(Boolean);
        const whitelist = sceneCodes.length ? sceneCodes : SCENE_FALLBACK.map((s) => s.code);

        // 平台最大接单距离阈值(take_distance_max_km)
        const effMaxKm = await loadTakeDistanceCap();

        const baseWhere = {
          is_deleted: false,
          status: 'matching',
          match_mode: _.neq('direct'),        // 定向需求不进池
          creator_openid: _.neq(openid),      // 不展示自己的需求
          scene: _.in(whitelist)
        };
        const where = priceWhere ? _.and([ baseWhere, priceWhere ]) : baseWhere;

        // 按 created_at 降序分页(多取1条判定是否还有下一页)
        const demandR = await col('demand')
          .where(where)
          .orderBy('created_at', 'desc')
          .skip(skip)
          .limit(pageSize + 1)
          .get()
          .catch(() => ({ data: [] }));

        const rawDocs = demandR.data || [];
        const hasMore = rawDocs.length > pageSize;
        const docs = rawDocs.slice(0, pageSize);
        const items = docs.map((d) => mapDemand(d, now, pad));

        // 距离计算并过滤超出 take_distance_max_km 的需求(复用 square 口径; 仅作过滤, 不改动发布时间倒序)
        const kept = [];
        docs.forEach((d, i) => {
          const site = d.location || {};
          const lat = Number(site.latitude), lng = Number(site.longitude);
          if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
            const km = Math.round(haversineKm(vp.home.lat, vp.home.lng, lat, lng) * 10) / 10;
            items[i].distance_km = km;
            if (km > effMaxKm) return;
          }
          kept.push(items[i]);
        });

        await fillPublisherSurname(kept);
        return { ok: true, data: { list: kept, page, page_size: pageSize, has_more: hasMore } };
}

module.exports = {
  nearby: nearbyAction,
};
