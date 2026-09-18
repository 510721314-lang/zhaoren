// home-action 首页概览 · 最新 BLOG / 最新需求 / 活跃注册用户 / 活跃耍伴
// 公开接口(不要求登录, 不返回隐私字段), 首页单次调用取全部四块数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

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

// 场景固定顺序(与前端 config/enums.js SCENES 一致)
const SCENE_ORDER = ['W1', 'W2', 'W3', 'W7', 'W8', 'W9', 'W10', 'W11'];
const HOME_GROUP_SIZE = 8;     // 首页每场景展示条数
const SCENE_PAGE_SIZE = 50;    // 场景更多列表每页条数

// demand 文档 → 广场卡片视图模型(与原 square 内联映射保持一致)
function mapDemand(d, now, pad) {
  const remarkParts = String(d.remark || '').split('｜');
  const title = remarkParts[0] ? remarkParts[0].trim() : (d.content_options && d.content_options[0]) || '需求';
  const description = remarkParts[1] ? remarkParts[1].trim() : '';

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
}

// 批量补发布者姓氏(就地修改)
async function fillPublisherSurname(list) {
  const openids = list.map((d) => d.publisher.openid).filter(Boolean);
  if (!openids.length) return;
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

// 公共大厅可接单需求过滤条件
function hallWhere(extra) {
  return Object.assign({
    is_deleted: false,
    status: 'matching',
    expire_at: _.gt(Date.now()),
    broadcast: true
  }, extra || {});
}

exports.main = async (event, context) => {
  try {
    await require('./openid').warmEnv(cloud); // 环境门控日志预热
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

        // 并行拉 demand + partner_profile + 活跃用户 + 8 个场景分组(每场景取 9 条判定 has_more)
        // broadcast:true 硬过滤: 定向邀约(direct)/选单(select)需求不得泄漏进公共大厅/首页
        const sceneQueries = SCENE_ORDER.map((code) =>
          col('demand')
            .where(hallWhere({ scene: code }))
            .orderBy('created_at', 'desc')
            .limit(HOME_GROUP_SIZE + 1)
            .get()
            .catch(() => ({ data: [] }))
        );
        const [demandR, partnerR, activeUserR, ...sceneRs] = await Promise.all([
          col('demand')
            .where(hallWhere())
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
          // 活跃用户: 最近注册/登录的正常账号(排除冻结/封禁/注销)
          col('user_account')
            .where({ is_deleted: _.neq(true), status: _.nin(['frozen', 'banned', 'closed']) })
            .orderBy('created_at', 'desc')
            .limit(20)
            .get()
            .catch(() => ({ data: [] })),
          ...sceneQueries
        ]);

        // 活跃用户横滑栏(图4): 头像+昵称, 不泄露手机号/openid 以外敏感信息
        const activeUsers = (activeUserR.data || []).map((u) => ({
          openid: u.openid || '',
          nickname: u.nickname || '微信用户',
          avatar: (u.avatar && /^https?:/.test(u.avatar)) ? u.avatar : '',
          created_at: u.created_at || 0
        })).filter((u) => !!u.openid).slice(0, 10);

        const list = (demandR.data || []).map((d) => mapDemand(d, now, pad));
        await fillPublisherSurname(list);

        // 按场景分组(首页): 每场景 8 条 + has_more, 空场景不返回
        const sceneGroups = [];
        sceneRs.forEach((r, i) => {
          const code = SCENE_ORDER[i];
          const docs = r.data || [];
          if (!docs.length) return;
          const items = docs.slice(0, HOME_GROUP_SIZE).map((d) => mapDemand(d, now, pad));
          sceneGroups.push({
            scene_code: code,
            scene_name: SCENE_NAMES[code] || '',
            list: items,
            has_more: docs.length > HOME_GROUP_SIZE
          });
        });
        await fillPublisherSurname(sceneGroups.reduce((acc, g) => acc.concat(g.list), []));

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
              const avatar = (u.avatar && /^https?:/.test(u.avatar)) ? u.avatar : '';
              return {
                openid: p.openid,
                nickname: u.nickname || '耍伴',
                avatar,
                city: (p.city && p.city[0]) || '',
                accept_scenes: p.accept_scenes || [],
                partner_credit_score: u.partner_credit_score || 0,
                certified_scenes: p.certified_scenes || []
              };
            })
            .filter((p) => !!p.openid)
            .sort((a, b) => b.partner_credit_score - a.partner_credit_score);
        } catch (e) {}

        // partners: Tab「⭐耍伴推荐」前5; active_partners: 首页「活跃耍伴」横滑栏前10(图4)
        const activePartners = partnerList.slice(0, 10);
        const partners = partnerList.slice(0, 5);

        return { ok: true, data: { list, scene_groups: sceneGroups, partners, active_partners: activePartners, active_users: activeUsers } };
      }

      // ───────── 单场景需求分页(更多列表, 每页 50) ─────────
      case 'scene_list': {
        const sceneCode = String(event.scene_code || '').trim();
        if (!SCENE_NAMES[sceneCode]) {
          return { ok: false, code: 'home_bad_scene', msg: '场景参数错误' };
        }
        const skip = Math.max(0, parseInt(event.skip, 10) || 0);
        const now = Date.now();
        const pad = (n) => n < 10 ? '0' + n : '' + n;

        // 取 51 条判定是否还有下一页
        const demandR = await col('demand')
          .where(hallWhere({ scene: sceneCode }))
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
            scene_name: SCENE_NAMES[sceneCode],
            list,
            has_more: hasMore,
            next_skip: skip + list.length,
            page_size: SCENE_PAGE_SIZE
          }
        };
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
    log.d('home-action unhandled:', e && e.message);
    return { ok: false, code: 'home_server_error', msg: '服务繁忙,请稍后重试' };
  }
};
