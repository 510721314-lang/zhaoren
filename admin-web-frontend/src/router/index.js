// router/index.js · fail-closed 权限路由
import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/login', component: () => import('../views/Login.vue'), meta: { noAuth: true } },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    redirect: '/config',
    children: [
      { path: 'config', component: () => import('../views/Config.vue'), meta: { title: '运营配置' } },
      { path: 'users', component: () => import('../views/Users.vue'), meta: { title: '用户管理' } },
      { path: 'orders', component: () => import('../views/Orders.vue'), meta: { title: '订单管理' } },
      { path: 'finance', component: () => import('../views/Finance.vue'), meta: { title: '财务管理' } },
    ]
  }
];

const router = createRouter({ history: createWebHashHistory(), routes });

// fail-closed: 未登录所有路径 → login
router.beforeEach((to, _from, next) => {
  const key = localStorage.getItem('admin_web_key');
  if (!to.meta.noAuth && !key) next('/login');
  else if (to.path === '/login' && key) next('/config');
  else next();
});

export default router;
