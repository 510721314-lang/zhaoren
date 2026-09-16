// 对应 PRD 章节：3.10 耍伴工作台 / 5.1 B端后台RBAC / 9.1 信用分扣除与冻结规则
// partner-apply 耍伴入驻 · 身份取自 getWXContext().OPENID
// 1 个 action: apply
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 场景白名单(MVP-V1)
const SCENE_WHITELIST = ['W1', 'W2', 'W3', 'W7', 'W8', 'W9', 'W10', 'W11'];

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { rate_min_fen: 3000, rate_max_fen: 10000, min_credit_take_order: 600, auto_approve_partner: true };
}

async function getUser(openid) {
  const r = await col('user_account').where({ openid }).limit(1).get();
  return (r.data && r.data[0]) || null;
}

async function hasEmergencyContact(openid) {
  const r = await col('emergency_contact').where({ openid, is_deleted: false }).limit(1).get();
  return r.data && r.data.length > 0;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || event.mock_openid;  // 测试用:云端测试可传 mock_openid 模拟身份
  if (!openid) return { ok: false, code: 'apply_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`partner-apply action=${action} openid=${openid}`);

  if (action === 'debug_profile') {
    const r = await col('partner_profile').where({ openid, is_deleted: false }).limit(1).get();
    const profile = (r.data && r.data[0]) || null;
    return { ok: true, data: { openid, profile } };
  }

  if (action !== 'apply') return { ok: false, code: 'apply_unknown_action', msg: '未知动作' };

  const { accept_scenes, scene_rates, exam_scores } = event;

  // ── 校验场景:非空 + 白名单 ──
  if (!Array.isArray(accept_scenes) || accept_scenes.length === 0) {
    return { ok: false, code: 'apply_scenes_empty', msg: '请至少选择一个接单场景' };
  }
  for (const s of accept_scenes) {
    if (SCENE_WHITELIST.indexOf(s) < 0) {
      return { ok: false, code: 'apply_scene_invalid', msg: `场景 ${s} 不在白名单` };
    }
  }

  // ── W1 就医陪诊专项考核:国标考核分需 >= 80 ──
  if (accept_scenes.indexOf('W1') >= 0) {
    const score = Number(exam_scores && exam_scores.W1);
    if (!score || score < 80) {
      return { ok: false, code: 'apply_w1_exam_failed', msg: '就医陪诊场景需通过国标专项考核(>=80分)' };
    }
  }

  // ── 校验每个场景的时薪 ──
  // scene_rates: { W1: 5000, W2: 3000, ... } 分单位
  if (!scene_rates || typeof scene_rates !== 'object') {
    return { ok: false, code: 'apply_rates_empty', msg: '请为每个场景设置时薪' };
  }
  const config = await getConfig();
  const rateMin = config.rate_min_fen || 3000;
  const rateMax = config.rate_max_fen || 10000;
  // scene_rates 的 keys 必须与 accept_scenes 一一对应
  const rateKeys = Object.keys(scene_rates);
  for (const s of accept_scenes) {
    if (rateKeys.indexOf(s) < 0) {
      return { ok: false, code: 'apply_rate_missing', msg: `请为场景 ${s} 设置时薪` };
    }
    const r = Number(scene_rates[s]);
    if (!r || r < rateMin || r > rateMax) {
      return { ok: false, code: 'apply_rate_range', msg: `场景 ${s} 时薪需在 30-100 元/小时之间` };
    }
  }
  // 不允许多余的 key
  for (const k of rateKeys) {
    if (accept_scenes.indexOf(k) < 0) {
      return { ok: false, code: 'apply_rate_extra', msg: `场景 ${k} 未勾选但设置了时薪` };
    }
  }

  // ── 取用户 ──
  const user = await getUser(openid);
  if (!user) return { ok: false, code: 'apply_no_user', msg: '用户不存在,请先登录' };
  if (!user.is_realname_done) {
    return { ok: false, code: 'apply_not_realname', msg: '请先完成实名认证' };
  }
  const hasEC = await hasEmergencyContact(openid);
  if (!hasEC) {
    return { ok: false, code: 'apply_no_emergency', msg: '请先填写紧急联系人' };
  }
  if ((user.user_credit_score || 800) < (config.min_credit_take_order || 600)) {
    return { ok: false, code: 'apply_credit_low', msg: '信用分低于接单门槛,暂不能成为耍伴' };
  }
  if (user.status === 'frozen') {
    return { ok: false, code: 'apply_frozen', msg: '账号已被冻结,不可申请' };
  }
  if (user.status === 'banned') {
    return { ok: false, code: 'apply_banned', msg: '账号已封禁,请联系客服' };
  }
  if (user.status === 'closed') {
    return { ok: false, code: 'apply_closed', msg: '账号已注销' };
  }

  // ── upsert partner_profile ──
  const now = Date.now();
  const status = config.auto_approve_partner ? 'approved' : 'pending_review';
  const profileData = {
    openid,
    nickname: user.nickname || '微信用户',
    avatar: user.avatar || '',
    accept_scenes,
    scene_rates,
    exam_scores: exam_scores || {},
    city: ['成都'],
    accept_switch: true,
    status,
    applied_at: now,
    updated_at: now,
    is_deleted: false
  };

  try {
    const exist = await col('partner_profile').where({ openid, is_deleted: false }).limit(1).get();
    if (exist.data && exist.data.length > 0) {
      // 已是耍伴:仅更新可改字段(状态按当前 config 决定)
      await col('partner_profile').doc(exist.data[0]._id).update({ data: {
        accept_scenes, scene_rates, exam_scores: exam_scores || {}, city: ['成都'], status,
        updated_at: now
      }});
      console.log(`partner profile updated: ${openid}`);
    } else {
      await col('partner_profile').add({ data: profileData });
      console.log(`partner profile created: ${openid}`);
    }

    // 用户 roles 增加 partner
    const roles = Array.isArray(user.roles) ? user.roles.slice() : ['user'];
    if (roles.indexOf('partner') < 0) roles.push('partner');
    await col('user_account').where({ openid }).update({ data: { roles, updated_at: now } });

    // pending 时写 platform_event(P2)
    if (status === 'pending_review') {
      await col('platform_event').add({ data: {
        level: 'P2', type: 'partner_review', openid,
        payload: { accept_scenes, scene_rates },
        created_at: now, updated_at: now, is_deleted: false
      }});
      console.log(`partner review event created: ${openid}`);
    }

    return {
      ok: true,
      data: {
        openid, status,
        accept_scenes, scene_rates, city: ['成都'],
        auto_approved: status === 'approved'
      }
    };
  } catch (e) {
    console.log(`partner apply fail: ${e.message}`);
    return { ok: false, code: 'apply_db_fail', msg: '申请提交失败' };
  }
};
