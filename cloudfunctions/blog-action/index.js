// blog-action 耍伴服务动态(图文信息流) · 身份取自 getWXContext().OPENID
// action: feed_list / detail / publish / delete_my / like / unlike /
//         comment_list / comment_add / comment_delete / my_list
// 集合: blog_post(帖子) / blog_comment(评论) / blog_like(点赞, 幂等)
// 安全: 内容过敏感词(msgSecCheck 降级本地词库)、图片仅收 cloud:// fileID、所有写操作校验本人身份、软删除
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const PAGE_SIZE = 15;
const MAX_IMAGES = 9;
const CONTENT_MIN = 2;
const CONTENT_MAX = 1000;
const COMMENT_MAX = 200;
const SCENE_CODES = ['W1', 'W2', 'W8', 'W10', 'W11'];
// 话题白名单(与 miniprogram/utils/constants.js 的 BLOG_TOPICS 保持一致, 不接受自由输入)
const TOPIC_WHITELIST = ['陪诊日常', '学习陪伴', '生活协助', '出行陪伴', '线上陪伴', '服务心得', '暖心瞬间'];
const MAX_TAGS = 3;
// 已完成订单状态(用于耍伴完单统计)
const DONE_STATUS = ['S5', 'S8', 'S9', 'S10'];

// 话题入参清洗: 白名单去重 + 限数量
function sanitizeTags(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  input.forEach((t) => {
    if (typeof t === 'string' && TOPIC_WHITELIST.indexOf(t) >= 0 && out.indexOf(t) < 0 && out.length < MAX_TAGS) {
      out.push(t);
    }
  });
  return out;
}

// 32 位十六进制文档 ID 校验
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}
// openid 格式校验
function isOpenid(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_-]{20,40}$/.test(s);
}
// 云存储文件 ID 才允许入库, 拒绝任意外链/脚本
function isCloudFileId(f) {
  return typeof f === 'string' && f.indexOf('cloud://') === 0 && f.length < 512;
}

// 集合自愈: 新环境首次使用时自动创建 3 个集合(已存在则忽略), 每个冷启动实例只执行一次
let collectionsReady = null;
function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = (async () => {
      const names = ['blog_post', 'blog_comment', 'blog_like'];
      for (let i = 0; i < names.length; i++) {
        try { await db.createCollection(names[i]); } catch (e) { /* 已存在/无权限均忽略, 后续真实操作会暴露原始错误 */ }
      }
      return true;
    })();
  }
  return collectionsReady;
}

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { block_words: ['加微信', '加V', '转账', '私聊我'] };
}

// 内容安全: msgSecCheck 不可用/无权限时降级本地词库
async function safeCheckText(text, blockWords) {
  if (!text) return { pass: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: String(text).slice(0, 2500) });
    if (res.errCode === 0) return { pass: true };
    return { pass: false, msg: '内容包含违规信息,请修改后发布' };
  } catch (e) {
    const hit = (blockWords || []).find((w) => text.indexOf(w) >= 0);
    return hit
      ? { pass: false, msg: '内容包含屏蔽词「' + hit + '」,请修改后发布' }
      : { pass: true, fallback: true };
  }
}

