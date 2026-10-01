// views/Login.vue · 登录(S1 RBAC 双模式)
// 模式A 账号密码(admin_accounts, 推荐) → 后端签名 __admin_token 存 localStorage
// 模式B admin_web_key 密钥(兼容旧链路, 仍可用)
<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <template #header>
        <h2>找人帮忙 · 管理后台</h2>
      </template>

      <!-- 模式切换 -->
      <el-radio-group v-model="mode" size="small" style="margin-bottom:16px">
        <el-radio-button value="account">账号登录</el-radio-button>
        <el-radio-button value="key">密钥登录</el-radio-button>
      </el-radio-group>

      <template v-if="mode === 'account'">
        <el-input v-model="account" placeholder="登录名" size="large" style="margin-bottom:12px" />
        <el-input v-model="password" placeholder="密码" show-password type="password" size="large" style="margin-bottom:12px"
          @keyup.enter="onLogin" />
        <el-button type="primary" size="large" :loading="loading" style="width:100%;margin-bottom:12px" @click="onLogin">
          登录
        </el-button>
        <div class="login-hint">账号由超管在「系统管理-账号管理」创建</div>
      </template>

      <template v-else>
        <el-input v-model="key" placeholder="请输入 admin_web_key" show-password type="password" size="large" />
        <el-button type="primary" size="large" :loading="loading" style="width:100%;margin-top:20px" @click="onLogin">
          进入管理后台
        </el-button>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { call } from '../api/admin.js';

const mode = ref('account');
const account = ref('');
const password = ref('');
const key = ref('');
const loading = ref(false);

async function onLogin() {
  loading.value = true;
  let r;
  if (mode.value === 'account') {
    r = await call('admin_login', { account: account.value.trim(), password: password.value });
  } else {
    // 密钥登录: 显式传 key 验证(避免 localStorage 覆盖)
    r = await call('config_get', {}, key.value);
  }
  loading.value = false;
  if (r.ok) {
    if (mode.value === 'account') {
      localStorage.setItem('admin_token', r.data.token);
      localStorage.setItem('admin_role', r.data.role || 'R1');
      localStorage.setItem('admin_account', r.data.account || '');
      localStorage.removeItem('admin_web_key'); // 账号登录后清理旧 key, 统一走 token
    } else {
      localStorage.setItem('admin_web_key', key.value);
      localStorage.removeItem('admin_token');   // 切回 key 模式则清 token
      localStorage.removeItem('admin_role');
    }
    window.location.hash = '#/config';
  } else {
    alert('登录失败: ' + (r.msg || r.code));
  }
}
</script>

<style scoped>
.login-wrap { display:flex; justify-content:center; align-items:center; height:100vh; background:#f5f7fa; }
.login-card { width:360px; }
.login-hint { font-size:12px; color:#909399; text-align:center; }
</style>