// admin-action · 参数配置只读组（config_get / config_history_list / config_log_list，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

function config_get(ctx) {
  const { config, ok, CONFIG_SCHEMA, resolveOperations } = ctx;
  return ok({
    env: config.env || 'prod',
    platform_fee_rate_fen: config.platform_fee_rate_fen,
    auto_approve_partner: !!config.auto_approve_partner,
    payment_visible: config.payment_visible !== false,
    block_words: config.block_words || [],
    city_enabled: config.city_enabled || [],
    test_openids: config.test_openids || [],
    error_scan_last_at: config.error_scan_last_at || 0,
    error_scan_heartbeat_at: config.error_scan_heartbeat_at || 0,
    audit_prune_last: config.audit_prune_last || null,
    timeouts: {
      s0_timeout_min: config.s0_timeout_min !== undefined ? config.s0_timeout_min : 30,
      s1_timeout_min: config.s1_timeout_min !== undefined ? config.s1_timeout_min : 15,
      interrupt_timeout_h: config.interrupt_timeout_h !== undefined ? config.interrupt_timeout_h : 24,
      eval_window_h: config.eval_window_h !== undefined ? config.eval_window_h : 48,
      default_star: config.default_star !== undefined ? config.default_star : 4,
      milestone_confirm_min: config.milestone_confirm_min !== undefined ? config.milestone_confirm_min : 15
    },
    time_redline: {
      close_min: config.time_redline_close_min !== undefined ? config.time_redline_close_min : 1440,
      open_min: config.time_redline_open_min !== undefined ? config.time_redline_open_min : 360
    },
    limits: {
      publish_distance_max_km: config.publish_distance_max_km !== undefined ? config.publish_distance_max_km : 50,
      take_distance_max_km: config.take_distance_max_km !== undefined ? config.take_distance_max_km : 50,
      youth_limit_fen: config.youth_limit_fen !== undefined ? config.youth_limit_fen : 20000
    },
    insurance: {
      coverage_accident_fen: config.insurance_coverage_accident_fen !== undefined ? config.insurance_coverage_accident_fen : 50000000,
      coverage_property_fen: config.insurance_coverage_property_fen !== undefined ? config.insurance_coverage_property_fen : 5000000
    },
    fast_withdraw: {
      per_order_max_fen: config.fast_withdraw_per_order_max_fen !== undefined ? config.fast_withdraw_per_order_max_fen : 20000,
      per_day_max_fen: config.fast_withdraw_per_day_max_fen !== undefined ? config.fast_withdraw_per_day_max_fen : 200000
    },
    security: {
      security_only_template_before_confirm: config.security_only_template_before_confirm !== false
    },
    modify_config: Object.assign(
      { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 },
      config.modify_config || {}
    ),
    idcard_aes_key_set: !!(config.idcard_aes_key && /^[0-9a-f]{64}$/i.test(config.idcard_aes_key)),
    credits: {
      min_credit_take_order: config.min_credit_take_order !== undefined ? config.min_credit_take_order : 600,
      min_credit_place_order: config.min_credit_place_order !== undefined ? config.min_credit_place_order : 600,
      credit_freeze_line: config.credit_freeze_line !== undefined ? config.credit_freeze_line : 400
    },
    rate_range: {
      rate_min_fen: config.rate_min_fen !== undefined ? config.rate_min_fen : 3000,
      rate_max_fen: config.rate_max_fen !== undefined ? config.rate_max_fen : 10000,
      scene_default_rate_fen: config.scene_default_rate_fen !== undefined ? config.scene_default_rate_fen : 5000
    },
    scene_list: config.scene_list || [],
    system_templates: config.system_templates || [],
    config_schema: CONFIG_SCHEMA,
    partner_daily_take_limit: config.partner_daily_take_limit || 5,
    operations: resolveOperations(config),
    legal: {
      disclaimer_text: config.legal_disclaimer_text || '',
      service_agreement: config.legal_service_agreement || '',
      privacy_policy: config.legal_privacy_policy || '',
      aa_promise: config.legal_aa_promise || '',
      pet_authorization: config.legal_pet_authorization || '',
      scene_disclaimers: config.legal_scene_disclaimers || {}
    }
  });
}

async function config_history_list(ctx) {
  const { event, pager, col, ok } = ctx;
  const pg = pager(event);
  const q = {};
  if (event.key) q.keys = String(event.key);
  const cnt = await col('config_history').where(q).count().catch(() => ({ total: 0 }));
  const r = await col('config_history').where(q).orderBy('at', 'desc')
    .skip(pg.skip).limit(pg.size).get().catch(() => ({ data: [] }));
  return ok({
    total: cnt.total || 0, page: pg.page, size: pg.size,
    list: (r.data || []).map((x) => ({
      _id: x._id, keys: x.keys || [], before: x.before || {}, after: x.after || {},
      reason: x.reason || '', operator: x.operator || '', at: x.at
    }))
  });
}

async function config_log_list(ctx) {
  const { event, pager, col, ok } = ctx;
  const pg = pager(event);
  const baseQ = { type: 'config_change', is_deleted: false };
  const cnt = await col('platform_event').where(baseQ).count();
  const r = await col('platform_event')
    .where(baseQ).orderBy('created_at', 'desc')
    .skip(pg.skip).limit(pg.size).get();
  return ok({
    total: cnt.total, page: pg.page, size: pg.size,
    list: r.data.map((e) => {
      const p = e.payload || {};
      return {
        _id: e._id,
        created_at: e.created_at,
        openid: e.openid || '',
        reason: p.reason || '',
        before: p.before || {},
        after: p.after || {}
      };
    })
  });
}

module.exports = { config_get, config_history_list, config_log_list };
