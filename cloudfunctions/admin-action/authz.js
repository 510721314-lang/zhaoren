// authz.js —— admin-action 的 RBAC 授权表与角色判定（2026-11-06 P3-25 最小版拆分）
// 从 index.js 原样迁出，**零行为变更**；入口只保留「取角色 + 判定 + 留痕」的编排。
// 维护约定：新增 action 必须在 ROLE_GRANTS 显式声明 R2/R3 放行，未声明 → 默认仅 R1（敏感：export_*/config_set/force 类）。

const ADMIN_ROLE_LABEL = { R1: '超管', R2: '审核', R3: '运营' };
const ADMIN_ROLES = ['R1', 'R2', 'R3'];
// 非 R1 角色的 action 放行表
// R2=审核专员: 审核/证据/举报/IM监管/内容下架; R3=运营: 配置/活动/通知/订单/财务只读/用户查询
const ROLE_GRANTS = {
  // ── R2 审核 ──
  'audit_init': ['R2'], 'audit_query': ['R2'], 'audit_verify': ['R2'],
  'evidence_query': ['R2'],
  'partner_profile_pending_list': ['R2'], 'partner_profile_review': ['R2'], 'review': ['R2'],
  'im_degraded_list': ['R2'], 'im_message_admin_list': ['R2'],
  'report_list': ['R2', 'R3'], 'report_handle': ['R2'],
  'safety_log_list': ['R2'], 'insurance_list': ['R2'],
  'blog_list': ['R2', 'R3'], 'blog_offline': ['R2'], 'blog_restore': ['R2'], 'blog_delete': ['R2'],
  'blog_comment_list': ['R2'], 'blog_comment_delete': ['R2'],
  'demand_list': ['R2', 'R3'], 'demand_offline': ['R2', 'R3'],
  'order_list': ['R2', 'R3'], 'order_query': ['R2', 'R3'], 'order_detail': ['R2', 'R3'],
  'dispute_list': ['R2', 'R3'], 'dispute_detail': ['R2', 'R3'], 'dispute_handle': ['R2'],
  // 第三批 3B: 爽约申诉列表/裁定(裁定人 R2/R3, 设计稿 §2.2)
  'no_show_report_list': ['R2', 'R3'], 'no_show_decide': ['R2', 'R3'],
  // ── R3 运营 ──
  'dashboard': ['R3'],
  'config_get': ['R3'], 'config_log_list': ['R3'],
  // 法律文档版本库(批1a): 只读列表放开 R3; 发布/回滚/存量初始化属敏感写, 未列出即仅 R1
  'legal_doc_list': ['R3'], 'legal_doc_get': ['R3'],
  'home_activity_list': ['R3'], 'home_activity_create': ['R3'], 'home_activity_update': ['R3'], 'home_activity_delete': ['R3'], 'upload_image': ['R3'],
  'notice_send': ['R3'],
  'kefu_conv_list': ['R3'], 'kefu_conv_reply': ['R3'],
  'user_list': ['R3'], 'user_detail': ['R3'],
  'partner_list': ['R3'], 'partner_detail': ['R3'],
  'finance_list': ['R3'], 'finance_stats': ['R3'],
  'withdraw_list': ['R3'], 'settlement_list': ['R3'],
  'credit_log_list': ['R3'], 'penalty': ['R2', 'R3'],
  // ── 认证考试管理(题库/通过规则, 配置化) ──
  'exam_subject_list': ['R3'], 'exam_subject_detail': ['R3'],
  'exam_subject_create': ['R3'], 'exam_subject_update': ['R3'], 'exam_subject_delete': ['R3'],
  'exam_bank_seed': ['R1', 'R3'],
  // S4: 题库写入口迁至 questions（新增/编辑/删除/批量/导入）
  'exam_subject_overview': ['R3'], 'exam_subject_meta_update': ['R3'],
  'question_list': ['R3'], 'question_detail': ['R3'],
  'question_upsert': ['R3'], 'question_delete': ['R3'],
  'question_bulk_status': ['R3'], 'question_import_markdown': ['R3'],
  // S4: 学习内容只读预览
  'content_list': ['R3'], 'content_detail': ['R3']
};

// 角色是否可执行该 action（R1 超管放行全部；未声明的 action 仅 R1）
function canAccess(action, role) {
  if (role === 'R1') return true;
  const grants = ROLE_GRANTS[action];
  return !!(grants && grants.indexOf(role) >= 0);
}

// 拒绝文案（与拆分前逐字一致）
function forbiddenMsg(action) {
  const grants = ROLE_GRANTS[action];
  return `无权限执行此操作(需 ${(grants || ['R1']).map((r) => ADMIN_ROLE_LABEL[r]).join('/')} 角色)`;
}

module.exports = { ADMIN_ROLE_LABEL, ADMIN_ROLES, ROLE_GRANTS, canAccess, forbiddenMsg };
