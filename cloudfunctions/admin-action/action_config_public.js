// admin-action · 公开配置 config_public（免鉴权，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

function config_public(ctx) {
  const { config } = ctx;
  const cfgRaw = config || {};
  const nsInt = (v, def) => (v === undefined || v === null || v === '' ? def : Number(v));
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
  return { ok: true, data: {
    version: cfgRaw.version,
    timeouts: {
      s0_timeout_min: cfgRaw.s0_timeout_min,
      s1_timeout_min: cfgRaw.s1_timeout_min,
      interrupt_timeout_h: cfgRaw.interrupt_timeout_h,
      eval_window_h: cfgRaw.eval_window_h,
      default_star: cfgRaw.default_star
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
      coverage_accident_fen: cfgRaw.insurance && cfgRaw.insurance.coverage_accident_fen,
      coverage_property_fen: cfgRaw.insurance && cfgRaw.insurance.coverage_property_fen
    },
    fast_withdraw: {
      per_order_max_fen: cfgRaw.fast_withdraw && cfgRaw.fast_withdraw.per_order_max_fen,
      per_day_max_fen: cfgRaw.fast_withdraw && cfgRaw.fast_withdraw.per_day_max_fen
    },
    modify_config: cfgRaw.modify_config,
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
      pet_authorization: cfgRaw.legal_pet_authorization || ''
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
      welfare_hourly_rate_fen: cfgRaw.welfare_hourly_rate_fen !== undefined ? cfgRaw.welfare_hourly_rate_fen : 3000,
      fixed_price_min_fen: cfgRaw.fixed_price_min_fen,
      fixed_price_max_fen: cfgRaw.fixed_price_max_fen,
      welfare_fixed_price_fen: cfgRaw.welfare_fixed_price_fen,
      good_review_min_stars: cfgRaw.order_good_review_min_stars !== undefined ? cfgRaw.order_good_review_min_stars : 4,
      reason_max_len: cfgRaw.order_reason_max_len !== undefined ? cfgRaw.order_reason_max_len : 200,
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
      demand_urge: demandUrge
    },
    urge: {
      remind_after_h: nsInt(cfgRaw.remind_after_h, 1),
      escalate_after_h: nsInt(cfgRaw.escalate_after_h, 4),
      max_count: nsInt(cfgRaw.urge_max_count, 2)
    }
  } };
}

module.exports = { config_public };
