// home-action 首页概览 · 最新 BLOG / 最新需求 / 活跃注册用户 / 活跃耍伴
// 公开接口(不要求登录, 不返回隐私字段), 首页单次调用取全部四块数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const SCENE_NAMES = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };
const CONTENT_TRUNC = 60;

// 集合自愈: 新环境首次调用自动建 blog 相关集合(demand/user_account/partner_profile 属已有核心集合, 不自动建)
let collectionsReady = null;
function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = (async () => {
      const names = ['blog_post', 'blog_comment', 'blog_like'];
      await Promise.all(names.map((n) =>
        db.createCollection(n).catch(() => {})
      ));
      return true;
    })();
  }
  return collectionsReady;
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function sceneLabel(code) {
  return SCENE_NAMES[code] || '';
}

exports.main = async (event, context) => {
  try {
    await ensureCollections();
    const action = event.action || 'overview';

    switch (action) {

      // ───────── 首页概览(一次返回四块) ─────────
      case 'overview': {
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
            return {
              openid: p.openid,
              nickname: u.nickname || '耍伴',
              avatar: u.avatar || '',
              city: (p.city && p.city[0]) || '',
              accept_scenes: p.accept_scenes || [],
              partner_credit_score: u.partner_credit_score || 0
            };
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
              scene_name: sceneLabel(d.scene),
              content_options: d.content_options || (d.content_option ? [d.content_option] : []),
              location_name: (d.location && d.location.name) || '',
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
      case 'square': {
        const limit = Math.min(Number(event.limit) || 20, 50);
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 并行拉 demand + partner_profile
        const [demandR, partnerR] = await Promise.all([
          col('demand')
            .where({ is_deleted: false, status: 'matching', expire_at: _.gt(now) })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .get()
            .catch(() => ({ data: [] })),
          col('partner_profile')
            .where({ status: 'approved', is_deleted: _.neq(true) })
            .orderBy('created_at', 'desc')
            .limit(10)
            .get()
            .catch(() => ({ data: [] }))
        ]);

        const list = (demandR.data || []).map((d) => {
          // 备注拆分: 标题｜描述
          const remarkParts = String(d.remark || '').split('｜');
          const title = remarkParts[0] ? remarkParts[0].trim() : (d.content_options && d.content_options[0]) || '需求';
          const description = remarkParts[1] ? remarkParts[1].trim() : '';

          // 时间格式化
          const dt = new Date(d.start_time);
          const service_date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
          const service_time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

          const minutes_ago = Math.max(1, Math.floor((now - (d.created_at || now)) / 60000));

          return {
            _id: d._id,
            demand_no: d.demand_no,
            scene_code: d.scene,
            project_attr: d.project_attr || 'commercial',
            title,
            description,
            service_date,
            service_time,
            duration_hours: d.duration_h,
            location: d.location || { name: '' },
            district: (d.location && d.location.city) || '',
            distance_km: null,
            headcount: 1,
            budget: Math.round((d.rate_fen || 0) / 100),
            aa_estimate: d.aa_tier || '0-50',
            status: d.status,
            match_mode: d.match_mode || 'broadcast',
            publisher: {
              surname: '匿',
              real_name_verified: true,
              minutes_ago,
              openid: d.creator_openid
            },
            created_at: d.created_at
          };
        });

        // 批量补发布者姓氏
        const openids = list.map((d) => d.publisher.openid).filter(Boolean);
        if (openids.length) {
          try {
            const uR = await col('user_account').where({ openid: _.in(openids) }).limit(openids.length).get();
            const map = {};
            (uR.data || []).forEach((u) => { map[u.openid] = u; });
            list.forEach((d) => {
              const u = map[d.publisher.openid] || {};
              const name = u.surname || u.real_name || u.nickname || '';
              d.publisher.surname = name ? String(name).charAt(0) : '匿';
            });
          } catch (e) {}
        }

        // 耍伴推荐: partner_profile + user_account 昵称
        let partnerList = [];
        try {
          const partnerOpenids = (partnerR.data || []).map((p) => p.openid).filter(Boolean);
          const partnerUserMap = {};
          if (partnerOpenids.length) {
            const puR = await col('user_account').where({ openid: _.in(partnerOpenids) }).limit(partnerOpenids.length).get();
            (puR.data || []).forEach((u) => { partnerUserMap[u.openid] = u; });
          }
          partnerList = (partnerR.data || [])
            .map((p) => {
              const u = partnerUserMap[p.openid] || {};
              return {
                openid: p.openid,
                nickname: u.nickname || '耍伴',
                avatar: u.avatar || '',
                city: (p.city && p.city[0]) || '',
                accept_scenes: p.accept_scenes || [],
                partner_credit_score: u.partner_credit_score || 0,
                certified_scenes: p.certified_scenes || []
              };
            })
            .sort((a, b) => b.partner_credit_score - a.partner_credit_score)
            .slice(0, 5);
        } catch (e) {}

        return { ok: true, data: { list, partners: partnerList } };
      }

      // ───────── 用户公开主页 ─────────
      case 'user_home': {
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
              tags: p.tags || [],
              scene: p.scene || '',
              like_count: p.like_count || 0,
              comment_count: p.comment_count || 0,
              created_at: p.created_at
            }))
          }
        };
      }

      default:
        return { ok: false, code: 'home_unknown_action', msg: '未知动作' };
    }
  } catch (e) {
    console.log('home-action unhandled:', e && e.message);
    return { ok: false, code: 'home_server_error', msg: '服务繁忙,请稍后重试' };
  }
};
