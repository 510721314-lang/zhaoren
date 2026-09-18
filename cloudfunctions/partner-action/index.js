// 对应 PRD 章节：3.10.1 耍伴接单配置管理 / 5.1 B端后台RBAC / 3.2.2 进行中订单定义
// partner-action 耍伴配置与接单动作 · 身份取自 getWXContext().OPENID
// 4 个 action: set_switch / update_config / my_profile / review
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

// 进行中订单状态集合
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];
// 场景白名单
const SCENE_WHITELIST = ['W1', 'W2', 'W3', 'W7', 'W8', 'W9', 'W10', 'W11'];

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return {
    rate_min_fen: 3000, rate_max_fen: 10000,
    min_credit_take_order: 600, admin_openids: []
  };
}

// 容错读取耍伴资料: is_deleted 缺省(历史坏文档)视为有效并惰性治愈(见 ./heal)
const { getHealedPartnerProfile } = require('./heal');
const { getCachedEnv } = require('./openid');
async function getProfile(openid) {
  return getHealedPartnerProfile(col, _, openid);
}

// 默认考核分模板: 所有场景默认 100 (dev 环境耍伴能直接测 W1), prod 空值由管理员审核补
const DEFAULT_EXAM_SCORES = { W1: 100, W2: 100, W8: 100, W10: 100, W11: 100 };

