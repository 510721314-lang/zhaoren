// action_publish.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 1. 发布需求
async function publish_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, db, _, col, log, writeAudit, phoneCrypt, getSceneCodes, MATCH_MODE_WHITELIST, DISCLAIMER_TYPE_MAP, SCENE_OPTIONS_FALLBACK, DEFAULT_PET_AUTHORIZATION, buildCheckboxEvidence, isMobilePhone, maskContact, verifySignatureFile, titleMaxLen, descMaxLen, checkText, genDemandNo, isServiceTimeAllowed, suspendLeftDays, haversineKm, isTestOpenid, validLngLat, getConfig, contentOptionsMax, getUser, hasEmergencyContact, isValidDocId } = ctx;
      const {
        scene, start_time, duration_h, location, publish_location, content_option, content_options,
        remark, title, description, rate_fen, aa_tier, aa_promise_checked,
        match_mode, disclaimer_signed, target_openid, pet_auth_checked, pet_auth_signature_file_id,
        pricing_type, fixed_price_fen, project_attr,
        headcount, gender_pref,
        publish_type, service_target, proxy_signature_file_id, proxy_authorized,
        contact_phone, contact_phone_source,
        client_request_id
      } = event;
      // 计价模式归一化(缺省 hourly 兼容存量; 未传 project_attr 视为商业)
      const pricingType = pricing_type === 'fixed' ? 'fixed' : 'hourly';
      const projectAttr = project_attr === 'public_welfare' ? 'public_welfare' : 'commercial';
      const isWelfare = projectAttr === 'public_welfare';

      // ── 基础校验 ──
      const sceneCodes = await getSceneCodes();
      if (!scene || sceneCodes.indexOf(scene) < 0) {
        return { ok: false, code: 'publish_scene_invalid', msg: '场景不在白名单' };
      }
      // 接单模式(默认抢单 broadcast; 选单 select 需耍伴报名→需求者确认)
      const mode = MATCH_MODE_WHITELIST.indexOf(match_mode) >= 0 ? match_mode : 'broadcast';
      if (!start_time || typeof start_time !== 'number' || start_time <= Date.now()) {
        return { ok: false, code: 'publish_start_time', msg: '开始时间必须是未来时间戳' };
      }
      // 服务时间距发布最长 30 天(产品反馈硬规则)
      const MAX_ADVANCE_MS = 30 * 24 * 3600 * 1000;
      if (start_time > Date.now() + MAX_ADVANCE_MS) {
        return { ok: false, code: 'publish_time_too_far', msg: '服务时间距发布时间不能超过 30 天' };
      }
      // 服务端时间红线(R1, 与前端 redline.js 同口径, 防绕过): 00:00-06:00 不可预约
      // close_min=0 语义为全天开放; config 稍后并行拉取, 此处先读原始 event 校验, 完整 config 在下方二次强校验
      if (!isServiceTimeAllowed(start_time)) {
        return { ok: false, code: 'publish_redline', msg: '00:00-06:00 为休息时段,请选择 06:00 后的服务时间' };
      }
      if (!duration_h || duration_h < 1 || duration_h > 12) {
        return { ok: false, code: 'publish_duration', msg: '时长需 1-12 小时' };
      }
      // 时薪模式才校验 rate_fen; 一口价/公益用 fixed_price_fen, 不传 rate_fen 合法
      if (pricingType === 'hourly' && !isWelfare) {
        if (!rate_fen || typeof rate_fen !== 'number' || rate_fen < 100) {
          return { ok: false, code: 'publish_rate', msg: '时薪金额格式有误' };
        }
      }
      // 履约地点: MVP 阶段只校验 name 非空, 经纬度可选(隐私指引审核期间用户无法选点, 允许 0)
      if (!location || !location.name) {
        return { ok: false, code: 'publish_location', msg: '请填写履约地点名称' };
      }
      // 发布地址(发布者当前精确 GPS, 只读留痕且不可手改):
      // 这里只解析, 强校验(必须真实坐标/与履约地距离)在 config 读取后执行; 禁止再用履约地兜底
      const pubLoc = (publish_location
        && validLngLat(Number(publish_location.latitude), Number(publish_location.longitude)))
        ? {
            name: publish_location.name || '当前位置',
            latitude: Number(publish_location.latitude),
            longitude: Number(publish_location.longitude),
            city: publish_location.city
          }
        : null;
      // 服务端自测链路(mock_openid 且无真实 OPENID)无定位, 沿用旧兜底以免阻断自动化回归
      const isMockCall = !wxCtx.OPENID && !!event.mock_openid;
      if (!aa_tier) {
        return { ok: false, code: 'publish_aa_tier', msg: '请选择 AA 档位' };
      }
      // AA 承诺书必勾(rules.md 三.6 · 服务端兜底,不勾不能提交)
      if (!aa_promise_checked) {
        return { ok: false, code: 'publish_aa_promise', msg: '请先阅读并勾选《线下费用自理承诺书》' };
      }
      // 场景免责声明必勾(code.html 第一道防线·需求者下单前签署)
      if (!disclaimer_signed) {
        return { ok: false, code: 'publish_disclaimer', msg: '请先阅读并勾选《场景免责声明》' };
      }
      // W9 宠物照料授权(PRD R9: 「明确授权」须留存电子凭证, 无凭证视为未授权不得履约)
      // 凭证 = 授权书全文 + 本人手写签字图(服务端下载复算 SHA-256); 缺签字图视为未完成授权
      let petSignature = null;
      if (scene === 'W9') {
        if (!pet_auth_checked) {
          return { ok: false, code: 'publish_pet_auth_required', msg: 'W9 宠物陪伴需先确认《宠物照料授权书》' };
        }
        petSignature = await verifySignatureFile(pet_auth_signature_file_id);
        if (!petSignature.ok) {
          return { ok: false, code: 'publish_pet_auth_sign_required', msg: '请完成《宠物照料授权书》手写签字后重试' };
        }
      }

      // ── 发布类型(需求②代他人发布): self=自己 / proxy=代他人; 代理关系必须留手写签字授权凭据 ──
      // PRD W8 禁止代签法律文件但允许"代老人/未成年人代为下单"场景, 代理授权须签字存证(kind=proxy_authorization)。
      const PUBLISH_TYPE_WHITELIST = ['self', 'proxy'];
      const publishType = PUBLISH_TYPE_WHITELIST.indexOf(publish_type) >= 0 ? publish_type : 'self';
      let proxySignature = null;
      if (publishType === 'proxy') {
        if (!proxy_authorized) {
          return { ok: false, code: 'publish_proxy_authorized', msg: '代他人发布需先确认《委托授权书》' };
        }
        if (!service_target || !service_target.name) {
          return { ok: false, code: 'publish_proxy_target', msg: '请填写被代发人姓名' };
        }
        if (!service_target.relation) {
          return { ok: false, code: 'publish_proxy_target', msg: '请选择与本人的关系' };
        }
        if (service_target.relation === '其他' && !String(service_target.relation_note || '').trim()) {
          return { ok: false, code: 'publish_proxy_target', msg: '请填写关系补充说明' };
        }
        // 电话: 兼容旧入参名 phone_mask; 存储升级为真号(phone), 输出层一律脱敏
        if (!isMobilePhone(service_target.phone || service_target.phone_mask)) {
          return { ok: false, code: 'publish_proxy_phone', msg: '请填写正确的手机号' };
        }
        proxySignature = await verifySignatureFile(proxy_signature_file_id);
        if (!proxySignature.ok) {
          return { ok: false, code: 'publish_proxy_sign_required', msg: '请完成《委托授权书》手写签字后重试' };
        }
      }

      // ── 需求规模/性别偏好归一化(publish 分支此前漏写, 本次补齐; 默认语义与 update 分支一致) ──
      const headcountN = (Number.isInteger(Number(headcount)) && headcount >= 1 && headcount <= 10)
        ? Number(headcount) : 1;
      const genderPref = (typeof gender_pref === 'string' && gender_pref.trim())
        ? gender_pref.trim().slice(0, 10) : '不限';

      // 并行拉取 配置/用户/紧急联系人(减少串行往返, 冷启动也能压进超时)
      const [config, user, hasEC] = await Promise.all([
        getConfig(), getUser(openid), hasEmergencyContact(openid)
      ]);
      if (!user) return { ok: false, code: 'publish_no_user', msg: '用户不存在,请先登录' };

      // ── 联系手机号(所有需求必填): source=account 取账户已绑号(服务端直取, 不信任前端); custom 走 11 位格式校验 ──
      const PHONE_11_RE = /^1[3-9]\d{9}$/;
      let contactPhone = '';
      if (contact_phone_source === 'account') {
        // 账户已绑号现为 AES 密文存储(P0-3): 解密取真号(兼容存量明文), 仍按原口径落 demand.contact_phone
        const _cfgP = await getConfig();
        contactPhone = String(phoneCrypt.readPhone(user, _cfgP && _cfgP.phone_aes_key) || '').trim();
        if (!PHONE_11_RE.test(contactPhone)) {
          return { ok: false, code: 'publish_contact_required', msg: '账户未绑定手机号, 请手动填写联系手机号' };
        }
      } else {
        contactPhone = String(contact_phone || '').trim();
        if (!PHONE_11_RE.test(contactPhone)) {
          return { ok: false, code: 'publish_contact_required', msg: '请填写正确的 11 位联系手机号' };
        }
      }

      // 服务端时间红线二次强校验(带完整 admin_config, 与前端 redline.js 同口径)
      if (!isServiceTimeAllowed(start_time, config)) {
        return { ok: false, code: 'publish_redline', msg: '00:00-06:00 为休息时段,请选择 06:00 后的服务时间' };
      }

      // 平台总开关: 核心交易维护中, 阻断发布/编辑需求(与 order-create、C 端入口守卫口径一致)
      if (config.switch_access === false) {
        return { ok: false, code: 'access_disabled', msg: '平台维护中,暂无法发布需求,请稍后再试' };
      }

      // ── 账号状态: 冻结/封禁统一拦截 ──
      if (user.status === 'frozen') {
        return { ok: false, code: 'publish_frozen', msg: '账号已冻结,不可发布需求' };
      }
      if (user.status === 'banned') {
        return { ok: false, code: 'publish_banned', msg: '账号已封禁,请联系客服' };
      }
      if (user.status === 'closed') {
        return { ok: false, code: 'publish_closed', msg: '账号已注销' };
      }
      // 断链②修复(第三批爽约): 停用中拦截「新发单」; 到期/缺 suspend_until 视为已恢复按 normal 放行
      const suspendDays = suspendLeftDays(user);
      if (suspendDays > 0) {
        return { ok: false, code: 'publish_suspended', msg: `账号停用中,${suspendDays}天后自动恢复` };
      }

      // ── 实名门禁(发布前必须完成实名; 测试期可在「实名认证」页模拟通过) ──
      // 不再对 is_realname_simulated 自动放行: 必须由用户显式完成认证后才置 is_realname_done
      if (!user.is_realname_done) {
        return { ok: false, code: 'publish_not_realname', msg: '请先完成实名认证后再发布需求' };
      }

      // ── 计价分支(时薪 hourly / 一口价 fixed; 公益归入 fixed 特例) ──
      // 0 是合法值, 显式判空禁 || 兜底; 区间留空(非有限数) = 不钳制
      // 青年限额/红线/时间冲突均收敛到 total_fen, 下方无需再分支
      let docPricingType, docRateFen, docFixedPriceFen, docProjectAttr, total_fen;
      docProjectAttr = projectAttr;
      if (isWelfare) {
        // 公益单: 一等公民, 归入一口价; 价格取后台 welfare_fixed_price_fen, 未配置则不可发布
        const wFen = Number(config.welfare_fixed_price_fen);
        if (!Number.isFinite(wFen)) {
          return { ok: false, code: 'publish_welfare_not_open', msg: '公益单暂未开放,请稍后再试' };
        }
        docPricingType = 'fixed';
        docFixedPriceFen = wFen;
        docRateFen = null;
        total_fen = wFen;
      } else if (pricingType === 'fixed') {
        if (!fixed_price_fen || typeof fixed_price_fen !== 'number' || fixed_price_fen <= 0) {
          return { ok: false, code: 'publish_fixed_price', msg: '一口价金额格式有误' };
        }
        const _fLo = Number(config.fixed_price_min_fen);
        const _fHi = Number(config.fixed_price_max_fen);
        if (Number.isFinite(_fLo) && fixed_price_fen < _fLo) {
          return { ok: false, code: 'publish_fixed_range', msg: `一口价需不低于 ${_fLo / 100} 元` };
        }
        if (Number.isFinite(_fHi) && fixed_price_fen > _fHi) {
          return { ok: false, code: 'publish_fixed_range', msg: `一口价需不高于 ${_fHi / 100} 元` };
        }
        docPricingType = 'fixed';
        docFixedPriceFen = fixed_price_fen;
        docRateFen = null;
        total_fen = fixed_price_fen;
      } else {
        const _pLo = Number(config.rate_min_fen);
        const _pHi = Number(config.rate_max_fen);
        const pLo = Number.isFinite(_pLo) ? _pLo : 3000;
        const pHi = Number.isFinite(_pHi) ? _pHi : 10000;
        if (rate_fen < pLo || rate_fen > pHi) {
          return { ok: false, code: 'publish_rate_range', msg: `时薪需在 ${pLo / 100}-${pHi / 100} 元/小时之间` };
        }
        docPricingType = 'hourly';
        docFixedPriceFen = null;
        docRateFen = rate_fen;
        total_fen = rate_fen * duration_h;
      }
      if (!hasEC) {
        // MVP bootstrap: 首次发布自动创建一个占位紧急联系人
        await col('emergency_contact').add({
          data: {
            openid, name: '紧急联系人', phone: '13800000000',
            relation: '家人', is_deleted: false,
            created_at: Date.now(), updated_at: Date.now()
          }
        });
      }

      // ── 信用分 ──
      if ((user.user_credit_score || 800) < (config.min_credit_place_order || 600)) {
        return { ok: false, code: 'publish_credit_low', msg: '信用分低于下单门槛,暂不能发布需求' };
      }

      // ── 发布地址强校验(发布者当前精确GPS, 只读不可手改, 防恶意虚拟定位) ──
      // mock 自测链路无 GPS 跳过; 真实客户端必须携带真实坐标
      if (!isMockCall && !pubLoc) {
        return { ok: false, code: 'publish_location_required', msg: '发布需求需要获取你的当前位置,请授权定位后重试' };
      }
      // 发布位置 ↔ 履约地直线距离 ≤ 后台阈值(默认50km); 履约地无坐标时跳过(隐私审核期允许手填地点)
      if (!isMockCall && validLngLat(Number(location.latitude), Number(location.longitude))) {
        const pubDistKm = haversineKm(
          pubLoc.latitude, pubLoc.longitude,
          Number(location.latitude), Number(location.longitude)
        );
        const maxPubKm = Number(config.publish_distance_max_km) || 50;
        if (pubDistKm > maxPubKm) {
          return {
            ok: false,
            code: 'publish_too_far',
            msg: `你当前位置距履约地点约 ${Math.round(pubDistKm)} 公里,超过 ${maxPubKm} 公里,请确认履约地点或到达当地后发布`
          };
        }
      }

      // ── 定向邀约: 必须指定一个已审核通过的耍伴, 需求不入大厅仅TA可接 ──
      if (mode === 'direct') {
        if (!target_openid || typeof target_openid !== 'string') {
          return { ok: false, code: 'publish_target_required', msg: '定向邀约缺少指定耍伴' };
        }
        if (target_openid === openid) {
          return { ok: false, code: 'publish_target_self', msg: '不能定向邀约自己' };
        }
        const tpR = await col('partner_profile')
          .where({ openid: target_openid, status: 'approved', is_deleted: _.neq(true) })
          .limit(1).get().catch(() => ({ data: [] }));
        if (!(tpR.data && tpR.data[0])) {
          return { ok: false, code: 'publish_target_invalid', msg: '指定耍伴不存在或未通过审核' };
        }
      }

      // ── 金额校验(分单位 · rules.md 三.7; total_fen 已在计价分支算出) ──
      if (typeof total_fen !== 'number' || total_fen <= 0) {
        return { ok: false, code: 'publish_total_invalid', msg: '总价计算异常' };
      }

      // ── 青少年保护(rules.md 三.10) ──
      if (user.age !== null && user.age !== undefined && user.age >= 18 && user.age <= 22) {
        if (total_fen > (config.youth_limit_fen || 20000)) {
          return { ok: false, code: 'publish_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
        }
      }

      // ── 城市(归一化: 去掉结尾「市」, 兼容「成都市」/「成都」两种写法) ──
      const normCity = (c) => String(c || '').replace(/市$/, '').trim();
      const city = normCity(location.city) || '成都';
      // 白名单: 配置缺失/为空数组时兜底「成都」(空数组是真值, 不会走 || 兜底, 需显式判空)
      let enabledCities = (Array.isArray(config.city_enabled) ? config.city_enabled : [])
        .map(normCity).filter(Boolean);
      if (enabledCities.length === 0) enabledCities = ['成都'];
      // 精确匹配优先; 容错: 城市串/地点名包含任一开通城市名也放行(防止前端解析出「川省成都」类脏值误伤)
      const locName = String((location && location.name) || '');
      const cityOk = enabledCities.indexOf(city) >= 0
        || enabledCities.some((c) => city.indexOf(c) >= 0 || locName.indexOf(c) >= 0);
      if (!cityOk) {
        return { ok: false, code: 'publish_city_disabled', msg: `当前城市未开通服务(${city})` };
      }

      // ── 子服务内容校验(多选;兼容旧版单选 content_option) ──
      let opts = Array.isArray(content_options)
        ? content_options
        : (typeof content_option === 'string' ? [content_option] : []);
      opts = Array.from(new Set(opts.map((s) => String(s || '').trim()).filter(Boolean)));
      if (opts.length === 0) {
        return { ok: false, code: 'publish_content_option', msg: '请选择服务内容' };
      }
      if (opts.length > contentOptionsMax(config)) {
        return { ok: false, code: 'publish_content_too_many', msg: `服务内容最多选择 ${contentOptionsMax(config)} 项` };
      }
      // 选项必须属于该场景(admin_config.scene_list 优先,兜底常量)
      const sceneCfg = (config.scene_list || []).find((s) => s.code === scene);
      const allowedOptions = (sceneCfg && sceneCfg.options) || SCENE_OPTIONS_FALLBACK[scene] || [];
      for (const o of opts) {
        if (allowedOptions.indexOf(o) < 0) {
          return { ok: false, code: 'publish_content_invalid', msg: `服务内容「${o}」不在该场景可选项内` };
        }
      }

      // ── 标题/详细描述字数 + 备注安全检测(msgSecCheck v2,降级违禁词 · rules.md 六) ──
      // 2026-10-18: 标题/描述上限分别后台可配(publish_title_max_len / publish_desc_max_len)
      // 新客户端分别上报 title/description → 服务端分别校验并拼回 remark 落库(展示/检索口径不变)
      // 旧客户端未传 title/description → 只传 remark 整串, 按派生总上限(标题上限+1+描述上限)兜底
      const titleStr = title != null ? String(title).trim() : '';
      const descStr = description != null ? String(description).trim() : '';
      let remarkStr;
      if (titleStr || descStr) {
        const tLimit = titleMaxLen(config);
        const dLimit = descMaxLen(config);
        if (titleStr.length > tLimit) {
          return { ok: false, code: 'publish_title_long', msg: `需求标题最长 ${tLimit} 字` };
        }
        if (descStr.length > dLimit) {
          return { ok: false, code: 'publish_desc_long', msg: `详细描述最长 ${dLimit} 字` };
        }
        remarkStr = `${titleStr}｜${descStr}`;
      } else {
        remarkStr = remark ? String(remark).trim() : '';
        const totalLimit = titleMaxLen(config) + 1 + descMaxLen(config);
        if (remarkStr.length > totalLimit) {
          return { ok: false, code: 'publish_remark_long', msg: `备注最长 ${totalLimit} 字` };
        }
      }
      if (remarkStr) {
        const chk = await checkText(openid, remarkStr, config.block_words);
        if (!chk.pass) {
          return { ok: false, code: 'publish_remark_blocked', msg: chk.reason };
        }
      }

      // ── 时间冲突校验:同用户 + 同场景 + 服务内容有交集,时间段不可重叠 ──
      const newStart = start_time;
      const newEnd = start_time + duration_h * 3600 * 1000;
      const existDemands = await col('demand').where({
        creator_openid: openid,
        scene,
        is_deleted: false,
        status: _.neq('cancelled')
      }).get();
      for (const d of existDemands.data) {
        const oldStart = d.start_time;
        const oldEnd = d.start_time + (d.duration_h || 1) * 3600 * 1000;
        // 区间重叠判定:新区间与旧区间有交集(端点相接不算冲突)
        if (!(newStart < oldEnd && oldStart < newEnd)) continue;
        // 多选口径:服务内容有交集才算冲突
        const oldOpts = (d.content_options && d.content_options.length)
          ? d.content_options
          : (d.content_option ? [d.content_option] : []);
        if (opts.some((o) => oldOpts.indexOf(o) >= 0)) {
          return { ok: false, code: 'publish_time_conflict', msg: '该时段已有同类服务需求,请调整时间' };
        }
      }

      // ── 幂等保护: 弱网重试复用 client_request_id 查重, 绝不新建第二条 ──
      // 前端草稿发布固定用草稿 _id, 无草稿用页面级缓存 uuid; 成功后清除, 失败/弱网时保留供重试复用
      if (client_request_id) {
        try {
          const dupRes = await col('demand').where({
            creator_openid: openid,
            client_request_id,
            is_deleted: false
          }).limit(1).get();
          const dup = (dupRes.data && dupRes.data[0]) || null;
          // 非删除态(排除已取消/已过期)才幂等直返; 删除态则允许重建新需求
          if (dup && dup.status && dup.status !== 'cancelled' && dup.status !== 'expired') {
            log.d(`demand idempotent hit: ${client_request_id} -> ${dup.demand_no}`);
            return {
              ok: true,
              data: { idempotent: true, demand_id: dup._id, demand_no: dup.demand_no, status: dup.status }
            };
          }
        } catch (e) {
          log.d(`demand idempotent check fail: ${(e && e.message) || e}`);  // 查重失败不阻断主流程
        }
      }

      // ── 写入 ──
      const now = Date.now();
      const demand_no = genDemandNo();
      // 免责声明类型: 优先从 admin_config.scene_list 动态读(SSOT, 复用上方 L358 sceneCfg), 兜底 LEGACY 映射
      const disclaimerType = (sceneCfg && sceneCfg.disclaimer_type) || DISCLAIMER_TYPE_MAP[scene] || 'general_disclaimer';
      const doc = {
        demand_no,
        client_request_id: client_request_id || '',   // 幂等键: 弱网重试据其查重, 避免重复建需求
        creator_openid: openid,
        scene,
        project_attr: docProjectAttr,
        start_time,
        duration_h,
        location: { name: location.name, latitude: location.latitude, longitude: location.longitude, city },
        // 发布地址: 发布时实际GPS定位(只读留痕, 不参与接单距离/通勤计算)
        // 真实调用 pubLoc 已强校验非空; mock 自测链路无GPS, 沿用履约地兜底以免阻断自动化回归
        publish_location: isMockCall
          ? { name: location.name || '当前位置', latitude: Number(location.latitude) || 0, longitude: Number(location.longitude) || 0, city }
          : {
              name: pubLoc.name || '当前位置',
              latitude: pubLoc.latitude,
              longitude: pubLoc.longitude,
              city: normCity(pubLoc.city) || city
            },
        content_option: opts[0],  // 兼容旧字段:取首项
        content_options: opts,    // 多选全量
        remark: remarkStr,
        pricing_type: docPricingType,   // hourly | fixed(含公益)
        rate_fen: docRateFen,            // hourly=分; fixed=null(不写 0)
        fixed_price_fen: docFixedPriceFen, // fixed=分; hourly=null
        total_fen,
        aa_tier,
        aa_promise_signed: !!aa_promise_checked,   // rules.md 三.6 AA承诺书(服务端已兜底校验)
        // ── 合规双签(code.html 第一道防线) ──
        disclaimer_type: disclaimerType,
        disclaimer_signed: true,
        disclaimer_signed_at: now,
        // W9 宠物照料授权电子确认凭证(PRD R9; 非 W9 恒 false)
        pet_auth_signed: scene === 'W9' ? !!pet_auth_checked : false,
        pet_auth_signed_at: (scene === 'W9' && pet_auth_checked) ? now : 0,
        // ── 需求规模/性别偏好(此前 publish 分支漏写, 本次补齐与 update 对齐) ──
        headcount: headcountN,
        gender_pref: genderPref,
        // ── 发布者联系手机号(履约联系用; 真号受限存储, 任何输出不回传; 二期接真实验证/虚拟号) ──
        contact_phone: contactPhone,
        // ── 发布类型(需求②代他人发布): self=自己 / proxy=代他人 ──
        publish_type: publishType,
        service_target: proxySignature
          ? {
              name: String(service_target.name).slice(0, 20),
              relation: String(service_target.relation || '').slice(0, 10),
              relation_note: String(service_target.relation_note || '').slice(0, 20),
              // 真号受限存储(仅服务端使用, 为二期虚拟号/验证预埋); 任何输出接口一律 maskContact 脱敏, 不回传真号
              phone: String(service_target.phone || service_target.phone_mask || '').trim().slice(0, 20)
            }
          : null,
        proxy_auth_signed: !!proxySignature,
        proxy_auth_signed_at: proxySignature ? now : 0,
        // ── 接单模式 ──
        match_mode: mode,                            // broadcast=抢单 / select=选单
        applicants: [],                              // 选单模式:报名耍伴列表
        matched_openid: null,                        // 选单模式:已确认的耍伴
        status: 'matching',
        match_candidates: [],
        invited: mode === 'direct' ? [target_openid] : [],  // 定向: 仅受邀耍伴可接
        broadcast: mode === 'broadcast',  // 仅抢单模式入厅; 定向/选单不入公共大厅
        // 抢单通知(需求①站内闭环): 待推送标记, 由 order-timer 定时分批向「范围内可接耍伴」推 system_notice 引导抢单
        // direct 定向模式已单发邀请(L816), 不再群发; broadcast/select 需覆盖更多耍伴故置待推送
        grab_notify_pending: mode === 'direct' ? false : true,
        is_test: isTestOpenid(config, openid),   // D4-5 测试白名单打标(供 purge_test_data 精准清理)
        expire_at: now + 24 * 3600 * 1000,  // 24h 后过期
        created_at: now,
        updated_at: now,
        is_deleted: false
      };

      try {
        const addRes = await col('demand').add({ data: doc });
        log.d(`demand created: ${demand_no}`);

        // ── P1 留证: 需求者场景免责声明(勾选同意)全文+SHA-256 落库(不阻断主流程) ──
        let evidenceId = '';
        let evidenceHash = '';
        try {
          const evData = buildCheckboxEvidence({
            openid, role: 'user', scene, disclaimerType, config,
            demandId: addRes._id, signedAt: now
          });
          const evRes = await col('disclaimer_signature').add({ data: evData });
          evidenceId = (evRes && evRes._id) || '';
          evidenceHash = evData.signature_hash || '';
          log.d(`scene evidence(user) written: ${demand_no}`);
        } catch (ee) {
          log.d(`scene evidence(user) fail: ${(ee && ee.message) || ee}`);
          col('platform_event').add({ data: {
            level: 'P3', type: 'evidence_write_fail', openid,
            payload: { node: 'publish', scene, demand_id: addRes._id, message: String((ee && ee.message) || ee) },
            created_at: Date.now(), updated_at: Date.now(), is_deleted: false
          }}).catch(() => {});
        }

        // ── W9 留证: 宠物照料授权书(电子确认, PRD R9 授权凭证; 不阻断主流程) ──
        let petEvidenceId = '';
        let petEvidenceHash = '';
        if (scene === 'W9' && pet_auth_checked) {
          try {
            const petData = buildCheckboxEvidence({
              openid, role: 'user', scene, disclaimerType: 'pet_authorization',
              config, demandId: addRes._id, signedAt: now,
              kind: 'pet_authorization',
              signature: petSignature,
              doc: {
                key: 'pet_authorization', title: '宠物照料授权书',
                text: String(config.legal_pet_authorization || DEFAULT_PET_AUTHORIZATION)
              }
            });
            const petRes = await col('disclaimer_signature').add({ data: petData });
            petEvidenceId = (petRes && petRes._id) || '';
            petEvidenceHash = petData.signature_hash || '';
            log.d(`pet auth evidence written: ${demand_no}`);
          } catch (ee) {
            log.d(`pet auth evidence fail: ${(ee && ee.message) || ee}`);
            col('platform_event').add({ data: {
              level: 'P3', type: 'evidence_write_fail', openid,
              payload: { node: 'publish_pet', scene, demand_id: addRes._id, message: String((ee && ee.message) || ee) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }}).catch(() => {});
          }
        }

        // ── 代发留证(需求②): 委托授权书 + 本人手写签字(kind=proxy_authorization; 不阻断主流程) ──
        // 复用 W9 同套 buildCheckboxEvidence 的 signature 覆盖 → 落 signature_file_id/SHA-256/verify_method=handwritten
        if (publishType === 'proxy' && proxySignature) {
          try {
            const proxyData = buildCheckboxEvidence({
              openid, role: 'user', scene, disclaimerType: 'proxy_authorization',
              config, demandId: addRes._id, signedAt: now,
              kind: 'proxy_authorization',
              signature: {
                fileId: proxySignature.fileId, hash: proxySignature.hash, size: proxySignature.size
              },
              doc: {
                key: 'proxy_authorization', title: '委托授权书',
                text: `本人授权代操作人代为发布平台需求：被代发人 ${service_target.name || ''}，与本人关系 ${service_target.relation || ''}。`
              }
            });
            await col('disclaimer_signature').add({ data: proxyData });
            log.d(`proxy auth evidence written: ${demand_no}`);
          } catch (ee) {
            log.d(`proxy auth evidence fail: ${(ee && ee.message) || ee}`);
            col('platform_event').add({ data: {
              level: 'P3', type: 'evidence_write_fail', openid,
              payload: { node: 'publish_proxy', scene, demand_id: addRes._id, message: String((ee && ee.message) || ee) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }}).catch(() => {});
          }
        }

        // 定向邀约: 给受邀耍伴写系统通知(不阻断主流程), 通知点击直达需求详情
        if (mode === 'direct') {
          try {
            const callerName = user.nickname || user.surname || '发单人';
            await col('system_notice').add({
              data: {
                to_openid: target_openid,
                order_id: '',
                demand_id: addRes._id,
                type: 'direct_invite',
                title: '你收到一条定向需求邀约',
                body: `${callerName}定向向你发布了一条需求,请在24小时内查看并接单`,
                action_key: 'jump_demand',
                action_payload: { demand_id: addRes._id },
                created_at: now,
                read: false
              }
            });
          } catch (ne) {
            log.d(`direct invite notice fail: ${ne.message}`);
          }
        }

        // 发布者站内通知(2026-10-10): 发布成功即时回执, 使「消息→系统通知」出现未读提示(不阻断主流程)
        try {
          await col('system_notice').add({ data: {
            to_openid: openid,
            order_id: '',
            demand_id: addRes._id,
            type: 'demand_published',
            title: '需求发布成功',
            body: mode === 'direct'
              ? '已向指定耍伴发出邀约, 等待对方响应'
              : '正在为你匹配附近耍伴, 有人接单会第一时间通知你',
            action_key: 'jump_demand',
            action_payload: { demand_id: addRes._id },
            created_at: now, read: false
          }});
        } catch (ne) { log.d(`publish notice fail: ${ne.message}`); }

        // 抢单通知即时化(2026-10-10): broadcast/select 发布时立即向「范围内可接耍伴」推站内通知(选取/文案与
        // order-timer.processDemandNotify 同口径); 候选数 > IMMEDIATE_CAP 时不即时推, 保留 grab_notify_pending
        // 交定时器兜底(避免超时); 仅当全部推送成功才清 pending, 否则留标由定时器重试。全程不阻断主流程。
        const IMMEDIATE_CAP = 20;
        if (mode !== 'direct') {
          try {
            const minCredit = Number(config.min_credit_take_order) || 600;
            const takeCap = Number(config.take_distance_max_km) || 50;
            const pBase = { status: 'approved', is_deleted: _.neq(true), accept_switch: _.neq(false), accept_scenes: scene };
            let cands = [];
            try { cands = (await col('partner_profile').where(Object.assign({}, pBase, { credit_score: _.gte(minCredit) })).limit(50).get()).data || []; } catch (e) { cands = []; }
            if (!cands.length) { try { cands = (await col('partner_profile').where(pBase).limit(50).get()).data || []; } catch (e) { cands = []; } }
            const dLoc = doc.location || {};
            const hasLoc = Number.isFinite(Number(dLoc.latitude)) && Number.isFinite(Number(dLoc.longitude));
            const targets = [];
            for (const p of cands) {
              const own = Number(p.max_distance_km);
              const eff = (Number.isFinite(own) && own > 0) ? Math.min(own, takeCap) : takeCap;
              const hl = p.home_location || {};
              if (!hasLoc || !Number.isFinite(Number(hl.latitude)) || !Number.isFinite(Number(hl.longitude))) continue;
              if (haversineKm(Number(dLoc.latitude), Number(dLoc.longitude), Number(hl.latitude), Number(hl.longitude)) > eff) continue;
              targets.push(p.openid);
            }
            if (targets.length && targets.length <= IMMEDIATE_CAP) {
              const subject = (doc.content_options && doc.content_options[0]) || '新需求';
              const results = await Promise.allSettled(targets.map((o) => col('system_notice').add({ data: {
                to_openid: o, order_id: '', demand_id: addRes._id, type: 'demand_grab',
                title: '有新需求可接单',
                body: `${String(subject).slice(0, 30)} · 距你较近, 速来抢单`,
                action_key: 'jump_demand', action_payload: { demand_id: addRes._id },
                created_at: now, read: false
              }})));
              const okAll = results.every((r) => r.status === 'fulfilled');
              log.d(`grab immediate push: ${demand_no} targets=${targets.length} okAll=${okAll}`);
              if (okAll) {
                await col('demand').where({ _id: addRes._id, grab_notify_pending: true })
                  .update({ data: { grab_notify_pending: false, updated_at: Date.now() } });
              }
            } else if (targets.length > IMMEDIATE_CAP) {
              log.d(`grab push deferred to timer: ${demand_no} targets=${targets.length}`);
            }
          } catch (ge) { log.d(`grab immediate push fail: ${ge.message}`); }
        }

        // 发布成功后清理来源草稿(若本次发布由草稿发起), 避免残留草稿导致重复发布
        let draftCleared = false;
        const srcDraftId = event.draft_id;
        if (srcDraftId && isValidDocId(srcDraftId)) {
          try {
            const dRes = await col('demand_draft').doc(srcDraftId).get();
            const d = dRes.data;
            if (d && d.openid === openid && !d.is_deleted) {
              await col('demand_draft').doc(srcDraftId).update({
                data: { is_deleted: true, updated_at: now }
              });
              draftCleared = true;
            }
          } catch (e) { /* 草稿清理失败不阻断发布 */ }
        }
        await writeAudit(db, log, {
          openid, role: 'user', category: 'business', action: 'demand_publish',
          target_type: 'demand', target_id: addRes._id,
          detail: {
            demand_no, scene, match_mode: mode, pricing_type: docPricingType, rate_fen: docRateFen, total_fen, aa_tier,
            duration_h, aa_promise_checked: !!aa_promise_checked,
            pet_auth: scene === 'W9' && !!pet_auth_checked,
            evidence_ids: [evidenceId, petEvidenceId].filter(Boolean)
          },
          evidence_id: evidenceId, doc_hash: evidenceHash,
          result: 'ok', client_ip: clientIp, device
        });
        return {
          ok: true,
          data: {
            _id: addRes._id, demand_no, total_fen, status: 'matching',
            expire_at: doc.expire_at, draft_cleared: draftCleared
          }
        };
      } catch (e) {
        log.d(`demand publish fail: ${e.message}`);
        return { ok: false, code: 'publish_db_fail', msg: '需求发布失败' };
      }
}

module.exports = {
  publish: publish_action,
};
