// 对应 PRD 章节：3.1 注册与实名认证 / 8.1 信用分体系 / 9.2.2 用户隐私脱敏
// user-login 登录与实名注册 · 身份取自 getWXContext().OPENID,禁止信任前端字段
// action 列表: login / peek_login / phone_login / phone_register / password_register / password_login /
//             update_profile / bind_phone / bind_idcard / submit_realname / simulate_realname /
//             set_emergency_contact / get_my_credit / close_account
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

// ─────────────────── 账号密码辅助 ───────────────────
// 生成 16 字节随机 salt (hex 32 字符)
function genSalt() { return crypto.randomBytes(16).toString('hex'); }
// SHA256(salt + password + salt)
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password + salt).digest('hex');
}
// login_account 格式: 4-20 位字母/数字/下划线
const ACCOUNT_RE = /^[a-zA-Z0-9_]{4,20}$/;
// password 格式: 6-32 位 (不含空白)
const PASSWORD_RE = /^\S{6,32}$/;

// 进行中订单: 存在任一笔时不允许注销(需先完结/协商)
const ACTIVE_ORDER_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

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

// ─────────────── 身份证号加密(AES-256-GCM, 禁止明文落库) ───────────────
// 密钥存 admin_config.idcard_aes_key(64 hex); 首次实名时 lazy 生成并写回
// 密文格式 hex(iv12 + tag16 + ciphertext); 业务只展示 idcard_mask, 不提供解密接口
async function ensureIdcardKey() {
  const cfg = await getConfig();
  if (cfg.idcard_aes_key && /^[0-9a-f]{64}$/i.test(cfg.idcard_aes_key)) return cfg.idcard_aes_key;
  const key = crypto.randomBytes(32).toString('hex');
  try {
    await col('admin_config').where({ _id: 'global' }).update({
      data: { idcard_aes_key: key, updated_at: Date.now() }
    });
    return key;
  } catch (e) {
    // 并发首次绑定落败: 重读拿到另一方写入的 key
    const r = await col('admin_config').doc('global').get().catch(() => ({ data: {} }));
    const k = r.data && r.data.idcard_aes_key;
    if (k && /^[0-9a-f]{64}$/i.test(k)) return k;
    throw new Error('idcard_key_unavailable');
  }
}
function encryptIdCard(plain, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('hex');
}

// ─────────────── 实名签署协议兜底文案(admin_config.legal_* 未配置时使用) ───────────────
// 正式文案由后台「法律合规」模块维护; 留证时以服务端读取到的全文计算 SHA-256 并随记录入库
const DEFAULT_SERVICE_AGREEMENT = [
  '找个人帮忙 服务协议（测试期精简版，正式全文以平台公示版本为准）',
  '一、平台性质：本平台为生活服务信息撮合平台，仅提供信息发布与撮合服务，不直接提供服务，亦不承担服务方的履约责任。',
  '二、用户义务：用户应提供真实身份信息，不得发布违法、违规或虚假需求；不得站外交易、私自转账。',
  '三、服务与费用：服务时薪由双方按平台规则约定；平台不代收服务费，AA（交通、餐费、门票等）费用由双方线下自行协商结算。',
  '四、安全与免责：用户应遵守平台安全规范与时间红线；因用户自身原因或第三方原因造成的损失，平台不承担责任。',
  '五、电子签署：用户通过手写签名方式确认本协议，电子签名与手写签名具有同等法律效力。'
].join('\n');

const DEFAULT_AA_PROMISE = [
  '费用自理承诺书',
  '一、AA 指交通费、餐费、门票等第三方费用，不含服务费；',
  '二、AA 费用由双方线下自行协商结算，平台不代收、不担保、不仲裁；',
  '三、平台不参与定价与结算；',
  '四、因 AA 产生的纠纷，平台不承担调解、仲裁、赔偿责任。'
].join('\n');

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
    const r = await col('admin_config').doc('global').get();
    return r.data || { block_words: ['加微信', '加V', '转账', '私聊我'] };
  } catch (e) { return { block_words: ['加微信', '加V', '转账', '私聊我'] }; }
}

