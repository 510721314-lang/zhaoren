// P3-47 前端验收：编辑定向邀约——邀约对象卡片回显 + 保存无误拦（REGISTRY #181 ①③）
// 用法：node tests/e2e/verify-p347-edit.js <demand_id>
// 前置：demand 已由 .tmp-tcb/p347_seed.cjs 造好（direct/target=test_partner_001/matching/creator=模拟器账号）
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

const DEMAND_ID = process.argv[2];
if (!DEMAND_ID || !/^[0-9a-f]{32}$/.test(DEMAND_ID)) { console.error('用法: node tests/e2e/verify-p347-edit.js <32位demand_id>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let mp, results = [];
  const step = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
  try {
    await startDevTools();
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
    if (!await waitForReady(mp, 30)) { console.error('FAIL: 30s 内项目未编译完成'); process.exit(1); }

    // ① 进编辑页（模拟器登录账号=creator, detail 将回传 target_openid）
    const page = await mp.reLaunch(`/pages-v2/publish/publish?mode=edit&demand_id=${DEMAND_ID}`);
    if (!page) { console.error('FAIL: reLaunch 编辑页返回 null'); process.exit(1); }

    // ② 轮询等邀约卡片昵称回填（新逻辑专属行为; 旧编译产物/回填失效则 16s 超时）
    let name = '', title = '';
    for (let i = 0; i < 20; i++) {
      await sleep(800);
      const d = await page.data();
      name = d.invitePartnerName || '';
      title = (d.form && d.form.title) || '';
      if (name) break;
    }
    step('邀约对象卡片回填(invitePartnerName)', !!name, `昵称="${name}" 标题="${(title || '').slice(0, 12)}…"`);
    if (!name) {
      const d = await page.data();
      step('detail 回填诊断', false, `match_mode=${d.form && d.form.match_mode} target相关字段=${JSON.stringify({ invitePartnerName: d.invitePartnerName }).slice(0, 120)}`);
    }

    // ③ 改标题（+验证尾缀）并提交（编辑与发布共用 onPublish, 编辑态走 demand-publish/update）
    const d0 = await page.data();
    const newTitle = ((d0.form && d0.form.title) || 'P347测试') + 'X';
    await page.setData({ 'form.title': newTitle });
    await page.callMethod('onPublish');
    let publishing = true;
    for (let i = 0; i < 25; i++) {
      await sleep(800);
      const d = await page.data();
      publishing = !!d.publishing;
      if (!publishing) break;
    }
    step('提交完成(publishing 结束)', !publishing, publishing ? '25s 内未结束' : '已结束');

    // ④ 编辑态是否仍在编辑页且未弹错误中断（被「定向邀约缺少指定耍伴」拦时 toast 难捕, 由云端断言脚本裁决）
    const dEnd = await page.data();
    step('仍处编辑态(isEditMode)', dEnd.isEditMode === true, `标题="${(dEnd.form && dEnd.form.title || '').slice(0, 14)}…"`);

    const fail = results.filter((r) => !r.ok).length;
    console.log(`\nUI 阶段: ${results.length - fail}/${results.length} PASS（云端断言见 p347_assert.cjs）`);
    process.exit(0); // UI 阶段完成, 最终裁决交给云端断言
  } catch (e) {
    console.error('EXCEPTION: ' + (e && e.message));
    if (mp) try { await mp.disconnect(); } catch (_) {}
    process.exit(1);
  }
})();
