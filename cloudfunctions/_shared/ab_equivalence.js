// A/B 等价性比对：拆分前(_orig_baseline.js) vs 当前(index.js)，同输入深比较。
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { makeSdk } = require('./_mock_sdk');
const crypto = require('crypto');

const USER = 'o_user_1', PARTNER = 'o_partner_1', STRANGER = 'o_stranger';
const ADMIN = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
const OID = 'a'.repeat(32);
const baseStore = () => ({
  admin_config: { global: { env: 'dev' } },
  order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER, start_time: Date.now() - 60000, urge_count: 0 } },
  system_notice: {}, user_account: {}, demand: {}
});
// admin-action: 白名单含 ADMIN，env=dev 放行 mock_openid 测试管理员
const adminStore = () => ({
  admin_config: { global: { env: 'dev', admin_openids: [ADMIN] } },
  order_main: { [OID]: { _id: OID, order_no: 'ORD-TEST', status: 'S10', user_openid: USER, partner_openid: PARTNER } },
  platform_event: {}, config_history: {}, audit_log: {}
});
// demand-publish: 拆分试点(cancel / lazy_expire)用例夹具
const DID = 'd'.repeat(32);
const dpStore = (demand) => ({
  admin_config: { global: { env: 'dev' } },
  demand: demand ? { [DID]: Object.assign({ _id: DID, demand_no: 'DR-TEST', scene: 'W1', is_deleted: false }, demand) } : {},
  order_main: {}, system_notice: {}, user_account: {}
});
// demand-publish: 全面拆分用例夹具(env=dev 放行 mock_openid; 富配置/实名用户让 publish 穿透到写库成功)
const DPUID = 'u'.repeat(32);
const dpPubStore = (over) => Object.assign({
  admin_config: { global: {
    env: 'dev',
    scene_list: [{ code: 'W1', name: '就医陪诊', options: ['陪同挂号', '取药', '陪检'], visible: true, builtin: true, disclaimer_type: 'medical_disclaimer' }],
    legal_scene_disclaimers: { W1: 'W1 就医陪诊场景免责声明全文' },
    rate_min_fen: 3000, rate_max_fen: 10000,
    min_credit_place_order: 600, min_credit_take_order: 600,
    city_enabled: ['成都'], publish_distance_max_km: 50, take_distance_max_km: 50,
    welfare_fixed_price_fen: 5000
  } },
  user_account: { [DPUID]: { _id: DPUID, openid: USER, nickname: '张三', surname: '张', status: 'normal', is_realname_done: true, user_credit_score: 800, age: null, is_deleted: false } },
  emergency_contact: {}, partner_profile: {}, demand_draft: {}, disclaimer_signature: {},
  demand: {}, order_main: {}, system_notice: {}, audit_log: {}, platform_event: {}
}, over || {});
// partner-action: 物理拆分用例夹具(admin_config env=dev 放行 mock_openid; 已认证耍伴 profile)
const PAID = 'p'.repeat(32);
const paStore = (over) => Object.assign({
  admin_config: { global: { env: 'dev', admin_openids: [ADMIN], scene_list: [{ code: 'W1' }, { code: 'W2' }] } },
  user_account: { ['u'.repeat(32)]: { _id: 'u'.repeat(32), openid: USER, roles: ['user', 'partner'], nick_name: '我', nickname: '我' } },
  partner_profile: { [PAID]: { _id: PAID, openid: USER, status: 'approved', accept_scenes: ['W1'], is_deleted: false } },
  system_notice: {}, audit_log: {}, exam_bank: {}, evaluation: {}, order_main: {}
}, over || {});
// order-timer: 拆分用例夹具(纯 cron 入口, 经 timer event 触发; prod 口径忽略 mock_openid)
const otStore = (over) => Object.assign({
  admin_config: { global: { env: 'prod', admin_openids: [] } },
  order_main: {}, user_account: {}, demand: {}, system_notice: {}, order_status_log: {},
  platform_event: {}, audit_log: {}, evaluation: {}, credit_score_log: {}, admin_web_session: {}
}, over || {});

// payment-mock: 物理拆分用例夹具(env=dev + dev_until 未来 → 放行 mock_openid 与 mock 资金门控 MOCK_ONLY_ACTIONS)
const pmStore = (over) => Object.assign({
  admin_config: { global: { env: 'dev', dev_until: Date.now() + 3600 * 1000, mock_payment_enabled: true, scene_list: [{ code: 'W1', name: '陪诊' }] } },
  order_main: { [OID]: { _id: OID, order_no: 'ORD-PM', status: 'S0', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, fee_fen: 100, scene: 'W1', aa_tier: '0-50', pricing_type: 'hourly', pay_expire_at: Date.now() + 3600 * 1000 } },
  pay_transaction: {}, withdraw_record: {}, withdraw_lock: {}, insurance_record: {},
  user_account: {}, partner_profile: {}, system_notice: {}, order_status_log: {}, audit_log: {}, credit_score_log: {}
}, over || {});

// home-action: 物理拆分用例夹具(env=dev + dev_until 未来 → resolveOpenid 放行 mock_openid;
// admin_config 含 scene_list(W8 隐藏)/home_activities/take_distance_max_km; USER 为 approved 耍伴带 home_location)
const HUSER = 'h'.repeat(32);
const haStore = (over) => Object.assign({
  admin_config: { global: {
    env: 'dev', dev_until: Date.now() + 3600 * 1000, take_distance_max_km: 50,
    scene_list: [
      { code: 'W1', name: '就医陪诊', options: ['陪同挂号', '取药', '陪检', '陪护'], visible: true, builtin: true, hidden_options: ['陪护'] },
      { code: 'W2', name: '学习陪伴', options: ['陪读', '答疑'], visible: true, builtin: true },
      { code: 'W8', name: '生活协助', options: ['代购'], visible: false, builtin: true }
    ],
    home_activities: [
      { id: 'act_banner', type: 'both', status: 'active', title: '首页横幅', priority: 5, jump_to: 'demand_publish', jump_param: {} },
      { id: 'act_card', type: 'card', status: 'active', title: '  卡片  ', priority: 3, scene_code: 'W1', subtitle: '副标题', jump_to: 'scene_list', jump_param: {} },
      { id: 'act_off', type: 'card', status: 'inactive', title: '停用', jump_to: 'scene_list', jump_param: {} }
    ]
  } },
  user_account: {
    [HUSER]: { _id: HUSER, openid: HUSER, nickname: '主页用户', surname: '李', roles: ['user'], status: 'normal', city_list: ['成都'], created_at: 100 },
    ['u'.repeat(32)]: { _id: 'u'.repeat(32), openid: USER, nickname: '我', surname: '张', roles: ['user', 'partner'], status: 'normal', created_at: 200 },
    ['v'.repeat(32)]: { _id: 'v'.repeat(32), openid: PARTNER, nickname: '伴', surname: '王', roles: ['user'], status: 'normal', created_at: 300 }
  },
  partner_profile: {
    ['p'.repeat(32)]: { _id: 'p'.repeat(32), openid: USER, status: 'approved', accept_scenes: ['W1'], home_location: { latitude: 30.5, longitude: 104.0 }, accept_rate_min_fen: 0, accept_rate_max_fen: 10000, max_distance_km: 10, city: ['成都'], is_deleted: false },
    ['q'.repeat(32)]: { _id: 'q'.repeat(32), openid: PARTNER, status: 'approved', accept_scenes: ['W1', 'W2'], home_location: { latitude: 30.6, longitude: 104.1 }, city: ['成都'], is_deleted: false }
  },
  demand: {
    ['d'.repeat(32)]: { _id: 'd'.repeat(32), demand_no: 'DR-HA1', scene: 'W1', status: 'matching', is_deleted: false, broadcast: true, match_mode: 'broadcast', creator_openid: PARTNER, created_at: Date.now() - 5 * 60000 - 30000, start_time: Date.now() + 3600000, expire_at: Date.now() + 7200000, location: { name: '成都市', city: '成都', latitude: 30.55, longitude: 104.05 }, remark: '需求标题｜需求描述', rate_fen: 5000, pricing_type: 'hourly' }
  },
  blog_post: {
    ['b'.repeat(32)]: { _id: 'b'.repeat(32), author_openid: HUSER, author_nickname: '主页用户', status: 'normal', is_deleted: false, content: '这是一条测试动态内容', images: ['cloud://x/1.png', 'https://ignored'], tags: ['生活'], scene: 'W1', like_count: 3, comment_count: 1, created_at: 500 }
  },
  system_notice: {}, audit_log: {}
}, over || {});

// P1 E2E: CN 12:00 安全时间戳(落在 redline 运营时段内), A/B 两侧同值故不影响等价
const _tsD = new Date(); _tsD.setUTCDate(_tsD.getUTCDate() + 1); _tsD.setUTCHours(4, 0, 0, 0);
const NEW_TS = _tsD.getTime();
const START_TS = NEW_TS - 24 * 3600 * 1000;
// 爽约申诉窗口: 约定开始时间须在「now - reportWindowH(48h)」之后, 取 1h 前
const RECENT_TS = Date.now() - 3600 * 1000;

