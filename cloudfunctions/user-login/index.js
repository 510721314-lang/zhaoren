// 对应 PRD 章节：3.1 注册与实名认证 / 8.1 信用分体系 / 9.2.2 用户隐私脱敏
// user-login 登录与实名注册 · 身份取自 getWXContext().OPENID,禁止信任前端字段
// 6 个 action: login / update_profile / bind_phone / bind_idcard / set_emergency_contact / get_my_credit
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 身份证 18 位校验位算法(GB 11643-1999)
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

function isValidIdCard(id) {
  if (!id || typeof id !== 'string') return false;
  if (!/^\d{17}[\dXx]$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(id[i], 10) * ID_WEIGHTS[i];
  const checkCode = ID_CHECK[sum % 11];
  return checkCode === id[17].toUpperCase();
}

// 从身份证第 7-14 位提取生日并计算年龄
function calcAgeFromIdCard(id) {
  const y = parseInt(id.substr(6, 4), 10);
  const m = parseInt(id.substr(10, 2), 10);
  const d = parseInt(id.substr(12, 2), 10);
  if (!y || !m || !d) return null;
  const birth = new Date(y, m - 1, d);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d)) age--;
  return age;
}

// 脱敏:138****1234 / 5101**********1234
function maskPhone(p) {
  if (!p || p.length < 11) return p || '';
  return p.slice(0, 3) + '****' + p.slice(7);
}
function maskIdCard(id) {
  if (!id || id.length < 18) return id || '';
  return id.slice(0, 4) + '**********' + id.slice(14);
}

// 内容安全(msgSecCheck 不可用时降级本地词库)
async function safeCheckText(text, blockWords) {
  if (!text) return { pass: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    return { pass: res.errCode === 0, msg: res.errCode === 0 ? '' : '内容违规' };
  } catch (e) {
    // 降级:本地词库
    const hit = (blockWords || []).find(w => text.indexOf(w) >= 0);
    return { pass: !hit, msg: hit ? '内容包含敏感词' : '', fallback: true };
  }
}

// 获取运营参数(本地兜底词库等)
async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data.length) return r.data[0];
  } catch (e) {}
  return { block_words: ['加微信', '加V', '转账', '私聊我'] };
}

// 写信用分流水
async function logCredit(openid, type, delta, score, reason) {
  await col('credit_score_log').add({ data: {
    openid, type, delta, score, reason,
    created_at: Date.now(), updated_at: Date.now(), is_deleted: false
  }});
}

