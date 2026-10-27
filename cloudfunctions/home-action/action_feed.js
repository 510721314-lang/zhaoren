// action_feed.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

      // ───────── 首页概览(一次返回四块) ─────────
async function overviewAction(ctx) {
  const { event, openid, clientIp, device, action, cloud, _, col, SCENE_NAMES_LEGACY, CONTENT_TRUNC, truncate, loadVisitorPartner, haversineKm } = ctx;
        // 观看者(耍伴)身份: 供耍伴推荐卡计算距离(与 square/nearby 同口径)
        const vOpenid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vPartner = await loadVisitorPartner(vOpenid);
        // 4 个独立查询并行执行(原串行 250-500ms → 并行 ~100ms)
        const [blogR, demandR, userR, partnerR] = await Promise.all([
          col('blog_post')
            .where({ status: 'normal', is_deleted: false })
            .orderBy('created_at', 'desc')
            .limit(3)
            .get()
            .catch(() => ({ data: [] })),
          col('demand')
            .where({ is_deleted: false, status: _.neq('cancelled') })
            .orderBy('created_at', 'desc')
            .limit(3)
            .get()
            .catch(() => ({ data: [] })),
          col('user_account')
            .where({
              is_deleted: _.neq(true),
              status: _.in(['normal', 'banned', 'frozen']),
              register_source: _.neq('phone_pending')
            })
            .orderBy('created_at', 'desc')
            .limit(5)
            .get()
            .catch(() => ({ data: [] })),
          col('partner_profile')
            .where({ status: 'approved', is_deleted: _.neq(true) })
            .orderBy('created_at', 'desc')
            .limit(20)
            .get()
            .catch(() => ({ data: [] }))
        ]);

        const partnerOpenids = (partnerR.data || []).map((p) => p.openid).filter(Boolean);
        const partnerUserMap = {};
        if (partnerOpenids.length) {
          const puR = await col('user_account')
            .where({ openid: _.in(partnerOpenids) })
            .limit(partnerOpenids.length)
            .get()
            .catch(() => ({ data: [] }));
          (puR.data || []).forEach((u) => { partnerUserMap[u.openid] = u; });
        }
        const partnerList = (partnerR.data || [])
          .map((p) => {
            const u = partnerUserMap[p.openid] || {};
            const item = {
              openid: p.openid,
              nickname: u.nickname || '耍伴',
              avatar: u.avatar || '',
              city: (p.city && p.city[0]) || '',
              accept_scenes: p.accept_scenes || [],
              partner_credit_score: u.partner_credit_score || 0,
              bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
              skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || []
            };
            // 距离: 观看者(耍伴)home_location ↔ 目标耍伴home_location
            if (vPartner && vPartner.home) {
              const hl = p.home_location || {};
              const lat = Number(hl.latitude), lng = Number(hl.longitude);
              if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
                item.distance_km = Math.round(haversineKm(vPartner.home.lat, vPartner.home.lng, lat, lng) * 10) / 10;
              }
            }
            return item;
          })
          .sort((a, b) => b.partner_credit_score - a.partner_credit_score)
          .slice(0, 5);

        return {
          ok: true,
          data: {
            blogs: (blogR.data || []).map((p) => ({
              _id: p._id,
              author_nickname: p.author_nickname || '微信用户',
              author_avatar: p.author_avatar || '',
              content: truncate(p.content, CONTENT_TRUNC),
              cover: (p.images && p.images[0]) || '',
              tags: p.tags || [],
              scene: p.scene || '',
              like_count: p.like_count || 0,
              created_at: p.created_at
            })),
            demands: (demandR.data || []).map((d) => ({
              _id: d._id,
              demand_no: d.demand_no,
              scene: d.scene,
              scene_name: SCENE_NAMES_LEGACY[d.scene] || d.scene || '',
              content_options: d.content_options || (d.content_option ? [d.content_option] : []),
              location_name: (d.location && d.location.name) || '',
              pricing_type: d.pricing_type || 'hourly',
              rate_fen: d.rate_fen || 0,
              start_time: d.start_time,
              created_at: d.created_at
            })),
            users: (userR.data || []).map((u) => ({
              openid: u.openid || '',
              nickname: u.nickname || '微信用户',
              avatar: u.avatar || '',
              created_at: u.created_at
            })),
            partners: partnerList
          }
        };
}

      // ───────── 需求广场列表 + 耍伴推荐 ─────────