// order-create: 物理拆分用例夹具(env=dev → resolveOpenid 放行; USER=approved 耍伴带实名/信用/接单场景,
// PARTNER=需求发布者; demand 处于 matching 且在允许时段/未过期 → create_from_take 可穿透到建单事务)
const DEM = 'd'.repeat(32);
const ocStore = (over) => Object.assign({
  admin_config: { global: {
    env: 'dev', dev_until: Date.now() + 3600 * 1000, take_distance_max_km: 50,
    min_credit_take_order: 600, min_credit_place_order: 600, youth_limit_fen: 20000,
    platform_fee_rate_fen: 1000, legal_scene_disclaimers: { W1: 'W1就医陪诊场景免责声明全文' }
  } },
  user_account: {
    ['u'.repeat(32)]: { _id: 'u'.repeat(32), openid: USER, nickname: '耍伴', roles: ['user', 'partner'], status: 'normal', is_realname_done: true, partner_credit_score: 800, user_credit_score: 800, age: null, is_deleted: false },
    ['v'.repeat(32)]: { _id: 'v'.repeat(32), openid: PARTNER, nickname: '需方', roles: ['user'], status: 'normal', user_credit_score: 800, age: null, is_deleted: false }
  },
  partner_profile: {
    ['p'.repeat(32)]: { _id: 'p'.repeat(32), openid: USER, status: 'approved', accept_switch: true, accept_scenes: ['W1'], exam_scores: { base: 100, W1: 100 }, max_distance_km: 10, is_deleted: false }
  },
  demand: {
    [DEM]: { _id: DEM, demand_no: 'DR-OC1', scene: 'W1', status: 'matching', is_deleted: false, broadcast: true, match_mode: 'broadcast', creator_openid: PARTNER, start_time: NEW_TS, duration_h: 1, expire_at: Date.now() + 7200000, location: { name: '成都市', city: '成都', latitude: 30.5, longitude: 104.0 }, publish_location: null, content_options: ['陪同挂号'], pricing_type: 'hourly', rate_fen: 5000, total_fen: 5000, project_attr: 'commercial', headcount: 1 }
  },
  disclaimer_signature: {
    ['s'.repeat(32)]: { _id: 's'.repeat(32), openid: USER, role: 'partner', scene: 'W1', is_deleted: false, signature_hash: 'abc123', docs: [] }
  },
  exam_bank: {},
  // 批3b'(2026-10-23): 接单硬门禁要求已填紧急联系人; 基线不读此集合, 加种子对基线无影响
  emergency_contact: {
    ['e'.repeat(32)]: { _id: 'e'.repeat(32), openid: USER, name: '张三', phone: '13800000000', relation: '家人', is_deleted: false }
  },
  order_main: {}, order_confirmations: {}, order_status_log: {}, platform_event: {},
  system_notice: {}, audit_log: {}
}, over || {});
// 无耍伴角色夹具(触发 order_not_partner)
const ocNoPartner = () => ocStore({ user_account: {
  ['u'.repeat(32)]: { _id: 'u'.repeat(32), openid: USER, nickname: '耍伴', roles: ['user'], status: 'normal', is_realname_done: true, partner_credit_score: 800 },
  ['v'.repeat(32)]: { _id: 'v'.repeat(32), openid: PARTNER, nickname: '需方', roles: ['user'], status: 'normal', user_credit_score: 800 }
} });

// user-login: 物理拆分(地图组 set_map_share / report_map_gps / nearby_map_list)用例夹具
const ULID = 'u'.repeat(32);
const ULID2 = 'v'.repeat(32);
const ulStore = (user) => ({
  admin_config: { global: { env: 'dev' } },
  user_account: user ? { [ULID]: Object.assign({ _id: ULID, openid: USER, roles: ['user'], is_deleted: false }, user) } : {},
  audit_log: {}
});
// 双人地图夹具: 我(USER, 已开共享 + 有效定位) + TA(PARTNER, 已开共享 + 有效定位)
const ulMapStore = () => ({
  admin_config: { global: { env: 'dev' } },
  user_account: {
    [ULID]: { _id: ULID, openid: USER, roles: ['user'], nickname: '我', allow_map_share: true, map_gps: { lat: 30.5, lng: 104.0, at: Date.now() }, is_deleted: false },
    [ULID2]: { _id: ULID2, openid: PARTNER, roles: ['partner'], nickname: 'TA', avatar: 'https://x/y.png', allow_map_share: true, map_gps: { lat: 30.6, lng: 104.1, at: Date.now() }, is_deleted: false }
  },
  audit_log: {}
});

