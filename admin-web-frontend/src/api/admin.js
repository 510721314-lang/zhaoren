// api/admin.js · admin-web HTTP 代理层
// 所有请求走 admin-web HTTP 云函数 → proxy admin-action
import axios from 'axios';

// TODO: 部署后把 HTTP trigger URL 填到这里
const BASE_URL = window.location.hostname.includes('localhost')
  ? 'http://127.0.0.1:3000/api'  // 本地 dev 用 vite proxy
  : '/api';                       // 生产走同域或 CloudBase 静态托管同域

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
