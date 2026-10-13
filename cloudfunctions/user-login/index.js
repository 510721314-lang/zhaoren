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
const { writeAudit } = require('./audit');
// (2026-10-13) 留存负债闭环: 失败计数(密码/SMS)改原子自增+条件写后, passwordFailPatch 不再被本文件使用
const { evalPasswordLock, evalEmergencyCooldown } = require('./security_policy');

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

// ─────────────── 手机号加密(评审整改 P0-3, 2026-10-12) ───────────────
// 规范源 _shared/phone_crypt.js(修改后跑 sync-phone-crypt.ps1 同步三副本); 禁止明文落库。
// 密钥 admin_config.phone_aes_key(64 hex), 首次写号时 lazy 生成并写回(与 idcard_aes_key 同法)。
// 落库 phone_enc(密文) + phone_hash(HMAC 确定性查询键) + phone_mask(展示掩码); 查询一律用 phone_hash。
const phoneCrypt = require('./phone_crypt');
async function ensurePhoneKey() {
  const cfg = await getConfig();
  if (phoneCrypt.isHexKey(cfg.phone_aes_key)) return cfg.phone_aes_key;
  const key = crypto.randomBytes(32).toString('hex');
  try {
    await col('admin_config').where({ _id: 'global' }).update({
      data: { phone_aes_key: key, updated_at: Date.now() }
    });
    return key;
  } catch (e) {
    // 并发首次写号落败: 重读拿到另一方写入的 key
    const r = await col('admin_config').doc('global').get().catch(() => ({ data: {} }));
    const k = r.data && r.data.phone_aes_key;
    if (phoneCrypt.isHexKey(k)) return k;
    throw new Error('phone_key_unavailable');
  }
}
// 生成写补丁(加密三字段 + 清除存量明文 phone) 并给出确定性查询键
async function phoneKeyAndPatch(plain) {
  const key = await ensurePhoneKey();
  const patch = Object.assign(phoneCrypt.phonePatch(plain, key), { phone: _.remove() });
  return { key, patch, hash: patch.phone_hash };
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
    log.w('msgSecCheck fail(降级本地词库):', (e && (e.errCode || e.errMsg || e.message)) || '');
    // 降级:本地词库
    const hit = (blockWords || []).find(w => text.indexOf(w) >= 0);
    return { pass: !hit, msg: hit ? '内容包含敏感词' : '', fallback: true };
  }
}

// 获取运营参数(本地兜底词库等)
async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    return r.data || { block_words: ['加微信', '加V', '转账', '私聊我', '威信', 'VX', 'vx', '加我vx', '扣扣', 'QQ号', '支付宝', '口令红包', '站外交易', '线下转账'] };
  } catch (e) { return { block_words: ['加微信', '加V', '转账', '私聊我', '威信', 'VX', 'vx', '加我vx', '扣扣', 'QQ号', '支付宝', '口令红包', '站外交易', '线下转账'] }; }
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
    age: u.age, status: u.status, phone: phoneCrypt.displayPhone(u),
    idcard_masked: u.idcard_mask || (u.idcard ? maskIdCard(u.idcard) : ''),
    register_source: u.register_source,
    // 地图即时定位共享开关(双向对称: 允许 TA 通过地图找到我; 默认关闭, 隐私)
    allow_map_share: u.allow_map_share === true,
    created_at: u.created_at, updated_at: u.updated_at
  };
}

// 断链②修复(第三批爽约): 停用到期惰性恢复(在登录读取用户处调用)。
// 停用中不拦截登录(保证在途履约/申诉举证可进行); 仅在 status='suspended' 且已到期
//(或 suspend_until 缺失, 视为历史异常数据按已到期处理)时写回 normal 并通知。
async function maybeRestoreSuspend(u) {
  if (!u || u.status !== 'suspended') return u;
  const until = Number(u.suspend_until) || 0;
  if (until > Date.now()) return u;
  const now = Date.now();
  try {
    // 条件更新: 并发登录时只有一方真正写回, 通知不重复发
    const r = await col('user_account').where({ _id: u._id, status: 'suspended' }).update({ data: {
      status: 'normal', suspend_restored_at: now, updated_at: now
    }});
    if (r && r.stats && r.stats.updated > 0) {
      await col('system_notice').add({ data: {
        to_openid: u.openid, type: 'account_restored',
        title: '账号已恢复', body: '账号停用期已结束,已恢复',
        read: false, created_at: now, updated_at: now, is_deleted: false
      }});
    }
  } catch (e) { log.d(`restore suspend fail: ${e && e.message}`); }
  u.status = 'normal';   // 写回失败也按已到期放行(fail-open: 处罚已到期, 不阻塞登录)
  return u;
}

