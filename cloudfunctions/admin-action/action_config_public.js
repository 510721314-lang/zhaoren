// admin-action · 公开配置 config_public（免鉴权，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。
const { resolveModify, resolveS2Change } = require('./config_defaults');

function config_public(ctx) {
  const { config } = ctx;
  const cfgRaw = config || {};
  const nsInt = (v, def) => (v === undefined || v === null || v === '' ? def : Number(v));
  // 2026-11-05 N-3: 改期/S2 规则默认值统一由 _shared/config_defaults.js 提供（副本经 sync 同步）
  const subGrab = (cfgRaw.sub_msg_templates && cfgRaw.sub_msg_templates.demand_grab) || {};
  const demandGrab = subGrab.tmpl_id ? {
    enabled: true,
    tmpl_id: subGrab.tmpl_id,
    page: subGrab.page || 'pages-v2/demand-detail/demand-detail',
    miniprogram_state: subGrab.miniprogram_state || 'formal',
    fields: subGrab.fields || null
  } : { enabled: false };
  const subUrge = (cfgRaw.sub_msg_templates && cfgRaw.sub_msg_templates.demand_urge) || {};
  const demandUrge = subUrge.tmpl_id ? {
    enabled: true,
    tmpl_id: subUrge.tmpl_id,
    page: subUrge.page || 'pages-v2/order-detail/order-detail',
    miniprogram_state: subUrge.miniprogram_state || 'formal',
    fields: subUrge.fields || null
  } : { enabled: false };
  const subComm = (cfgRaw.sub_msg_templates && cfgRaw.sub_msg_templates.confirm_comm) || {};
  const confirmComm = subComm.tmpl_id ? {
    enabled: true,
    tmpl_id: subComm.tmpl_id,
    page: subComm.page || 'pages-v2/chat/chat',
    miniprogram_state: subComm.miniprogram_state || 'formal',
    fields: subComm.fields || null
  } : { enabled: false };
  return { ok: true, data: {
    version: cfgRaw.version,
    timeouts: {
      s0_timeout_min: cfgRaw.s0_timeout_min,
      s1_timeout_min: cfgRaw.s1_timeout_min,
      interrupt_timeout_h: cfgRaw.interrupt_timeout_h,
      // 2026-11-10 修复: S4 裁定期(天)单独下发; 前端原把 interrupt_timeout_h(小时) 当日渲染成「24天」
      partial_judge_days: cfgRaw.partial_judge_days !== undefined ? cfgRaw.partial_judge_days : 7,
      eval_window_h: cfgRaw.eval_window_h,
      default_star: cfgRaw.default_star,
      // 加时确认窗口(批3.4 补齐; 2026-10-13 改分钟制默认 20): 0 = 跟随改期确认窗口(与 order-timer/order-action 同一口径)
      extend_confirm_min: cfgRaw.extend_confirm_min !== undefined ? cfgRaw.extend_confirm_min : 20
    },
    credits: { credit_freeze_line: cfgRaw.credit_freeze_line },
    rate_range: { rate_min_fen: cfgRaw.rate_min_fen, rate_max_fen: cfgRaw.rate_max_fen },
    scene_default_rate_fen: cfgRaw.scene_default_rate_fen,
    time_redline: {
      open_min: cfgRaw.time_redline_open_min !== undefined ? cfgRaw.time_redline_open_min : 360,
      close_min: cfgRaw.time_redline_close_min !== undefined ? cfgRaw.time_redline_close_min : 1440
    },
    limits: {
      publish_distance_max_km: cfgRaw.publish_distance_max_km,
      take_distance_max_km: cfgRaw.take_distance_max_km,
      youth_limit_fen: cfgRaw.youth_limit_fen
    },
    insurance: {
      // 2026-11-10 修复: 运营页落库为顶层键(schema f), 原读嵌套 insurance.* 恒 undefined
      coverage_accident_fen: cfgRaw.insurance_coverage_accident_fen !== undefined ? cfgRaw.insurance_coverage_accident_fen : 50000000,
      coverage_property_fen: cfgRaw.insurance_coverage_property_fen !== undefined ? cfgRaw.insurance_coverage_property_fen : 5000000
    },
    fast_withdraw: {
      per_order_max_fen: cfgRaw.fast_withdraw_per_order_max_fen !== undefined ? cfgRaw.fast_withdraw_per_order_max_fen : 20000,
      per_day_max_fen: cfgRaw.fast_withdraw_per_day_max_fen !== undefined ? cfgRaw.fast_withdraw_per_day_max_fen : 200000
    },
    modify_config: resolveModify(cfgRaw),
    s2_change: (() => {
      const s = resolveS2Change(cfgRaw);
      return {
        enabled: s.enabled, b_min_hours: s.bMinHours, a_min_hours: s.aMinHours,
        a_confirm_min: s.aConfirmMin, b_confirm_min: s.bConfirmMin,
        per_field_max: s.perFieldMax, total_max: s.totalMax
      };
    })(),
    switches: {
      switch_access: cfgRaw.switch_access !== false,
      switch_blog: cfgRaw.switch_blog !== false,
      switch_im: cfgRaw.switch_im !== false
    },
    partner_accept: {
      daily_take_limit: cfgRaw.partner_daily_take_limit || 5
    },
    realname: {
      face_mode: cfgRaw.realname_face_mode || 'mock'
    },
    legal_public: {
      service_agreement: cfgRaw.legal_service_agreement || '',
      aa_promise: cfgRaw.legal_aa_promise || '',
      pet_authorization: cfgRaw.legal_pet_authorization || '',
      // 批1a(2026-10-25): 补齐隐私政策/通用免责 + 各文档生效版本号。
      // 版本号由 legal_doc_publish 双写维护(admin_config.legal_versions)，旧客户端忽略未知字段，行为不变。
      privacy_policy: cfgRaw.legal_privacy_policy || '',
      disclaimer_text: cfgRaw.legal_disclaimer_text || '',
      versions: cfgRaw.legal_versions || {}
    },
    partner_profile: {
      skills_max: cfgRaw.p_skills_max !== undefined ? cfgRaw.p_skills_max : 10,
      skills_len: cfgRaw.p_skills_len !== undefined ? cfgRaw.p_skills_len : 12,
      highlights_max: cfgRaw.p_highlights_max !== undefined ? cfgRaw.p_highlights_max : 3,
      highlight_len: cfgRaw.p_highlight_len !== undefined ? cfgRaw.p_highlight_len : 30,
      media_title_max: cfgRaw.p_media_title_max !== undefined ? cfgRaw.p_media_title_max : 20,
      media_len: cfgRaw.p_media_len !== undefined ? cfgRaw.p_media_len : 20,
      media_photo_max: cfgRaw.p_media_photo_max !== undefined ? cfgRaw.p_media_photo_max : 6,
      media_photo_size_mb: cfgRaw.p_media_photo_size_mb !== undefined ? cfgRaw.p_media_photo_size_mb : 3,
      bio_len: cfgRaw.p_bio_len !== undefined ? cfgRaw.p_bio_len : 200
    },
    message: {
      page_size: cfgRaw.msg_page_size !== undefined ? cfgRaw.msg_page_size : 15
    },
    publish: {
      content_options_max: cfgRaw.publish_content_options_max !== undefined ? cfgRaw.publish_content_options_max : 3,
      // 场景卡服务项展示上限(批3.2): 发布页/场景卡最多展示几项(展示层), 与勾选上限 content_options_max 不同
      scene_option_display_max: cfgRaw.scene_option_display_max !== undefined ? cfgRaw.scene_option_display_max : 3,
      welfare_hourly_rate_fen: cfgRaw.welfare_hourly_rate_fen !== undefined ? cfgRaw.welfare_hourly_rate_fen : 3000,
      fixed_price_min_fen: cfgRaw.fixed_price_min_fen,
      fixed_price_max_fen: cfgRaw.fixed_price_max_fen,
      welfare_fixed_price_fen: cfgRaw.welfare_fixed_price_fen,
      good_review_min_stars: cfgRaw.order_good_review_min_stars !== undefined ? cfgRaw.order_good_review_min_stars : 4,
      reason_max_len: cfgRaw.order_reason_max_len !== undefined ? cfgRaw.order_reason_max_len : 200,
      title_max_len: cfgRaw.publish_title_max_len !== undefined ? cfgRaw.publish_title_max_len : 20,
      desc_max_len: cfgRaw.publish_desc_max_len !== undefined ? cfgRaw.publish_desc_max_len : 200,
      share_title_max: cfgRaw.share_title_max !== undefined ? cfgRaw.share_title_max : 30
    },
    no_show: {
      report_window_h: nsInt(cfgRaw.no_show_report_window_h, 48),
      defense_window_h: nsInt(cfgRaw.no_show_defense_window_h, 48),
      score_deduct: nsInt(cfgRaw.no_show_score_deduct, 20),
      suspend_threshold: nsInt(cfgRaw.no_show_suspend_threshold, 3),
      suspend_days: nsInt(cfgRaw.no_show_suspend_days, 7),
      count_window_days: nsInt(cfgRaw.no_show_count_window_days, 180),
      evidence_max: nsInt(cfgRaw.no_show_evidence_max, 3),
      reason_min_len: nsInt(cfgRaw.no_show_reason_min_len, 10),
      max_per_order: nsInt(cfgRaw.no_show_max_per_order, 1)
    },
    paging: {
      order_page_size: cfgRaw.order_page_size !== undefined ? cfgRaw.order_page_size : 20,
      index_nearby: cfgRaw.page_index_nearby !== undefined ? cfgRaw.page_index_nearby : 10,
      index_square: cfgRaw.page_index_square !== undefined ? cfgRaw.page_index_square : 20,
      square_limit: cfgRaw.page_square_limit !== undefined ? cfgRaw.page_square_limit : 50,
      nearby_limit: cfgRaw.page_nearby_limit !== undefined ? cfgRaw.page_nearby_limit : 20,
      wallet_withdraw: cfgRaw.page_wallet_withdraw !== undefined ? cfgRaw.page_wallet_withdraw : 20,
      notice_limit: cfgRaw.page_notice_limit !== undefined ? cfgRaw.page_notice_limit : 50
    },
    workbench: {
      income_show: cfgRaw.workbench_income_show !== undefined ? cfgRaw.workbench_income_show : 5
    },
    payment: {
      tip_enabled: cfgRaw.env === 'dev' || cfgRaw.mock_payment_enabled === true
    },
    sub_msg: {
      demand_grab: demandGrab,
      demand_urge: demandUrge,
      confirm_comm: confirmComm
    },
    urge: {
      remind_after_h: nsInt(cfgRaw.remind_after_h, 1),
      escalate_after_h: nsInt(cfgRaw.escalate_after_h, 4),
      max_count: nsInt(cfgRaw.urge_max_count, 2)
    },
    // 评价激励(D, 2026-10-14): 双方分别配置; 缺省 0=不发(fail-closed)
    eval_reward: {
      user_fen: nsInt(cfgRaw.eval_reward_user_fen, 0),
      user_credit: nsInt(cfgRaw.eval_reward_user_credit, 0),
      partner_fen: nsInt(cfgRaw.eval_reward_partner_fen, 0),
      partner_credit: nsInt(cfgRaw.eval_reward_partner_credit, 0)
    },
    // 理由文案(2026-11-11): 加时/改期 picker 显示文案可后台配置; key 固定(服务端 REASON_TYPES 白名单), 仅覆盖 t 字段; 缺省回退内置默认
    reason_labels: {
      extend: normalizeReasonLabels(cfgRaw.reason_labels_extend, 'extend', [
        { k: 'time_conflict', t: '时间冲突' }, { k: 'content_adjust', t: '内容调整' }, { k: 'other', t: '其他' }
      ]),
      modify: normalizeReasonLabels(cfgRaw.reason_labels_modify, 'modify', [
        { k: 'time_conflict', t: '时间冲突' }, { k: 'other', t: '其他' }
      ])
    }
  } };
}

// reason_labels_* 校验: 必须是 [{k,t}] 数组且 k 命中该通道内置白名单; 非法项剔除, 全非法回退默认(fail-closed)
const REASON_LABEL_KEYS = {
  extend: ['time_conflict', 'content_adjust', 'other'],
  modify: ['time_conflict', 'other']
};
function normalizeReasonLabels(raw, kind, def) {
  if (!Array.isArray(raw) || !raw.length) return def;
  const allowed = REASON_LABEL_KEYS[kind] || [];
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const k = String(it.k || '');
    const t = String(it.t || '').trim();
    if (!k || !t || allowed.indexOf(k) < 0) continue;
    out.push({ k, t: t.slice(0, 20) });
  }
  return out.length ? out : def;
}

module.exports = { config_public };
