// views/Login.vue · admin_web_key 登录
<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <template #header>
        <h2>找人帮忙 · 管理后台</h2>
      </template>
      <el-input v-model="key" placeholder="请输入 admin_web_key" show-password type="password" size="large" />
      <el-button type="primary" size="large" :loading="loading" style="width:100%;margin-top:20px" @click="onLogin">
        进入管理后台
      </el-button>
      <div class="login-hint">密钥在 admin_config.admin_web_key（init-db generate_admin_web_key 生成）</div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { call } from '../api/admin.js';
const key = ref('');
const loading = ref(false);

async function onLogin() {
  if (!key.value) return;
  loading.value = true;
  const r = await call('config_get'); // 用 config_get 当探测接口
  loading.value = false;
  if (r.ok) {
    localStorage.setItem('admin_web_key', key.value);
    window.location.hash = '#/config';
  } else {
    alert('密钥错误: ' + (r.msg || r.code));
  }
}
</script>

<style scoped>
.login-wrap { display:flex; justify-content:center; align-items:center; height:100vh; background:#f5f7fa; }
.login-card { width:360px; }
.login-hint { font-size:12px; color:#909399; margin-top:12px; text-align:center; }
</style>
