// action_misc.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

      // ───────── 用户公开主页 ─────────
async function userHomeAction(ctx) {
  const { event, openid, clientIp, device, action, cloud, col, CONTENT_TRUNC, truncate } = ctx;
        const targetOpenid = event.openid || '';
        if (!targetOpenid || !/^[a-zA-Z0-9_-]{20,40}$/.test(targetOpenid)) {
          return { ok: false, code: 'home_bad_openid', msg: '参数错误' };
        }

        // 查 user_account + blog_post(用户发布的动态)
        const [userR, postR] = await Promise.all([
          col('user_account')
            .where({ openid: targetOpenid })
            .limit(1)
            .get()
            .catch(() => ({ data: [] })),
          col('blog_post')
            .where({ author_openid: targetOpenid, status: 'normal', is_deleted: false })
            .orderBy('created_at', 'desc')
            .limit(15)
            .get()
            .catch(() => ({ data: [] }))
        ]);

        const u = (userR.data || [])[0];
        if (!u) return { ok: false, code: 'home_user_gone', msg: '该用户不存在或已注销' };

        // 统计: 发帖数
        const postCountR = await col('blog_post')
          .where({ author_openid: targetOpenid, status: 'normal', is_deleted: false })
          .count()
          .catch(() => ({ total: 0 }));

        const isDeleted = u.is_deleted === true;
        if (isDeleted) return { ok: false, code: 'home_user_gone', msg: '该用户不存在或已注销' };

        return {
          ok: true,
          data: {
            profile: {
              openid: u.openid,
              nickname: u.nickname || '微信用户',
              avatar: u.avatar || '',
              city: (u.city_list && u.city_list[0]) || (u.city && u.city[0]) || '',
              created_at: u.created_at,
              is_partner: (u.roles || []).includes('partner'),
              partner_credit_score: u.partner_credit_score || 0
            },
            stats: {
              post_count: postCountR.total || 0
            },
            posts: (postR.data || []).map((p) => ({
              _id: p._id,
              content: truncate(p.content, CONTENT_TRUNC),
              cover: (p.images && p.images[0]) || '',
              images: ((p.images || []).filter((u) => typeof u === 'string' && u.indexOf('cloud://') === 0)).slice(0, 4),
              tags: p.tags || [],
              scene: p.scene || '',
              like_count: p.like_count || 0,
              comment_count: p.comment_count || 0,
              created_at: p.created_at
            }))
          }
        };
}

      // ───────── 首页活动列表(小程序端: 时间过滤 + 状态过滤 + 优先级排序; 配置 60s 缓存) ─────────
async function homeActivityListAction(ctx) {
  const { event, openid, clientIp, device, action, log, pickActivities, loadHomeActivitiesRaw } = ctx;
        try {
          const sceneCode = String(event.scene_code || '').trim();
          const raw = await loadHomeActivitiesRaw();
          const { banners, cards } = pickActivities(raw, sceneCode);
          return { ok: true, data: { banners, cards } };
        } catch (e) {
          log.d('home_activity_list err:', e.message);
          return { ok: true, data: { banners: [], cards: [] } };
        }
}

      // ───────── 活动详情(按 id 取单条: 仅 active 且时间窗内, 含 content 详情) ─────────
async function activityDetailAction(ctx) {
  const { event, openid, clientIp, device, action, col, log } = ctx;
        try {
          const cfgR = await col('admin_config').doc('global').get();
          const cfg = cfgR.data || {};
          const now = Date.now();
          const id = String(event.id || '');
          const a = (cfg.home_activities || []).find((x) =>
            x.id === id && x.status === 'active' &&
            (!x.start_at || now >= x.start_at) && (!x.end_at || now <= x.end_at)
          );
          if (!a) return { ok: false, code: 'act_not_found', msg: '活动不存在或已结束' };
          return { ok: true, data: a };
        } catch (e) {
          log.d('activity_detail err:', e.message);
          return { ok: false, code: 'home_server_error', msg: '服务繁忙,请稍后重试' };
        }
}

module.exports = {
  user_home: userHomeAction,
  home_activity_list: homeActivityListAction,
  activity_detail: activityDetailAction,
};
