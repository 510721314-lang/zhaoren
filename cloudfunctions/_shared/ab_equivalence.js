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

// P1 E2E: CN 12:00 安全时间戳(落在 redline 运营时段内), A/B 两侧同值故不影响等价
const _tsD = new Date(); _tsD.setUTCDate(_tsD.getUTCDate() + 1); _tsD.setUTCHours(4, 0, 0, 0);
const NEW_TS = _tsD.getTime();
const START_TS = NEW_TS - 24 * 3600 * 1000;
// 爽约申诉窗口: 约定开始时间须在「now - reportWindowH(48h)」之后, 取 1h 前
const RECENT_TS = Date.now() - 3600 * 1000;

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
  { fn: 'order-action', name: 'start_S2_ok', openid: PARTNER,
    store: Object.assign(baseStore(), { order_main: { [OID]: { _id: OID, order_no: 'ORD-1', status: 'S2', user_openid: USER, partner_openid: PARTNER, total_fen: 1000 } } }),
    event: { action: 'start_service', mock_openid: PARTNER, order_id: OID } },
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
    'detail_ok', 'auto_order_detail',          // detail 字段扩充(modify_*_at / complaint / fund / refund / dispute / fees / frozen)
    'confirm_all_not_participant',              // 错误消息脱敏(不再回显参与方 openid)
    'complaint_status', 'auto_order_complaint', // 投诉入口放开至 S2 起(原 S2 拒绝)
    'auto_order_timeline',                      // 新增 timeline action(原 oa_unknown_action)
    'auto_admin_config_get',                    // config_schema 新增 extend_confirm_h / scene_option_display_max · 2026-10-13 每项新增 d 说明文案(运营配置页内嵌) · extend_confirm_h→extend_confirm_min(分钟制默认20, 时间红线加 clock)
    'auto_admin_config_restore', 'auto_admin_import_collection', // 新增备份恢复 action(原 admin_unknown_action; 配合 .predeploy/restore.ps1 闭环 DB 恢复)
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
    if (typeof val === 'number' && val > 1e12) return '<ts>';
    if (typeof val === 'string' && /^(REF|ORD|WD|TX|DR)[0-9a-f]+$/i.test(val)) return '<id>';
    if (typeof val === 'string' && /^mock_id_/.test(val)) return '<id>';
    return val;
  }));
}
