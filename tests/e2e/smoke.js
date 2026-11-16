// 最简冒烟：验证 miniprogram-automator 启动序列 + 正确 API
// 用法：node tests/e2e/smoke.js
const automator = require('miniprogram-automator');

(async () => {
  let miniProgram;
  try {
    console.log('[1/4] connecting ws://127.0.0.1:9420 ...');
    miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    console.log('[1/4] connected OK');

    console.log('[2/4] systemInfo ...');
    const info = await miniProgram.systemInfo();
    console.log('[2/4] brand:', info.brand, 'platform:', info.platform);

    console.log('[3/4] reLaunch /pages-v2/index/index ...');
    const page = await miniProgram.reLaunch('/pages-v2/index/index');
    if (!page) { console.log('[FAIL] reLaunch returned undefined'); process.exit(1); }
    console.log('[3/4] page.path =', page.path);  // path 是属性，不是方法

    console.log('[4/4] page.data() (async method) ...');
    const data = await page.data();
    const keys = Object.keys(data || {});
    console.log('[4/4] data keys:', keys.length > 0 ? keys.slice(0, 10).join(',') : '(empty)');

    console.log('\n=== smoke PASS ===');
    console.log('启动序列: cli.bat auto (Start-Process) → automator.connect → reLaunch → page.data()');
    process.exit(0);
  } catch (e) {
    console.error('\n[FAIL]', e.message);
    process.exit(1);
  } finally {
    if (miniProgram) { try { await miniProgram.disconnect(); } catch (_) {} }
  }
})();
