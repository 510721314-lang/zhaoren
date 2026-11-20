// 验证 S3 详情页聊天入口修复（T-17.4 姊妹缺口）：双侧按钮渲染 + goChat 跳转
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

const ORDERS = [
  { id: '1a3ef1dd6ac9d6950002c3cb08aaf350', expect: { user: '与对方交流', partner: '联系用户' } },
  { id: 'c9723b216ae483e70344a8795d6d7c7a', expect: { user: '与对方交流', partner: '联系用户' } }
];

(async () => {
  await startDevTools();
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  await waitForReady(mp, 30);
  let okAll = true;
  try {
    for (const o of ORDERS) {
      const page = await mp.reLaunch(`/pages-v2/order-detail/order-detail?id=${o.id}`);
      if (!page) throw new Error(`reLaunch undefined for ${o.id}`);
      // 轮询等 order 数据加载
      let data = await page.data();
      for (let i = 0; i < 20 && (!data.order || data.order.status !== 'S3'); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        data = await page.data();
      }
      if (!data.order || data.order.status !== 'S3') {
        console.log(`[SKIP] ${o.id} 未加载到 S3 订单（status=${data.order && data.order.status}）`);
        okAll = false; continue;
      }
      const role = data.order.my_role;
      const expectText = o.expect[role];
      // 断言按钮渲染
      const btns = await page.$$('.od__btn--ghost');
      let chatBtn = null;
      for (const b of btns) {
        const t = await b.text();
        if (t.trim() === expectText) { chatBtn = b; break; }
      }
      console.log(`[${o.id.slice(0, 8)}] role=${role} expect="${expectText}" btn=${chatBtn ? 'FOUND' : 'MISSING'}`);
      if (!chatBtn) { okAll = false; continue; }
      // 点击按钮 → 断言跳转聊天页
      await chatBtn.tap();
      await new Promise((r) => setTimeout(r, 2500));
      const cur = await mp.currentPage();
      const inChat = cur && cur.path.indexOf('chat') >= 0;
      console.log(`[${o.id.slice(0, 8)}] tap goChat → path=${cur ? cur.path : 'null'} ${inChat ? 'PASS' : 'FAIL'}`);
      if (!inChat) okAll = false;
    }
    console.log(`[VERDICT] ${okAll ? 'PASS' : 'FAIL'} - S3 详情页双侧聊天入口`);
  } catch (e) {
    console.log(`[VERDICT] FAIL - 脚本异常: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await mp.disconnect();
  }
  if (!okAll) process.exitCode = 1;
})();