const CASES = [
  { name: 'detail_ok', openid: USER, event: { action: 'detail', order_id: OID, mock_openid: USER } },
  { name: 'detail_not_found', openid: USER, store: { admin_config: { global: { env: 'dev' } }, order_main: {} }, event: { action: 'detail', order_id: OID, mock_openid: USER } },
  { name: 'detail_not_participant', openid: STRANGER, event: { action: 'detail', order_id: OID, mock_openid: STRANGER } },
  { name: 'my_orders_partner', openid: PARTNER, event: { action: 'my_orders', role: 'partner', filter: 'all', mock_openid: PARTNER } },
  { name: 'my_orders_user', openid: USER, event: { action: 'my_orders', role: 'user', filter: 'doing', mock_openid: USER } },
  { name: 'my_counts_user', openid: USER, event: { action: 'my_counts', role: 'user', mock_openid: USER } },
  { name: 'notice_list', openid: USER, event: { action: 'notice_list', limit: 20, mock_openid: USER } },
  { name: 'notice_poll_bad', openid: USER, event: { action: 'notice_poll', order_id: 'bad', mock_openid: USER } },
  { name: 'notice_read_all', openid: USER, event: { action: 'notice_read', mock_openid: USER } },
  { name: 'nudge_not_owner', openid: STRANGER, event: { action: 'nudge_partner', order_id: OID, mock_openid: STRANGER } },
  { name: 'cancel_not_participant', openid: STRANGER, event: { action: 'cancel', order_id: OID, mock_openid: STRANGER } },
  { name: 'get_conf_not_found', openid: USER, store: { admin_config: { global: { env: 'dev' } }, order_main: {} }, event: { action: 'get_confirmation', order_id: OID, mock_openid: USER } },
  { name: 'get_conf_not_participant', openid: STRANGER, event: { action: 'get_confirmation', order_id: OID, mock_openid: STRANGER } },
  { name: 'update_item_bad', openid: USER, event: { action: 'update_item', order_id: OID, item: 'xxx', mock_openid: USER } },
  { name: 'update_item_not_editable', openid: USER, event: { action: 'update_item', order_id: OID, item: 'time', mock_openid: USER } },
  { name: 'confirm_item_bad', openid: USER, event: { action: 'confirm_item', order_id: OID, item: 'bad', mock_openid: USER } },
  { name: 'confirm_all_not_participant', openid: STRANGER, event: { action: 'confirm_all', order_id: OID, mock_openid: STRANGER } },
  { name: 'cancel_not_participant', openid: STRANGER, event: { action: 'cancel', order_id: OID, mock_openid: STRANGER } },
  { name: 'cancel_status', openid: USER, event: { action: 'cancel', order_id: OID, mock_openid: USER } },
  { name: 'start_perm', openid: USER, event: { action: 'start_service', order_id: OID, mock_openid: USER } },
  { name: 'complete_status', openid: PARTNER, event: { action: 'complete_service', order_id: OID, mock_openid: PARTNER } },
  { name: 'ms_invalid', openid: USER, event: { action: 'milestone_confirm', order_id: OID, mock_openid: USER } },
  { name: 'resume_status', openid: PARTNER, event: { action: 'resume_service', order_id: OID, mock_openid: PARTNER } },
  { name: 'modify_bad_time', openid: USER, event: { action: 'modify', order_id: OID, new_start_time: Date.now() - 1000, mock_openid: USER } },
  { name: 'modify_not_participant', openid: STRANGER, event: { action: 'modify', order_id: OID, new_start_time: Date.now() + 86400000, mock_openid: STRANGER } },
  { name: 'extend_hours_bad', openid: USER, event: { action: 'extend', order_id: OID, add_hours: 0, mock_openid: USER } },
  { name: 'extend_status', openid: PARTNER, event: { action: 'extend', order_id: OID, add_hours: 1, mock_openid: PARTNER } },
  { name: 'extend_reject_no_pending', openid: PARTNER, event: { action: 'extend_reject', order_id: OID, mock_openid: PARTNER } },
  { name: 'partial_status', openid: USER, event: { action: 'partial_confirm', order_id: OID, mock_openid: USER } },
  { name: 'ratio_status', openid: USER, event: { action: 'ratio_confirm', order_id: OID, mock_openid: USER } },
  { name: 'complaint_status', openid: USER, event: { action: 'complaint', order_id: OID, mock_openid: USER } },
  { name: 'complaint_not_participant', openid: STRANGER, event: { action: 'complaint', order_id: OID, mock_openid: STRANGER } },
  { name: 'cw_status', openid: USER, event: { action: 'complaint_withdraw', order_id: OID, mock_openid: USER } },
  { name: 'ns_bad_report', openid: PARTNER, event: { action: 'no_show_report_defense', report_id: 'x', mock_openid: PARTNER } },
  { name: 'nsw_bad_report', openid: USER, event: { action: 'no_show_report_withdraw', report_id: 'x', mock_openid: USER } },
  { name: 'ns_detail_not_participant', openid: STRANGER, event: { action: 'no_show_report_detail', order_id: OID, mock_openid: STRANGER } },
  // ── demand-publish：拆分试点 cancel / lazy_expire A/B 证据（拆分前 git 版本作 baseline）──
  { fn: 'demand-publish', name: 'dp_cancel_no_id', openid: USER, event: { action: 'cancel', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_cancel_bad_id', openid: USER, event: { action: 'cancel', demand_id: 'x', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_cancel_not_found', openid: USER, store: dpStore(null), event: { action: 'cancel', demand_id: DID, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_cancel_not_owner', openid: STRANGER, store: dpStore({ status: 'matching', creator_openid: USER }), event: { action: 'cancel', demand_id: DID, mock_openid: STRANGER } },
  { fn: 'demand-publish', name: 'dp_cancel_status', openid: USER, store: dpStore({ status: 'matched', creator_openid: USER }), event: { action: 'cancel', demand_id: DID, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_cancel_ok', openid: USER, store: dpStore({ status: 'matching', creator_openid: USER }), event: { action: 'cancel', demand_id: DID, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_lazy_expire_none', openid: USER, store: dpStore(null), event: { action: 'lazy_expire', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_lazy_expire_one', openid: USER, store: dpStore({ status: 'matching', creator_openid: USER, expire_at: 1 }), event: { action: 'lazy_expire', mock_openid: USER } },
  // ── demand-publish：全面拆分 8 个 action(publish/my_demands/detail/detail_light/save_draft/list_drafts/delete_draft/update) A/B 证据 ──
  { fn: 'demand-publish', name: 'dp_publish_no_scene', openid: USER, store: dpPubStore(), event: { action: 'publish', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_publish_bad_time', openid: USER, store: dpPubStore(), event: { action: 'publish', scene: 'W1', start_time: 1, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_publish_ok', openid: USER, store: dpPubStore(), event: {
    action: 'publish', mock_openid: USER, device: 'test',
    scene: 'W1', start_time: NEW_TS, duration_h: 1,
    location: { name: '成都武侯区某医院', latitude: 30.55, longitude: 104.05, city: '成都' },
    publish_location: { name: '当前位置', latitude: 30.55, longitude: 104.05, city: '成都' },
    aa_tier: '0-50', aa_promise_checked: true, disclaimer_signed: true,
    content_options: ['陪同挂号'], rate_fen: 5000, match_mode: 'broadcast',
    publish_type: 'self', contact_phone: '13800000000', headcount: 1 } },
  { fn: 'demand-publish', name: 'dp_my_demands_ok', openid: USER, store: dpStore({ status: 'matching', creator_openid: USER }), event: { action: 'my_demands', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_detail_no_id', openid: USER, store: dpStore(null), event: { action: 'detail', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_detail_ok', openid: USER, store: dpStore({ status: 'matching', creator_openid: USER, content_options: ['陪同挂号'], remark: '需求标题｜需求描述', start_time: Date.now() + 3600000, duration_h: 1, rate_fen: 5000, pricing_type: 'hourly', location: { name: '成都市', city: '成都', latitude: 30.55, longitude: 104.05 }, contact_phone: '13800000000', created_at: Date.now() - 5 * 60000 }), event: { action: 'detail', demand_id: DID, viewer_lat: 30.6, viewer_lng: 104.1, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_detail_light_no_id', openid: USER, store: dpStore(null), event: { action: 'detail_light', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_detail_light_ok', openid: USER, store: dpStore({ status: 'matching', creator_openid: USER }), event: { action: 'detail_light', demand_id: DID, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_save_draft_no_data', openid: USER, store: dpStore(null), event: { action: 'save_draft', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_save_draft_create', openid: USER, store: dpStore(null), event: { action: 'save_draft', demand_data: { scene: 'W1', remark: 'draft' }, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_list_drafts_ok', openid: USER, store: dpStore(null), event: { action: 'list_drafts', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_delete_draft_no_id', openid: USER, store: dpStore(null), event: { action: 'delete_draft', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_update_no_id', openid: USER, store: dpStore(null), event: { action: 'update', mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_update_not_owner', openid: USER, store: dpStore({ status: 'matching', creator_openid: STRANGER }), event: { action: 'update', demand_id: DID, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_update_bad_status', openid: USER, store: dpStore({ status: 'matched', creator_openid: USER }), event: { action: 'update', demand_id: DID, mock_openid: USER } },
  { fn: 'demand-publish', name: 'dp_unknown', openid: USER, store: dpStore(null), event: { action: 'nope_xxx', mock_openid: USER } },
  // ── user-login：物理拆分地图组(set_map_share / report_map_gps / nearby_map_list) A/B 证据 ──
  { fn: 'user-login', name: 'ul_map_share_bad_allow', openid: USER, store: ulStore({ allow_map_share: true }), event: { action: 'set_map_share', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_map_share_no_user', openid: USER, store: ulStore(null), event: { action: 'set_map_share', allow: true, mock_openid: USER } },
  { fn: 'user-login', name: 'ul_map_share_on', openid: USER, store: ulStore({ allow_map_share: false }), event: { action: 'set_map_share', allow: true, mock_openid: USER } },
  { fn: 'user-login', name: 'ul_map_share_off', openid: USER, store: ulStore({ allow_map_share: true, map_gps: { lat: 30.5, lng: 104, at: 1 } }), event: { action: 'set_map_share', allow: false, mock_openid: USER } },
  { fn: 'user-login', name: 'ul_gps_bad_location', openid: USER, store: ulStore({ allow_map_share: true }), event: { action: 'report_map_gps', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_gps_bad_range', openid: USER, store: ulStore({ allow_map_share: true }), event: { action: 'report_map_gps', latitude: 999, longitude: 104, mock_openid: USER } },
  { fn: 'user-login', name: 'ul_gps_no_user', openid: USER, store: ulStore(null), event: { action: 'report_map_gps', latitude: 30.5, longitude: 104, mock_openid: USER } },
  { fn: 'user-login', name: 'ul_gps_share_off', openid: USER, store: ulStore({ allow_map_share: false }), event: { action: 'report_map_gps', latitude: 30.5, longitude: 104, mock_openid: USER } },
  { fn: 'user-login', name: 'ul_gps_ok', openid: USER, store: ulStore({ allow_map_share: true }), event: { action: 'report_map_gps', latitude: 30.5, longitude: 104, mock_openid: USER } },
  { fn: 'user-login', name: 'ul_nearby_no_user', openid: USER, store: ulStore(null), event: { action: 'nearby_map_list', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_nearby_ok', openid: USER, store: ulMapStore(), event: { action: 'nearby_map_list', mock_openid: USER } },
  // ── user-login：认证组(send_sms_code / phone_login / phone_register / password_register / password_login) A/B 证据 ──
  { fn: 'user-login', name: 'ul_sms_bad_phone', openid: USER, store: ulStore(null), event: { action: 'send_sms_code', phone: '123', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_sms_frequent', openid: USER, store: ulStore({ sms_expire_at: Date.now() + 5 * 60 * 1000 - 10000 }), event: { action: 'send_sms_code', phone: '13800000000', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_sms_ok_existing', openid: USER, store: ulStore({ sms_expire_at: 0 }), event: { action: 'send_sms_code', phone: '13800000000', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_sms_new_shell', openid: USER, store: ulStore(null), event: { action: 'send_sms_code', phone: '13800000000', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_phone_login_missing', openid: USER, store: ulStore(null), event: { action: 'phone_login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_phone_login_bad_fmt', openid: USER, store: ulStore(null), event: { action: 'phone_login', phone: '123', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_phone_register_bad', openid: USER, store: ulStore(null), event: { action: 'phone_register', phone: '123', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_pwd_reg_bad_account', openid: USER, store: ulStore(null), event: { action: 'password_register', account: 'a', password: '12345678', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_pwd_reg_bad_pwd', openid: USER, store: ulStore(null), event: { action: 'password_register', account: 'abcde', password: '123', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_pwd_login_missing', openid: USER, store: ulStore(null), event: { action: 'password_login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_pwd_login_no_account', openid: USER, store: ulStore(null), event: { action: 'password_login', account: 'nobody', password: '12345678', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_pwd_login_has_pwd', openid: USER, store: ulStore({ password_hash: 'deadbeef', password_salt: 'salt', account: 'nobody' }), event: { action: 'password_login', account: 'nobody', password: '12345678', mock_openid: USER } },
  // ── user-login：账号/资料组(login / update_profile / bind_phone / bind_idcard / submit_realname / simulate_realname / close_account / peek_login) A/B 证据 ──
  { fn: 'user-login', name: 'ul_login_new', openid: USER, store: ulStore(null), event: { action: 'login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_login_existing', openid: USER, store: ulStore({}), event: { action: 'login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_login_frozen', openid: USER, store: ulStore({ status: 'frozen' }), event: { action: 'login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_login_banned', openid: USER, store: ulStore({ status: 'banned' }), event: { action: 'login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_profile_empty', openid: USER, store: ulStore({}), event: { action: 'update_profile', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_profile_long_nick', openid: USER, store: ulStore({}), event: { action: 'update_profile', nickname: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_profile_ok', openid: USER, store: ulStore({}), event: { action: 'update_profile', nickname: '张三', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_bind_phone_missing', openid: USER, store: ulStore({}), event: { action: 'bind_phone', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_bind_idcard_bad', openid: USER, store: ulStore({}), event: { action: 'bind_idcard', idcard: '123', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_peek_not_found', openid: USER, store: ulStore(null), event: { action: 'peek_login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_peek_found', openid: USER, store: ulStore({ nickname: 'u' }), event: { action: 'peek_login', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_close_not_found', openid: USER, store: ulStore(null), event: { action: 'close_account', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_simulate_realname', openid: USER, store: ulStore({}), event: { action: 'simulate_realname', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_submit_realname_bad', openid: USER, store: ulStore({}), event: { action: 'submit_realname', mock_openid: USER } },
  // ── user-login：杂项组(set_emergency_contact / get_emergency_contact / get_my_credit / global_config) A/B 证据 ──
  { fn: 'user-login', name: 'ul_ec_set_empty', openid: USER, store: ulStore({}), event: { action: 'set_emergency_contact', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_ec_set_bad_phone', openid: USER, store: ulStore({}), event: { action: 'set_emergency_contact', name: 'a', phone: '123', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_ec_get', openid: USER, store: ulStore({}), event: { action: 'get_emergency_contact', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_credit_get', openid: USER, store: ulStore({ user_credit_score: 800 }), event: { action: 'get_my_credit', mock_openid: USER } },
  { fn: 'user-login', name: 'ul_global_config', openid: USER, store: ulStore(null), event: { action: 'global_config', mock_openid: USER } },
  // ── admin-action：核心逻辑块补 A/B 证据（拆分前 git 版本作 baseline）──
  { fn: 'admin-action', name: 'cfg_no_change', openid: ADMIN, store: adminStore(), event: { action: 'config_set', mock_openid: ADMIN } },
  { fn: 'admin-action', name: 'cfg_bad_int', openid: ADMIN, store: adminStore(), event: { action: 'config_set', s0_timeout_min: 0, mock_openid: ADMIN } },
  { fn: 'admin-action', name: 'cfg_bad_env', openid: ADMIN, store: adminStore(), event: { action: 'config_set', env: 'staging', mock_openid: ADMIN } },
  { fn: 'admin-action', name: 'dispute_bad_id', openid: ADMIN, store: adminStore(), event: { action: 'dispute_handle', order_id: 'bad', decision: 'open', note: 'x', mock_openid: ADMIN } },
  { fn: 'admin-action', name: 'dispute_bad_decision', openid: ADMIN, store: adminStore(), event: { action: 'dispute_handle', order_id: OID, decision: 'nope', note: 'x', mock_openid: ADMIN } },
  { fn: 'admin-action', name: 'audit_bad_openid', openid: ADMIN, store: adminStore(), event: { action: 'audit_verify', openid: 'x', mock_openid: ADMIN } },
  { fn: 'admin-action', name: 'audit_empty', openid: ADMIN, store: adminStore(), event: { action: 'audit_verify', openid: ADMIN, mock_openid: ADMIN } },
  // ── 5 个核心块「成功路径」深覆盖（富夹具 + 合法入参 → 抵达 ok:true），与上面对应的拒绝分支正反对照 ──
  { fn: 'admin-action', name: 'cfg_set_ok', openid: ADMIN, store: adminStore(),
    event: { action: 'config_set', mock_openid: ADMIN, block_words_add: ['测试屏蔽词'] } },
  { fn: 'admin-action', name: 'dispute_open_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-X', status: 'S10', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 } } }),
    event: { action: 'dispute_handle', mock_openid: ADMIN, order_id: OID, decision: 'open', note: '登记争议' } },
  { fn: 'admin-action', name: 'noshow_decide_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { no_show_report: { ['b'.repeat(32)]: { _id: 'b'.repeat(32), status: 'decided', order_id: OID, verdict: 'rejected' } } }),
    event: { action: 'no_show_decide', mock_openid: ADMIN, report_id: 'b'.repeat(32), verdict: 'rejected', note: '驳回' } },
  { fn: 'admin-action', name: 'exam_create_ok', openid: ADMIN, store: adminStore(),
    event: { action: 'exam_subject_create', mock_openid: ADMIN, code: 'NEWSUBJ', title: '新科目', pass_line: 60, requires: [], questions: [{ question: 'q?', options: ['a', 'b'], answer_idx: 0 }] } },
  (() => {
    const at = 1700000000000; const chain = crypto.createHash('sha256').update(['', ADMIN, 'act_x', '', at, JSON.stringify({})].join('|'), 'utf8').digest('hex');
    return { fn: 'admin-action', name: 'audit_verify_ok', openid: ADMIN,
      store: Object.assign(adminStore(), { audit_log: { r1: { _id: 'r1', prev_hash: '', openid: ADMIN, action: 'act_x', target_id: '', at, detail: {}, chain_hash: chain } } }),
      event: { action: 'audit_verify', mock_openid: ADMIN, openid: ADMIN } };
  })(),
  // ── Batch 1: 厚业务逻辑成功路径（状态机/多表写/处罚链/退款），与自动种子的拒绝分支正反对照 ──
  { fn: 'admin-action', name: 'force_cancel_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S1' } }, order_status_log: {} }),
    event: { action: 'order_force_cancel', mock_openid: ADMIN, order_id: OID, note: '测试取消' } },
  { fn: 'admin-action', name: 'withdraw_approve_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { withdraw_record: { ['c'.repeat(32)]: { _id: 'c'.repeat(32), status: 'processing', amount_fen: 1000 } } }),
    event: { action: 'withdraw_review', mock_openid: ADMIN, withdraw_id: 'c'.repeat(32), decision: 'approve' } },
  { fn: 'admin-action', name: 'dispute_refund_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-2', status: 'S10.5', total_fen: 1000, user_openid: USER, partner_openid: PARTNER, complaint_from_status: '' } }, pay_transaction: {}, system_notice: {} }),
    event: { action: 'dispute_handle', mock_openid: ADMIN, order_id: OID, decision: 'refund', note: '退款裁决' } },
  { fn: 'admin-action', name: 'noshow_upheld_ok', openid: ADMIN,
    store: Object.assign(adminStore(), {
      no_show_report: { ['d'.repeat(32)]: { _id: 'd'.repeat(32), status: 'received', order_id: OID, order_no: 'ORD-3', target_openid: PARTNER, target_role: 'partner', reporter_openid: USER } },
      user_account: { [PARTNER]: { _id: 'ua1', openid: PARTNER, partner_credit_score: 800, status: 'normal' } }, credit_score_log: {}, system_notice: {}, partner_profile: {} }),
    event: { action: 'no_show_decide', mock_openid: ADMIN, report_id: 'd'.repeat(32), verdict: 'upheld', note: '成立' } },
  // ── Batch 2: 中逻辑成功路径（题目更新/删除、资料审核、信用分、举报处理），与拒绝分支正反对照 ──
  { fn: 'admin-action', name: 'exam_update_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { exam_bank: { e1: { _id: 'e1', code: 'SUBJ2', is_deleted: false } } }),
    event: { action: 'exam_subject_update', mock_openid: ADMIN, code: 'SUBJ2', title: '新名', pass_line: 70, requires: [], questions: [{ question: 'q?', options: ['a', 'b'], answer_idx: 0 }] } },
  { fn: 'admin-action', name: 'exam_delete_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { exam_bank: { e1: { _id: 'e1', code: 'SUBJ2', requires: [], is_deleted: false } } }),
    event: { action: 'exam_subject_delete', mock_openid: ADMIN, code: 'SUBJ2' } },
  { fn: 'admin-action', name: 'pp_review_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { partner_profile: { p1: { _id: 'p1', openid: PARTNER, profile_audit_status: 'pending', bio_pending: '一段简介', is_deleted: false } }, system_notice: {} }),
    event: { action: 'partner_profile_review', mock_openid: ADMIN, target_openid: PARTNER, items: [{ field: 'bio', pass: true }] } },
  { fn: 'admin-action', name: 'credit_adjust_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { user_account: { u1: { _id: 'u1', openid: PARTNER, partner_credit_score: 800 } }, credit_score_log: {} }),
    event: { action: 'user_credit_adjust', mock_openid: ADMIN, target_openid: PARTNER, score_type: 'partner', delta: 20, reason: '测试加分' } },
  { fn: 'admin-action', name: 'report_handle_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { safety_report: { ['b'.repeat(32)]: { _id: 'b'.repeat(32), type: 'spam', order_no: '' } } }),
    event: { action: 'report_handle', mock_openid: ADMIN, report_id: 'b'.repeat(32), note: '已处理' } },
  // ── Batch 3: 薄逻辑成功路径（字段翻转 + 副作用日志），与拒绝分支正反对照 ──
  { fn: 'admin-action', name: 'blog_offline_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { blog_post: { ['1'.repeat(32)]: { _id: '1'.repeat(32), status: 'normal', author_openid: USER } } }),
    event: { action: 'blog_offline', mock_openid: ADMIN, post_id: '1'.repeat(32), note: '违规' } },
  { fn: 'admin-action', name: 'blog_restore_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { blog_post: { ['1'.repeat(32)]: { _id: '1'.repeat(32), status: 'offline', author_openid: USER } } }),
    event: { action: 'blog_restore', mock_openid: ADMIN, post_id: '1'.repeat(32) } },
  { fn: 'admin-action', name: 'blog_delete_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { blog_post: { ['1'.repeat(32)]: { _id: '1'.repeat(32), status: 'normal', author_openid: USER, is_deleted: false } } }),
    event: { action: 'blog_delete', mock_openid: ADMIN, post_id: '1'.repeat(32), note: '删除' } },
  { fn: 'admin-action', name: 'blog_comment_delete_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { blog_post: { ['1'.repeat(32)]: { _id: '1'.repeat(32) } }, blog_comment: { ['2'.repeat(32)]: { _id: '2'.repeat(32), post_id: '1'.repeat(32), status: 'normal', is_deleted: false } } }),
    event: { action: 'blog_comment_delete', mock_openid: ADMIN, comment_id: '2'.repeat(32), note: '删除' } },
  { fn: 'admin-action', name: 'partner_online_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { partner_profile: { p1: { _id: 'p1', openid: PARTNER, status: 'approved', accept_switch: false, is_deleted: false } } }),
    event: { action: 'partner_online', mock_openid: ADMIN, target_openid: PARTNER } },
  { fn: 'admin-action', name: 'partner_offline_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { partner_profile: { p1: { _id: 'p1', openid: PARTNER, status: 'approved', accept_switch: true, is_deleted: false } } }),
    event: { action: 'partner_offline', mock_openid: ADMIN, target_openid: PARTNER, reason: '休息' } },
  { fn: 'admin-action', name: 'user_ban_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { user_account: { u1: { _id: 'u1', openid: PARTNER, status: 'normal' } } }),
    event: { action: 'user_ban', mock_openid: ADMIN, target_openid: PARTNER, reason: '违规' } },
  { fn: 'admin-action', name: 'user_unban_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { user_account: { u1: { _id: 'u1', openid: PARTNER, status: 'banned' } } }),
    event: { action: 'user_unban', mock_openid: ADMIN, target_openid: PARTNER } },
  { fn: 'admin-action', name: 'user_freeze_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { user_account: { u1: { _id: 'u1', openid: PARTNER, status: 'normal' } } }),
    event: { action: 'user_freeze', mock_openid: ADMIN, target_openid: PARTNER, reason: '风控' } },
  { fn: 'admin-action', name: 'user_unfreeze_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { user_account: { u1: { _id: 'u1', openid: PARTNER, status: 'frozen' } } }),
    event: { action: 'user_unfreeze', mock_openid: ADMIN, target_openid: PARTNER } },
  // ── E2E: 订单端到端异常分支(CAS+多表副作用: demand释放/通知/审计/流水/资金正交位) ──
  { fn: 'order-action', name: 'cancel_S1_release_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S1', user_openid: USER, partner_openid: PARTNER, demand_id: 'e'.repeat(32), total_fen: 1000 } }, demand: { ['e'.repeat(32)]: { _id: 'e'.repeat(32), status: 'matched' } } }),
    event: { action: 'cancel', mock_openid: PARTNER, order_id: OID, reason: '不需要了' } },
  // start_service 自 2026-10-14(需求B)起强制要求 start_evidence(照片+实时位置); 基线(_orig_baseline.js)忽略该字段,
  // 故入参补齐后两侧返回值逐字一致(无需 KNOWN_EVOLUTION)。校验/落库由 order_start_evidence.test.js 独立守护。
  { fn: 'order-action', name: 'start_S2_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S2', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 } } }),
    event: { action: 'start_service', mock_openid: PARTNER, order_id: OID,
      start_evidence: {
        photos: [{ file_id: 'cloud://mock/start-evidence/1.jpg', kind: 'scene', at: 1700000000000 }],
        partner_location: { latitude: 30.5, longitude: 104.0, accuracy: 12, address: '成都市', at: 1700000000000 }
      } } },
  { fn: 'order-action', name: 'complete_S3_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S3', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, milestone: { current: 3, confirmed: [true, true, true] } } } }),
    event: { action: 'complete_service', mock_openid: PARTNER, order_id: OID } },
  { fn: 'admin-action', name: 'dispute_complete_evaluated_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-2', status: 'S10.5', total_fen: 1000, user_openid: USER, partner_openid: PARTNER, complaint_from_status: 'S8' } }, system_notice: {} }),
    event: { action: 'dispute_handle', mock_openid: ADMIN, order_id: OID, decision: 'complete', note: '完成' } },
  { fn: 'admin-action', name: 'dispute_refund_amount_exceed', openid: ADMIN,
    store: Object.assign(adminStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-2', status: 'S10.5', total_fen: 1000, user_openid: USER, partner_openid: PARTNER, complaint_from_status: 'S3' } }, pay_transaction: { t1: { _id: 't1', order_id: OID, type: 'refund', status: 'success', amount_fen: 800, is_deleted: false } } }),
    event: { action: 'dispute_handle', mock_openid: ADMIN, order_id: OID, decision: 'refund', refund_fen: 300, note: '超上限' } },
  { fn: 'admin-action', name: 'dispute_refund_partial_ok', openid: ADMIN,
    store: Object.assign(adminStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-2', status: 'S10.5', total_fen: 1000, user_openid: USER, partner_openid: PARTNER, complaint_from_status: 'S3' } }, pay_transaction: { t1: { _id: 't1', order_id: OID, type: 'refund', status: 'success', amount_fen: 800, is_deleted: false } }, system_notice: {} }),
    event: { action: 'dispute_handle', mock_openid: ADMIN, order_id: OID, decision: 'refund', refund_fen: 200, note: '部分退200' } },
  // ── P1 E2E: 履约中段链路(改期/部分完成/比例确认/投诉开闭) 全链路成功 + CAS + 副作用 ──
  { fn: 'order-action', name: 'modify_apply_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S2', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, start_time: START_TS, modify_count: 0 } } }),
    event: { action: 'modify', mock_openid: PARTNER, order_id: OID, new_start_time: NEW_TS } },
  { fn: 'order-action', name: 'modify_confirm_ok', openid: USER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S2_5', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, start_time: START_TS, modify_count: 0, pending_modify: { from_status: 'S2', new_start_time: NEW_TS, by_openid: PARTNER, created_at: START_TS, expire_at: NEW_TS + 86400000 } } } }),
    event: { action: 'modify_confirm', mock_openid: USER, order_id: OID } },
  { fn: 'order-action', name: 'partial_confirm_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S3.5', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 } } }),
    event: { action: 'partial_confirm', mock_openid: PARTNER, order_id: OID } },
  { fn: 'order-action', name: 'ratio_confirm_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S4', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 } } }),
    event: { action: 'ratio_confirm', mock_openid: PARTNER, order_id: OID, ratio: 50 } },
  { fn: 'order-action', name: 'complaint_open_ok', openid: USER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S8', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 } }, complaint: {} }),
    event: { action: 'complaint', mock_openid: USER, order_id: OID, reason: '服务问题' } },
  { fn: 'order-action', name: 'complaint_withdraw_ok', openid: USER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S10.5', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, complaint_by: USER, complaint_from_status: 'S8' } }, complaint: {} }),
    event: { action: 'complaint_withdraw', mock_openid: USER, order_id: OID } },
  // ── P1 前段: 恢复/里程碑/加时 链路(嵌套 CAS milestone.* + fixed 定价避开金额分摊) ──
  { fn: 'order-action', name: 'resume_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S3.5', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 } } }),
    event: { action: 'resume_service', mock_openid: PARTNER, order_id: OID } },
  { fn: 'order-action', name: 'milestone_submit_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S3', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, milestone: { current: 0, confirmed: [false, false, false], evidence: [] } } } }),
    event: { action: 'milestone_submit', mock_openid: PARTNER, order_id: OID } },
  { fn: 'order-action', name: 'milestone_confirm_ok', openid: USER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S3', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, milestone: { current: 1, confirmed: [false, false, false], evidence: [] } } } }),
    event: { action: 'milestone_confirm', mock_openid: USER, order_id: OID, milestone: 1 } },
  { fn: 'order-action', name: 'extend_apply_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S3', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, pricing_type: 'fixed', duration_h: 2 } } }),
    event: { action: 'extend', mock_openid: PARTNER, order_id: OID, add_hours: 2 } },
  { fn: 'order-action', name: 'extend_confirm_ok', openid: USER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S3', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, pricing_type: 'fixed', duration_h: 2, fee_fen: 100, partner_income_fen: 900, pending_extend: { add_hours: 2, add_amount_fen: 0, by_openid: PARTNER, created_at: 1, expire_at: Date.now() + 86400000 } } } }),
    event: { action: 'extend_confirm', mock_openid: USER, order_id: OID } },
  // ── #21 E2E: 爽约申诉链(action 级) submit/defense/withdraw, 覆盖冻结/解冻 + report 文档写 ──
  { fn: 'order-action', name: 'no_show_submit_ok', openid: USER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S2', user_openid: USER, partner_openid: PARTNER, total_fen: 1000, start_time: RECENT_TS } }, no_show_report: {} }),
    event: { action: 'no_show_report_submit', mock_openid: USER, order_id: OID, reason: '对方未按约定时间到达现场', reason_type: 'late' } },
  { fn: 'order-action', name: 'no_show_defense_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { no_show_report: { ['f'.repeat(32)]: { _id: 'f'.repeat(32), order_id: OID, order_no: 'ORD-1', reporter_openid: USER, reporter_role: 'user', target_openid: PARTNER, target_role: 'partner', status: 'received', evidence_deadline: Date.now() + 3600000, is_deleted: false } } }),
    event: { action: 'no_show_report_defense', mock_openid: PARTNER, report_id: 'f'.repeat(32), defense_reason: '我已按时到达并完成服务' } },
  { fn: 'order-action', name: 'no_show_withdraw_ok', openid: USER,
    store: Object.assign(baseStore(), { no_show_report: { ['f'.repeat(32)]: { _id: 'f'.repeat(32), order_id: OID, order_no: 'ORD-1', reporter_openid: USER, reporter_role: 'user', target_openid: PARTNER, status: 'received', is_deleted: false } } }),
    event: { action: 'no_show_report_withdraw', mock_openid: USER, report_id: 'f'.repeat(32) } },
  // ── partner-action：物理拆分组1(apply/set_switch/update_config/sub_authorize/my_profile) A/B 证据 ──
  { fn: 'partner-action', name: 'pa_apply_no_user', openid: USER, store: paStore({ user_account: {} }), event: { action: 'apply', mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_apply_pending', openid: USER, store: paStore({ partner_profile: {} }), event: { action: 'apply', mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_apply_auto', openid: USER, store: paStore({ partner_profile: {}, admin_config: { global: { env: 'dev', auto_approve_partner: true, scene_list: [{ code: 'W1' }] } } }), event: { action: 'apply', accept_scenes: ['W1'], mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_switch_no_profile', openid: USER, store: paStore({ partner_profile: {} }), event: { action: 'set_switch', accept_switch: true, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_switch_not_approved', openid: USER, store: paStore({ partner_profile: { [PAID]: { _id: PAID, openid: USER, status: 'pending_review', is_deleted: false } } }), event: { action: 'set_switch', accept_switch: true, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_switch_busy', openid: USER, store: paStore({ order_main: { [OID]: { _id: OID, partner_openid: USER, status: 'S2', is_deleted: false } } }), event: { action: 'set_switch', accept_switch: false, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_switch_on', openid: USER, store: paStore(), event: { action: 'set_switch', accept_switch: true, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_config_no_profile', openid: USER, store: paStore({ partner_profile: {} }), event: { action: 'update_config', mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_config_bad_loc', openid: USER, store: paStore(), event: { action: 'update_config', home_location: { latitude: 999, longitude: 1 }, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_config_bad_dist', openid: USER, store: paStore(), event: { action: 'update_config', max_distance_km: 100, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_config_empty_scenes', openid: USER, store: paStore(), event: { action: 'update_config', accept_scenes: [], mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_config_ok', openid: USER, store: paStore(), event: { action: 'update_config', max_distance_km: 10, accept_scenes: ['W1'], scene_rates: { W1: 5000 }, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_sub_bad_tmpl', openid: USER, store: paStore(), event: { action: 'sub_authorize', tmpl: 'xxx', mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_sub_no_profile', openid: USER, store: paStore({ partner_profile: {} }), event: { action: 'sub_authorize', tmpl: 'demand_grab', mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_sub_ok', openid: USER, store: paStore(), event: { action: 'sub_authorize', tmpl: 'demand_grab', authorized: true, mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_my_profile_no', openid: USER, store: paStore({ partner_profile: {} }), event: { action: 'my_profile', mock_openid: USER } },
  { fn: 'partner-action', name: 'pa_my_profile_ok', openid: USER, store: paStore(), event: { action: 'my_profile', mock_openid: USER } },
  // ── order-timer：物理拆分段落组(S1/S0/中断/改期/加时/停用恢复/里程碑/自动评价/S8归档/S4升级/争议升级) A/B 证据 ──
  { fn: 'order-timer', name: 'ot_forbidden', openid: USER, store: otStore(), event: { action: 'run', mock_openid: USER } },
  { fn: 'order-timer', name: 'ot_timer_empty', openid: '', store: otStore(), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s1', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S1', created_at: 1, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s0', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-2', status: 'S0', pay_expire_at: 1, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s35', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-3', status: 'S3.5', interrupted_at: 1, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s25', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-4', status: 'S2_5', modify_at: 1, pending_modify: { from_status: 'S2', by_openid: USER }, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s3_extend', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-5', status: 'S3', pending_extend: { created_at: 1, by_openid: USER }, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_suspend', openid: '', store: otStore({ user_account: { ['u'.repeat(32)]: { _id: 'u'.repeat(32), openid: USER, status: 'suspended', suspend_until: 1 } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_milestone', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-6', status: 'S3', milestone: { submitted_at: 1, confirmed: [false, false, false] }, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s5', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-7', status: 'S5', service_completed_at: 1, total_fen: 1000, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s8', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-8', status: 'S8', evaluated_at: 1, total_fen: 1000, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_s4', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-9', status: 'S4', updated_at: 1, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  { fn: 'order-timer', name: 'ot_dispute', openid: '', store: otStore({ order_main: { [OID]: { _id: OID, order_no: 'ORD-10', status: 'S10.5', dispute_state: 'open', dispute_opened_at: 1, user_openid: USER, partner_openid: PARTNER } } }), event: { Type: 'Timer', TriggerName: 'orderTimer' } },
  // ── payment-mock：物理拆分 A/B 证据(收银/支付/退款/打赏/保障/AA/账户/收入/提现各分支) ──
  { fn: 'payment-mock', name: 'pm_cashier_no_order', openid: USER, store: pmStore(), event: { action: 'cashier_info', mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_cashier_not_found', openid: USER, store: pmStore({ order_main: {} }), event: { action: 'cashier_info', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_cashier_not_owner', openid: STRANGER, store: pmStore(), event: { action: 'cashier_info', order_id: OID, mock_openid: STRANGER } },
  { fn: 'payment-mock', name: 'pm_cashier_ok', openid: USER, store: pmStore(), event: { action: 'cashier_info', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_pay_bad_id', openid: USER, store: pmStore(), event: { action: 'mock_pay', order_id: 'bad', mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_pay_not_found', openid: USER, store: pmStore({ order_main: {} }), event: { action: 'mock_pay', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_pay_not_owner', openid: STRANGER, store: pmStore(), event: { action: 'mock_pay', order_id: OID, mock_openid: STRANGER } },
  { fn: 'payment-mock', name: 'pm_pay_ok', openid: USER, store: pmStore(), event: { action: 'mock_pay', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_refund_not_found', openid: USER, store: pmStore({ order_main: {} }), event: { action: 'mock_refund', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_refund_not_owner', openid: STRANGER, store: pmStore(), event: { action: 'mock_refund', order_id: OID, mock_openid: STRANGER } },
  { fn: 'payment-mock', name: 'pm_refund_ok', openid: USER, store: pmStore(), event: { action: 'mock_refund', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_tip_not_found', openid: USER, store: pmStore({ order_main: {} }), event: { action: 'mock_tip', order_id: OID, amount_fen: 500, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_tip_bad_amount', openid: USER, store: pmStore(), event: { action: 'mock_tip', order_id: OID, amount_fen: 1, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_tip_list', openid: USER, store: pmStore(), event: { action: 'tip_list', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_ins_not_found', openid: USER, store: pmStore({ order_main: {} }), event: { action: 'mock_ins', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_ins_ok', openid: USER, store: pmStore(), event: { action: 'mock_ins', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_aa_record', openid: USER, store: pmStore(), event: { action: 'aa_record', order_id: OID, mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_balance_info', openid: PARTNER, store: pmStore(), event: { action: 'balance_info', mock_openid: PARTNER } },
  { fn: 'payment-mock', name: 'pm_income_list', openid: PARTNER, store: pmStore(), event: { action: 'income_list', mock_openid: PARTNER } },
  { fn: 'payment-mock', name: 'pm_tip_income_list', openid: PARTNER, store: pmStore(), event: { action: 'tip_income_list', mock_openid: PARTNER } },
  { fn: 'payment-mock', name: 'pm_migrate_tip', openid: USER, store: pmStore(), event: { action: 'migrate_tip_partner', mock_openid: USER } },
  { fn: 'payment-mock', name: 'pm_withdraw_bad_amount', openid: PARTNER, store: pmStore(), event: { action: 'withdraw', amount_fen: 1, mock_openid: PARTNER } },
  { fn: 'payment-mock', name: 'pm_withdraw_insufficient', openid: PARTNER, store: pmStore(), event: { action: 'withdraw', amount_fen: 10000, mock_openid: PARTNER } },
  { fn: 'payment-mock', name: 'pm_fast_withdraw_insufficient', openid: PARTNER, store: pmStore(), event: { action: 'fast_withdraw', amount_fen: 10000, mock_openid: PARTNER } },
  { fn: 'payment-mock', name: 'pm_withdraw_list', openid: PARTNER, store: pmStore(), event: { action: 'withdraw_list', mock_openid: PARTNER } },
  // ── home-action：物理拆分 A/B 证据(概览/广场/场景分组/场景分页/附近/用户主页/活动) ──
  { fn: 'home-action', name: 'ha_overview_guest', openid: '', store: haStore(), event: { action: 'overview', mock_openid: '' } },
  { fn: 'home-action', name: 'ha_overview_partner', openid: USER, store: haStore(), event: { action: 'overview', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_square_guest', openid: '', store: haStore(), event: { action: 'square', limit: 20, mock_openid: '' } },
  { fn: 'home-action', name: 'ha_square_partner', openid: USER, store: haStore(), event: { action: 'square', limit: 20, mock_openid: USER } },
  { fn: 'home-action', name: 'ha_scene_groups_hide', openid: USER, store: haStore(), event: { action: 'scene_groups', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_scene_list_ok', openid: USER, store: haStore(), event: { action: 'scene_list', scene_code: 'W1', skip: 0, mock_openid: USER } },
  { fn: 'home-action', name: 'ha_scene_list_bad', openid: USER, store: haStore(), event: { action: 'scene_list', scene_code: 'W9', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_nearby_ok', openid: USER, store: haStore(), event: { action: 'nearby', page: 1, page_size: 10, mock_openid: USER } },
  { fn: 'home-action', name: 'ha_nearby_need_home', openid: USER, store: haStore({ partner_profile: {} }), event: { action: 'nearby', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_user_home_bad', openid: USER, store: haStore(), event: { action: 'user_home', openid: 'x', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_user_home_gone', openid: USER, store: haStore({ user_account: {} }), event: { action: 'user_home', openid: HUSER, mock_openid: USER } },
  { fn: 'home-action', name: 'ha_user_home_ok', openid: USER, store: haStore(), event: { action: 'user_home', openid: HUSER, mock_openid: USER } },
  { fn: 'home-action', name: 'ha_act_list', openid: USER, store: haStore(), event: { action: 'home_activity_list', scene_code: 'W1', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_act_detail_ok', openid: USER, store: haStore(), event: { action: 'activity_detail', id: 'act_card', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_act_detail_not_found', openid: USER, store: haStore(), event: { action: 'activity_detail', id: 'nope', mock_openid: USER } },
  { fn: 'home-action', name: 'ha_unknown', openid: USER, store: haStore(), event: { action: 'nope_xxx', mock_openid: USER } },
  // ── order-create：物理拆分显式用例(资格查询 / 免责签署 / 接单结果兜底 / 接单建单 正反路径) ──
  { fn: 'order-create', name: 'oc_check_signed_ok', openid: USER, store: ocStore(), event: { action: 'check_signed', scene: 'W1', mock_openid: USER } },
  { fn: 'order-create', name: 'oc_check_signed_no_scene', openid: USER, store: ocStore(), event: { action: 'check_signed', mock_openid: USER } },
  { fn: 'order-create', name: 'oc_sign_ok', openid: USER, store: ocStore(), event: { action: 'sign_disclaimer', scene: 'W2', mock_openid: USER, device: 'test' } },
  { fn: 'order-create', name: 'oc_sign_idempotent', openid: USER, store: ocStore(), event: { action: 'sign_disclaimer', scene: 'W1', mock_openid: USER, device: 'test' } },
  { fn: 'order-create', name: 'oc_sign_no_scene', openid: USER, store: ocStore(), event: { action: 'sign_disclaimer', mock_openid: USER } },
  { fn: 'order-create', name: 'oc_check_take_bad_id', openid: USER, store: ocStore(), event: { action: 'check_take_result', demand_id: 'DR-NOT-HEX', mock_openid: USER } },
  { fn: 'order-create', name: 'oc_check_take_gone', openid: USER, store: ocStore(), event: { action: 'check_take_result', demand_id: 'e'.repeat(32), mock_openid: USER } },
  { fn: 'order-create', name: 'oc_check_take_not_mine', openid: USER, store: ocStore(), event: { action: 'check_take_result', demand_id: DEM, mock_openid: USER } },
  { fn: 'order-create', name: 'oc_create_bad_id', openid: USER, store: ocStore(), event: { action: 'create_from_take', demand_id: 'DR-NOT-HEX', mock_openid: USER } },
  { fn: 'order-create', name: 'oc_create_no_demand', openid: USER, store: ocStore(), event: { action: 'create_from_take', mock_openid: USER } },
  { fn: 'order-create', name: 'oc_create_not_partner', openid: USER, store: ocNoPartner(), event: { action: 'create_from_take', demand_id: DEM, partner_location: { latitude: 30.5, longitude: 104.0 }, mock_openid: USER } },
  { fn: 'order-create', name: 'oc_create_demand_gone', openid: USER, store: ocStore({ demand: {} }), event: { action: 'create_from_take', demand_id: DEM, partner_location: { latitude: 30.5, longitude: 104.0 }, mock_openid: USER } },
  { fn: 'order-create', name: 'oc_create_not_signed', openid: USER, store: ocStore({ disclaimer_signature: {} }), event: { action: 'create_from_take', demand_id: DEM, partner_location: { latitude: 30.5, longitude: 104.0 }, mock_openid: USER } },
  { fn: 'order-create', name: 'oc_create_no_location', openid: USER, store: ocStore(), event: { action: 'create_from_take', demand_id: DEM, mock_openid: USER } },
  { fn: 'order-create', name: 'oc_create_too_far', openid: USER, store: ocStore(), event: { action: 'create_from_take', demand_id: DEM, partner_location: { latitude: 40.0, longitude: 120.0 }, mock_openid: USER } },
  // 注意: 该用例锁定「拆分前既有行为」——create_from_take 成功路径因 L482 try 块内 const
  // (orderNo/orderId/totalFen/orderData/userEvidenceId) 在 finally 后越界引用, 两侧同抛
  // ReferenceError; 后续单独修复该 bug 时本用例会转 FAIL, 需按 KNOWN_EVOLUTION 显式登记。
  { fn: 'order-create', name: 'oc_create_build_path', openid: USER, store: ocStore(), event: { action: 'create_from_take', demand_id: DEM, partner_location: { latitude: 30.5, longitude: 104.0 }, mock_openid: USER, device: 'test' } },
  { fn: 'order-create', name: 'oc_unknown', openid: USER, store: ocStore(), event: { action: 'nope_xxx', mock_openid: USER } },
];

// ── 自动种子：枚举每个 handler 导出的 action，为全部 action 生成 entry/鉴权种子，
//    确保 114 个 action 的分发路由 + 鉴权门 + 无 ReferenceError 都被 A/B 覆盖。
const fs = require('fs');
function enumerateActions(dir) {
  const out = [];
  const ad = path.join(__dirname, '..', dir);
  for (const f of fs.readdirSync(ad).filter((x) => /^action_.*\.js$/.test(x))) {
    let m;
    try { delete require.cache[require.resolve(path.join(ad, f))]; m = require(path.join(ad, f)); }
    catch { continue; }
    for (const k of Object.keys(m)) if (typeof m[k] === 'function') out.push(k);
  }
  return out;
}
const AUTO_SEEDS = [
  // order-action：用订单参与方 USER（baseStore 含真实订单），穿透到「取单→角色校验→状态机校验」业务分支
  ...enumerateActions('order-action').map((a) => ({
    name: `auto_order_${a}`, openid: USER,
    event: { action: a, order_id: OID, mock_openid: USER, page: 1, size: 5, limit: 20 },
  })),
  // admin-action：管理员 ADMIN + 通用分页参数 + 通用参数包，越过「参数校验门」进入更深业务分支
  ...enumerateActions('admin-action').map((a) => ({
    fn: 'admin-action', name: `auto_admin_${a}`, openid: ADMIN, store: adminStore(),
    event: {
      action: a, order_id: OID, mock_openid: ADMIN, page: 1, size: 5, limit: 20,
      openid: ADMIN, target_openid: ADMIN, id: OID, blog_id: OID, comment_id: OID,
      demand_id: OID, activity_id: OID, report_id: OID, conv_id: OID,
      code: 'SUBJ01', title: 't', name: 'n', note: 'n', decision: 'open',
      confirm: true, data: {}, status: 'active', hours: 1, fen: 100,
    },
  })),
  // user-login：物理拆分后枚举 handler 导出的 action，覆盖分发路由 + 鉴权门 + 无 ReferenceError
  // (store 用 baseStore: admin_config.env=dev 放行 mock_openid; user_account 为空 → 命中 no_user 分支)
  ...enumerateActions('user-login').map((a) => ({
    fn: 'user-login', name: `auto_ul_${a}`, openid: USER,
    event: { action: a, mock_openid: USER, phone: '13800000000', sms_code: '123456', nickname: 'n', avatar: '', device: 'test' },
  })),
  // partner-action：物理拆分后枚举 handler 导出的 action，覆盖分发路由 + 鉴权门 + 无 ReferenceError
  ...enumerateActions('partner-action').map((a) => ({
    fn: 'partner-action', name: `auto_pa_${a}`, openid: USER, store: paStore(),
    event: {
      action: a, mock_openid: USER, device: 'test',
      subject: 'base', answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      target_openid: USER, pass: true, partner_openid: USER, latitude: 30.5, longitude: 104,
      bio: '简介', skills: [], service_highlights: [], items: [{ field: 'bio', pass: true }],
      tmpl: 'demand_grab', authorized: true, accept_switch: true, max_distance_km: 10,
    },
  })),
  // payment-mock：物理拆分后枚举 handler 导出的 action，覆盖分发路由 + 鉴权/预检门 + 无 ReferenceError
  ...enumerateActions('payment-mock').map((a) => ({
    fn: 'payment-mock', name: `auto_pm_${a}`, openid: USER, store: pmStore(),
    event: { action: a, mock_openid: USER, order_id: OID, amount_fen: 10000, device: 'test' },
  })),
  // home-action：物理拆分后枚举 handler 导出的 action，覆盖分发路由 + 无 ReferenceError
  // (store 用 haStore: env=dev 放行 mock_openid; 通用入参含 limit/page/size 穿透到列表分支)
  ...enumerateActions('home-action').map((a) => ({
    fn: 'home-action', name: `auto_ha_${a}`, openid: USER, store: haStore(),
    event: { action: a, mock_openid: USER, limit: 20, page: 1, page_size: 10, scene_code: 'W1' },
  })),
  // order-create：物理拆分后枚举 handler 导出的 action，覆盖分发路由 + 无 ReferenceError
  // (store 用 ocStore: env=dev; USER 为 approved 耍伴带实时定位 → 兼容 create_from_take 定位门)
  ...enumerateActions('order-create').map((a) => ({
    fn: 'order-create', name: `auto_oc_${a}`, openid: USER, store: ocStore(),
    event: { action: a, mock_openid: USER, demand_id: DEM, scene: 'W1', partner_location: { latitude: 30.5, longitude: 104.0 } },
  })),
  // demand-publish：物理拆分后枚举 handler 导出的 action，覆盖分发路由 + 无 ReferenceError
  // (store 用 dpPubStore: env=dev + 富配置/实名用户, 通用入参穿透到各自业务分支)
  ...enumerateActions('demand-publish').map((a) => ({
    fn: 'demand-publish', name: `auto_dp_${a}`, openid: USER, store: dpPubStore(),
    event: {
      action: a, mock_openid: USER, device: 'test', demand_id: DID, draft_id: DID,
      scene: 'W1', start_time: NEW_TS, duration_h: 1,
      location: { name: '成都', city: '成都', latitude: 30.55, longitude: 104.05 },
      content_options: ['陪同挂号'], rate_fen: 5000, aa_tier: '0-50',
      aa_promise_checked: true, disclaimer_signed: true, publish_type: 'self',
      contact_phone: '13800000000',
    },
  })),
];
const ALL_CASES = CASES.concat(AUTO_SEEDS);

function loadWith(dir, file, sdk) {
  let active = sdk;
  const orig = Module._load;
  Module._load = function (r) { if (r === 'wx-server-sdk') return active; return orig.apply(this, arguments); };
  const full = path.join(__dirname, '..', dir, file);
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  Module._load = orig;
  return mod;
}

(async () => {
  // 批5.1: 基线缺失即 FAIL(不再静默 SKIP), 强制维护 _orig_baseline.js。
  // 基线 = 拆分前单体版本: git show <拆分前commit>:cloudfunctions/<fn>/index.js > cloudfunctions/<fn>/_orig_baseline.js
  const dirs = Array.from(new Set(ALL_CASES.map((c) => c.fn || 'order-action')));
  const missing = dirs.filter((d) => {
    try { require('fs').accessSync(path.join(__dirname, '..', d, '_orig_baseline.js')); return false; }
    catch (e) { return true; }
  });
  if (missing.length) {
    console.error('[FAIL] A/B equivalence: 缺少基线文件 _orig_baseline.js');
    console.error('       缺基线的函数: ' + missing.join(', '));
    console.error('       生成方式: git show <拆分前commit>:cloudfunctions/<fn>/index.js > cloudfunctions/<fn>/_orig_baseline.js');
    process.exit(2);
  }
  // 已知「有意行为演进」白名单: 拆分后各批次对这些路径做了有意改动,
  // 与拆分前基线的差异属预期, 不计为回归; 未登记的新差异一律 FAIL。
  // 来源: 3509ef1(投诉放开 S2 起 / 动态时间线 / detail 字段扩充) · 安全整改(错误消息脱敏去 openid) · 批3(config_schema 新增 extend_confirm_h/scene_option_display_max)。
  const KNOWN_EVOLUTION = new Set([
    'detail_ok', 'auto_order_detail',          // detail 字段扩充(modify_*_at / complaint / fund / refund / dispute / fees / frozen); 2026-10-16 再新增 demand_title/demand_desc(需求标题/详细描述, 按 demand.remark 全角｜拆分) — 行为由 order-action.entry.test.js 新增 2 例独立守护
    'confirm_all_not_participant',              // 错误消息脱敏(不再回显参与方 openid)
    'complaint_status', 'auto_order_complaint', // 投诉入口放开至 S2 起(原 S2 拒绝)
    'complaint_open_ok',                        // 2026-10-15 需求变更: S5(履约完成)/S8(已评价)起不再可发起投诉(原 S8 可发起·基线仍放开); 新行为由 order-action.entry.test.js 新增 2 例(S5 需求方 / S8 耍伴 → oa_complaint_status 且不落库)独立守护
    'auto_order_timeline',                      // 新增 timeline action(原 oa_unknown_action)
    'auto_order_user_confirm_start',            // 2026-10-14 需求B二期: 新增 user_confirm_start action(原 oa_unknown_action); 行为由 order-action.entry.test.js 独立守护
    'auto_order_start_apply',                   // 2026-10-14 阶段C-1: 新增 start_apply action(原 order_unknown_action); 行为由 order_start_apply.test.js 独立守护(4 例)
    'auto_order_start_confirm', 'auto_order_start_reject', // 2026-10-14 阶段D: 新增 start_confirm/start_reject(原 order_unknown_action); 行为由 order_start_confirm.test.js 独立守护
    'auto_order_server_now', 'auto_order_start_photo', // 2026-10-14 阶段E: 新增 server_now(取服务端时间戳, §F3 水印用) / start_photo(S3 内现场照片存证, 不改状态); 行为由 order_start_photo.test.js 独立守护(7 例)
    'auto_order_finish_apply', 'auto_order_finish_confirm', 'auto_order_finish_reject', // 2026-10-15 阶段F: 新增 finish_apply(S3→S3_6, 凭证前置) / finish_confirm(S3_6→S5) / finish_reject(S3_6→S3); 行为由 order_finish.test.js 独立守护(13 例)
    'auto_admin_config_get',                    // config_schema 新增 extend_confirm_h / scene_option_display_max · 2026-10-13 每项新增 d 说明文案(运营配置页内嵌) · extend_confirm_h→extend_confirm_min(分钟制默认20, 时间红线加 clock)
    'auto_admin_config_restore', 'auto_admin_import_collection', // 新增备份恢复 action(原 admin_unknown_action; 配合 .predeploy/restore.ps1 闭环 DB 恢复)
    'oc_create_build_path', 'auto_oc_create_from_take', // 2026-10-14 修复拆分前既有块作用域越界: create_from_take 成功路径 7 变量提升到 try 外, 基线仍抛 ReferenceError、修复后返回成功(成功路径另由 order_create_take_success.test.js 独立守护)
    'ot_s1', 'ot_s0', 'ot_s35', 'ot_s25', 'ot_s3_extend', 'ot_suspend', 'ot_milestone', 'ot_s5', 'ot_s8', 'ot_s4', 'ot_dispute', 'ot_timer_empty', // 2026-10-15 阶段G: order-timer 返回体新增 thresholds(start_apply_timeout_min/finish_confirm_timeout_min) + 两段字段/counts(start_apply_timeout/finish_confirm_timeout: S2.6→S10.5/no.26, S3.6→S10.5/no.30); 新行为由 order_timeout.test.js 独立守护(5 例), ot_s3_extend/ot_suspend 既有行为由 order-timer.entry.test.js 新增 2 例独立守护
    'my_orders_partner', 'my_orders_user', 'notice_list', // 2026-10-17 订单列表/通知列表新增 demand_title/demand_desc(需求标题/详细描述, 按 demand.remark 全角｜拆分反查 demand) — 行为由 order-action.entry.test.js 新增 3 例独立守护
    'dp_my_demands_ok', // 2026-10-17 my_demands 新增 demand_title/demand_desc(需求标题/详细描述, 按 demand.remark 全角｜拆分; 文档自身含 remark, 无需反查) — 行为由 demand-publish.entry.test.js 新增 2 例独立守护
    'auto_pa_take_readiness', // 2026-10-21 接单引导链: 新增 take_readiness 只读探针(原 pa_unknown_action); 行为由 partner-action.entry.test.js 新增 7 例独立守护
    'auto_pa_init_draft',     // 2026-10-23 批3a P2-10-a: 新增 init_draft 入驻草稿初始化(原 pa_unknown_action, 基线无此 action); draft 不授角色/不进审核队列/不可接单, 行为由 partner-action.entry.test.js 新增 8 例独立守护
    'ul_simulate_realname', 'auto_ul_simulate_realname', // 2026-10-21 修复拆分遗留作用域缺陷: action_account.js 引用本文件不存在的 getCachedEnv → 基线恒 login_server_error; 提审期方案A 改为读 config.env 后 dev 正常返回 ok(守卫与 simulate 行为由 user-login.entry.test.js 新增 4 例独立守护)
    'auto_admin_legal_doc_list', 'auto_admin_legal_doc_publish', 'auto_admin_legal_doc_rollback', 'auto_admin_legal_doc_seed', // 2026-10-25 批1a: 新增法律文档版本库 4 个 action(基线 admin_unknown_action); 授权见 docs/legal-compliance-1a-authorization-20261025.md, 行为由 admin-action.entry.test.js 新增 5 例独立守护
  ]);
  let fails = 0, known = 0;
  for (const c of ALL_CASES) {
    const dir = c.fn || 'order-action';
    const st = c.store || baseStore();
    // 两个独立 sdk 实例，相同 store 快照
    const a = loadWith(dir, '_orig_baseline.js', makeSdk({ openid: c.openid, store: JSON.parse(JSON.stringify(st)) }));
    const b = loadWith(dir, 'index.js', makeSdk({ openid: c.openid, store: JSON.parse(JSON.stringify(st)) }));
    // 捕获任一侧抛错：两边抛同类同因错误也算等价（mock 能力边界内的行为一致）
    const run = async (m) => { try { return { ok: true, v: await m.main(JSON.parse(JSON.stringify(c.event)), {}) }; } catch (e) { return { ok: false, v: String(e && e.message || e) }; } };
    const ra = await run(a);
    const rb = await run(b);
    try {
      assert.deepStrictEqual(normalize(rb), normalize(ra));
      console.log('OK  ', c.name);
    } catch (e) {
      if (KNOWN_EVOLUTION.has(c.name)) { known++; console.log('KNOWN', c.name, '(intentional evolution)'); continue; }
      fails++;
      console.log('FAIL', c.name);
      console.log('  expected:', JSON.stringify(ra));
      console.log('  actual  :', JSON.stringify(rb));
    }
  }
  console.log(fails === 0
    ? `\nA/B EQUIVALENT: ${ALL_CASES.length} cases (${CASES.length} explicit + ${AUTO_SEEDS.length} auto; ${known} known-evolution)`
    : `\n${fails} unexpected diff(s)`);
  process.exit(fails);
})();

function normalize(v) {
  // 剔除非确定性：Date.now 时间戳 / 自增计数 / 随机单号 造成的差异不影响结构等价
  return JSON.parse(JSON.stringify(v, (k, val) => {
    if (k === 'minutes_ago' && typeof val === 'number') return '<ago>';
    if (typeof val === 'number' && val > 1e12) return '<ts>';
    if (typeof val === 'string' && /^(REF|ORD|WD|TX|DR|PAY|TIP|AA|INS|POL)[0-9a-f]{6,}$/i.test(val)) return '<id>';
    // 2026-10-21 订单号改纯数字(18 位): 随机单号两侧必然不同, 需一并掩码; 16-20 位数字串在本套用例中仅可能来自单号
    if (typeof val === 'string' && /^\d{16,20}$/.test(val)) return '<id>';
    if (typeof val === 'string' && /^mock_id_/.test(val)) return '<id>';
    return val;
  }));
}
