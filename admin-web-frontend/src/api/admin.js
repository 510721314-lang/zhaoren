// api/admin.js · admin-web HTTP 代理层
// 所有请求走 admin-web HTTP 云函数 → proxy admin-action
import axios from 'axios';

// 规则: BASE_URL 只做"根"（dev 空串走 vite proxy、生产 trigger 根 URL 不带 /api）
//       call() 固定 .post('/api', data)  → 最终拼成 /api + body.action
const PROD_ROOT = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com'; // CloudBase HTTP 网关根 URL
const BASE_URL = window.location.hostname.includes('localhost')
  ? ''         // dev: 空串让 axios 走 vite proxy（/api/* → cloudbaseUrl/api/*）
  : PROD_ROOT; // prod: 直打 CloudBase HTTP trigger 根

const http = axios.create({ baseURL: BASE_URL, timeout: 15000 });

http.interceptors.request.use((config) => {
  const key = localStorage.getItem('admin_web_key') || '';
  if (key) config.headers['X-Admin-Key'] = key;
  return config;
});

http.interceptors.response.use(
  (r) => r.data,
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
