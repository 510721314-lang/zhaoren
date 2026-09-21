// api/admin.js · admin-web HTTP 代理层
// 所有请求走 admin-web HTTP 云函数 → proxy admin-action
import axios from 'axios';

// 规则: 始终直打 CloudBase HTTP 网关（HTTPS + CORS 已配置, 跨域无问题）
//       call() 固定 .post('/api', data) → 最终拼成 PROD_ROOT/api + body.action
// 这样无论本机 dev / 远程桌面 / 手机浏览器 / 生产 dist 都能通, 不依赖 vite proxy
const PROD_ROOT = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com';
const BASE_URL = PROD_ROOT;

const http = axios.create({ baseURL: BASE_URL, timeout: 15000 });

http.interceptors.request.use((config) => {
  const key = localStorage.getItem('admin_web_key') || '';
  if (key) config.headers['X-Admin-Key'] = key;
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
    return d;
  },
  (e) => {
    const status = e.response && e.response.status;
    if (status === 401) {
      localStorage.removeItem('admin_web_key');
      window.location.hash = '#/login';
    }
    return { ok: false, code: 'http_' + status, msg: e.message };
  }
);

export function call(action, data = {}) {
  return http.post('/api', { action, ...data });
}
export default { call };
