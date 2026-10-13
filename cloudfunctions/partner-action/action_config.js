// action_config.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 0. 申请成为耍伴 (upsert partner_profile)
    //    审核红线: 仅 admin_config.auto_approve_partner === true 时自动开通;
    //    否则新申请/被拒记录一律 pending_review, 且不授予 partner role, 由管理员 review 放行
async function applyAction(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, suspendLeftDays, getSceneCodes, getExamBank, sanitizeHomeLocation, getConfig } = ctx;
      const config = await getConfig();
      const autoApprove = config.auto_approve_partner === true;
      const uaCol = col('user_account');
      const ua = await uaCol.where({ openid }).limit(1).get();
      if (!ua.data.length) return { ok: false, code: 'pa_no_user', msg: '请先登录' };
      // 断链②修复(第三批爽约): 停用中拦截「新申请」(前端「成为耍伴」实际走本入口);
      // 到期/缺 suspend_until 视为已恢复按 normal 放行
      const applySuspendDays = suspendLeftDays(ua.data[0]);
      if (applySuspendDays > 0) {
        return { ok: false, code: 'pa_suspended', msg: `账号停用中,${applySuspendDays}天后自动恢复` };
      }

      // 加 partner role(仅审核通过后; pending_review 不授予)
      const curRoles = ua.data[0].roles || [];

      // upsert partner_profile
      // 注意: 早期版本 add 漏写 is_deleted 且重复提交可能产生多条文档,
      // 这里宽查(不带 is_deleted)并治愈该 openid 下全部文档, 避免严格守卫 limit(1) 漏读
      const ppCol = col('partner_profile');
      const now = Date.now();
      const existing = await ppCol.where({ openid }).limit(100).get();
      // 动态拿活跃场景列表(SSOT: admin_config.scene_list)
      const sceneCodes = await getSceneCodes();
      const scenes = Array.isArray(event.accept_scenes) && event.accept_scenes.length
        ? event.accept_scenes
        : (curRoles.includes('partner') && existing.data.length ? existing.data[0].accept_scenes || [] : [sceneCodes[0] || 'W1']);

      // 日常位置(注册时 chooseLocation 选点); 未传/非法则保留旧值, 不强制阻断老客户端
      const homeLocation = sanitizeHomeLocation(event.home_location);

      // 补全场景考核分: 非 W1 场景默认 100, W1(就医陪诊) 强制默认 0 防止架空国标考核
      // W1 开通线口径统一(2026-10-07 P6 小修): 与接单/考试同源 → exam_bank.pass_line(兜底 100)
      const defaultExam = sceneCodes.reduce((a, c) => { a[c] = c === 'W1' ? 0 : 100; return a; }, {});
      const w1Bank = (await getExamBank()).W1 || {};
      const w1PassLine = Number(w1Bank.pass_line) || 100;

      // 若显式传了 W1 分数, 按 exam_bank.pass_line 校验(与 order-create 接单校验同口径)
      if (event.exam_scores && Number(event.exam_scores.W1)) {
        if (Number(event.exam_scores.W1) < w1PassLine) {
          return { ok: false, code: 'pa_w1_exam_failed', msg: `就医陪诊场景需通过国标专项考核(>=${w1PassLine}分)` };
        }
        defaultExam.W1 = Number(event.exam_scores.W1);
      }

      // 已是 approved 的历史档案重走申请时保留资格(只更新场景); 其余一律按自动开关决定
      const wasApproved = existing.data.some(p => p.status === 'approved');
      const finalApproved = wasApproved || autoApprove;
      const finalStatus = finalApproved ? 'approved' : 'pending_review';

      let profileId = '';
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
          if (homeLocation) patch.home_location = homeLocation;
          profileId = p._id;
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
        if (homeLocation) doc.home_location = homeLocation;
        const addRes = await ppCol.add({ data: doc });
        profileId = (addRes && addRes._id) || '';
      }

      // 仅最终审核通过才授予 partner role; 待审核不污染身份分流
      let roles = curRoles;
      if (finalApproved && !curRoles.includes('partner')) {
        roles = [...curRoles, 'partner'];
        await uaCol.doc(ua.data[0]._id).update({ data: { roles, updated_at: now } });
      }

      log.d(`partner apply: ${openid} scenes=${scenes} docs=${existing.data.length} status=${finalStatus}`);
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'account', action: 'partner_apply',
        target_type: 'partner_profile', target_id: profileId,
        detail: { profile_id: profileId, scenes_count: scenes.length, status: finalStatus },
        result: 'ok', client_ip: clientIp, device
      });
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
async function setSwitchAction(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, getProfile, hasBusyOrder } = ctx;
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
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_switch',
        target_type: 'partner_profile', target_id: profile._id,
        detail: { accept_switch: newSwitch },
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { accept_switch: newSwitch } };
}

    // 2. 修改时薪与场景
