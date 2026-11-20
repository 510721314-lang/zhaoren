// 验证 #184⑧-render：工作台钱包页 credit_score/credit_level 真实渲染（prod env + DevTools 真实 OPENID）
// 证据链：workbench.fetchData → payment-mock balance_info → b.credit_score/b.credit_level
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

function verdict(ok, detail) {
  console.log(`[VERDICT] ${ok ? 'PASS' : 'FAIL'} - ${detail}`);
  process.exitCode = ok ? 0 : 1;
}

(async () => {
  await startDevTools();
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  await waitForReady(mp, 30);
  try {
    const page = await mp.reLaunch('/pages-v2/workbench/workbench');
    if (!page) throw new Error('reLaunch returned undefined');
    // 轮询等待 balance_info 异步回填 creditScore（最多 20s）
    let data = await page.data();
    for (let i = 0; i < 20 && !(typeof data.creditScore === 'number' && data.creditScore > 0); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      data = await page.data();
    }
    const score = data.creditScore;
    const level = data.creditLevel;
    console.log(`creditScore=${score} creditLevel=${level} loading=${data.loading} loadError=${data.loadError}`);
    // 渲染断言：信用分卡 = .wb__data-grid 第 3 张卡（前两张为今日待履约/本周收入）
    const nums = await page.$$('.wb__data-grid .wb__data-num');
    const labels = await page.$$('.wb__data-grid .wb__data-label');
    const numText = (nums && nums[2]) ? await nums[2].text() : '';
    const labelText = (labels && labels[2]) ? await labels[2].text() : '';
    console.log(`DOM: wb__data-num="${numText}" wb__data-label="${labelText}"`);
    const ok = typeof score === 'number' && score > 0 && /^(L[1-4])$/.test(level)
      && String(score) === String(numText).trim();
    verdict(ok, ok
      ? `钱包页真实渲染信用分 score=${score} level=${level}（balance_info 返回字段被 WXML 消费）`
      : `断言未过：score=${score} level=${level} DOM="${numText}"/"${labelText}" —— 需区分「账号无 partner 档案回退 0」vs「修复失效」，见 REGISTRY 归档判定`);
  } catch (e) {
    verdict(false, `脚本异常: ${e.message}`);
  } finally {
    await mp.disconnect();
  }
})();
