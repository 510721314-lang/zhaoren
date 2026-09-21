// views/Layout.vue · 侧边栏 + 顶栏 + 路由出口
<template>
  <el-container class="layout-wrap">
    <el-aside width="200px">
      <el-menu :default-active="$route.path" router background-color="#304156" text-color="#bfcbd9" active-text-color="#409EFF">
        <el-menu-item index="/config"><el-icon><Setting /></el-icon>运营配置</el-menu-item>
        <el-menu-item index="/users"><el-icon><User /></el-icon>用户管理</el-menu-item>
        <el-menu-item index="/orders"><el-icon><Tickets /></el-icon>订单管理</el-menu-item>
        <el-menu-item index="/finance"><el-icon><Money /></el-icon>财务管理</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header>
        <span>{{ $route.meta.title }}</span>
        <el-button style="float:right" size="small" @click="onLogout">退出</el-button>
      </el-header>
      <el-main><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { Setting, User, Tickets, Money } from '@element-plus/icons-vue';
function onLogout() {
  localStorage.removeItem('admin_web_key');
  window.location.hash = '#/login';
}
</script>

<style scoped>
.layout-wrap { height:100vh; }
.el-aside { background:#304156; }
.el-header { background:#fff; border-bottom:1px solid #e4e7ed; display:flex; align-items:center; }
</style>