async function updateConfigAction(ctx) {
  const { event, openid, clientIp, device, db, _, col, log, writeAudit, getSceneCodes, sanitizeHomeLocation, sanitizeWeeklySlots, getConfig, getProfile } = ctx;
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      if (profile.status !== 'approved') {
        return { ok: false, code: 'pa_not_approved', msg: '耍伴资料未审核通过' };
      }

      const config = await getConfig();
      const update = { updated_at: Date.now() };
      // 0 是合法下限(不能用 || 兜底, 否则 admin 配置 0 会被误当成缺省 3000)
      const _rmn = Number(config.rate_min_fen);
      const _rmx = Number(config.rate_max_fen);
      const rateMin = Number.isFinite(_rmn) ? _rmn : 3000;
      const rateMax = Number.isFinite(_rmx) ? _rmx : 10000;
      // 场景时薪硬上限(分/小时): 仅防溢出与脏数据, 不构成业务边界 —— 场景时薪由耍伴前端自主设定(产品拍板 2026-09-23)
      const RATE_FEN_HARD_MAX = 9999900; // = 99999 元/时

      // 日常位置更新: 显式 null 清除, 传对象则校验后覆盖
      if (event.home_location !== undefined) {
        if (event.home_location === null) {
          update.home_location = _.remove();
        } else {
          const hl = sanitizeHomeLocation(event.home_location);
          if (!hl) return { ok: false, code: 'pa_bad_location', msg: '日常位置无效' };
          update.home_location = hl;
        }
      }

      // 最大接单距离(公里, 3-50): 广场展示过滤 + 接单校验取 min(本值, 平台上限 take_distance_max_km)
      if (event.max_distance_km !== undefined) {
        const md = parseInt(event.max_distance_km, 10);
        if (!Number.isInteger(md) || md < 3 || md > 50) {
          return { ok: false, code: 'pa_bad_max_distance', msg: '最大接单距离须为 3-50 公里的整数' };
        }
        update.max_distance_km = md;
      }

      // 场景校验
      let newScenes = profile.accept_scenes || [];
      if (Array.isArray(event.accept_scenes)) {
        if (event.accept_scenes.length === 0) {
          return { ok: false, code: 'pa_scenes_empty', msg: '请至少选择一个接单场景' };
        }
        const sceneCodes = await getSceneCodes();
        for (const s of event.accept_scenes) {
          if (sceneCodes.indexOf(s) < 0) {
            return { ok: false, code: 'pa_scene_invalid', msg: `场景 ${s} 不在白名单` };
          }
        }
        newScenes = event.accept_scenes;
        update.accept_scenes = newScenes;
      }

      // 各场景时薪(scene_rates: { W1: 5000, ... } 分单位)
      // 耍伴端逐场景输入(元/小时); 传入值非法时回落「原有效值 → 平台默认时薪」, 不硬拒(防脏数据/旧客户端)
      const sceneDefaultRate = config.scene_default_rate_fen || 5000;
      const oldRates = profile.scene_rates || {};
      if (event.scene_rates && typeof event.scene_rates === 'object') {
        const rateKeys = Object.keys(event.scene_rates);
        // 不允许多余 key
        for (const k of rateKeys) {
          if (newScenes.indexOf(k) < 0) {
            return { ok: false, code: 'pa_rate_extra', msg: `场景 ${k} 未勾选但设置了时薪` };
          }
        }
        // 为每个选中场景确定时薪: 传入值合法则用, 否则回退原值, 再否则平台默认
        // (场景时薪自主设定: 仅要求正整数分, 不按平台 rateMin/rateMax 卡边界)
        const mergedRates = {};
        for (const s of newScenes) {
          let r = rateKeys.indexOf(s) >= 0 ? Number(event.scene_rates[s]) : NaN;
          if (!r || !Number.isInteger(r) || r < 100 || r > RATE_FEN_HARD_MAX) {
            const old = Number(oldRates[s]);
            r = (old && Number.isInteger(old) && old >= 100 && old <= RATE_FEN_HARD_MAX) ? old : sceneDefaultRate;
          }
          mergedRates[s] = r;
        }
        update.scene_rates = mergedRates;
      } else if (update.accept_scenes) {
        // 只改场景未带时薪: 为新场景补默认时薪, 已有场景保留原值
        const mergedRates = {};
        for (const s of newScenes) {
          const old = Number(oldRates[s]);
          mergedRates[s] = (old && Number.isInteger(old) && old >= 100 && old <= RATE_FEN_HARD_MAX) ? old : sceneDefaultRate;
        }
        update.scene_rates = mergedRates;
      }

      // 每周接单时段(结构化分钟数; 服务端 order-create 按"服务时间必须落在启用时段内"校验)
      if (event.weekly_slots !== undefined) {
        if (event.weekly_slots === null) {
          update.weekly_slots = _.remove();
        } else {
          const slots = sanitizeWeeklySlots(event.weekly_slots);
          if (!slots) {
            return { ok: false, code: 'pa_bad_slots', msg: '接单时段格式不正确(每天需 0-1440 的整数分钟, 起止不能相同)' };
          }
          update.weekly_slots = slots;
        }
      }

      // 接单价格区间(分/小时; null=清除=不限); 边界复用上方 rateMin/rateMax(0 合法)
      const priceLo = rateMin;
      const priceHi = rateMax;
      const hasMin = event.accept_rate_min_fen !== undefined;
      const hasMax = event.accept_rate_max_fen !== undefined;
      if (hasMin || hasMax) {
        const norm = (v) => (v === null ? null : Number(v));
        const curMin = profile.accept_rate_min_fen === undefined ? null : profile.accept_rate_min_fen;
        const curMax = profile.accept_rate_max_fen === undefined ? null : profile.accept_rate_max_fen;
        const nextMin = hasMin ? norm(event.accept_rate_min_fen) : curMin;
        const nextMax = hasMax ? norm(event.accept_rate_max_fen) : curMax;
        if (nextMin !== null && (!Number.isInteger(nextMin) || nextMin < priceLo || nextMin > priceHi)) {
          return { ok: false, code: 'pa_price_min_range', msg: `最低单价需在 ${priceLo / 100}-${priceHi / 100} 元/小时之间` };
        }
        if (nextMax !== null && (!Number.isInteger(nextMax) || nextMax < priceLo || nextMax > priceHi)) {
          return { ok: false, code: 'pa_price_max_range', msg: `最高单价需在 ${priceLo / 100}-${priceHi / 100} 元/小时之间` };
        }
        if (nextMin !== null && nextMax !== null && nextMin > nextMax) {
          return { ok: false, code: 'pa_price_cross', msg: '最低单价不能高于最高单价' };
        }
        if (hasMin) update.accept_rate_min_fen = nextMin === null ? _.remove() : nextMin;
        if (hasMax) update.accept_rate_max_fen = nextMax === null ? _.remove() : nextMax;
      }

      // 一口价接单区间(客单价, 分; null=不限; 无平台钳制, 宁松勿错)
      const hasTMi = event.accept_total_min_fen !== undefined;
      const hasTMa = event.accept_total_max_fen !== undefined;
      if (hasTMi || hasTMa) {
        const normT = (v) => (v === null ? null : Number(v));
        const curTMi = profile.accept_total_min_fen === undefined ? null : profile.accept_total_min_fen;
        const curTMa = profile.accept_total_max_fen === undefined ? null : profile.accept_total_max_fen;
        const nextTMi = hasTMi ? normT(event.accept_total_min_fen) : curTMi;
        const nextTMa = hasTMa ? normT(event.accept_total_max_fen) : curTMa;
        if (nextTMi !== null && (!Number.isInteger(nextTMi) || nextTMi < 0)) {
          return { ok: false, code: 'pa_total_min_bad', msg: '最低客单价需为不小于 0 的整数(分)' };
        }
        if (nextTMa !== null && (!Number.isInteger(nextTMa) || nextTMa < 0)) {
          return { ok: false, code: 'pa_total_max_bad', msg: '最高客单价需为不小于 0 的整数(分)' };
        }
        if (nextTMi !== null && nextTMa !== null && nextTMi > nextTMa) {
          return { ok: false, code: 'pa_total_cross', msg: '最低客单价不能高于最高客单价' };
        }
        if (hasTMi) update.accept_total_min_fen = nextTMi === null ? _.remove() : nextTMi;
        if (hasTMa) update.accept_total_max_fen = nextTMa === null ? _.remove() : nextTMa;
      }

      await col('partner_profile').doc(profile._id).update({ data: update });
      log.d(`partner config updated: ${openid}`);
      const updated = Object.keys(update).filter(k => k !== 'updated_at');
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_config_update',
        target_type: 'partner_profile', target_id: profile._id,
        detail: { updated },
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { updated } };
}

    // 3.5 抢单提醒订阅授权(需求①增强): tmpl=demand_grab, authorized=bool
    // 将授权结果存 partner_profile.sub_msgs, 供 order-timer 抢单通知时判断是否额外发订阅消息(静默降级: 未授权仅站内)
