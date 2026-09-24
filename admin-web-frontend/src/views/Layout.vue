// views/Layout.vue · 侧边栏 8 菜单分组 · 对齐蓝图 IA 原则 (按业务对象聚合)
<template>
  <el-container class="layout-wrap">
    <el-aside width="220px">
      <div class="logo">找人帮忙 · 管理后台</div>
      <el-menu :default-active="$route.path" router background-color="#304156" text-color="#bfcbd9" active-text-color="#409EFF">
        <!-- 1. 工作台 -->
        <el-menu-item index="/dashboard"><el-icon><DataAnalysis /></el-icon>工作台</el-menu-item>

        <!-- 2. 订单与履约 -->
        <el-sub-menu index="order-group">
          <template #title><el-icon><Tickets /></el-icon><span>订单与履约</span></template>
          <el-menu-item index="/orders">订单列表</el-menu-item>
          <el-menu-item index="/dispute">纠纷处理</el-menu-item>
          <el-menu-item index="/safety-log">安全报备</el-menu-item>
          <el-menu-item index="/insurance">保险记录</el-menu-item>
        </el-sub-menu>

        <!-- 3. 用户与耍伴 -->
        <el-sub-menu index="user-group">
          <template #title><el-icon><User /></el-icon><span>用户与耍伴</span></template>
          <el-menu-item index="/users">发单用户</el-menu-item>
          <el-menu-item index="/partners">耍伴管理</el-menu-item>
          <el-menu-item index="/review">耍伴审核</el-menu-item>
        </el-sub-menu>

        <!-- 4. 财务与资产 -->
        <el-menu-item index="/finance"><el-icon><Money /></el-icon>财务与资产</el-menu-item>

        <!-- 5. 内容中心 -->
        <el-sub-menu index="content-group">
          <template #title><el-icon><Reading /></el-icon><span>内容中心</span></template>
          <el-menu-item index="/demand">需求广场</el-menu-item>
          <el-menu-item index="/blog">博客管理</el-menu-item>
          <el-menu-item index="/comment">评论管理</el-menu-item>
        </el-sub-menu>

        <!-- 6. 安全与风控 -->
        <el-sub-menu index="risk-group">
          <template #title><el-icon><Lock /></el-icon><span>安全与风控</span></template>
          <el-menu-item index="/report">举报处理</el-menu-item>
          <el-menu-item index="/conversation">会话监管</el-menu-item>
          <el-menu-item index="/audit">行为审计</el-menu-item>
        </el-sub-menu>

        <!-- 7. 运营配置(已拆为独立模块) -->
        <el-sub-menu index="ops-group">
          <template #title><el-icon><Setting /></el-icon><span>运营配置</span></template>
          <el-menu-item index="/operations">阈值与开关</el-menu-item>
          <el-menu-item index="/config-log">参数变更日志</el-menu-item>
          <el-menu-item index="/legal">法律合规</el-menu-item>
        </el-sub-menu>

        <!-- 8. 系统管理 -->
        <el-sub-menu index="sys-group">
          <template #title><el-icon><Tools /></el-icon><span>系统管理</span></template>
          <el-menu-item index="/notice">通知群发</el-menu-item>
          <el-menu-item index="/export">导出任务</el-menu-item>
        </el-sub-menu>
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
import {
  Setting, User, Tickets, Money, DataAnalysis, Reading, Lock, Tools
} from '@element-plus/icons-vue';

function onLogout() {
  localStorage.removeItem('admin_web_key');
  window.location.hash = '#/login';
}
</script>

<style scoped>
.layout-wrap { height:100vh; }
.el-aside { background:#304156; overflow-y:auto; }
.logo { color:#fff; font-size:14px; font-weight:600; padding:14px 16px; border-bottom:1px solid #3a4a5e; text-align:center; }
.el-header { background:#fff; border-bottom:1px solid #e4e7ed; display:flex; align-items:center; }
</style>