// 检查是否有进行中订单
async function hasBusyOrder(openid) {
  const r = await col('order_main').where({
    partner_openid: openid, status: _.in(BUSY_STATUS), is_deleted: false
  }).limit(1).get();
  return r.data && r.data.length > 0;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'pa_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`partner-action action=${action} openid=${openid}`);

  switch (action) {

    // 0. 申请成为耍伴 (upsert partner_profile)
    //    审核红线: 仅 admin_config.auto_approve_partner === true 时自动开通;
    //    否则新申请/被拒记录一律 pending_review, 且不授予 partner role, 由管理员 review 放行
    case 'apply': {
      const config = await getConfig();
      const autoApprove = config.auto_approve_partner === true;
      const uaCol = col('user_account');
      const ua = await uaCol.where({ openid }).limit(1).get();
      if (!ua.data.length) return { ok: false, code: 'pa_no_user', msg: '请先登录' };

      // 加 partner role(仅审核通过后; pending_review 不授予)
      const curRoles = ua.data[0].roles || [];

      // upsert partner_profile
      // 注意: 早期版本 add 漏写 is_deleted 且重复提交可能产生多条文档,
      // 这里宽查(不带 is_deleted)并治愈该 openid 下全部文档, 避免严格守卫 limit(1) 漏读
      const ppCol = col('partner_profile');
      const now = Date.now();
      const existing = await ppCol.where({ openid }).limit(100).get();
      const scenes = Array.isArray(event.accept_scenes) && event.accept_scenes.length
        ? event.accept_scenes
        : (curRoles.includes('partner') && existing.data.length ? existing.data[0].accept_scenes || [] : ['W1']);

      // 补全场景考核分(exam_scores 为空时默认全部 100 分, 让耍伴能直接接所有已开通场景)
      // W1 真实上线需对接真实考核系统, prod 正式运营前由管理员手动审核维护各场景考核分
      const defaultExam = DEFAULT_EXAM_SCORES;

      // 已是 approved 的历史档案重走申请时保留资格(只更新场景); 其余一律按自动开关决定
      const wasApproved = existing.data.some(p => p.status === 'approved');
      const finalApproved = wasApproved || autoApprove;
      const finalStatus = finalApproved ? 'approved' : 'pending_review';

      if (existing.data.length) {
        for (const p of existing.data) {
          // 重走申请=重新开通: 补全所有守卫依赖字段(status/is_deleted/accept_switch)
          const patch = {
            accept_scenes: scenes,
            status: p.status === 'approved' ? 'approved' : finalStatus,
            is_deleted: false,
            updated_at: now
          };
          if (p.accept_switch === undefined) patch.accept_switch = true;
          if (p.credit_score === undefined) patch.credit_score = 800;
          if (defaultExam && !p.exam_scores) patch.exam_scores = defaultExam;
          await ppCol.doc(p._id).update({ data: patch });
        }
      } else {
        const doc = {
          openid,
          nick_name: ua.data[0].nick_name || '新耍伴',
          accept_scenes: scenes,
          status: finalStatus,
          accept_switch: true,
          credit_score: 800,
          order_count: 0,
          income_total_fen: 0,
          is_deleted: false,
          created_at: now,
          updated_at: now
        };
        if (defaultExam) doc.exam_scores = defaultExam;
        await ppCol.add({ data: doc });
      }

      // 仅最终审核通过才授予 partner role; 待审核不污染身份分流
      let roles = curRoles;
      if (finalApproved && !curRoles.includes('partner')) {
        roles = [...curRoles, 'partner'];
        await uaCol.doc(ua.data[0]._id).update({ data: { roles, updated_at: now } });
      }

      log.d(`partner apply: ${openid} scenes=${scenes} docs=${existing.data.length} status=${finalStatus}`);
      return {
        ok: true,
        data: {
          roles: [...new Set(roles)],
          accept_scenes: scenes,
          status: finalStatus,
          pending_review: !finalApproved
        }
      };
    }

    // 1. 接单开关切换
    case 'set_switch': {
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      if (profile.status !== 'approved') {
        return { ok: false, code: 'pa_not_approved', msg: '耍伴资料未审核通过' };
      }

      // 关闭时检查进行中订单
      const newSwitch = event.accept_switch === false || event.accept_switch === 'false' ? false : true;
      if (!newSwitch) {
        const busy = await hasBusyOrder(openid);
        if (busy) return { ok: false, code: 'pa_busy_order', msg: '有进行中订单,不可关闭接单' };
      }

      await col('partner_profile').doc(profile._id).update({ data: {
        accept_switch: newSwitch, updated_at: Date.now()
      }});
      log.d(`partner switch -> ${newSwitch}: ${openid}`);
      return { ok: true, data: { accept_switch: newSwitch } };
    }

    // 2. 修改时薪与场景
    case 'update_config': {
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      if (profile.status !== 'approved') {
        return { ok: false, code: 'pa_not_approved', msg: '耍伴资料未审核通过' };
      }

      const config = await getConfig();
      const update = { updated_at: Date.now() };
      const rateMin = config.rate_min_fen || 3000;
      const rateMax = config.rate_max_fen || 10000;

      // 场景校验
      let newScenes = profile.accept_scenes || [];
      if (Array.isArray(event.accept_scenes)) {
        if (event.accept_scenes.length === 0) {
          return { ok: false, code: 'pa_scenes_empty', msg: '请至少选择一个接单场景' };
        }
        for (const s of event.accept_scenes) {
          if (SCENE_WHITELIST.indexOf(s) < 0) {
            return { ok: false, code: 'pa_scene_invalid', msg: `场景 ${s} 不在白名单` };
          }
        }
        newScenes = event.accept_scenes;
        update.accept_scenes = newScenes;
      }

      // 各场景时薪校验(scene_rates: { W1: 5000, ... })
      if (event.scene_rates && typeof event.scene_rates === 'object') {
        const rateKeys = Object.keys(event.scene_rates);
        // 校验:每个选中场景必须有对应时薪
        for (const s of newScenes) {
          if (rateKeys.indexOf(s) < 0) {
            return { ok: false, code: 'pa_rate_missing', msg: `请为场景 ${s} 设置时薪` };
          }
          const r = Number(event.scene_rates[s]);
          if (!r || r < rateMin || r > rateMax) {
            return { ok: false, code: 'pa_rate_range', msg: `场景 ${s} 时薪需在 30-100 元/小时之间` };
          }
        }
        // 不允许多余 key
        for (const k of rateKeys) {
          if (newScenes.indexOf(k) < 0) {
            return { ok: false, code: 'pa_rate_extra', msg: `场景 ${k} 未勾选但设置了时薪` };
          }
        }
        update.scene_rates = event.scene_rates;
      } else if (update.accept_scenes) {
        // 只改场景未带时薪:校验原 scene_rates 是否覆盖新场景
        const oldRates = profile.scene_rates || {};
        for (const s of newScenes) {
          if (oldRates[s] === undefined) {
            return { ok: false, code: 'pa_rate_missing', msg: `新增场景 ${s} 需设置时薪` };
          }
        }
      }

      await col('partner_profile').doc(profile._id).update({ data: update });
      log.d(`partner config updated: ${openid}`);
      return { ok: true, data: { updated: Object.keys(update).filter(k => k !== 'updated_at') } };
    }

    // 3. 我的耍伴资料与接单统计
    case 'my_profile': {
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };

      // 统计:总单数、完成单数、好评率(占位)
      let totalOrders = 0, completedOrders = 0, goodRate = 0;
      try {
        const tr = await col('order_main').where({
          partner_openid: openid, is_deleted: false
        }).count();
        totalOrders = tr.total || 0;
        const cr = await col('order_main').where({
          partner_openid: openid, status: _.in(['S5', 'S8', 'S9', 'S10']), is_deleted: false
        }).count();
        completedOrders = cr.total || 0;
        // 好评率: evaluation 表 star>=4 占比
        const er = await col('evaluation').where({ partner_openid: openid, is_deleted: false }).count();
        const ec = await col('evaluation').where({ partner_openid: openid, star: _.gte(4), is_deleted: false }).count();
        if (er.total > 0) goodRate = Math.round((ec.total / er.total) * 100);
      } catch (e) {}

      return {
        ok: true,
        data: {
          profile: {
            _id: profile._id, openid: profile.openid,
            nickname: profile.nickname, avatar: profile.avatar,
            accept_scenes: profile.accept_scenes || [],
            scene_rates: profile.scene_rates || {},
            exam_scores: profile.exam_scores || {},
            city: profile.city, accept_switch: profile.accept_switch,
            status: profile.status, applied_at: profile.applied_at
          },
          stats: {
            total_orders: totalOrders,
            completed_orders: completedOrders,
            good_rate: goodRate
          }
        }
      };
    }

    // 4. 审核(管理员专用)
    case 'review': {
      const config = await getConfig();
      const adminList = config.admin_openids || [];
      if (adminList.indexOf(openid) < 0) {
        return { ok: false, code: 'pa_not_admin', msg: '无管理员权限' };
      }

      const { target_openid, pass } = event;
      if (!target_openid) return { ok: false, code: 'pa_no_target', msg: '缺少待审核用户' };

      const profile = await getProfile(target_openid);
      if (!profile) return { ok: false, code: 'pa_target_no_profile', msg: '目标用户不是耍伴' };
      if (profile.status !== 'pending_review') {
        return { ok: false, code: 'pa_already_reviewed', msg: '该耍伴已审核过' };
      }

      const newStatus = pass ? 'approved' : 'rejected';
      await col('partner_profile').doc(profile._id).update({ data: {
        status: newStatus, updated_at: Date.now()
      }});
      // 审核通过: 同步授予 user_account 的 partner role(申请时 pending_review 不授)
      if (pass) {
        try {
          const uaR = await col('user_account').where({ openid: target_openid }).limit(1).get();
          if (uaR.data && uaR.data.length) {
            const roles = uaR.data[0].roles || [];
            if (roles.indexOf('partner') < 0) {
              await col('user_account').doc(uaR.data[0]._id).update({
                data: { roles: [...roles, 'partner'], updated_at: Date.now() }
              });
            }
          }
        } catch (e) { log.d(`review grant role fail: ${e.message}`); }
      }
      log.d(`partner reviewed: ${target_openid} -> ${newStatus}`);
      return { ok: true, data: { target_openid, status: newStatus } };
    }

    // 5. 耍伴详情（C端公开）
    case 'detail': {
      const { partner_openid } = event;
      if (!partner_openid) return { ok: false, code: 'pa_no_target', msg: '缺少耍伴标识' };

      const r = await col('partner_profile').where({ openid: partner_openid, status: 'approved', is_deleted: false }).limit(1).get();
      if (!r.data || !r.data[0]) return { ok: false, code: 'pa_not_found', msg: '耍伴不存在或未认证' };
      const p = r.data[0];

      // 拉 user_account 拿昵称头像
      let nickname = p.nickname || '微信用户', avatar = '';
      try {
        const ua = await col('user_account').where({ openid: partner_openid }).limit(1).get();
        if (ua.data && ua.data[0]) {
          nickname = ua.data[0].nickname || nickname;
          avatar = ua.data[0].avatar || '';
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
            score: p.score || 0,
            level: p.level || 'L1',
            accept_switch: p.accept_switch !== false,
            real_name_verified: !!p.real_name_verified,
            face_verified: !!p.face_verified,
            intro: p.intro || '这个耍伴还没写自我介绍~',
            certified_scenes: p.accept_scenes || []
          },
          stats: { total_orders: totalOrders, completed_orders: completedOrders },
          evaluations
        }
      };
    }

    default:
      return { ok: false, code: 'pa_unknown_action', msg: '未知动作' };
  }
};

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
  return new Date(ts).toLocaleDateString();
}