// dev 环境 simulated 实名用户当作已实名放行(开发调试便利, prod 严格)
// 来源: admin_config.env (openid.js 5 分钟缓存)
function devAllowSimulatedRealname(u) {
  if (!u || u.is_realname_done || !u.is_realname_simulated) return u;
  try {
    const env = require('./openid').getCachedEnv();
    if (env === 'dev') u.is_realname_done = true;
  } catch (e) {}
  return u;
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
  // dev 环境 simulated 实名用户当作已实名放行(开发调试便利, prod 严格)
  const realnameDone = devAllowSimulatedRealname(u).is_realname_done;
  return {
    _id: u._id, openid: u.openid, nickname: u.nickname, avatar: u.avatar,
    roles: u.roles, user_credit_score: u.user_credit_score,
    partner_credit_score: u.partner_credit_score,
    is_realname_done: realnameDone,
    is_realname_simulated: u.is_realname_simulated,
    realname_method: u.realname_method || '',
    realname_done_at: u.realname_done_at || 0,
    age: u.age, status: u.status, phone: u.phone ? maskPhone(u.phone) : '',
    idcard_masked: u.idcard_mask || (u.idcard ? maskIdCard(u.idcard) : ''),
    register_source: u.register_source,
    created_at: u.created_at, updated_at: u.updated_at
  };
}

