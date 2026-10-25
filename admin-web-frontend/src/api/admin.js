// api/admin.js · admin-web HTTP 代理层
// 所有请求走 admin-web HTTP 云函数 → proxy admin-action
import axios from 'axios';
import { ElMessage } from 'element-plus';

// 批 6.2: 这些写操作改的是带缓存的后台配置/活动, 生效有约 5 分钟传播延迟, 成功后统一提示
const DELAY_EFFECT_ACTIONS = new Set([
  'config_set', 'home_activity_create', 'home_activity_update', 'home_activity_delete'
]);

// (复核整改 2026-10-19) 504 自动重试白名单 —— 仅【读类 action】可安全重试(幂等; 按前端实际调用面穷举)。
// 写类(action 不在本集合)一律不重试: 504 时云函数可能已落库, 重试会重复提交(config_set / *_review / *_handle / *_delete / seed 等)。
const READ_ONLY_ACTIONS = new Set([
  'admin_account_list', 'config_get', 'blog_list', 'blog_comment_list',
  'audit_query', 'audit_verify', 'finance_stats', 'finance_list', 'withdraw_list',
  'im_message_admin_list', 'kefu_conv_list', 'dispute_list', 'dispute_detail',
  'demand_list', 'config_log_list', 'dashboard', 'report_list',
  'exam_subject_list', 'exam_subject_detail', 'event_list',
  'order_list', 'order_detail', 'insurance_list', 'home_activity_list',
  'user_list', 'user_detail', 'credit_log_list', 'partner_profile_pending_list',
  'safety_log_list', 'partner_list', 'no_show_report_list',
  'export_collection', 'export_admin_config'
]);

// 规则: 始终直打 CloudBase HTTP 网关（HTTPS + CORS 已配置, 跨域无问题）
//       call() 固定 .post('/api', data) → 最终拼成 PROD_ROOT/api + body.action
// 这样无论本机 dev / 远程桌面 / 手机浏览器 / 生产 dist 都能通, 不依赖 vite proxy
const PROD_ROOT = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com';
const BASE_URL = PROD_ROOT;

const http = axios.create({ baseURL: BASE_URL, timeout: 15000 });

// 密钥归一（2026-10-25 实测结论）：
// ① 首尾**半角**空白 HTTP 头会自行剥离（实测 key+' ' 与 '\t'+key 均返回 200），故 trim 主要防「浏览器抛非法头字符」类异常；
// ② 真正的 401 真凶是**带前缀整行**（AWK_KEY=<key> 实测必 401）→ 这里主动剥离已知前缀，避免用户手工裁切；
// ③ 全角空格 U+3000 等 Unicode 空白不会被 HTTP 剥离，trim 恰好覆盖（JS trim 会移除 U+3000）。
export function normalizeKey(raw) {
  let s = String(raw == null ? '' : raw).trim();
  const m = s.match(/^AWK_KEY\s*=\s*([\s\S]*)$/i);
  if (m) s = m[1].trim();
  // 2026-10-25 追加: trim() 清不掉零宽空格(U+200B)/软连字符等不可见字符, 从网页复制常带入。
  // 密钥本体只含 [A-Za-z0-9_-]（实测生产 key = "AWK-" + 64 位）, 故直接剔除其余字符。
  s = s.replace(/[^A-Za-z0-9_-]/g, '');
  return s;
}

http.interceptors.request.use((config) => {
  // 账号会话(批4.2): 若已登录账号, 注入 X-Admin-Token 供网关会话校验, 无需每次携带长期静态 key
  const token = localStorage.getItem('admin_token') || '';
  if (token) {
    config.headers['X-Admin-Token'] = token;
    if (config.data && typeof config.data === 'object') {
      config.data.__admin_token = token; // 后端 RBAC 角色门控仍读 body 内 __admin_token
    }
  }
  // 只在 headers 里没显式传 X-Admin-Key 时才从 localStorage 读(密钥模式兜底)
  // 2026-10-25 修复: localStorage 里的 key 可能带行尾空格/换行/前缀(粘贴残留) → 统一走 normalizeKey
  if (!config.headers['X-Admin-Key']) {
    const key = normalizeKey(localStorage.getItem('admin_web_key'));
    if (key) config.headers['X-Admin-Key'] = key;
  }
  return config;
});

http.interceptors.response.use(
  (r) => {
    const d = r.data;
    // 业务层 bad_key / missing_key → 清 localStorage + 跳 login
    if (d && d.ok === false && (d.code === 'bad_key' || d.code === 'missing_key' || d.code === 'admin_web_key_not_set')) {
      localStorage.removeItem('admin_web_key');
      if (window.location.hash !== '#/login') {
        window.location.hash = '#/login';
      }
    }
    // 批4.2: 会话过期(bad_token) → 清 token 跳登录
    if (d && d.ok === false && d.code === 'bad_token') {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_role');
      localStorage.removeItem('admin_account');
      if (window.location.hash !== '#/login') {
        window.location.hash = '#/login';
      }
    }
    // 批 6.2: 配置/活动写操作成功 → 统一提示生效延迟(不阻断, 仅提示)
    if (d && d.ok === true) {
      try {
        const body = r.config && r.config.data;
        const action = (typeof body === 'string' ? JSON.parse(body).action : body && body.action);
        if (action && DELAY_EFFECT_ACTIONS.has(action)) {
          ElMessage.info('配置已保存, 约 5 分钟内生效');
        }
      } catch (_) { /* 解析失败不影响主流程 */ }
    }
    return d;
  },
  (e) => {
    const status = e.response && e.response.status;
    // (P2-6 重做 + 复核整改 2026-10-19) 504 网关超时自动重试一次 —— 仅限【读类 action】(见 READ_ONLY_ACTIONS);
    // 写类非幂等, 重试可能重复落库, 一律不重试, 直接抛给调用方。
    if (status === 504 && e.config && !e.config._retry) {
      let act = '';
      try {
        const b = e.config.data;
        const parsed = typeof b === 'string' ? JSON.parse(b) : b;
        act = (parsed && parsed.action) || '';
      } catch (_) { act = ''; }
      if (READ_ONLY_ACTIONS.has(act)) {
        e.config._retry = true;
        return new Promise((resolve) => setTimeout(() => resolve(http.request(e.config)), 1000));
      }
    }
    if (status === 401) {
      localStorage.removeItem('admin_web_key');
      window.location.hash = '#/login';
    }
    return { ok: false, code: 'http_' + status, msg: e.message };
  }
);

export function call(action, data = {}, keyOverride = null) {
  // keyOverride 用于登录页: 此时 localStorage 还没存 key, 显式传才能通过网关校验
  const cfg = { action, ...data };
  if (keyOverride) {
    return http.post('/api', cfg, { headers: { 'X-Admin-Key': keyOverride } });
  }
  return http.post('/api', cfg);
}
export default { call };
