// action_account.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 1. 登录(自动建号,幂等)
async function login_action(ctx) {
  const { event, openid, clientIp, device, db, _, col, log, writeAudit, getConfig, logCredit, safeUserDoc, maybeRestoreSuspend } = ctx;
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
async function update_profile_action(ctx) {
  const { event, openid, clientIp, device, col, safeCheckText, getConfig } = ctx;
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
async function bind_phone_action(ctx) {
  const { event, openid, clientIp, device, col, maskPhone, phoneCrypt, phoneKeyAndPatch, resolvePhone } = ctx;
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
async function bind_idcard_action(ctx) {
  const { event, openid, clientIp, device, col, isValidIdCard, calcAgeFromIdCard, maskIdCard, ensureIdcardKey, encryptIdCard } = ctx;
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
async function submit_realname_action(ctx) {
  const { event, openid, clientIp, device, cloud, crypto, db, col, log, writeAudit, isValidIdCard, calcAgeFromIdCard, maskIdCard, ensureIdcardKey, encryptIdCard, DEFAULT_SERVICE_AGREEMENT, DEFAULT_AA_PROMISE, getConfig, safeUserDoc } = ctx;
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
      // 人脸模式守卫(2026-10-21 提审期方案A, 用户批准): 以 realname_face_mode 为唯一开关, fail-closed。
      // 'mock' → 放行 mock 人脸(提审期供审核员走通实名链路); 'wx' 或键缺失(prod) → 一律拒绝。
      // 证据可追溯: verify_method='mock_face' 永久保留; prod 经 mock 实名的账号打标 is_realname_simulated=true,
      // 提审通过后只需把 realname_face_mode 回改 'wx' 关闸, 并可用 admin-action realname_reset_simulated 清除。
      // TODO(最后一步): 接入真实人脸时需重构为 mock(dev)/wx(prod)/拒绝 三分支, 仅改 face_mode 配置不会自动开通真实核验
      // env 直接取本次已读到的 config(与上方 getConfig 同源, 不走跨进程失效不掉的缓存)
      // 修复(2026-10-21): 原 getCachedEnv() 在拆分后的本文件作用域内不存在 → ReferenceError → login_server_error
      const envNow = String(config.env || '') === 'dev' ? 'dev' : 'prod';
      const faceMode = String(config.realname_face_mode || (envNow === 'dev' ? 'mock' : 'wx'));
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

      // 2026-10-27: 实名通过后若昵称仍是注册默认值('微信用户'/空)，回写为实名姓名，
      // 否则「我的」页永远显示「微信用户」（注册流程不收集昵称，update_profile 前端无入口）。
      // 已有自定义昵称的账号不覆盖。
      let curNick = '';
      try {
        const curR = await col('user_account').where({ openid }).limit(1).get();
        curNick = String(((curR.data && curR.data[0]) || {}).nickname || '').trim();
      } catch (e) {
        log.d(`realname read nickname fail: ${(e && e.message) || e}`);
      }
      const nickPatch = (!curNick || curNick === '微信用户') ? { nickname: name } : {};

      try {
        await col('user_account').where({ openid }).update({ data: Object.assign({
          real_name: name,
          idcard_enc: idcardEnc, idcard_mask: maskIdCard(id), idcard: '',
          age,
          // dev 保持 false(既有口径不变); prod 经 mock 实名打标 true, 便于提审后用 realname_reset_simulated 一键清除
          is_realname_done: true, is_realname_simulated: envNow !== 'dev',
          realname_method: 'mock_face', realname_evidence_id: evidenceId, realname_done_at: nowTs,
          updated_at: nowTs
        }, nickPatch) });
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
async function simulate_realname_action(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, safeUserDoc, getConfig } = ctx;
      // 修复(2026-10-21): 原 getCachedEnv() 在本文件作用域内不存在 → ReferenceError → login_server_error
      const cfg = await getConfig();
      if (String(cfg.env || '') !== 'dev') {
        return { ok: false, code: 'realname_mock_closed', msg: '实名认证通道暂未开放,请稍后重试' };
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

    // 7. 注销账号(软删除 + 个人信息匿名化; 有进行中订单时拒绝)
async function close_account_action(ctx) {
  const { event, openid, clientIp, device, db, _, col, log, writeAudit, ACTIVE_ORDER_STATUS } = ctx;
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
// 首页未读角标缓存(30s): peek_login 高频调用, 避免每次都多一次 system_notice count
let _unreadCache = { openid: '', at: 0, n: 0 };

async function peek_login_action(ctx) {
  const { event, openid, clientIp, device, col, _, safeUserDoc, maybeRestoreSuspend } = ctx;
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
        // 2026-10-27: 附带未读数(首页铃铛角标), 30s 缓存避免高频 peek 反复计数
        let unread = 0;
        const nowTs = Date.now();
        if (_unreadCache.openid === openid && nowTs - _unreadCache.at < 30000) {
          unread = _unreadCache.n;
        } else {
          try {
            const nr = await col('system_notice').where({ to_openid: openid, read: false, type: _.neq('error_scan') }).count();
            unread = Number(nr && nr.total) || 0;
            _unreadCache = { openid, at: nowTs, n: unread };
          } catch (e) { /* 计数失败不影响登录信息返回 */ }
        }
        return { ok: true, data: { found: true, user: Object.assign({}, safeUserDoc(u), { unread_notice: unread }) } };
      } catch (e) {
        return { ok: false, code: 'peek_fail', msg: '查询失败' };
      }
}

module.exports = {
  login: login_action,
  update_profile: update_profile_action,
  bind_phone: bind_phone_action,
  bind_idcard: bind_idcard_action,
  submit_realname: submit_realname_action,
  simulate_realname: simulate_realname_action,
  close_account: close_account_action,
  peek_login: peek_login_action,
};
