import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// CloudBase HTTP trigger URL 部署后填到 cloudbaseUrl
// 本地 dev 用 vite proxy 转发
const cloudbaseUrl = 'https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com'; // CloudBase HTTP 网关根 URL

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: cloudbaseUrl,
        changeOrigin: true,
        rewrite: (p) => p
      }
    }
  }
});