// ── 地图即时定位共享辅助 ──
function pickGps(u) {
  const g = u && u.map_gps;
  if (!g || !Number.isFinite(Number(g.lat)) || !Number.isFinite(Number(g.lng))) return null;
  return { lat: Number(g.lat), lng: Number(g.lng), at: Number(g.at) || 0 };
}
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ─────────────── 短信验证码 / 手机号解析辅助(模块级, 禁止放进 switch 内) ───────────────
// 手机号 11 位校验
const PHONE_RE = /^1\d{10}$/;
// 生成 6 位数字验证码(CSPRNG, 安全基线: 禁止 Math.random)
function genSmsCode() {
  return String(crypto.randomInt(100000, 1000000));
}
// 短信验证码防爆破: 连续失败 5 次锁定 10 分钟
const SMS_MAX_FAIL = 5;
const SMS_LOCK_MS = 10 * 60 * 1000;
// 密码登录防爆破: 与短信同策略(5 次/10 分钟)
const PWD_MAX_FAIL = 5;
const PWD_LOCK_MS = 10 * 60 * 1000;
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
      log.w('resolvePhone getPhoneNumber fail:', e.errCode, e.errMsg);
      return { ok: false, code: 'phone_decrypt_fail', msg: '手机号获取失败:' + (e.errMsg || '请重试') };
    }
  }
  if (phone && sms_code) {
    if (!PHONE_RE.test(phone)) return { ok: false, code: 'phone_format', msg: '手机号格式有误' };
    try {
      const r = await col('user_account').where({ openid: callerOpenid }).limit(1).get();
      const u = r.data && r.data.length > 0 ? r.data[0] : null;
      if (!u) return { ok: false, code: 'sms_no_user', msg: '请先获取验证码' };
      // 防爆破锁定检查放最前(fail-closed: 锁定中一律拒绝, 提示明确)
      if (u.sms_lock_until && u.sms_lock_until > Date.now()) {
        return { ok: false, code: 'sms_locked', msg: '验证码错误次数过多,请10分钟后再试' };
      }
      // sms_target 现为手机号 HMAC(新写入); 兼容存量明文 shell
      const targetHash = phoneCrypt.phoneHash(phone, await ensurePhoneKey());
      if (!u.sms_code || !u.sms_target || (u.sms_target !== targetHash && u.sms_target !== phone)) {
        return { ok: false, code: 'sms_no_code', msg: '未发送验证码或手机号不匹配' };
      }
      if (u.sms_expire_at < Date.now()) {
        return { ok: false, code: 'sms_expired', msg: '验证码已过期' };
      }
      if (u.sms_code !== sms_code) {
        // 失败计数原子 +1(2026-10-13 留存负债闭环, 与密码防爆破同口径);
        // 达上限由「条件写」置锁并作废验证码(仅当计数≥阈值才命中, 并发下幂等)
        await col('user_account').doc(u._id).update({ data: { sms_fail_count: _.inc(1), updated_at: Date.now() } })
          .catch((e) => { log.w('sms fail 计数写入失败:', e && e.message); });
        await col('user_account').where({ _id: u._id, sms_fail_count: _.gte(SMS_MAX_FAIL) })
          .update({ data: { sms_lock_until: Date.now() + SMS_LOCK_MS, sms_code: '', sms_expire_at: 0, sms_target: '' } })
          .catch(() => {});
        return { ok: false, code: 'sms_wrong', msg: '验证码错误' };
      }
      // 验证通过, 消耗验证码、清零失败计数并写入手机号(加密落库, 不写明文)
      const smsPatch = await phoneKeyAndPatch(phone);
      await col('user_account').doc(u._id).update({
        data: Object.assign({ sms_code: '', sms_expire_at: 0, sms_target: '', sms_fail_count: 0, sms_lock_until: 0, updated_at: Date.now() }, smsPatch.patch)
      });
      return { ok: true, phone };
    } catch (e) {
      log.d('resolvePhone sms verify fail:', e && e.message);
      return { ok: false, code: 'sms_verify_fail', msg: '验证码校验失败,请稍后重试' };
    }
  }
  return { ok: false, code: 'phone_missing', msg: '请提供 getPhoneNumber 授权或手机号+验证码' };
}

// ── 物理拆分: action 分发表(同级 action_*.js; handler 经 ctx 注入共享符号, 禁 require('./index')) ──
const HANDLERS = Object.assign({},
  require('./action_map'),
  require('./action_auth'),
  require('./action_account'),
  require('./action_misc')
);

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'login_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`user-login action=${action} openid=${openid}`);

  // 审计留痕公共字段(IP 取自微信侧上下文, 设备由端上透传)
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  // 总保险: 任何未预期异常都转成 JSON 业务错误, 避免云函数崩溃让客户端收到"网络异常"
  try {
  // 物理拆分分发: 命中 HANDLERS 的 action 走同级 handler(等价于下方同名单一 case, 行为逐字不变)
  if (HANDLERS[action]) {
    const ctx = {
      event, openid, clientIp, device,
      db, col, _, log, writeAudit,
      // 地图组
      pickGps, haversineMeters,
      // 认证组(短信/手机/密码)
      cloud, crypto, phoneCrypt, ensurePhoneKey, phoneKeyAndPatch, genSalt, hashPassword,
      evalPasswordLock, evalEmergencyCooldown,
      PHONE_RE, genSmsCode, SMS_MAX_FAIL, SMS_LOCK_MS, PWD_MAX_FAIL, PWD_LOCK_MS,
      resolvePhone, logCredit, safeUserDoc, maybeRestoreSuspend,
      // 账号/资料组
      getConfig, devAllowSimulatedRealname, safeCheckText,
      ACCOUNT_RE, PASSWORD_RE, ACTIVE_ORDER_STATUS,
      ID_WEIGHTS, ID_CHECK, isValidIdCard, calcAgeFromIdCard,
      maskPhone, maskIdCard, ensureIdcardKey, encryptIdCard,
      DEFAULT_SERVICE_AGREEMENT, DEFAULT_AA_PROMISE
    };
    return await HANDLERS[action](ctx);
  }
  switch (action) {

    default:
      return { ok: false, code: 'login_unknown_action', msg: '未知动作' };
  }
  } catch (e) {
    log.d(`user-login unhandled action=${action}:`, e && e.message);
    return { ok: false, code: 'login_server_error', msg: '服务繁忙,请稍后重试' };
  }
};
