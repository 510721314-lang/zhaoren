// 批量冒烟：遍历 app.json 所有页面，验证可打开 + page.data() 可获取
// 用法：node tests/e2e/smoke-pages.js
// 自动启动 DevTools + 开启自动化端口，无需手动前置
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

// 主包 + 分包页面（需参数的页面加假参数，仅验证可打开）
const PAGES = [
  // 主包
  'pages-v2/index/index',
  'pages-v2/square/square',
  'pages-v2/message/message',
  'pages-v2/profile/profile',
  'pages-v2/login/login',
  'pages-v2/publish/publish',
  'pages-v2/demand-detail/demand-detail?id=test',
  'pages-v2/nearby-list/nearby-list',
  'pages-v2/nearby-map/nearby-map',
  'pages-v2/partner-detail/partner-detail?id=test',
  'pages-v2/chat/chat?id=test',
  'pages-v2/pay/pay?id=test',
  'pages-v2/order-detail/order-detail?id=test',
  'pages-v2/workbench/workbench',
  'pages-v2/orders/orders',
  'pages-v2/my-demands/my-demands',
  'pages-v2/blog/blog',
  'pages-v2/blog-publish/blog-publish',
  'pages-v2/blog-detail/blog-detail?id=test',
  // pkgAdmin
  'pages-v2/admin/admin',
  'pages-v2/admin/users',
  'pages-v2/admin/partners',
  'pages-v2/admin/demands',
  'pages-v2/admin/orders',
  'pages-v2/admin/finance',
  'pages-v2/admin/config',
  'pages-v2/admin/user-detail?id=test',
  // pkgAgreement / pkgPrivacy
  'pages-v2/agreement/agreement',
  'pages-v2/privacy/privacy',
  // pkgLow
  'pages-v2/pkg-low/wallet/wallet',
  'pages-v2/pkg-low/credit/credit',
  'pages-v2/pkg-low/contacts/contacts',
  'pages-v2/pkg-low/notices/notices',
  'pages-v2/pkg-low/partner-apply/partner-apply',
  'pages-v2/pkg-low/partner-profile-edit/partner-profile-edit',
  'pages-v2/pkg-low/accept-config/accept-config',
  'pages-v2/pkg-low/activity-detail/activity-detail?id=test',
  'pages-v2/pkg-low/realname/realname',
  'pages-v2/pkg-low/safety/safety',
  'pages-v2/pkg-low/evaluate/evaluate?id=test',
  'pages-v2/pkg-low/exam/exam',
  'pages-v2/pkg-low/exam-status/exam-status',
  'pages-v2/pkg-low/study/study',
  'pages-v2/pkg-low/kefu/kefu',
  'pages-v2/pkg-low/no-show-report/no-show-report?id=test',
];

(async () => {
  let miniProgram;
  const results = [];
  try {
    // 自动启动 DevTools + 开自动化端口
    await startDevTools();
    try {
      miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
    } catch (e) {
      console.error(`FAIL: 无法连接自动化端口 ${PORT}: ${e.message}`);
      process.exit(1);
    }
    console.log('已连接，等待项目编译 ...');
    if (!await waitForReady(miniProgram, 30)) {
      console.error('FAIL: 30s 内项目未编译完成');
      process.exit(1);
    }
    console.log(`开始测试 ${PAGES.length} 个页面...\n`);

    for (let i = 0; i < PAGES.length; i++) {
      const url = PAGES[i];
      const basePath = url.split('?')[0];
      const label = `[${i + 1}/${PAGES.length}] ${basePath}`;
      try {
        const page = await miniProgram.reLaunch('/' + url);
        if (!page) {
          results.push({ url: basePath, ok: false, reason: 'reLaunch returned undefined' });
          console.log(`${label} FAIL: undefined`);
          continue;
        }
        const path = page.path;
        const data = await page.data();
        const dataKeys = Object.keys(data || {}).length;
        const ok = typeof path === 'string' && path.length > 0;
        results.push({ url: basePath, ok, path, dataKeys });
        console.log(`${label} ${ok ? 'OK' : 'FAIL'} path=${path} dataKeys=${dataKeys}`);
      } catch (e) {
        results.push({ url: basePath, ok: false, reason: e.message.slice(0, 80) });
        console.log(`${label} FAIL: ${e.message.slice(0, 80)}`);
      }
    }
  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    if (miniProgram) { try { await miniProgram.disconnect(); } catch (_) {} }
  }

  // 汇总
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n=== SUMMARY: ${pass}/${PAGES.length} PASS, ${fail} FAIL ===`);
  if (fail > 0) {
    console.log('\nFailed pages:');
    results.filter(r => !r.ok).forEach(r => console.log(`  ${r.url} — ${r.reason}`));
  }
  process.exit(fail > 0 ? 1 : 0);
})();
