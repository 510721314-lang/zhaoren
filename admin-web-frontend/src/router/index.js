// router/index.js · fail-closed 权限路由 · 对齐蓝图 8 菜单 21 页
import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/login', component: () => import('../views/Login.vue'), meta: { noAuth: true } },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    redirect: '/dashboard',
    children: [
      // ── 1. 工作台 ──
      { path: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '工作台' } },

      // ── 2. 订单与履约 ──
      { path: 'orders', component: () => import('../views/Orders.vue'), meta: { title: '订单列表' } },
      { path: 'dispute', component: () => import('../views/Dispute.vue'), meta: { title: '纠纷处理' } },
      { path: 'safety-log', component: () => import('../views/SafetyLog.vue'), meta: { title: '安全报备' } },
      { path: 'insurance', component: () => import('../views/Insurance.vue'), meta: { title: '保险记录' } },

      // ── 3. 用户与耍伴 ──
      { path: 'users', component: () => import('../views/Users.vue'), meta: { title: '发单用户' } },
      { path: 'partners', component: () => import('../views/Partners.vue'), meta: { title: '耍伴管理' } },
      { path: 'review', component: () => import('../views/Review.vue'), meta: { title: '耍伴审核' } },

      // ── 4. 财务与资产 ──
      { path: 'finance', component: () => import('../views/Finance.vue'), meta: { title: '财务与资产' } },

      // ── 5. 内容中心 ──
      { path: 'demand', component: () => import('../views/Demand.vue'), meta: { title: '需求广场' } },
      { path: 'blog', component: () => import('../views/Blog.vue'), meta: { title: '博客管理' } },
      { path: 'comment', component: () => import('../views/Comment.vue'), meta: { title: '评论管理' } },

      // ── 6. 安全与风控 ──
      { path: 'report', component: () => import('../views/Report.vue'), meta: { title: '举报处理' } },
      { path: 'conversation', component: () => import('../views/Conversation.vue'), meta: { title: '会话监管' } },

      // ── 7. 运营配置 ──
      { path: 'config', redirect: '/operations' },  // 旧入口跳转
      { path: 'operations', component: () => import('../views/Operations.vue'), meta: { title: '运营配置' } },
      { path: 'config-log', component: () => import('../views/ConfigLog.vue'), meta: { title: '参数变更日志' } },
      { path: 'legal', component: () => import('../views/Legal.vue'), meta: { title: '法律合规' } },

      // ── 8. 系统管理 ──
      { path: 'notice', component: () => import('../views/Notice.vue'), meta: { title: '通知群发' } },
      { path: 'export', component: () => import('../views/Export.vue'), meta: { title: '导出任务' } },
    ]
  }
];

const router = createRouter({ history: createWebHashHistory(), routes });

// fail-closed: 未登录所有路径 → login
router.beforeEach((to, _from, next) => {
  const key = localStorage.getItem('admin_web_key');
  if (!to.meta.noAuth && !key) next('/login');
  else if (to.path === '/login' && key) next('/dashboard');
  else next();
});

export default router;