async function squareAction(ctx) {
  const { event, clientIp, device, action, cloud, _, col, memGet, sceneGroupsCacheKey, pickActivities, loadHomeActivitiesRaw, mapDemand, fillPublisherSurname, hallWhere, priceRangeWhere, loadVisitorPartner, loadTakeDistanceCap, haversineKm } = ctx;
        const limit = Math.min(Number(event.limit) || 20, 50);
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 价格区间过滤(耍伴在接单配置设的区间; 非耍伴/游客/未设置 → 不过滤)
        // 过滤条件下推到 DB(而非 JS 侧过滤), 保证 limit 仍能取满
        const openid = await require('./openid').resolveOpenid(cloud, event).catch(() => '');
        const vp = await loadVisitorPartner(openid);
        const vRange = vp && vp.range;
        const priceWhere = priceRangeWhere(vRange);

        // 自己的需求恒可见: 发布者(无论当前前端身份)总能看见自己刚发布的需求,
        // 不受自身耍伴接单配置(价格区间/接单距离)过滤; 他人视角仍按接单配置过滤
        const ownWhere = openid ? Object.assign(hallWhere(), { creator_openid: openid }) : null;
        const hallWithPrice = priceWhere ? _.and([ hallWhere(), priceWhere ]) : hallWhere();
        const squareWhere = ownWhere ? _.or([hallWithPrice, ownWhere]) : hallWithPrice;

        // 轻量并行: demand + partner + active_user, 不查 scene_groups(5个额外查询导致冷启动超时,
        // 场景分组改由 scene_groups action 单独懒加载)
        // S1/S2 性能: banner 活动配置(admin_config 主键读, 60s 实例缓存)同时点火,
        // 与主查询并行; 冷 miss 时也不把这次 RTT 串行叠加到响应尾部
        const activitiesP = loadHomeActivitiesRaw().catch(() => []);
        const [demandR, partnerR, activeUserR] = await Promise.all([
          col('demand')
            .where(squareWhere)
            .orderBy('created_at', 'desc')
            .limit(limit)
            .get()
            .catch(() => ({ data: [] })),
          col('partner_profile')
            .where({ status: 'approved', is_deleted: _.neq(true) })
            .orderBy('created_at', 'desc')
            .limit(20)
            .get()
            .catch(() => ({ data: [] })),
          // 断链②修复(第三批爽约): 停用中用户不进入活跃用户栏(推荐栏为白名单 in 查询, suspended 天然不在内)
          col('user_account')
            .where({ is_deleted: _.neq(true), status: _.nin(['frozen', 'banned', 'closed', 'suspended']) })
            .orderBy('created_at', 'desc')
            .limit(20)
            .get()
            .catch(() => ({ data: [] }))
        ]);

        // 活跃用户横滑栏(图4): 头像+昵称, 不泄露手机号/openid 以外敏感信息
        const activeUsers = (activeUserR.data || []).map((u) => ({
          openid: u.openid || '',
          nickname: u.nickname || '微信用户',
          // P3-18(2026-10-27): 头像自助上传后存云存储 fileID(cloud://), 白名单同步放行
          avatar: (u.avatar && /^(https?:|cloud:\/\/)/.test(u.avatar)) ? u.avatar : '',
          created_at: u.created_at || 0
        })).filter((u) => !!u.openid).slice(0, 10);

        let list = (demandR.data || []).map((d) => mapDemand(d, now, pad));

        // S3 性能: 耍伴昵称查询提前发起(不 await), 与下方距离过滤/fillPublisherSurname 并行,
        // 消除 square 内一次串行 DB RTT
        const partnerOpenids = (partnerR.data || []).map((p) => p.openid).filter(Boolean);
        const puPromise = partnerOpenids.length
          ? col('user_account').where({ openid: _.in(partnerOpenids) }).limit(partnerOpenids.length).get().catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] });

        // 最大接单距离(接单配置设置): 参考耍伴日常位置计算并回填 distance_km;
        // 已设置且超出 min(设置, 平台上限) 的需求不在广场展示(与接单时服务端校验对齐)
        // 例外: 自己的需求(ownWhere 已并入)恒可见, 距离过滤时跳过, 但照常回填 distance_km 供展示
        if (vp && vp.home) {
          const effMaxKm = vp.maxKm ? Math.min(vp.maxKm, await loadTakeDistanceCap()) : null;
          const kept = [];
          (demandR.data || []).forEach((d, i) => {
            const site = d.location || {};
            const lat = Number(site.latitude), lng = Number(site.longitude);
            if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
              const km = Math.round(haversineKm(vp.home.lat, vp.home.lng, lat, lng) * 10) / 10;
              list[i].distance_km = km;
              if (effMaxKm !== null && km > effMaxKm && d.creator_openid !== openid) return;
            }
            kept.push(list[i]);
          });
          list = kept;
        }
        await fillPublisherSurname(list);

        // 耍伴推荐: partner_profile + user_account 昵称
        let partnerList = [];
        try {
          const partnerUserMap = {};
          const puR = await puPromise;
          (puR.data || []).forEach((u) => { partnerUserMap[u.openid] = u; });
          partnerList = (partnerR.data || [])
            .map((p) => {
              const u = partnerUserMap[p.openid] || {};
              const avatar = (u.avatar && /^(https?:|cloud:\/\/)/.test(u.avatar)) ? u.avatar : '';
              const item = {
                openid: p.openid,
                nickname: u.nickname || '耍伴',
                avatar,
                city: (p.city && p.city[0]) || '',
                accept_scenes: p.accept_scenes || [],
                partner_credit_score: u.partner_credit_score || 0,
                certified_scenes: p.certified_scenes || [],
                // 耍伴资料: 只读审核通过快照(fail-closed); 卡片只取 bio, 详情页另有 detail 接口给全量
                bio: (p.profile_audited_snapshot && p.profile_audited_snapshot.bio) || '',
                skills: (p.profile_audited_snapshot && p.profile_audited_snapshot.skills) || []
              };
              // 距离: 观看者(耍伴)home_location ↔ 目标耍伴home_location, 与 nearby/广场需求同口径
              if (vp && vp.home) {
                const hl = p.home_location || {};
                const lat = Number(hl.latitude), lng = Number(hl.longitude);
                if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
                  item.distance_km = Math.round(haversineKm(vp.home.lat, vp.home.lng, lat, lng) * 10) / 10;
                }
              }
              return item;
            })
            .filter((p) => !!p.openid)
            .sort((a, b) => b.partner_credit_score - a.partner_credit_score);
        } catch (e) {}

        // partners: Tab「⭐耍伴推荐」前5; active_partners: 首页「活跃耍伴」横滑栏前10(图4)
        const activePartners = partnerList.slice(0, 10);
        const partners = partnerList.slice(0, 5);

        // S1 性能: 首页 2RTT → 1RTT
        // · banners 为纯配置读取(60s 缓存), 始终内联, 首页恒定少 1 RTT
        // · scene_groups 含 9 个实时 demand 查询, 仅在「访客维度 60s 缓存命中」时内联;
        //   未命中(冷启动首次)仍返回空数组由前端懒调 scene_groups action(该 action 计算后回种缓存),
        //   避免 square 重蹈 9 查询叠加导致冷启动超时的旧问题; tab 切回/60s 内二次进首页即命中
        let inlineBanners = [];
        try {
          // 复用开头与主查询并行点火的 activitiesP(冷 miss 也已并行, 不再串行补 RTT)
          inlineBanners = pickActivities(await activitiesP, '').banners;
        } catch (e) { /* 配置读取失败静默, 前端兜底懒调 */ }
        let inlineGroups = [];
        try {
          const cachedGroups = memGet(sceneGroupsCacheKey(openid, vRange));
          if (Array.isArray(cachedGroups)) inlineGroups = cachedGroups;
        } catch (e) {}

        return { ok: true, data: { list, scene_groups: inlineGroups, banners: inlineBanners, partners, active_partners: activePartners, active_users: activeUsers } };
}

module.exports = {
  overview: overviewAction,
  square: squareAction,
};
