// action_update.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 9. 更新需求(仅创建者,仅 matching 状态; 白名单字段更新; 跳过发布地址重定位)
async function update_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, db, _, col, log, writeAudit, getSceneCodes, MATCH_MODE_WHITELIST, DISCLAIMER_TYPE_MAP, SCENE_OPTIONS_FALLBACK, DEFAULT_PET_AUTHORIZATION, buildCheckboxEvidence, verifySignatureFile, remarkMaxLen, checkText, suspendLeftDays, getConfig, contentOptionsMax, getUser, isValidDocId } = ctx;
      const { demand_id, scene, start_time, duration_h, location, content_option, content_options,
        remark, rate_fen, aa_tier, aa_promise_checked, disclaimer_signed,
        match_mode, target_openid, gender_pref, headcount, pet_auth_checked, pet_auth_signature_file_id,
        pricing_type, fixed_price_fen, project_attr } = event;
      // 计价模式归一化(与 publish 同口径; 缺省 hourly/commercial 兼容存量)
      const pricingTypeU = pricing_type === 'fixed' ? 'fixed' : 'hourly';
      const projectAttrU = project_attr === 'public_welfare' ? 'public_welfare' : 'commercial';
      const isWelfareU = projectAttrU === 'public_welfare';

      if (!demand_id) return { ok: false, code: 'update_no_id', msg: '缺少需求 ID' };
      if (!isValidDocId(demand_id)) return { ok: false, code: 'update_bad_id', msg: '需求 ID 格式不正确' };

      // d 需在整个 update case 可见(后续 mode 兜底 + 成功日志均引用);
      // 此前 const 声明在 try 块内, 块外引用抛 ReferenceError: d is not defined, 被误判为 DB 失败
      let d;
      try {
        const r = await col('demand').doc(demand_id).get();
        d = r.data;
        if (!d || d.is_deleted) return { ok: false, code: 'update_not_found', msg: '需求不存在' };
        if (d.creator_openid !== openid) return { ok: false, code: 'update_not_owner', msg: '无权编辑此需求' };
        if (d.status !== 'matching') return { ok: false, code: 'update_bad_status', msg: `当前状态(${d.status})不可编辑` };
      } catch (e) {
        return { ok: false, code: 'update_get_fail', msg: '查询需求失败' };
      }

      // ── 并行拉配置 + 用户 ──
      const [config, user] = await Promise.all([getConfig(), getUser(openid)]);
      if (!user) return { ok: false, code: 'update_no_user', msg: '用户不存在,请先登录' };
      if (user.status === 'frozen') return { ok: false, code: 'update_frozen', msg: '账号已冻结' };
      if (user.status === 'banned') return { ok: false, code: 'update_banned', msg: '账号已封禁' };
      if (user.status === 'closed') return { ok: false, code: 'update_closed', msg: '账号已注销' };
      // 断链②修复(第三批爽约): 停用中拦截「发布更新」; 到期/缺 suspend_until 视为已恢复按 normal 放行
      const suspendDaysU = suspendLeftDays(user);
      if (suspendDaysU > 0) {
        return { ok: false, code: 'update_suspended', msg: `账号停用中,${suspendDaysU}天后自动恢复` };
      }

      // ── 场景白名单(动态从 admin_config.scene_list 读取) ──
      const sceneCodes2 = await getSceneCodes();
      if (!scene || sceneCodes2.indexOf(scene) < 0) {
        return { ok: false, code: 'update_scene_invalid', msg: '场景不在白名单' };
      }
      const mode = MATCH_MODE_WHITELIST.indexOf(match_mode) >= 0 ? match_mode : d.match_mode;

      // ── 开始时间: 必须是未来时间戳, 距现在不超 30 天 ──
      if (!start_time || typeof start_time !== 'number' || start_time <= Date.now()) {
        return { ok: false, code: 'update_start_time', msg: '开始时间必须是未来时间' };
      }
      const MAX_ADVANCE_MS = 30 * 24 * 3600 * 1000;
      if (start_time > Date.now() + MAX_ADVANCE_MS) {
        return { ok: false, code: 'update_time_too_far', msg: '服务时间距现在不能超过 30 天' };
      }

      // ── 时长 1-12 ──
      if (!duration_h || duration_h < 1 || duration_h > 12) {
        return { ok: false, code: 'update_duration', msg: '时长需 1-12 小时' };
      }

      // ── 计价分支(与 publish 同口径: hourly / fixed / 公益特例; 收敛到 total_fen) ──
      let docPricingTypeU, docRateFenU, docFixedPriceFenU, docProjectAttrU, total_fen;
      docProjectAttrU = projectAttrU;
      if (isWelfareU) {
        const wFen = Number(config.welfare_fixed_price_fen);
        if (!Number.isFinite(wFen)) {
          return { ok: false, code: 'update_welfare_not_open', msg: '公益单暂未开放,请稍后再试' };
        }
        docPricingTypeU = 'fixed'; docFixedPriceFenU = wFen; docRateFenU = null; total_fen = wFen;
      } else if (pricingTypeU === 'fixed') {
        if (!fixed_price_fen || typeof fixed_price_fen !== 'number' || fixed_price_fen <= 0) {
          return { ok: false, code: 'update_fixed_price', msg: '一口价金额格式有误' };
        }
        const _uFLo = Number(config.fixed_price_min_fen);
        const _uFHi = Number(config.fixed_price_max_fen);
        if (Number.isFinite(_uFLo) && fixed_price_fen < _uFLo) {
          return { ok: false, code: 'update_fixed_range', msg: `一口价需不低于 ${_uFLo / 100} 元` };
        }
        if (Number.isFinite(_uFHi) && fixed_price_fen > _uFHi) {
          return { ok: false, code: 'update_fixed_range', msg: `一口价需不高于 ${_uFHi / 100} 元` };
        }
        docPricingTypeU = 'fixed'; docFixedPriceFenU = fixed_price_fen; docRateFenU = null; total_fen = fixed_price_fen;
      } else {
        if (!rate_fen || typeof rate_fen !== 'number' || rate_fen < 100) {
          return { ok: false, code: 'update_rate', msg: '时薪金额格式有误' };
        }
        // 0 是合法下限(不用 || 兜底); 区间与提示文案均按后台实配生成
        const _uLo = Number(config.rate_min_fen);
        const _uHi = Number(config.rate_max_fen);
        const uLo = Number.isFinite(_uLo) ? _uLo : 3000;
        const uHi = Number.isFinite(_uHi) ? _uHi : 10000;
        if (rate_fen < uLo || rate_fen > uHi) {
          return { ok: false, code: 'update_rate_range', msg: `时薪需在 ${uLo / 100}-${uHi / 100} 元/小时之间` };
        }
        docPricingTypeU = 'hourly'; docFixedPriceFenU = null; docRateFenU = rate_fen; total_fen = rate_fen * duration_h;
      }

      // ── 履约地点 ──
      if (!location || !location.name) {
        return { ok: false, code: 'update_location', msg: '请填写履约地点名称' };
      }

      // ── AA + 免责声明 ──
      if (!aa_tier) return { ok: false, code: 'update_aa_tier', msg: '请选择 AA 档位' };
      if (!aa_promise_checked) return { ok: false, code: 'update_aa_promise', msg: '请先勾选《线下费用自理承诺书》' };
      if (!disclaimer_signed) return { ok: false, code: 'update_disclaimer', msg: '请先勾选《场景免责声明》' };
      // W9 宠物照料授权(与 publish 同口径: 无凭证视为未授权)
      if (scene === 'W9' && !pet_auth_checked) {
        return { ok: false, code: 'update_pet_auth_required', msg: 'W9 宠物陪伴需先确认《宠物照料授权书》' };
      }
      // 首次补留证(该需求此前无凭证)时才要求手写签字图; 已签过的需求沿用原留证不重复签
      let petSignature = null;
      if (scene === 'W9' && pet_auth_checked && d.pet_auth_signed !== true) {
        petSignature = await verifySignatureFile(pet_auth_signature_file_id);
        if (!petSignature.ok) {
          return { ok: false, code: 'update_pet_auth_sign_required', msg: '请完成《宠物照料授权书》手写签字后重试' };
        }
      }

      // ── 定向邀约改 direct 时需校验 target_openid ──
      if (mode === 'direct') {
        if (!target_openid) return { ok: false, code: 'update_target_required', msg: '定向邀约缺少指定耍伴' };
        if (target_openid === openid) return { ok: false, code: 'update_target_self', msg: '不能定向邀约自己' };
        const tpR = await col('partner_profile')
          .where({ openid: target_openid, status: 'approved', is_deleted: _.neq(true) })
          .limit(1).get().catch(() => ({ data: [] }));
        if (!(tpR.data && tpR.data[0])) {
          return { ok: false, code: 'update_target_invalid', msg: '指定耍伴不存在或未通过审核' };
        }
      }

      // ── 城市校验 ──
      const normCity = (c) => String(c || '').replace(/市$/, '').trim();
      const city = normCity(location.city) || '成都';
      let enabledCities = (Array.isArray(config.city_enabled) ? config.city_enabled : [])
        .map(normCity).filter(Boolean);
      if (enabledCities.length === 0) enabledCities = ['成都'];
      const locName = String((location && location.name) || '');
      const cityOk = enabledCities.indexOf(city) >= 0
        || enabledCities.some((c) => city.indexOf(c) >= 0 || locName.indexOf(c) >= 0);
      if (!cityOk) {
        return { ok: false, code: 'update_city_disabled', msg: `当前城市未开通服务(${city})` };
      }

      // ── 子服务内容校验 ──
      let opts = Array.isArray(content_options)
        ? content_options
        : (typeof content_option === 'string' ? [content_option] : []);
      opts = Array.from(new Set(opts.map((s) => String(s || '').trim()).filter(Boolean)));
      if (opts.length === 0) return { ok: false, code: 'update_content_option', msg: '请选择服务内容' };
      if (opts.length > contentOptionsMax(config)) return { ok: false, code: 'update_content_too_many', msg: `服务内容最多 ${contentOptionsMax(config)} 项` };
      const sceneCfg = (config.scene_list || []).find((s) => s.code === scene);
      const allowedOptions = (sceneCfg && sceneCfg.options) || SCENE_OPTIONS_FALLBACK[scene] || [];
      for (const o of opts) {
        if (allowedOptions.indexOf(o) < 0) {
          return { ok: false, code: 'update_content_invalid', msg: `服务内容「${o}」不在该场景可选项内` };
        }
      }

      // ── 备注安全 ──
      const remarkStr = remark ? String(remark).trim() : '';
      if (remarkStr) {
        const remarkLimit = remarkMaxLen(config);
        if (remarkStr.length > remarkLimit) {
          return { ok: false, code: 'update_remark_long', msg: `备注最长 ${remarkLimit} 字` };
        }
        const chk = await checkText(openid, remarkStr, config.block_words);
        if (!chk.pass) {
          return { ok: false, code: 'update_remark_blocked', msg: chk.reason };
        }
      }

      // ── 时间冲突校验:排除当前需求本身 ──
      const newStart = start_time;
      const newEnd = start_time + duration_h * 3600 * 1000;
      const existDemands = await col('demand').where({
        creator_openid: openid, scene, is_deleted: false,
        status: _.neq('cancelled'),
        _id: _.neq(demand_id)  // 排除自己, 避免编辑前和编辑后冲突
      }).get();
      for (const e of existDemands.data) {
        const oldStart = e.start_time;
        const oldEnd = e.start_time + (e.duration_h || 1) * 3600 * 1000;
        if (!(newStart < oldEnd && oldStart < newEnd)) continue;
        const oldOpts = (e.content_options && e.content_options.length)
          ? e.content_options
          : (e.content_option ? [e.content_option] : []);
        if (opts.some((o) => oldOpts.indexOf(o) >= 0)) {
          return { ok: false, code: 'update_time_conflict', msg: '该时段已有同类服务需求,请调整时间' };
        }
      }

      // ── 青少年保护(total_fen 已在计价分支算出) ──
      if (user.age !== null && user.age !== undefined && user.age >= 18 && user.age <= 22) {
        if (total_fen > (config.youth_limit_fen || 20000)) {
          return { ok: false, code: 'update_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
        }
      }

      // ── 白名单字段组装(publish_location/broadcast/invited 等系统字段禁止改) ──
      const now = Date.now();
      const patch = {
        scene,
        content_option: opts[0],
        content_options: opts,
        start_time,
        duration_h,
        location: {
          name: location.name,
          address: location.name,
          latitude: location.latitude || 0,
          longitude: location.longitude || 0,
          city
        },
        remark: remarkStr,
        pricing_type: docPricingTypeU,
        project_attr: docProjectAttrU,
        rate_fen: docRateFenU,
        fixed_price_fen: docFixedPriceFenU,
        total_fen,
        aa_tier,
        aa_promise_signed: !!aa_promise_checked,
        disclaimer_signed: !!disclaimer_signed,
        disclaimer_signed_at: now,
        match_mode: mode,
        headcount: headcount || 1,
        gender_pref: gender_pref || '不限',
        updated_at: now
      };
      // match_mode 改了 → 同步更新 broadcast/invited(不改 publish_location!)
      patch.broadcast = mode === 'broadcast';
      patch.invited = mode === 'direct' ? [target_openid] : [];
      // 场景变更时同步刷新免责声明类型(SSOT: admin_config.scene_list; 此前 update 漏刷新, 场景与类型可能不一致)
      patch.disclaimer_type = (sceneCfg && sceneCfg.disclaimer_type) || DISCLAIMER_TYPE_MAP[scene] || 'general_disclaimer';
      // W9 宠物照料授权(电子确认)状态同步; 非 W9 场景恒 false
      patch.pet_auth_signed = scene === 'W9' && !!pet_auth_checked;
      if (patch.pet_auth_signed) patch.pet_auth_signed_at = now;
      if (mode === 'direct' && target_openid) {
        patch.target_openid = target_openid;
      }

      // ── CAS 更新: 仅 matching 状态可改, 防止并发冲突 ──
      try {
        const cr = await col('demand').where({ _id: demand_id, status: 'matching' }).update({ data: patch });
        if (!cr.stats || cr.stats.updated !== 1) {
          return { ok: false, code: 'update_gone', msg: '需求状态已变化,请刷新后重试' };
        }
        log.d(`demand updated: ${d.demand_no}`);
        // ── P1 留证: 场景变更(=换签新场景免责声明)才补新留证; 场景未变沿用原留证(不重复签) ──
        let upEvidenceId = '';
        let upEvidenceHash = '';
        let upPetEvidenceId = '';
        if (d.scene !== scene) {
          try {
            const upData = buildCheckboxEvidence({
              openid, role: 'user', scene, disclaimerType: patch.disclaimer_type, config,
              demandId: demand_id, signedAt: now
            });
            const upRes = await col('disclaimer_signature').add({ data: upData });
            upEvidenceId = (upRes && upRes._id) || '';
            upEvidenceHash = upData.signature_hash || '';
            log.d(`scene evidence(user) written(update): ${d.demand_no}`);
          } catch (ee) {
            log.d(`scene evidence(update) fail: ${(ee && ee.message) || ee}`);
            col('platform_event').add({ data: {
              level: 'P3', type: 'evidence_write_fail', openid,
              payload: { node: 'update', scene, demand_id, message: String((ee && ee.message) || ee) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }}).catch(() => {});
          }
        }
        // ── W9 留证: 首次确认宠物照料授权书(该需求此前无凭证)时补留证 ──
        if (scene === 'W9' && pet_auth_checked && d.pet_auth_signed !== true) {
          try {
            const upPetData = buildCheckboxEvidence({
              openid, role: 'user', scene, disclaimerType: 'pet_authorization',
              config, demandId: demand_id, signedAt: now,
              kind: 'pet_authorization',
              signature: petSignature,
              doc: {
                key: 'pet_authorization', title: '宠物照料授权书',
                text: String(config.legal_pet_authorization || DEFAULT_PET_AUTHORIZATION)
              }
            });
            const upPetRes = await col('disclaimer_signature').add({ data: upPetData });
            upPetEvidenceId = (upPetRes && upPetRes._id) || '';
            log.d(`pet auth evidence written(update): ${d.demand_no}`);
          } catch (ee) {
            log.d(`pet auth evidence(update) fail: ${(ee && ee.message) || ee}`);
            col('platform_event').add({ data: {
              level: 'P3', type: 'evidence_write_fail', openid,
              payload: { node: 'update_pet', scene, demand_id, message: String((ee && ee.message) || ee) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }}).catch(() => {});
          }
        }
        await writeAudit(db, log, {
          openid, role: 'user', category: 'business', action: 'demand_update',
          target_type: 'demand', target_id: demand_id,
          detail: {
            demand_no: d.demand_no, scene, prev_scene: d.scene, match_mode: mode,
            scene_changed: d.scene !== scene,
            pet_auth: scene === 'W9' && !!pet_auth_checked,
            evidence_ids: [upEvidenceId, upPetEvidenceId].filter(Boolean)
          },
          evidence_id: upEvidenceId, doc_hash: upEvidenceHash,
          result: 'ok', client_ip: clientIp, device
        });
        return { ok: true, data: { _id: demand_id, updated_at: now } };
      } catch (e) {
        // 记录数据库原始错误(此前被吞, 无法定位; 查询通道: admin-action export_collection platform_event)
        try {
          await col('platform_event').add({ data: {
            level: 'P3', type: 'demand_update_fail', openid,
            payload: { demand_id, message: String((e && e.message) || e), errCode: (e && e.errCode) || '' },
            created_at: Date.now(), updated_at: Date.now(), is_deleted: false
          }});
        } catch (_) {}
        log.d(`update db fail: ${(e && e.message) || e}`);
        return { ok: false, code: 'update_db_fail', msg: '需求更新失败' };
      }
}

module.exports = {
  update: update_action,
};
