// 关键链路交互冒烟：首页→发布、首页→需求详情、我的→订单
// 用法：node tests/e2e/smoke-flows.js
// 与 smoke-pages.js（纯页面可达）互补，本文件测元素交互与跳转
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

const flows = [
  { name: '首页加载', url: '/pages-v2/index/index', check: async (page) => {
    const d = await page.data();
    if (!d || Object.keys(d).length < 5) throw new Error('首页 data 为空');
  }},
  { name: '首页→发布页', url: '/pages-v2/publish/publish', check: async (page) => {
    const d = await page.data();
    if (!d.form) throw new Error('发布页 form 不存在');
    const titleInput = await page.$('.pub__input');
    if (!titleInput) throw new Error('发布页标题输入框不存在');
  }},
  { name: '发布页→填标题', url: '/pages-v2/publish/publish', check: async (page) => {
    const titleInput = await page.$('.pub__input');
    if (titleInput) {
      await titleInput.input('自动化测试需求');
      const d = await page.data();
      if (d.form.title !== '自动化测试需求') throw new Error('标题回填失败');
    }
  }},
  { name: '我的→订单入口', url: '/pages-v2/profile/profile', check: async (page) => {
    const d = await page.data();
    // orderEntries 是订单入口列表
    if (d.orderEntries && d.orderEntries.length > 0) {
      const entry = await page.$('.pf__order');
      if (!entry) throw new Error('订单入口元素不存在');
    }
  }},
  { name: '我的→订单列表', url: '/pages-v2/orders/orders', check: async (page) => {
    const d = await page.data();
    if (!d) throw new Error('订单页 data 为空');
  }},
  { name: '首页→需求详情', url: '/pages-v2/demand-detail/demand-detail?id=test', check: async (page) => {
    const d = await page.data();
    if (!d) throw new Error('需求详情页 data 为空');
  }},
];

(async () => {
  let mp;
  try {
    await startDevTools();
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
    if (!await waitForReady(mp, 30)) {
      console.error('FAIL: 30s 内项目未编译完成'); process.exit(1);
    }
    console.log(`开始测试 ${flows.length} 条交互链路...\n`);

    let pass = 0, fail = 0;
    for (let i = 0; i < flows.length; i++) {
      const f = flows[i];
      process.stdout.write(`[${i + 1}/${flows.length}] ${f.name} ... `);
      try {
        const page = await mp.reLaunch(f.url);
        if (!page) { process.stdout.write('FAIL(reLaunch返回null)\n'); fail++; continue; }
        await new Promise(r => setTimeout(r, 1500)); // 等页面渲染
        await f.check(page);
        process.stdout.write('OK\n');
        pass++;
      } catch (e) {
        process.stdout.write(`FAIL(${e.message})\n`);
        fail++;
      }
    }
    console.log(`\n=== SUMMARY: ${pass}/${flows.length} PASS, ${fail} FAIL ===`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  } finally {
    if (mp) { try { await mp.disconnect(); } catch (_) {} }
  }
})();