// 用户文档脱敏后返回
function safeUserDoc(u) {
  if (!u) return null;
  return {
    _id: u._id, openid: u.openid, nickname: u.nickname, avatar: u.avatar,
    roles: u.roles, user_credit_score: u.user_credit_score,
    partner_credit_score: u.partner_credit_score,
    is_realname_done: u.is_realname_done,
    is_realname_simulated: u.is_realname_simulated,
    age: u.age, status: u.status, phone: u.phone ? maskPhone(u.phone) : '',
    idcard_masked: u.idcard ? maskIdCard(u.idcard) : '',
    register_source: u.register_source,
    created_at: u.created_at, updated_at: u.updated_at
  };
}

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return { ok: false, code: 'login_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`user-login action=${action} openid=${openid}`);

  switch (action) {

    // 1. 登录(自动建号,幂等)
    case 'login': {
      try {
        const r = await col('user_account').where({ openid }).limit(1).get();
        if (r.data && r.data.length > 0) {
          const u = r.data[0];
          if (u.status === 'frozen') {
            return { ok: false, code: 'login_account_frozen', msg: '账号已冻结,请联系管理员' };
          }
          return { ok: true, data: { user: safeUserDoc(u) } };
        }
        // 新建账号(初始信用 800)
        const now = Date.now();
        const newUser = {
          openid, nickname: '微信用户', avatar: '',
          roles: ['user'],
          user_credit_score: 800, partner_credit_score: 800,
          is_realname_done: false, is_realname_simulated: true,
          age: null, status: 'normal', register_source: 'mvp',
          created_at: now, updated_at: now, is_deleted: false
        };
        const addRes = await col('user_account').add({ data: newUser });
        await logCredit(openid, 'init', 0, 800, 'register init credit');
        newUser._id = addRes._id;
        console.log(`new user created: ${openid}`);
        return { ok: true, data: { user: safeUserDoc(newUser), is_new: true } };
      } catch (e) {
        console.log(`login error: ${e.message}`);
        return { ok: false, code: 'login_fail', msg: '登录失败,请稍后重试' };
      }
    }

    // 2. 更新昵称与头像(昵称过安全检测)
    case 'update_profile': {
      const { nickname, avatar } = event;
      if (!nickname && !avatar) return { ok: false, code: 'profile_empty', msg: '昵称与头像不能同时为空' };
      if (nickname && (typeof nickname !== 'string' || nickname.length > 20)) {
        return { ok: false, code: 'profile_nick_invalid', msg: '昵称长度需 1-20 字' };
      }
      const config = await getConfig();
      if (nickname) {
        const chk = await safeCheckText(nickname, config.block_words);
        if (!chk.pass) return { ok: false, code: 'profile_nick_blocked', msg: chk.msg || '昵称包含敏感内容' };
      }
      const update = { updated_at: Date.now() };
      if (nickname) update.nickname = nickname;
      if (avatar) update.avatar = avatar;
      try {
        await col('user_account').where({ openid }).update({ data: update });
        return { ok: true, data: { updated: Object.keys(update).filter(k => k !== 'updated_at') } };
      } catch (e) {
        return { ok: false, code: 'profile_save_fail', msg: '保存失败' };
      }
    }

    // 3. 绑定手机号(11 位 1 开头 · 仅校验,存明文仅供紧急联系)
    case 'bind_phone': {
      const { phone } = event;
      if (!phone || !/^1\d{10}$/.test(phone)) {
        return { ok: false, code: 'phone_format', msg: '手机号格式有误(需 11 位 1 开头)' };
      }
      try {
        await col('user_account').where({ openid }).update({ data: {
          phone, updated_at: Date.now()
        }});
        return { ok: true, data: { phone: maskPhone(phone) } };
      } catch (e) {
        return { ok: false, code: 'phone_save_fail', msg: '手机号保存失败' };
      }
    }

    // 4. 绑定身份证(18 位校验位 + 计算年龄 + <18 拒绝)
    case 'bind_idcard': {
      const { idcard } = event;
      if (!isValidIdCard(idcard)) {
        return { ok: false, code: 'idcard_format', msg: '身份证号格式有误' };
      }
      const age = calcAgeFromIdCard(idcard);
      if (age === null || age < 18) {
        return { ok: false, code: 'idcard_minor', msg: '未成年人禁止使用本服务' };
      }
      try {
        await col('user_account').where({ openid }).update({ data: {
          idcard, age, is_realname_done: true, updated_at: Date.now()
        }});
        return { ok: true, data: { age, idcard_masked: maskIdCard(idcard) } };
      } catch (e) {
        return { ok: false, code: 'idcard_save_fail', msg: '身份证保存失败' };
      }
    }

    // 5. 设置紧急联系人(1~2 名)
    case 'set_emergency_contact': {
      const { contacts } = event;
      if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > 2) {
        return { ok: false, code: 'emergency_count', msg: '紧急联系人需 1-2 名' };
      }
      for (const c of contacts) {
        if (!c.name || !c.phone || !c.relation) {
          return { ok: false, code: 'emergency_field', msg: '姓名/手机号/关系均必填' };
        }
        if (!/^1\d{10}$/.test(c.phone)) {
          return { ok: false, code: 'emergency_phone', msg: `${c.name} 的手机号格式有误` };
        }
      }
      try {
        // 删除旧联系人(逻辑删除),再插入新的
        await col('emergency_contact').where({ openid, is_deleted: false }).update({ data: {
          is_deleted: true, updated_at: Date.now()
        }});
        const now = Date.now();
        for (const c of contacts) {
          await col('emergency_contact').add({ data: {
            openid, name: c.name, phone: c.phone, relation: c.relation,
            created_at: now, updated_at: now, is_deleted: false
          }});
        }
        const safe = contacts.map(c => ({ name: c.name, phone: maskPhone(c.phone), relation: c.relation }));
        return { ok: true, data: { contacts: safe } };
      } catch (e) {
        return { ok: false, code: 'emergency_save_fail', msg: '紧急联系人保存失败' };
      }
    }

    // 6. 查询双信用分与最近 20 条流水
    case 'get_my_credit': {
      try {
        const ur = await col('user_account').where({ openid }).limit(1).get();
        if (!ur.data || !ur.data.length) return { ok: false, code: 'credit_no_user', msg: '用户不存在' };
        const u = ur.data[0];
        const lr = await col('credit_score_log').where({ openid }).orderBy('created_at', 'desc').limit(20).get();
        return {
          ok: true,
          data: {
            user_credit_score: u.user_credit_score,
            partner_credit_score: u.partner_credit_score,
            logs: (lr.data || []).map(l => ({
              type: l.type, delta: l.delta, score: l.score, reason: l.reason,
              created_at: l.created_at
            }))
          }
        };
      } catch (e) {
        return { ok: false, code: 'credit_query_fail', msg: '信用分查询失败' };
      }
    }

    default:
      return { ok: false, code: 'login_unknown_action', msg: '未知动作' };
  }
};
