// action_scene.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')
// 承接 index.js 首行 @VERIFIED 2026-10-13(场景/子场景显隐过滤统一在 scene_groups 出口): 本文件 scene_groups 体逐字不变

      // ───────── 首页按场景分组(懒加载, 结果按访客维度缓存 60s 供 square 内联) ─────────
async function sceneGroupsAction(ctx) {
  const { event, openid, clientIp, device, action, cloud, memSet, memGet, TTL_SCENE_GROUPS, sceneGroupsCacheKey, loadSceneList, buildSceneGroups, loadVisitorPartner } = ctx;
        const { scenes: allScenes } = await loadSceneList();
        // 前端显示开关(仅展示层过滤, 不动 scene_list 分页/nearby 白名单):
        //   ① 场景被运营显式隐藏(visible:false) ② 该场景的可见服务项为 0(子项被全部隐藏 / 本就没有)
        //      —— 没有可选服务项的场景在前端无法发布, 一并隐藏, 避免露出无法使用的空场景
        const scenes = allScenes.filter((s) => s.visible !== false && (s.options || []).length > 0);
        // 耍伴视角一致性: 与广场同口径应用接单价格区间过滤(非耍伴/游客/未设置 → 不过滤)
        const vOpenid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(vOpenid);
        const vRange = vp && vp.range;
        const cacheKey = sceneGroupsCacheKey(vOpenid, vRange);
        // 命中访客维度缓存直接返回(tab 切回/短时间重进免 9 次 demand 查询)
        const cached = memGet(cacheKey);
        const sceneGroups = Array.isArray(cached)
          ? cached
          : await buildSceneGroups(scenes, vRange);
        if (!Array.isArray(cached)) memSet(cacheKey, sceneGroups, TTL_SCENE_GROUPS);
        return { ok: true, data: { scene_groups: sceneGroups } };
}

      // ───────── 单场景需求分页(更多列表, 每页 50) ─────────
async function sceneListAction(ctx) {
  const { event, openid, clientIp, device, action, cloud, _, col, SCENE_PAGE_SIZE, loadSceneList, mapDemand, fillPublisherSurname, hallWhere, priceRangeWhere, loadVisitorPartner } = ctx;
        const sceneCode = String(event.scene_code || '').trim();
        // 动态校验: 必须在 admin_config.scene_list 里(首页分组同源)
        const { scenes } = await loadSceneList();
        const sceneDef = scenes.find((s) => s.code === sceneCode);
        if (!sceneDef) {
          return { ok: false, code: 'home_bad_scene', msg: '场景不存在或已隐藏' };
        }
        const skip = Math.max(0, parseInt(event.skip, 10) || 0);
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 耍伴视角一致性: 与广场同口径应用接单价格区间过滤(非耍伴/游客/未设置 → 不过滤)
        const vOpenid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(vOpenid);
        const vRange = vp && vp.range;
        const priceWhere = priceRangeWhere(vRange);

        // 取 51 条判定是否还有下一页
        const demandR = await col('demand')
          .where(priceWhere ? _.and([ hallWhere({ scene: sceneCode }), priceWhere ]) : hallWhere({ scene: sceneCode }))
          .orderBy('created_at', 'desc')
          .skip(skip)
          .limit(SCENE_PAGE_SIZE + 1)
          .get()
          .catch(() => ({ data: [] }));

        const docs = demandR.data || [];
        const hasMore = docs.length > SCENE_PAGE_SIZE;
        const list = docs.slice(0, SCENE_PAGE_SIZE).map((d) => mapDemand(d, now, pad));
        await fillPublisherSurname(list);

        return {
          ok: true,
          data: {
            scene_code: sceneCode,
            scene_name: sceneDef.name,
            list,
            has_more: hasMore,
            next_skip: skip + list.length,
            page_size: SCENE_PAGE_SIZE
          }
        };
}

module.exports = {
  scene_groups: sceneGroupsAction,
  scene_list: sceneListAction,
};
