// action_auth.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 发送短信验证码: 给指定 phone 发 6 位验证码, 存当前 openid 的 user_account(无则自动建空壳)
    // 开发期: console.log 打出来(模拟发送) 生产期: 接腾讯云 SMS
async function send_sms_code_action(ctx) {
  const { event, openid, clientIp, device, cloud, col, log, phoneCrypt, ensurePhoneKey, PHONE_RE, genSmsCode } = ctx;
      const { phone } = event;
      if (!PHONE_RE.test(phone)) return { ok: false, code: 'phone_format', msg: '手机号格式有误' };
      try {
        // 查 openid 下是否已有 user_account: 没有就建空壳(phone_register/login 会填充完整数据)
        let r = await col('user_account').where({ openid }).limit(1).get();
        // 重发冷却 60s(安全基线: 防短信轰炸/刷码); 以 sms_expire_at 倒推上次发送时间
        if (r.data && r.data.length > 0) {
          const lastSentAt = (r.data[0].sms_expire_at || 0) - 5 * 60 * 1000;
          if (lastSentAt > 0 && Date.now() - lastSentAt < 60 * 1000) {
            return { ok: false, code: 'sms_too_frequent', msg: '发送太频繁,请60秒后再试' };
          }
        }
        const code = genSmsCode();
        const expireAt = Date.now() + 5 * 60 * 1000; // 5 分钟
        // sms_target 只存手机号的确定性 HMAC(不落明文), 便于验证时比对且不残留 PII
        const smsTarget = phoneCrypt.phoneHash(phone, await ensurePhoneKey());
        let docId;
        if (r.data && r.data.length > 0) {
          docId = r.data[0]._id;
          await col('user_account').doc(docId).update({ data: {
            sms_code: code, sms_expire_at: expireAt, sms_target: smsTarget, updated_at: Date.now()
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
            phone: '', sms_code: code, sms_expire_at: expireAt, sms_target: smsTarget,
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
async function phone_login_action(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, phoneKeyAndPatch, logCredit, safeUserDoc, maybeRestoreSuspend, resolvePhone } = ctx;
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
          await maybeRestoreSuspend(u);   // 断链②: 停用到期惰性恢复(停用中不拦登录)
          if (u.status === 'frozen') return { ok: false, code: 'login_account_frozen', msg: '账号已冻结,请联系管理员' };
          if (u.status === 'banned') return { ok: false, code: 'login_account_banned', msg: '账号已封禁,请联系客服' };
          if (u.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '该账号已注销' };
          const pp = await phoneKeyAndPatch(phone);
          // 未迁移(无 phone_enc)或号码变更 → 以密文三字段覆盖并清除明文(惰性迁移)
          if (!u.phone_enc || u.phone_hash !== pp.hash) {
            await col('user_account').doc(u._id).update({ data: Object.assign({ updated_at: Date.now() }, pp.patch) });
            u.phone_enc = pp.patch.phone_enc; u.phone_hash = pp.patch.phone_hash; u.phone_mask = pp.patch.phone_mask; u.phone = '';
          }
          await writeAudit(db, log, {
            openid, role: 'user', category: 'auth', action: 'phone_login',
            target_type: 'user_account', target_id: u._id || '',
            detail: { path: 'openid_match' }, result: 'ok', client_ip: clientIp, device
          });
          return { ok: true, data: { user: safeUserDoc(u) } };
        }
        // 2. openid 下无正式账号: 按手机号查正式账号(换设备/换微信登录后重绑定); 排除 phone_pending 空壳
        // 查询用确定性 HMAC 键(phone_hash); 未迁移的存量文档(仅明文)回退明文查询, 保证登录不断
        const pp2 = await phoneKeyAndPatch(phone);
        let phoneR = await col('user_account').where({ phone_hash: pp2.hash }).get();
        if (!(phoneR.data && phoneR.data.length)) {
          phoneR = await col('user_account').where({ phone }).get();
        }
        const real = (phoneR.data || []).find(x => x.register_source !== 'phone_pending');
        if (real) {
          await maybeRestoreSuspend(real);   // 断链②: 停用到期惰性恢复(停用中不拦登录)
          if (real.status === 'frozen') return { ok: false, code: 'login_account_frozen', msg: '账号已冻结' };
          if (real.status === 'banned') return { ok: false, code: 'login_account_banned', msg: '账号已封禁' };
          if (real.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '该账号已注销' };
          // 重绑定 openid 到正式账号(同时把手机号迁移为密文落库)
          await col('user_account').doc(real._id).update({ data: Object.assign({ openid, updated_at: Date.now() }, pp2.patch) });
          real.openid = openid; real.phone = '';
          real.phone_enc = pp2.patch.phone_enc; real.phone_hash = pp2.patch.phone_hash; real.phone_mask = pp2.patch.phone_mask;
          // 清理当前 openid 下的短信空壳, 避免同一手机号出现两条记录
          if (pendingShellId) {
            await col('user_account').doc(pendingShellId).remove();
          }
          await writeAudit(db, log, {
            openid, role: 'user', category: 'auth', action: 'phone_login',
            target_type: 'user_account', target_id: real._id || '',
            detail: { path: 'phone_rebind' }, result: 'ok', client_ip: clientIp, device
          });
          return { ok: true, data: { user: safeUserDoc(real) } };
        }
        // 3. 既无 openid 正式账号也无手机号正式账号: 一键登录语义 → 自动注册
        //    (用户已完成 getPhoneNumber 授权或短信验证, 且前端已校验勾选协议)
        const now = Date.now();
        const pp3 = await phoneKeyAndPatch(phone);
        const baseData = {
          nickname: '微信用户', avatar: '',
          roles: ['user'],
          user_credit_score: 800, partner_credit_score: 800,
          is_realname_done: false, is_realname_simulated: true,
          age: null, status: 'normal',
          register_source: 'phone',
          updated_at: now,
          phone_enc: pp3.patch.phone_enc, phone_hash: pp3.patch.phone_hash, phone_mask: pp3.patch.phone_mask
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
        await writeAudit(db, log, {
          openid, role: 'user', category: 'auth', action: 'phone_login',
          target_type: 'user_account', target_id: newId || '',
          detail: { is_new: true, path: 'auto_register' }, result: 'ok', client_ip: clientIp, device
        });
        return { ok: true, data: { user: safeUserDoc(filledR.data), is_new: true } };
      } catch (e) {
        log.d(`phone_login db error: ${e.message}`);
        return { ok: false, code: 'login_fail', msg: '登录失败,请稍后重试' };
      }
}

    // 手机号快捷注册: 只建新账号, 不允许已有账号再走这个入口
async function phone_register_action(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, phoneKeyAndPatch, logCredit, safeUserDoc, resolvePhone } = ctx;
      const rp = await resolvePhone(event, openid);
      if (!rp.ok) return { ok: false, code: rp.code, msg: rp.msg };
      const phone = rp.phone;
      try {
        // 查 phone 是否已被正式账号占用(用确定性 hash 键; 未迁移存量回退明文查询)
        const regPatch = await phoneKeyAndPatch(phone);
        let phoneAll = await col('user_account').where({ phone_hash: regPatch.hash }).get();
        if (!(phoneAll.data && phoneAll.data.length)) {
          phoneAll = await col('user_account').where({ phone }).get();
        }
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
              register_source: 'phone',
              updated_at: now,
              phone_enc: regPatch.patch.phone_enc, phone_hash: regPatch.patch.phone_hash, phone_mask: regPatch.patch.phone_mask
            }});
            await logCredit(openid, 'init', 0, 800, 'phone register init credit');
            const updated = Object.assign({}, u, { nickname: '微信用户', roles: ['user'], user_credit_score: 800, partner_credit_score: 800, register_source: 'phone', phone: '', phone_enc: regPatch.patch.phone_enc, phone_hash: regPatch.patch.phone_hash, phone_mask: regPatch.patch.phone_mask, status: 'normal' });
            log.d(`phone register filled pending shell: ${openid}`);
            await writeAudit(db, log, {
              openid, role: 'user', category: 'auth', action: 'phone_register',
              target_type: 'user_account', target_id: u._id || '',
              detail: { is_new: true, register_source: 'phone', path: 'fill_pending' },
              result: 'ok', client_ip: clientIp, device
            });
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
          register_source: 'phone',
          created_at: now, updated_at: now, is_deleted: false,
          phone_enc: regPatch.patch.phone_enc, phone_hash: regPatch.patch.phone_hash, phone_mask: regPatch.patch.phone_mask
        };
        const addRes = await col('user_account').add({ data: newUser });
        await logCredit(openid, 'init', 0, 800, 'phone register init credit');
        newUser._id = addRes._id;
        log.d(`phone register new user: ${openid}`);
        await writeAudit(db, log, {
          openid, role: 'user', category: 'auth', action: 'phone_register',
          target_type: 'user_account', target_id: addRes._id || '',
          detail: { is_new: true, register_source: 'phone' }, result: 'ok', client_ip: clientIp, device
        });
        return { ok: true, data: { user: safeUserDoc(newUser), is_new: true } };
      } catch (e) {
        log.d(`phone_register db error: ${e.message}`);
        return { ok: false, code: 'register_fail', msg: '注册失败,请稍后重试' };
      }
}

    // 10. 账号密码注册: 要求当前 openid 已有 user_account(先微信登录建号), 设 login_account + password_hash
