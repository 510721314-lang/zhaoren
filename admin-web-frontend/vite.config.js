import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// CloudBase HTTP trigger URL 部署后填到 cloudbaseUrl
// 本地 dev 用 vite proxy 转发
const cloudbaseUrl = 'https://cloud1-d9gkefwcp5c777088-xxxxx.tcloudbaseapp.com'; // TODO: 部署后替换

export default defineConfig({
  plugins: [vue()],
  server: {
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
