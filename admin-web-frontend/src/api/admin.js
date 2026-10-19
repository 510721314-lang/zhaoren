// api/admin.js · admin-web HTTP 代理层
// 所有请求走 admin-web HTTP 云函数 → proxy admin-action
import axios from 'axios';
import { ElMessage } from 'element-plus';

// 批 6.2: 这些写操作改的是带缓存的后台配置/活动, 生效有约 5 分钟传播延迟, 成功后统一提示
const DELAY_EFFECT_ACTIONS = new Set([
  'config_set', 'home_activity_create', 'home_activity_update', 'home_activity_delete'
]);

// 规则: 始终直打 CloudBase HTTP 网关（HTTPS + CORS 已配置, 跨域无问题）
//       call() 固定 .post('/api', data) → 最终拼成 PROD_ROOT/api + body.action
// 这样无论本机 dev / 远程桌面 / 手机浏览器 / 生产 dist 都能通, 不依赖 vite proxy
const PROD_ROOT = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com';
const BASE_URL = PROD_ROOT;

const http = axios.create({ baseURL: BASE_URL, timeout: 15000 });

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
  if (!config.headers['X-Admin-Key']) {
    const key = localStorage.getItem('admin_web_key') || '';
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
    // (P2-6 重做) 504 网关超时自动重试一次: 云函数冷启动首个请求可能超网关 3s 硬限,
    // 第二次命中热启动云函数秒级返回; 只重试一次防死循环
    if (status === 504 && e.config && !e.config._retry) {
      e.config._retry = true;
      return new Promise((resolve) => setTimeout(() => resolve(http.request(e.config)), 1000));
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