async function password_register_action(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, genSalt, hashPassword, ACCOUNT_RE, PASSWORD_RE } = ctx;
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
        await writeAudit(db, log, {
          openid, role: 'user', category: 'security', action: 'password_register',
          target_type: 'user_account', target_id: myR.data[0]._id || '',
          detail: { login_account }, result: 'ok', client_ip: clientIp, device
        });
        return { ok: true, data: { msg: '注册成功' } };
      } catch (e) {
        log.d(`password_register error: ${e.message}`);
        return { ok: false, code: 'register_fail', msg: '注册失败,请稍后重试' };
      }
}

    // 11. 账号密码登录: 按 login_account 查 user_account, 验密, 通过则把 openid 更新为当前环境 openid
async function password_login_action(ctx) {
  const { event, openid, clientIp, device, db, _, col, log, writeAudit, evalPasswordLock, hashPassword, ACCOUNT_RE, PASSWORD_RE, safeUserDoc, maybeRestoreSuspend, PWD_MAX_FAIL, PWD_LOCK_MS } = ctx;
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
          // 防枚举: 与密码错误同文案, 不暴露账号是否存在
          return { ok: false, code: 'password_wrong', msg: '账号或密码错误' };
        }
        const u = r.data[0];
        await maybeRestoreSuspend(u);   // 断链②: 停用到期惰性恢复(停用中不拦登录)
        if (u.status === 'frozen') return { ok: false, code: 'login_account_frozen', msg: '账号已冻结' };
        if (u.status === 'banned') return { ok: false, code: 'login_account_banned', msg: '账号已封禁' };
        if (u.status === 'closed') return { ok: false, code: 'login_account_closed', msg: '账号已注销' };
        // 没设密码(纯微信/手机号账号): 不能走这个入口
        if (!u.password_hash || !u.password_salt) {
          return { ok: false, code: 'password_not_set', msg: '该账号未设置密码,请改用微信或手机号登录' };
        }
        // 防爆破锁定(fail-closed: 锁定中一律拒绝)
        const lock = evalPasswordLock(u.pwd_fail_count, u.pwd_lock_until, Date.now());
        if (lock.locked) {
          return { ok: false, code: 'password_locked', msg: '密码错误次数过多,请10分钟后再试' };
        }
        const expectHash = hashPassword(password, u.password_salt);
        if (expectHash !== u.password_hash) {
          // 失败计数原子 +1(2026-10-13 留存负债闭环: 原读-改-写并发下会丢计数, 锁定阈值可被绕过);
          // 达上限由「条件写」置锁并清零计数(仅当计数≥阈值才命中, 并发下幂等), 写入失败留痕不阻断
          await col('user_account').doc(u._id).update({ data: { pwd_fail_count: _.inc(1), updated_at: Date.now() } })
            .catch((e) => { log.w('password_login pwd_fail 计数写入失败:', e && e.message); });
          await col('user_account').where({ _id: u._id, pwd_fail_count: _.gte(PWD_MAX_FAIL) })
            .update({ data: { pwd_lock_until: Date.now() + PWD_LOCK_MS, pwd_fail_count: 0 } })
            .catch(() => {});
          return { ok: false, code: 'password_wrong', msg: '账号或密码错误' };
        }
        // 验密通过: 清零失败计数与锁定
        if (u.pwd_fail_count || u.pwd_lock_until) {
          await col('user_account').doc(u._id).update({ data: { pwd_fail_count: 0, pwd_lock_until: 0 } });
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
        await writeAudit(db, log, {
          openid, role: 'user', category: 'auth', action: 'password_login',
          target_type: 'user_account', target_id: u._id || '',
          detail: { login_account: u.login_account || '' }, result: 'ok', client_ip: clientIp, device
        });
        return { ok: true, data: { user: safeUserDoc(u) } };
      } catch (e) {
        log.d(`password_login error: ${e.message}`);
        return { ok: false, code: 'login_fail', msg: '登录失败,请稍后重试' };
      }
}

module.exports = {
  send_sms_code: send_sms_code_action,
  phone_login: phone_login_action,
  phone_register: phone_register_action,
  password_register: password_register_action,
  password_login: password_login_action,
};