// ─────────────── 短信验证码 / 手机号解析辅助(模块级, 禁止放进 switch 内) ───────────────
// 手机号 11 位校验
const PHONE_RE = /^1\d{10}$/;
// 生成 6 位数字验证码
function genSmsCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
// 从前端入参拿到真实手机号: 路径A phone_code(getPhoneNumber 授权) / 路径B phone+sms_code(短信验证码)
// callerOpenid 必须传 resolveOpenid 解析后的身份(不能内部取 wxCtx.OPENID, 否则 dev mock 链路断裂)
async function resolvePhone(event, callerOpenid) {
  const { phone_code, phone, sms_code } = event;
  if (phone_code) {
    try {
      const r = await cloud.openapi.phonenumber.getPhoneNumber({ code: phone_code });
      const p = r && r.phoneInfo && r.phoneInfo.purePhoneNumber;
      if (p && PHONE_RE.test(p)) return { ok: true, phone: p };
      return { ok: false, code: 'phone_decrypt_fail', msg: '手机号获取失败' };
    } catch (e) {
      log.d('resolvePhone getPhoneNumber fail:', e.errCode, e.errMsg);
      return { ok: false, code: 'phone_decrypt_fail', msg: '手机号获取失败:' + (e.errMsg || '请重试') };
    }
  }
  if (phone && sms_code) {
    if (!PHONE_RE.test(phone)) return { ok: false, code: 'phone_format', msg: '手机号格式有误' };
    try {
      const r = await col('user_account').where({ openid: callerOpenid }).limit(1).get();
      const u = r.data && r.data.length > 0 ? r.data[0] : null;
      if (!u) return { ok: false, code: 'sms_no_user', msg: '请先获取验证码' };
      if (!u.sms_code || !u.sms_target || u.sms_target !== phone) {
        return { ok: false, code: 'sms_no_code', msg: '未发送验证码或手机号不匹配' };
      }
      if (u.sms_expire_at < Date.now()) {
        return { ok: false, code: 'sms_expired', msg: '验证码已过期' };
      }
      if (u.sms_code !== sms_code) {
        return { ok: false, code: 'sms_wrong', msg: '验证码错误' };
      }
      // 验证通过, 消耗验证码并写入手机号
      await col('user_account').doc(u._id).update({
        data: { sms_code: '', sms_expire_at: 0, sms_target: '', phone, updated_at: Date.now() }
      });
      return { ok: true, phone };
    } catch (e) {
      log.d('resolvePhone sms verify fail:', e && e.message);
      return { ok: false, code: 'sms_verify_fail', msg: '验证码校验失败,请稍后重试' };
    }
  }
  return { ok: false, code: 'phone_missing', msg: '请提供 getPhoneNumber 授权或手机号+验证码' };
}

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'login_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`user-login action=${action} openid=${openid}`);

  // 总保险: 任何未预期异常都转成 JSON 业务错误, 避免云函数崩溃让客户端收到"网络异常"
  try {
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
          if (u.status === 'banned') {
            return { ok: false, code: 'login_account_banned', msg: '账号已封禁,请联系客服' };
          }
          if (u.status === 'closed') {
            return { ok: false, code: 'login_account_closed', msg: '该账号已注销' };
          }
          // dev 环境 simulated 账号强制放行: 直接读 DB env (不走 getCachedEnv 缓存, 因为跨进程 invalidate 不掉)
          if (!u.is_realname_done && u.is_realname_simulated) {
            try {
              const cfg = await getConfig();
              if (cfg && cfg.env === 'dev') {
                u.is_realname_done = true;
                log.d('[login] dev 放行 simulated realname for', openid);
              }
            } catch (_) {}
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
        // 新建账号同样 dev 放行 simulated
        try {
          const cfg = await getConfig();
          if (cfg && cfg.env === 'dev') {
            newUser.is_realname_done = true;
          }
        } catch (_) {}
        log.d(`new user created: ${openid}`);
        return { ok: true, data: { user: safeUserDoc(newUser), is_new: true } };
      } catch (e) {
        log.d(`login error: ${e.message}`);
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

    // 3. 绑定手机号: 只接受 getPhoneNumber 授权(phone_code) 或短信验证码(phone+sms_code),
    //    禁止直接信任前端明文 phone(防伪造)
    case 'bind_phone': {
      const rp = await resolvePhone(event, openid);
      if (!rp.ok) return { ok: false, code: rp.code, msg: rp.msg };
      try {
        await col('user_account').where({ openid }).update({ data: {
          phone: rp.phone, updated_at: Date.now()
        }});
        return { ok: true, data: { phone: maskPhone(rp.phone) } };
      } catch (e) {
        return { ok: false, code: 'phone_save_fail', msg: '手机号保存失败' };
      }
    }

    // 4. 绑定身份证(18 位校验位 + 计算年龄 + <18 拒绝; AES-256-GCM 加密落库)
    case 'bind_idcard': {
      const { idcard } = event;
      if (!isValidIdCard(idcard)) {
        return { ok: false, code: 'idcard_format', msg: '身份证号格式有误' };
      }
      const age = calcAgeFromIdCard(idcard);
      if (age === null || age < 18) {
        return { ok: false, code: 'idcard_minor', msg: '未成年人禁止使用本服务' };
      }
      let idcardEnc;
      try {
        const key = await ensureIdcardKey();
        idcardEnc = encryptIdCard(idcard, key);
      } catch (e) {
        return { ok: false, code: 'idcard_key_fail', msg: '实名服务暂不可用,请稍后重试' };
      }
      try {
        await col('user_account').where({ openid }).update({ data: {
          idcard_enc: idcardEnc, idcard_mask: maskIdCard(idcard),
          idcard: '', // 清理历史明文(老数据重绑时)
          age, is_realname_done: true, updated_at: Date.now()
        }});
        return { ok: true, data: { age, idcard_masked: maskIdCard(idcard) } };
      } catch (e) {
        return { ok: false, code: 'idcard_save_fail', msg: '身份证保存失败' };
      }
    }

    // 4.6 实名正式版(P0 完整留证): 真实姓名+身份证(AES) + 人脸(测试期 mock) + 手写签名留证
    // 留证落 disclaimer_signature(kind=realname_agreement): 签名图 fileID + 服务端复算 SHA-256 + 协议全文及其 hash
    case 'submit_realname': {
      const { real_name, idcard, signature_file_id } = event;
      const name = String(real_name || '').trim();
      if (!/^[\u4e00-\u9fa5A-Za-z·\s]{2,20}$/.test(name)) {
        return { ok: false, code: 'realname_bad_name', msg: '请输入真实姓名(2-20位中文或字母)' };
      }
      if (!isValidIdCard(String(idcard || ''))) {
        return { ok: false, code: 'idcard_format', msg: '身份证号格式有误' };
      }
      const id = String(idcard).trim().toUpperCase();
      const age = calcAgeFromIdCard(id);
      if (age === null || age < 18) return { ok: false, code: 'idcard_minor', msg: '未成年人禁止使用本服务' };
      if (age > 120) return { ok: false, code: 'idcard_age', msg: '身份证号出生日期有误' };
      if (!signature_file_id || !/^cloud:\/\//.test(String(signature_file_id))) {
        return { ok: false, code: 'realname_no_sign', msg: '请先完成手写签名' };
      }

      const config = await getConfig();
      // 人脸模式守卫: 测试期 mock 放行; 后台切到 wx 后本模拟通道 fail-closed(正式人脸流程随资质接入)
      const faceMode = String(config.realname_face_mode || 'mock');
      if (faceMode !== 'mock') {
        return { ok: false, code: 'realname_face_online', msg: '正式人脸核验通道尚未开放,请等待上线后再试' };
      }

      // 签名图取证: 服务端下载 → PNG 魔数 + 体积校验 → SHA-256(证明入库时刻的文件内容)
      let sigHash = '', sigSize = 0;
      try {
        const dl = await cloud.downloadFile({ fileID: String(signature_file_id) });
        const buf = dl && dl.fileContent;
        sigSize = buf ? buf.length : 0;
        if (!buf || !sigSize || sigSize > 2 * 1024 * 1024) throw new Error('bad_size');
        if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)) throw new Error('not_png');
        sigHash = crypto.createHash('sha256').update(buf).digest('hex');
      } catch (e) {
        log.d(`realname signature verify fail: ${(e && e.message) || e}`);
        return { ok: false, code: 'realname_sign_file', msg: '签名图校验失败,请清除后重新签名' };
      }

      // 协议全文取证: 服务端取同一来源文本(config.legal_*)并计算 hash; 全文随留证入库, 事后不可抵赖
      // 占位符防护: 文本过短(如"服务协议全文"7字占位)视为未配置, 回落完整兜底文案, 避免留证 hash 无意义
      const svcRaw = String(config.legal_service_agreement || '');
      const aaRaw = String(config.legal_aa_promise || '');
      const docs = [
        { key: 'service_agreement', title: '服务协议', text: svcRaw.length >= 50 ? svcRaw : DEFAULT_SERVICE_AGREEMENT },
        { key: 'aa_promise', title: '费用自理承诺书', text: aaRaw.length >= 20 ? aaRaw : DEFAULT_AA_PROMISE }
      ].map((d) => ({
        key: d.key, title: d.title,
        hash: crypto.createHash('sha256').update(d.text, 'utf8').digest('hex'),
        text: d.text
      }));

      // 身份证加密(AES-256-GCM)
      let idcardEnc;
      try {
        const key = await ensureIdcardKey();
        idcardEnc = encryptIdCard(id, key);
      } catch (e) {
        return { ok: false, code: 'idcard_key_fail', msg: '实名服务暂不可用,请稍后重试' };
      }

      const nowTs = Date.now();
      const wxCtxSign = cloud.getWXContext();
      let evidenceId = '';
      try {
        const er = await col('disclaimer_signature').add({ data: {
          kind: 'realname_agreement',
          openid, role: 'user', scene: '', disclaimer_type: 'realname_agreement',
          real_name: name, idcard_mask: maskIdCard(id), age,
          verify_method: 'mock_face', face_mode: faceMode,
          signature_file_id: String(signature_file_id), signature_hash: sigHash, signature_size: sigSize,
          docs,
          client_ip: (wxCtxSign && wxCtxSign.CLIENTIP) || '',
          device: String(event.device || '').slice(0, 200),
          signed_at: nowTs, created_at: nowTs, updated_at: nowTs, is_deleted: false
        }});
        evidenceId = (er && er._id) || '';
      } catch (e) {
        log.d(`realname evidence add fail: ${(e && e.message) || e}`);
        return { ok: false, code: 'realname_evidence_fail', msg: '留证落库失败,请稍后重试' };
      }

      try {
        await col('user_account').where({ openid }).update({ data: {
          real_name: name,
          idcard_enc: idcardEnc, idcard_mask: maskIdCard(id), idcard: '',
          age,
          is_realname_done: true, is_realname_simulated: false,
          realname_method: 'mock_face', realname_evidence_id: evidenceId, realname_done_at: nowTs,
          updated_at: nowTs
        }});
      } catch (e) {
        return { ok: false, code: 'realname_save_fail', msg: '实名信息保存失败,请稍后重试' };
      }

      const r2 = await col('user_account').where({ openid }).limit(1).get();
      const u2 = (r2.data && r2.data[0]) || null;
      log.d(`realname done(evidence=${evidenceId}) openid=${openid}`);
      return { ok: true, data: { user: u2 ? safeUserDoc(u2) : null, evidence_id: evidenceId } };
    }

    // 4.5 模拟实名认证(测试期专用: 仅 realname_face_mode=mock 时可用; 切 wx 后 fail-closed)
    case 'simulate_realname': {
      const simCfg = await getConfig();
      if (String(simCfg.realname_face_mode || 'mock') !== 'mock') {
        return { ok: false, code: 'realname_mock_closed', msg: '模拟认证已关闭' };
      }
      const now = Date.now();
      try {
        await col('user_account').where({ openid }).update({ data: {
          is_realname_done: true, is_realname_simulated: true,
          realname_simulated_at: now, updated_at: now
        }});
      } catch (e) {
        return { ok: false, code: 'realname_sim_fail', msg: '认证失败,请稍后重试' };
      }
      const r = await col('user_account').where({ openid }).limit(1).get();
      const u = (r.data && r.data[0]) || null;
      return { ok: true, data: { user: u ? safeUserDoc(u) : null } };
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
        const now = Date.now();
        // 槽位复用: 取现有未删联系人(按创建顺序, 最多2), 逐槽覆盖更新; 不足才新增, 多余软删。
        // 不采用"先全删再逐条插", 避免中途插入失败导致联系人被清空。
        const existR = await col('emergency_contact')
          .where({ openid, is_deleted: false }).orderBy('created_at', 'asc').limit(2).get();
        const existDocs = existR.data || [];
        await Promise.all(contacts.map((c, i) => {
          if (existDocs[i]) {
            return col('emergency_contact').doc(existDocs[i]._id).update({ data: {
              name: c.name, phone: c.phone, relation: c.relation, updated_at: now
            }});
          }
          return col('emergency_contact').add({ data: {
            openid, name: c.name, phone: c.phone, relation: c.relation,
            created_at: now, updated_at: now, is_deleted: false
          }});
        }));
        // 新数据少于旧数据(如 2 名减为 1 名): 多余旧槽位软删
        for (let i = contacts.length; i < existDocs.length; i++) {
          await col('emergency_contact').doc(existDocs[i]._id).update({ data: {
            is_deleted: true, updated_at: now
          }});
        }
        const safe = contacts.map(c => ({ name: c.name, phone: maskPhone(c.phone), relation: c.relation }));
        return { ok: true, data: { contacts: safe } };
      } catch (e) {
        return { ok: false, code: 'emergency_save_fail', msg: '紧急联系人保存失败' };
      }
    }

    // 5b. 查询我的紧急联系人(本人管理页回显, 返回完整手机号; 最多 2 名)
    case 'get_emergency_contact': {
      try {
        const r = await col('emergency_contact').where({ openid, is_deleted: false }).limit(2).get();
        const contacts = (r.data || []).map(c => ({
          name: c.name || '', phone: c.phone || '', relation: c.relation || ''
        }));
        return { ok: true, data: { contacts } };
      } catch (e) {
        return { ok: false, code: 'emergency_query_fail', msg: '紧急联系人查询失败' };
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

    // 7. 注销账号(软删除 + 个人信息匿名化; 有进行中订单时拒绝)
    case 'close_account': {
      let uid;
      try {
        const ur = await col('user_account').where({ openid }).limit(1).get();
        if (!ur.data || !ur.data.length) return { ok: false, code: 'close_no_user', msg: '账号不存在' };
        if (ur.data[0].status === 'closed') return { ok: false, code: 'close_already', msg: '账号已注销' };
        uid = ur.data[0]._id;

        // 有进行中订单(发单或接单任一方) → 拒绝, 需先完结
        const activeR = await col('order_main').where(_.and([
          { status: _.in(ACTIVE_ORDER_STATUS) },
          _.or([{ user_openid: openid }, { partner_openid: openid }])
        ])).count();
        if (activeR.total > 0) {
          return { ok: false, code: 'close_has_active_orders', msg: `还有 ${activeR.total} 笔进行中订单,请完结后再注销` };
        }
      } catch (e) {
        log.d(`close precheck fail: ${e.message}`);
        return { ok: false, code: 'close_precheck_fail', msg: '注销校验失败,请稍后重试' };
      }

      const now = Date.now();
      try {
        // ① 待接单需求自动取消(尚无订单与资金)
        await col('demand').where({ creator_openid: openid, status: 'matching' }).update({
          data: { status: 'cancelled', updated_at: now }
        });
        // ② 紧急联系人逻辑删除
        await col('emergency_contact').where({ openid, is_deleted: false }).update({
          data: { is_deleted: true, updated_at: now }
        });
        // ③ 耍伴档案停止接单(保留档案供历史订单展示)
        await col('partner_profile').where({ openid }).update({
          data: { accept_switch: false, updated_at: now }
        });
        // ④ 账号匿名化 + 置 closed(openid 保留用于订单流水追溯, 其余个人信息清空)
        await col('user_account').doc(uid).update({
          data: {
            status: 'closed', roles: [],
            nickname: '已注销用户', avatar: '', phone: '', idcard: '',
            idcard_enc: '', idcard_mask: '', age: null,
            is_realname_done: false,
            closed_at: now, is_deleted: true, updated_at: now
          }
        });
        await col('platform_event').add({ data: {
          level: 'P2', type: 'account_close', openid,
          payload: { at: now },
          created_at: now, updated_at: now, is_deleted: false
        }});
        return { ok: true, data: { msg: '账号已注销' } };
      } catch (e) {
        log.d(`close account fail: ${e.message}`);
        return { ok: false, code: 'close_fail', msg: '注销失败,请稍后重试或联系客服' };
      }
    }

    // peek_login: 仅查已有账号不建号(前端 onShow 续查用, 避免每次进页都弹登录打断)
    case 'peek_login': {
      try {
        const r = await col('user_account').where({ openid }).limit(1).get();
        if (!(r.data && r.data.length > 0)) {
          return { ok: true, data: { found: false } };
        }
        const u = r.data[0];
        if (u.status === 'frozen') return { ok: true, data: { found: true, frozen: true, msg: '账号已冻结' } };
        if (u.status === 'banned') return { ok: true, data: { found: true, banned: true, msg: '账号已封禁' } };
        if (u.status === 'closed') return { ok: true, data: { found: true, closed: true, msg: '账号已注销' } };
        return { ok: true, data: { found: true, user: safeUserDoc(u) } };
      } catch (e) {
        return { ok: false, code: 'peek_fail', msg: '查询失败' };
      }
    }

    // 发送短信验证码: 给指定 phone 发 6 位验证码, 存当前 openid 的 user_account(无则自动建空壳)
    // 开发期: console.log 打出来(模拟发送) 生产期: 接腾讯云 SMS
    case 'send_sms_code': {
      const { phone } = event;
      if (!PHONE_RE.test(phone)) return { ok: false, code: 'phone_format', msg: '手机号格式有误' };
      const code = genSmsCode();
      const expireAt = Date.now() + 5 * 60 * 1000; // 5 分钟
      try {
        // 查 openid 下是否已有 user_account: 没有就建空壳(phone_register/login 会填充完整数据)
        let r = await col('user_account').where({ openid }).limit(1).get();
        let docId;
        if (r.data && r.data.length > 0) {
          docId = r.data[0]._id;
          await col('user_account').doc(docId).update({ data: {
            sms_code: code, sms_expire_at: expireAt, sms_target: phone, updated_at: Date.now()
          }});
        } else {
          const now = Date.now();
          const newUser = {
            openid, nickname: '微信用户', avatar: '',
            roles: ['user'],
            user_credit_score: 800, partner_credit_score: 800,
            is_realname_done: false, is_realname_simulated: true,
            age: null, status: 'normal',
            register_source: 'phone_pending',
            phone: '', sms_code: code, sms_expire_at: expireAt, sms_target: phone,
            created_at: now, updated_at: now, is_deleted: false
          };
          const addRes = await col('user_account').add({ data: newUser });
          docId = addRes._id;
        }
        // 模拟发送: 验证码禁止写日志(防日志泄露被冒充)
        // TODO: 生产期替换为 await cloud.openapi.sms.send({...}) 或腾讯云 SMS SDK
        const env = require('./openid').getCachedEnv();
        log.d(`[SMS-SEND] phone=${phone} expire_at=${expireAt} (code hidden)`);
        if (env === 'dev') {
          // dev 云端测试/真机调试: 走响应回传验证码, 不进日志
          return { ok: true, data: { msg: '验证码已发送(dev 模式)', dev_code: code } };
        }
        return { ok: true, data: { msg: '验证码已发送' } };
      } catch (e) {
        log.d(`send_sms_code error: ${e.message}`);
        return { ok: false, code: 'sms_send_fail', msg: '验证码发送失败,请稍后重试' };
      }
    }

    // 手机号登录: 支持 getPhoneNumber 授权或手机号+短信验证码
    case 'phone_login': {
      // 注意: 手机号变量统一用 rp.phone, 切勿在此再解构 event.phone, 否则同作用域 const 重复声明导致整文件加载崩溃
      const rp = await resolvePhone(event, openid);
      if (!rp.ok) return { ok: false, code: rp.code, msg: rp.msg };
      const phone = rp.phone;
      try {
        // 1. 查当前 openid 账号; send_sms_code 建的 phone_pending 空壳不算正式账号
        const r = await col('user_account').where({ openid }).limit(1).get();
        const localDoc = (r.data && r.data.length > 0) ? r.data[0] : null;
        const pendingShellId = (localDoc && localDoc.register_source === 'phone_pending') ? localDoc._id : null;
        const u = (localDoc && localDoc.register_source !== 'phone_pending') ? localDoc : null;
        if (u) {
          if (u.status === 'frozen') return { ok: false, code: 'login_account_frozen', msg: '账号已冻结,请联系管理员' };
          if (u.status === 'banned') return { ok: false, code: 'login_account_banned', msg: '账号已封禁,请联系客服' };
          if (u.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '该账号已注销' };
          if (!u.phone || u.phone !== phone) {
            await col('user_account').doc(u._id).update({ data: { phone, updated_at: Date.now() }});
            u.phone = phone;
          }
          return { ok: true, data: { user: safeUserDoc(u) } };
        }
        // 2. openid 下无正式账号: 按手机号查正式账号(换设备/换微信登录后重绑定); 排除 phone_pending 空壳
        const phoneR = await col('user_account').where({ phone }).get();
        const real = (phoneR.data || []).find(x => x.register_source !== 'phone_pending');
        if (real) {
          if (real.status === 'frozen') return { ok: false, code: 'login_account_frozen', msg: '账号已冻结' };
          if (real.status === 'banned') return { ok: false, code: 'login_account_banned', msg: '账号已封禁' };
          if (real.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '该账号已注销' };
          // 重绑定 openid 到正式账号
          await col('user_account').doc(real._id).update({ data: { openid, phone, updated_at: Date.now() }});
          real.openid = openid; real.phone = phone;
          // 清理当前 openid 下的短信空壳, 避免同一手机号出现两条记录
          if (pendingShellId) {
            await col('user_account').doc(pendingShellId).remove();
          }
          return { ok: true, data: { user: safeUserDoc(real) } };
        }
        // 3. 既无 openid 正式账号也无手机号正式账号: 一键登录语义 → 自动注册
        //    (用户已完成 getPhoneNumber 授权或短信验证, 且前端已校验勾选协议)
        const now = Date.now();
        const baseData = {
          nickname: '微信用户', avatar: '',
          roles: ['user'],
          user_credit_score: 800, partner_credit_score: 800,
          is_realname_done: false, is_realname_simulated: true,
          age: null, status: 'normal',
          register_source: 'phone', phone,
          updated_at: now
        };
        let newId;
        if (pendingShellId) {
          // 短信链路的 phone_pending 空壳: 直接填充复用, 不新建
          await col('user_account').doc(pendingShellId).update({ data: baseData });
          newId = pendingShellId;
        } else {
          const addRes = await col('user_account').add({ data: Object.assign({ created_at: now }, baseData) });
          newId = addRes._id;
        }
        await logCredit(openid, 'init', 0, 800, 'phone one-click auto register');
        const filledR = await col('user_account').doc(newId).get();
        log.d(`phone_login auto-register user: ${openid}`);
        return { ok: true, data: { user: safeUserDoc(filledR.data), is_new: true } };
      } catch (e) {
        log.d(`phone_login db error: ${e.message}`);
        return { ok: false, code: 'login_fail', msg: '登录失败,请稍后重试' };
      }
    }

    // 手机号快捷注册: 只建新账号, 不允许已有账号再走这个入口
    case 'phone_register': {
      const rp = await resolvePhone(event, openid);
      if (!rp.ok) return { ok: false, code: rp.code, msg: rp.msg };
      const phone = rp.phone;
      try {
        // 查 phone 是否已被正式账号占用(可能同时命中本 openid 的 phone_pending 空壳, 必须取全部再过滤, 不能 limit(1))
        const phoneAll = await col('user_account').where({ phone }).get();
        const phoneDup = (phoneAll.data || []).find(x => x.register_source !== 'phone_pending');
        if (phoneDup) {
          if (phoneDup.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '该账号已注销,无法重新注册' };
          return { ok: false, code: 'phone_already_exists', msg: '该手机号已有账号,请直接登录' };
        }
        // 查 openid 是否已建号
        const openidR = await col('user_account').where({ openid }).limit(1).get();
        if (openidR.data && openidR.data.length > 0) {
          const u = openidR.data[0];
          if (u.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '该账号已注销,无法重新注册' };
          if (u.register_source === 'phone_pending') {
            // send_sms_code 建的空壳: 直接填充完整数据
            const now = Date.now();
            await col('user_account').doc(u._id).update({ data: {
              nickname: '微信用户', avatar: '',
              roles: ['user'],
              user_credit_score: 800, partner_credit_score: 800,
              is_realname_done: false, is_realname_simulated: true,
              age: null, status: 'normal',
              register_source: 'phone', phone,
              updated_at: now
            }});
            await logCredit(openid, 'init', 0, 800, 'phone register init credit');
            const updated = Object.assign({}, u, { nickname: '微信用户', roles: ['user'], user_credit_score: 800, partner_credit_score: 800, register_source: 'phone', phone, status: 'normal' });
            log.d(`phone register filled pending shell: ${openid}`);
            return { ok: true, data: { user: safeUserDoc(updated), is_new: true } };
          }
          // 已有正常账号
          return { ok: false, code: 'phone_already_exists', msg: '该微信号已有账号,请直接登录' };
        }
        // openid 和 phone 都无账号: 全新注册
        const now = Date.now();
        const newUser = {
          openid, nickname: '微信用户', avatar: '',
          roles: ['user'],
          user_credit_score: 800, partner_credit_score: 800,
          is_realname_done: false, is_realname_simulated: true,
          age: null, status: 'normal',
          register_source: 'phone', phone,
          created_at: now, updated_at: now, is_deleted: false
        };
        const addRes = await col('user_account').add({ data: newUser });
        await logCredit(openid, 'init', 0, 800, 'phone register init credit');
        newUser._id = addRes._id;
        log.d(`phone register new user: ${openid}`);
        return { ok: true, data: { user: safeUserDoc(newUser), is_new: true } };
      } catch (e) {
        log.d(`phone_register db error: ${e.message}`);
        return { ok: false, code: 'register_fail', msg: '注册失败,请稍后重试' };
      }
    }

    // 10. 账号密码注册: 要求当前 openid 已有 user_account(先微信登录建号), 设 login_account + password_hash
    case 'password_register': {
      const { login_account, password } = event;
      if (!login_account || !ACCOUNT_RE.test(login_account)) {
        return { ok: false, code: 'account_invalid', msg: '账号需 4-20 位字母/数字/下划线' };
      }
      if (!password || !PASSWORD_RE.test(password)) {
        return { ok: false, code: 'password_invalid', msg: '密码需 6-32 位,不含空白' };
      }
      try {
        // openid 下必须已有账号(不能凭空造账号密码, 微信身份仍是根源)
        const myR = await col('user_account').where({ openid }).limit(1).get();
        if (!(myR.data && myR.data.length > 0)) {
          return { ok: false, code: 'register_no_user', msg: '请先用微信登录或手机号快捷注册' };
        }
        // login_account 全局唯一查重
        const dupR = await col('user_account').where({ login_account }).count();
        if (dupR.total > 0) {
          return { ok: false, code: 'account_dup', msg: '该账号名已被占用' };
        }
        const salt = genSalt();
        const hash = hashPassword(password, salt);
        await col('user_account').doc(myR.data[0]._id).update({ data: {
          login_account, password_hash: hash, password_salt: salt, updated_at: Date.now()
        }});
        return { ok: true, data: { msg: '注册成功' } };
      } catch (e) {
        log.d(`password_register error: ${e.message}`);
        return { ok: false, code: 'register_fail', msg: '注册失败,请稍后重试' };
      }
    }

    // 11. 账号密码登录: 按 login_account 查 user_account, 验密, 通过则把 openid 更新为当前环境 openid
    case 'password_login': {
      const { login_account, password } = event;
      if (!login_account || !ACCOUNT_RE.test(login_account)) {
        return { ok: false, code: 'account_invalid', msg: '账号格式有误' };
      }
      if (!password || !PASSWORD_RE.test(password)) {
        return { ok: false, code: 'password_invalid', msg: '密码格式有误' };
      }
      try {
        const r = await col('user_account').where({ login_account }).limit(1).get();
        if (!(r.data && r.data.length > 0)) {
          return { ok: false, code: 'password_not_found', msg: '账号不存在' };
        }
        const u = r.data[0];
        if (u.status === 'frozen') return { ok: false, code: 'login_account_frozen', msg: '账号已冻结' };
        if (u.status === 'banned') return { ok: false, code: 'login_account_banned', msg: '账号已封禁' };
        if (u.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '账号已注销' };
        // 没设密码(纯微信/手机号账号): 不能走这个入口
        if (!u.password_hash || !u.password_salt) {
          return { ok: false, code: 'password_not_set', msg: '该账号未设置密码,请改用微信或手机号登录' };
        }
        const expectHash = hashPassword(password, u.password_salt);
        if (expectHash !== u.password_hash) {
          return { ok: false, code: 'password_wrong', msg: '密码错误' };
        }
        // 如果 openid 已变(换了微信/换了设备), 检查新 openid 下没有其他活跃账号 → 冲突则拒绝
        if (u.openid !== openid) {
          const conflictR = await col('user_account').where({ openid, status: _.nin(['closed']) }).count();
          if (conflictR.total > 0) {
            return { ok: false, code: 'openid_conflict', msg: '当前微信账号已绑定其他用户,请先退出登录或用原账号登录' };
          }
          await col('user_account').doc(u._id).update({ data: { openid, updated_at: Date.now() }});
          u.openid = openid;
        }
        return { ok: true, data: { user: safeUserDoc(u) } };
      } catch (e) {
        log.d(`password_login error: ${e.message}`);
        return { ok: false, code: 'login_fail', msg: '登录失败,请稍后重试' };
      }
    }

    // 公开配置读取(无身份校验, 返回 payment_visible 等审核/运营开关)
    case 'global_config': {
      const cfg = await getConfig();
      return { ok: true, data: {
        payment_visible: cfg.payment_visible !== false,
        block_words: cfg.block_words || [],
        scene_list: cfg.scene_list || []
      }};
    }

    default:
      return { ok: false, code: 'login_unknown_action', msg: '未知动作' };
  }
  } catch (e) {
    log.d(`user-login unhandled action=${action}:`, e && e.message);
    return { ok: false, code: 'login_server_error', msg: '服务繁忙,请稍后重试' };
  }
};