async function subAuthorizeAction(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, getProfile } = ctx;
      // 授权模板白名单: demand_grab(抢单提醒) / demand_urge(催办提醒, Wave2 止血⑥)
      const tmpl = String(event.tmpl || 'demand_grab');
      if (['demand_grab', 'demand_urge'].indexOf(tmpl) < 0) return { ok: false, code: 'pa_sub_tmpl_bad', msg: '不支持的订阅模板' };
      const profile = await getProfile(openid);
      if (!profile) return { ok: false, code: 'pa_no_profile', msg: '你还不是耍伴' };
      const sub_msgs = Object.assign({}, profile.sub_msgs || {}, {
        [tmpl]: { authorized: !!event.authorized, updated_at: Date.now() }
      });
      await col('partner_profile').doc(profile._id).update({ data: { sub_msgs, updated_at: Date.now() } });
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_sub_authorize',
        target_type: 'partner_profile', target_id: profile._id,
        detail: { tmpl, authorized: !!event.authorized }, result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { sub_msgs } };
}

    // 3. 我的耍伴资料与接单统计
async function myProfileAction(ctx) {
  const { event, openid, clientIp, device, _, col, getProfile } = ctx;
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
            weekly_slots: profile.weekly_slots || null,
            accept_rate_min_fen: profile.accept_rate_min_fen === undefined ? null : profile.accept_rate_min_fen,
            accept_rate_max_fen: profile.accept_rate_max_fen === undefined ? null : profile.accept_rate_max_fen,
            accept_total_min_fen: profile.accept_total_min_fen === undefined ? null : profile.accept_total_min_fen,
            accept_total_max_fen: profile.accept_total_max_fen === undefined ? null : profile.accept_total_max_fen,
            max_distance_km: profile.max_distance_km === undefined ? null : profile.max_distance_km,
            exam_scores: profile.exam_scores || {},
            city: profile.city, accept_switch: profile.accept_switch,
            home_location: profile.home_location ? {
              name: profile.home_location.name || '',
              address: profile.home_location.address || ''
            } : null,
            sub_msgs: profile.sub_msgs || {},
            status: profile.status, applied_at: profile.applied_at,
            // 资料维护回显: 展示快照 + 审核状态(编辑页用)
            bio: (profile.profile_audited_snapshot && profile.profile_audited_snapshot.bio) || '',
            skills: (profile.profile_audited_snapshot && profile.profile_audited_snapshot.skills) || [],
            service_highlights: (profile.profile_audited_snapshot && profile.profile_audited_snapshot.highlights) || [],
            profile_audit_status: profile.profile_audit_status || '',
            profile_reject_reason: profile.profile_reject_reason || '',
            // 本次待审核内容 + 审核历史(耍伴端"审核中"区展示)
            bio_pending: profile.bio_pending || '',
            skills_pending: profile.skills_pending || [],
            highlights_pending: profile.highlights_pending || [],
            // 资质证书 / 荣誉 其他: 已审展示快照 + 待审
            qualifications: (profile.profile_audited_snapshot && profile.profile_audited_snapshot.qualifications) || { titles: [], photos: [] },
            honors: (profile.profile_audited_snapshot && profile.profile_audited_snapshot.honors) || { titles: [], photos: [] },
            qualifications_pending: profile.qualifications_pending || { titles: [], photos: [] },
            honors_pending: profile.honors_pending || { titles: [], photos: [] },
            audit_history: (profile.profile_audit_history || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0))
          },
          stats: {
            total_orders: totalOrders,
            completed_orders: completedOrders,
            good_rate: goodRate
          }
        }
      };
}

module.exports = {
  apply: applyAction,
  set_switch: setSwitchAction,
  update_config: updateConfigAction,
  sub_authorize: subAuthorizeAction,
  my_profile: myProfileAction,
};
