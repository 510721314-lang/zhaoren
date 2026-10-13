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
  require('./action_auth')
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

    // 1. 登录(自动建号,幂等)
    case 'login': {
      try {
        const r = await col('user_account').where({ openid }).limit(1).get();
        if (r.data && r.data.length > 0) {
          const u = r.data[0];
          await maybeRestoreSuspend(u);   // 断链②: 停用到期惰性恢复(停用中不拦登录)
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
          await writeAudit(db, log, {
            openid, role: 'user', category: 'auth', action: 'login',
            target_type: 'user_account', target_id: u._id || '',
            detail: { is_new: false }, result: 'ok', client_ip: clientIp, device
          });
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
        await writeAudit(db, log, {
          openid, role: 'user', category: 'auth', action: 'login',
          target_type: 'user_account', target_id: addRes._id || '',
          detail: { is_new: true, register_source: 'mvp' }, result: 'ok', client_ip: clientIp, device
        });
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
        const bp = await phoneKeyAndPatch(rp.phone);
        await col('user_account').where({ openid }).update({ data: Object.assign({ updated_at: Date.now() }, bp.patch) });
        return { ok: true, data: { phone: phoneCrypt.maskPhone(rp.phone) } };
      } catch (e) {
        return { ok: false, code: 'phone_save_fail', msg: '手机号保存失败' };
      }
    }

    // 4. 绑定身份证(18 位校验位 + 计算年龄 + <18 拒绝; AES-256-GCM 加密落库)
    // 安全: 仅加密存证, 不置 is_realname_done —— 实名通过态只能由 submit_realname(人脸核验链路) 置位,
    //       防"只填身份证号即绕过实名"(is_partner/apply/partner_detail 均以该字段为实名门)
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
          age, updated_at: Date.now()
          // 注意: 不再置 is_realname_done, 实名通过态仅由 submit_realname 置位
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
      // 人脸模式守卫: mock 通道仅 dev 环境放行(env 为唯一权威开关, fail-closed);
      // prod 下无论 face_mode 配置漂移到何值, 模拟人脸一律拒绝 —— 防 mock 人脸洗成"正式实名+签名留证"的证据污染
      // TODO(最后一步): 接入真实人脸时需重构为 mock(dev)/wx(prod)/拒绝 三分支, 仅改 face_mode 配置不会自动开通真实核验
      const envNow = getCachedEnv();
      const faceMode = String(config.realname_face_mode || 'mock');
      if (faceMode !== 'mock' || envNow !== 'dev') {
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
      await writeAudit(db, log, {
        openid, role: 'user', category: 'auth', action: 'submit_realname',
        target_type: 'disclaimer_signature', target_id: evidenceId,
        detail: { method: 'mock_face', face_mode: faceMode, age, name_masked: name.slice(0, 1) + '**' },
        evidence_id: evidenceId, doc_hash: docs[0] ? docs[0].hash : '',
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { user: u2 ? safeUserDoc(u2) : null, evidence_id: evidenceId } };
    }

    // 4.5 模拟实名认证(测试期专用: 仅 dev 环境可用, env 为唯一权威开关 fail-closed)
    // prod 下任意用户(含真实 OPENID)一律拒绝, 防一键自授权实名绕过人脸核验
    case 'simulate_realname': {
      if (getCachedEnv() !== 'dev') {
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
      await writeAudit(db, log, {
        openid, role: 'user', category: 'auth', action: 'simulate_realname',
        target_type: 'user_account', target_id: u ? u._id : '',
        detail: { simulated: true, face_mode: 'mock' }, result: 'ok', client_ip: clientIp, device
      });
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
      // 合规硬约束: 紧急联系人每 30 天最多变更 1 次(首次设置豁免)
      const EMERGENCY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
      try {
        const meR = await col('user_account').where({ openid }).limit(1).get();
        const me = (meR.data && meR.data[0]) || null;
        const lastChanged = me && me.emergency_changed_at;
        const cd = evalEmergencyCooldown(lastChanged, Date.now(), EMERGENCY_COOLDOWN_MS);
        if (cd.blocked) {
          const nextAt = new Date(cd.nextAtMs);
          const nextStr = `${nextAt.getFullYear()}-${String(nextAt.getMonth() + 1).padStart(2, '0')}-${String(nextAt.getDate()).padStart(2, '0')}`;
          return { ok: false, code: 'emergency_too_frequent', msg: `紧急联系人每30天仅可变更1次, ${nextStr} 后可再次修改` };
        }
      } catch (e) {
        return { ok: false, code: 'emergency_save_fail', msg: '紧急联系人保存失败' };
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
        // 记录变更时间(30 天频控窗口起点)
        await col('user_account').where({ openid }).update({ data: { emergency_changed_at: now } });
        // 变更通知留痕: 原联系人收到通知的合规要求, 真实短信通道随企业资质最后一步接入;
        // 现阶段落审计 + system_notice 证据链, 提审演示可说明
        const oldMasked = existDocs.map((d) => ({ name: d.name || '', phone: maskPhone(d.phone || '') }));
        await writeAudit(db, log, {
          openid, role: 'user', category: 'account', action: 'emergency_contact_change',
          target_type: 'user_account', target_id: (me && me._id) || '',
          detail: { old_contacts: oldMasked, new_count: contacts.length },
          result: 'ok', client_ip: clientIp, device
        });
        try {
          await col('system_notice').add({ data: {
            to_openid: openid, type: 'emergency_contact_changed',
            title: '紧急联系人已变更',
            content: `您的紧急联系人已变更为 ${contacts.map((c) => c.name).join('、')}。`,
            read: false, created_at: now, updated_at: now, is_deleted: false
          }});
        } catch (e) { log.d(`emergency notice fail: ${e.message}`); }
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
        await writeAudit(db, log, {
          openid, role: 'user', category: 'account', action: 'close_account',
          target_type: 'user_account', target_id: uid || '',
          detail: { anonymized: true }, result: 'ok', client_ip: clientIp, device
        });
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
        await maybeRestoreSuspend(u);   // 断链②: 停用到期惰性恢复(停用中不拦登录)
        if (u.status === 'frozen') return { ok: true, data: { found: true, frozen: true, msg: '账号已冻结' } };
        if (u.status === 'banned') return { ok: true, data: { found: true, banned: true, msg: '账号已封禁' } };
        if (u.status === 'closed') return { ok: true, data: { found: true, closed: true, msg: '账号已注销' } };
        return { ok: true, data: { found: true, user: safeUserDoc(u) } };
      } catch (e) {
        return { ok: false, code: 'peek_fail', msg: '查询失败' };
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
