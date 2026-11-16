// 最简冒烟：验证 miniprogram-automator 启动序列 + 正确 API
// 用法：node tests/e2e/smoke.js（自动启动 DevTools + 开自动化端口，无需手动前置）
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

(async () => {
  let miniProgram;
  try {
    console.log('[0/5] 启动 DevTools + 开启自动化端口 ...');
    await startDevTools();

    console.log(`[1/5] connecting ws://127.0.0.1:${PORT} ...`);
    miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
    console.log('[1/5] connected OK');

    console.log('[1.5/5] 等待项目编译 ...');
    await waitForReady(miniProgram, 30);

    console.log('[2/5] systemInfo ...');
    const info = await miniProgram.systemInfo();
    console.log('[2/5] brand:', info.brand, 'platform:', info.platform);

    console.log('[3/5] reLaunch /pages-v2/index/index ...');
    const page = await miniProgram.reLaunch('/pages-v2/index/index');
    if (!page) { console.log('[FAIL] reLaunch returned undefined'); process.exit(1); }
    console.log('[3/5] page.path =', page.path);  // path 是属性，不是方法

    console.log('[4/5] page.data() (async method) ...');
    const data = await page.data();
    const keys = Object.keys(data || {});
    console.log('[4/5] data keys:', keys.length > 0 ? keys.slice(0, 10).join(',') : '(empty)');

    console.log('\n=== smoke PASS ===');
    console.log('启动序列: startDevTools() → automator.connect → waitForReady → reLaunch → page.data()');
    process.exit(0);
  } catch (e) {
    console.error('\n[FAIL]', e.message);
    process.exit(1);
  } finally {
    if (miniProgram) { try { await miniProgram.disconnect(); } catch (_) {} }
  }
})();
