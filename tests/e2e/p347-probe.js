// P3-47 定位：mp.evaluate 原子注入 patch wx.showToast/showModal → 页面实例 onPublish() → 收集拦截点
// 用法：node tests/e2e/p347-probe.js <demand_id>
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');
const DEMAND_ID = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await startDevTools();
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  await waitForReady(mp, 30);
  const page = await mp.reLaunch(`/pages-v2/publish/publish?mode=edit&demand_id=${DEMAND_ID}`);
  for (let i = 0; i < 15; i++) { await sleep(800); const d = await page.data(); if (d.invitePartnerName) break; }
  const probe = await mp.evaluate(() => {
    return new Promise((resolve) => {
      const pages = getCurrentPages();
      const pg = pages[pages.length - 1];
      if (!pg || !pg.onPublish) { resolve({ error: 'page 未找到或非 publish 页', route: pg && pg.route }); return; }
      const toasts = [], modals = [];
      const origToast = wx.showToast, origModal = wx.showModal;
      wx.showToast = (o) => { toasts.push((o && o.title) || ''); try { origToast.call(wx, o); } catch (e) {} };
      wx.showModal = (o) => { modals.push({ title: (o && o.title) || '', content: ((o && o.content) || '').slice(0, 60) }); setTimeout(() => { try { o && o.success && o.success({ confirm: true, cancel: false }); } catch (e) {} }, 100); };
      try {
        // 补齐克隆单缺失字段（造单模板 description 空 → 编辑校验「请输入描述」先拦）
        pg.setData({ 'form.description': 'P3-47 验收描述（自动化）' });
        pg.onPublish();
      } catch (e) { toasts.push('onPublish throw: ' + e.message); }
      setTimeout(() => {
        wx.showToast = origToast; wx.showModal = origModal;
        resolve({ toasts, modals, publishing: pg.data.publishing, isEditMode: pg.data.isEditMode, editModeFlag: !!pg.__editMode });
      }, 5000);
    });
  });
  console.log('probe 结果: ' + JSON.stringify(probe, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('EXCEPTION: ' + e.message); process.exit(1); });