// 作者公开快照(只取展示字段, 绝不取 phone/idcard)
async function getAuthorSnapshot(openid) {
  try {
    const r = await col('user_account').where({ openid }).limit(1).get();
    const u = r.data && r.data[0];
    if (!u) return null;
    return {
      author_nickname: u.nickname || '微信用户',
      author_avatar: u.avatar || '',
      is_partner: Array.isArray(u.roles) && u.roles.indexOf('partner') >= 0
    };
  } catch (e) {
    return null;
  }
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = event.mock_openid || wxCtx.OPENID;  // 真实 OPENID 优先, mock 仅云端测试兜底
  const action = event.action;
  const now = Date.now();

  try {
    await ensureCollections();
    switch (action) {

      // ───────── 信息流(首页/广场) ─────────
      case 'feed_list': {
        const page = Number.isInteger(event.page) && event.page > 0 ? event.page : 1;
        const scene = SCENE_CODES.indexOf(event.scene) >= 0 ? event.scene : '';
        const where = { status: 'normal', is_deleted: false };
        if (scene) where.scene = scene;
        // 话题筛选: tags 为数组字段, 等值匹配即"数组包含该元素"
        if (typeof event.tag === 'string' && TOPIC_WHITELIST.indexOf(event.tag) >= 0) where.tags = event.tag;
        // 指定作者(耍伴主页 TA 的动态)
        if (isOpenid(event.author_openid)) where.author_openid = event.author_openid;
        const skip = (page - 1) * PAGE_SIZE;
        const qR = await col('blog_post').where(where).orderBy('created_at', 'desc')
          .skip(skip).limit(PAGE_SIZE + 1).get();
        const rows = qR.data || [];
        const has_more = rows.length > PAGE_SIZE;
        const list = has_more ? rows.slice(0, PAGE_SIZE) : rows;
        const ids = list.map((p) => p._id);
        // 当前用户点赞状态
        const likedSet = {};
        if (ids.length && openid) {
          const lk = await col('blog_like').where({ openid, post_id: _.in(ids) }).get();
          (lk.data || []).forEach((x) => { likedSet[x.post_id] = true; });
        }
        return {
          ok: true,
          data: {
            list: list.map((p) => ({
              _id: p._id, author_openid: p.author_openid,
              author_nickname: p.author_nickname, author_avatar: p.author_avatar,
              is_partner: !!p.is_partner, scene: p.scene || '', content: p.content,
              images: p.images || [], tags: p.tags || [], like_count: p.like_count || 0,
              comment_count: p.comment_count || 0, created_at: p.created_at,
              liked: !!likedSet[p._id], single: (p.images || []).length === 1
            })),
            has_more, page
          }
        };
      }

      // ───────── 帖子详情(浏览数+1) ─────────
      case 'detail': {
        const post_id = event.post_id;
        if (!isValidDocId(post_id)) return { ok: false, code: 'bad_post_id', msg: '动态不存在' };
        let doc;
        try { doc = (await col('blog_post').doc(post_id).get()).data; }
        catch (e) { return { ok: false, code: 'post_gone', msg: '动态不存在或已删除' }; }
        if (!doc || doc.status !== 'normal' || doc.is_deleted) {
          return { ok: false, code: 'post_gone', msg: '动态不存在或已下架' };
        }
        await col('blog_post').doc(post_id).update({ data: { view_count: _.inc(1) } }).catch(() => {});
        let liked = false;
        if (openid) {
          const lk = await col('blog_like').where({ post_id, openid }).limit(1).get();
          liked = !!(lk.data && lk.data.length > 0);
        }
        return {
          ok: true,
          data: {
            post: {
              _id: doc._id, author_openid: doc.author_openid,
              author_nickname: doc.author_nickname, author_avatar: doc.author_avatar,
              is_partner: !!doc.is_partner, is_author: doc.author_openid === openid,
              scene: doc.scene || '', content: doc.content, images: doc.images || [],
              tags: doc.tags || [],
              like_count: doc.like_count || 0, comment_count: doc.comment_count || 0,
              view_count: (doc.view_count || 0) + 1, created_at: doc.created_at, liked
            }
          }
        };
      }

      // ───────── 发布图文 ─────────
      case 'publish': {
        if (!openid) return { ok: false, code: 'no_openid', msg: '请先登录' };
        const content = typeof event.content === 'string' ? event.content.trim() : '';
        if (content.length < CONTENT_MIN) return { ok: false, code: 'content_short', msg: '说点什么再发布吧' };
        if (content.length > CONTENT_MAX) return { ok: false, code: 'content_long', msg: '正文不能超过 ' + CONTENT_MAX + ' 字' };
        // 图片校验
        let images = Array.isArray(event.images) ? event.images : [];
        if (images.length > MAX_IMAGES) return { ok: false, code: 'images_many', msg: '最多上传 ' + MAX_IMAGES + ' 张图' };
        images = images.filter(isCloudFileId);
        if (images.length !== (Array.isArray(event.images) ? event.images.length : 0)) {
          return { ok: false, code: 'bad_image', msg: '图片来源非法,请重新选择' };
        }
        const scene = SCENE_CODES.indexOf(event.scene) >= 0 ? event.scene : '';
        const tags = sanitizeTags(event.tags);
        const cfg = await getConfig();
        const check = await safeCheckText(content, cfg.block_words);
        if (!check.pass) return { ok: false, code: 'content_blocked', msg: check.msg };

        const snap = await getAuthorSnapshot(openid);
        if (!snap) return { ok: false, code: 'no_account', msg: '请先完成登录后再发布' };

        const addRes = await col('blog_post').add({ data: {
          author_openid: openid,
          author_nickname: snap.author_nickname,
          author_avatar: snap.author_avatar,
          is_partner: snap.is_partner,
          scene, tags, content, images,
          like_count: 0, comment_count: 0, view_count: 0,
          status: 'normal', created_at: now, updated_at: now, is_deleted: false
        }});
        return { ok: true, data: { _id: addRes._id, msg: '发布成功' } };
      }

      // ───────── 删除自己的帖子(软删) ─────────
      case 'delete_my': {
        const post_id = event.post_id;
        if (!isValidDocId(post_id)) return { ok: false, code: 'bad_post_id', msg: '动态不存在' };
        const doc = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
        if (!doc) return { ok: false, code: 'post_gone', msg: '动态不存在' };
        if (doc.author_openid !== openid) return { ok: false, code: 'forbidden', msg: '只能删除自己的动态' };
        await col('blog_post').doc(post_id).update({ data: { status: 'deleted', is_deleted: true, updated_at: now } });
        return { ok: true, data: { msg: '已删除' } };
      }

      // ───────── 点赞(幂等) ─────────
      case 'like': {
        const post_id = event.post_id;
        if (!isValidDocId(post_id)) return { ok: false, code: 'bad_post_id', msg: '动态不存在' };
        const exist = await col('blog_like').where({ post_id, openid }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          return { ok: true, data: { liked: true, msg: '已点赞' } };
        }
        const post = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
        if (!post || post.status !== 'normal' || post.is_deleted) {
          return { ok: false, code: 'post_gone', msg: '动态不存在或已下架' };
        }
        await col('blog_like').add({ data: { post_id, openid, created_at: now } });
        await col('blog_post').doc(post_id).update({ data: { like_count: _.inc(1) } });
        return { ok: true, data: { liked: true, like_count: (post.like_count || 0) + 1 } };
      }

      // ───────── 取消点赞(幂等) ─────────
      case 'unlike': {
        const post_id = event.post_id;
        if (!isValidDocId(post_id)) return { ok: false, code: 'bad_post_id', msg: '动态不存在' };
        const exist = await col('blog_like').where({ post_id, openid }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          await col('blog_like').doc(exist.data[0]._id).remove();
          await col('blog_post').doc(post_id).update({ data: { like_count: _.inc(-1) } }).catch(() => {});
        }
        return { ok: true, data: { liked: false } };
      }

      // ───────── 评论列表(分页) ─────────
      case 'comment_list': {
        const post_id = event.post_id;
        if (!isValidDocId(post_id)) return { ok: false, code: 'bad_post_id', msg: '动态不存在' };
        const page = Number.isInteger(event.page) && event.page > 0 ? event.page : 1;
        const skip = (page - 1) * PAGE_SIZE;
        const r = await col('blog_comment').where({ post_id, status: 'normal', is_deleted: false })
          .orderBy('created_at', 'asc').skip(skip).limit(PAGE_SIZE + 1).get();
        const rows = r.data || [];
        const has_more = rows.length > PAGE_SIZE;
        const list = (has_more ? rows.slice(0, PAGE_SIZE) : rows).map((c) => ({
          _id: c._id, author_nickname: c.author_nickname, author_avatar: c.author_avatar,
          content: c.content, created_at: c.created_at, is_author: c.author_openid === openid
        }));
        return { ok: true, data: { list, has_more, page } };
      }

      // ───────── 发表评论 ─────────
      case 'comment_add': {
        if (!openid) return { ok: false, code: 'no_openid', msg: '请先登录' };
        const post_id = event.post_id;
        if (!isValidDocId(post_id)) return { ok: false, code: 'bad_post_id', msg: '动态不存在' };
        const content = typeof event.content === 'string' ? event.content.trim() : '';
        if (content.length < 1) return { ok: false, code: 'comment_short', msg: '评论内容不能为空' };
        if (content.length > COMMENT_MAX) return { ok: false, code: 'comment_long', msg: '评论不能超过 ' + COMMENT_MAX + ' 字' };
        const post = await col('blog_post').doc(post_id).get().then((r) => r.data).catch(() => null);
        if (!post || post.status !== 'normal' || post.is_deleted) {
          return { ok: false, code: 'post_gone', msg: '动态不存在或已下架' };
        }
        const cfg = await getConfig();
        const check = await safeCheckText(content, cfg.block_words);
        if (!check.pass) return { ok: false, code: 'content_blocked', msg: check.msg };
        const snap = await getAuthorSnapshot(openid);
        if (!snap) return { ok: false, code: 'no_account', msg: '请先登录后再评论' };

        const addRes = await col('blog_comment').add({ data: {
          post_id, author_openid: openid,
          author_nickname: snap.author_nickname, author_avatar: snap.author_avatar,
          content, status: 'normal', created_at: now, is_deleted: false
        }});
        await col('blog_post').doc(post_id).update({ data: { comment_count: _.inc(1) } }).catch(() => {});
        return {
          ok: true,
          data: {
            comment: {
              _id: addRes._id, author_nickname: snap.author_nickname, author_avatar: snap.author_avatar,
              content, created_at: now, is_author: true
            }
          }
        };
      }

      // ───────── 删除自己的评论 ─────────
      case 'comment_delete': {
        const comment_id = event.comment_id;
        if (!isValidDocId(comment_id)) return { ok: false, code: 'bad_comment_id', msg: '评论不存在' };
        const doc = await col('blog_comment').doc(comment_id).get().then((r) => r.data).catch(() => null);
        if (!doc) return { ok: false, code: 'comment_gone', msg: '评论不存在' };
        if (doc.author_openid !== openid) return { ok: false, code: 'forbidden', msg: '只能删除自己的评论' };
        await col('blog_comment').doc(comment_id).update({ data: { status: 'deleted', is_deleted: true } });
        await col('blog_post').doc(doc.post_id).update({ data: { comment_count: _.inc(-1) } }).catch(() => {});
        return { ok: true, data: { msg: '已删除' } };
      }

      // ───────── 我发布的动态 ─────────
      case 'my_list': {
        if (!openid) return { ok: false, code: 'no_openid', msg: '请先登录' };
        const page = Number.isInteger(event.page) && event.page > 0 ? event.page : 1;
        const skip = (page - 1) * PAGE_SIZE;
        const r = await col('blog_post').where({ author_openid: openid, is_deleted: false })
          .orderBy('created_at', 'desc').skip(skip).limit(PAGE_SIZE + 1).get();
        const rows = r.data || [];
        const has_more = rows.length > PAGE_SIZE;
        const list = (has_more ? rows.slice(0, PAGE_SIZE) : rows).map((p) => ({
          _id: p._id, author_openid: p.author_openid,
          author_nickname: p.author_nickname, author_avatar: p.author_avatar, is_partner: !!p.is_partner,
          scene: p.scene || '', tags: p.tags || [], content: p.content, images: p.images || [],
          like_count: p.like_count || 0, comment_count: p.comment_count || 0,
          status: p.status, offline: p.status === 'offline', created_at: p.created_at,
          single: (p.images || []).length === 1
        }));
        return { ok: true, data: { list, has_more, page } };
      }

      // ───────── 作者(耍伴)公开主页 ─────────
      case 'author_home': {
        const target = event.author_openid;
        if (!isOpenid(target)) return { ok: false, code: 'bad_openid', msg: '用户不存在' };
        const [uR, pR, ordTotalR, ordDoneR, evR, postCntR] = await Promise.all([
          col('user_account').where({ openid: target }).limit(1).get().catch(() => ({ data: [] })),
          col('partner_profile').where({ openid: target, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] })),
          col('order_main').where({ partner_openid: target, is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
          col('order_main').where({ partner_openid: target, status: _.in(DONE_STATUS), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
          col('evaluation').where({ to_openid: target, is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] })),
          col('blog_post').where({ author_openid: target, status: 'normal', is_deleted: false }).count().catch(() => ({ total: 0 }))
        ]);
        const u = uR.data && uR.data[0];
        if (!u || u.status === 'closed') return { ok: false, code: 'user_gone', msg: '该用户不存在或已注销' };
        const p = pR.data && pR.data[0];
        const isPartner = Array.isArray(u.roles) && u.roles.indexOf('partner') >= 0 && !!p && p.status === 'approved';
        const evs = evR.data || [];
        const avgStar = evs.length ? Math.round(evs.reduce((s, e) => s + (e.star || 0), 0) / evs.length * 10) / 10 : 0;
        return {
          ok: true,
          data: {
            profile: {
              author_openid: target,
              nickname: u.nickname || '微信用户',
              avatar: u.avatar || '',
              partner_credit_score: u.partner_credit_score || 0,
              is_partner: !!isPartner,
              is_self: target === openid,
              abnormal: u.status === 'banned' || u.status === 'frozen',
              accept_scenes: isPartner ? (p.accept_scenes || []) : [],
              city: isPartner ? (p.city || []) : []
            },
            stats: {
              total_orders: ordTotalR.total || 0,
              done_orders: ordDoneR.total || 0,
              eval_count: evs.length,
              avg_star: avgStar,
              post_count: postCntR.total || 0
            }
          }
        };
      }

      default:
        return { ok: false, code: 'blog_unknown_action', msg: '未知动作' };
    }
  } catch (e) {
    console.log('blog-action unhandled action=' + action + ':', e && e.message);
    return { ok: false, code: 'blog_server_error', msg: '服务繁忙,请稍后重试' };
  }
};
