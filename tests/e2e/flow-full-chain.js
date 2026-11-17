// tests/e2e/flow-full-chain.js
// L3 黄金路径端到端: 发布 → 接单 → 四确认 → 支付 → 履约(3里程碑) → 评价 → 回读断言 → 清理
// 身份切换: env=dev + mock_openid (user=admin openid, partner=test_partner_001)
// 前置: test_partner_001 已具备 base 考试/紧急联系人/accept_scenes含W8/accept_switch=true
// 用法: node tests/e2e/flow-full-chain.js  (需 DevTools 已打开项目)
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

const USER_OPENID = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';   // admin openid (test_openids + admin_openids)
const PARTNER_OPENID = 'test_partner_001';              // 测试耍伴 (test_openids)
const SCENE = 'W8';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 通用: 在小程序 AppService 调云函数, 支持 mock_openid 切换身份
async function callCloud(mp, name, data, mockOpenid) {
  const payload = mockOpenid ? Object.assign({}, data, { mock_openid: mockOpenid }) : data;
  const r = await mp.evaluate(async (args) => {
    try {
      const res = await wx.cloud.callFunction({ name: args.name, data: args.data });
      const result = res.result || {};
      return { ok: !!result.ok, code: result.code, msg: result.msg || result.errMsg, data: result.data, raw: result };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }, { name, data: payload });
  return r;
}

function assertOk(step, r, extra) {
  if (!r.ok) {
    console.error(`FAIL [${step}] ${r.code || ''} ${r.msg || ''}`);
    if (r.raw) console.error(`  raw: ${JSON.stringify(r.raw).slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`  PASS [${step}]${extra ? ' ' + extra : ''}`);
  return r.data;
}

(async () => {
  let mp;
  let demandId = null;
  let orderId = null;
  try {
    console.log('=== L3 全链路 e2e: 发布→接单→四确认→支付→履约→评价 ===\n');

    // 0. 启动 DevTools
    console.log('[0] 启动 DevTools...');
    await startDevTools();
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
    if (!await waitForReady(mp, 30)) { console.error('FAIL: 30s 内未编译完成'); process.exit(1); }
    console.log('  OK: DevTools 就绪\n');

    // 1. 切 dev 环境 (放行 mock_openid)
    console.log('[1] force_set_env → dev...');
    const envR = await callCloud(mp, 'init-db', { action: 'force_set_env', env: 'dev', reason: 'e2e-full-chain', confirm: true }, USER_OPENID);
    assertOk('force_set_env', envR, `from=${envR.raw && envR.raw.from} to=${envR.raw && envR.raw.to}`);
    console.log('  等待 env 缓存过期(60s, 热容器最长 5min)...');
    await sleep(60000);

    // 1.5. 前置清理: 清除上次运行残留的测试数据 (防 publish_time_conflict)
    console.log('[1.5] purge_test_data (清理上次残留)...');
    const dryR1 = await callCloud(mp, 'init-db', { action: 'purge_test_data', scope: 'all_istest' }, USER_OPENID);
    const actual1 = (dryR1.raw && dryR1.raw.stats && dryR1.raw.stats.order_main) || 0;
    const purgePre = await callCloud(mp, 'init-db', { action: 'purge_test_data', scope: 'all_istest', confirm: 'PURGE', expect_orders: actual1 }, USER_OPENID);
    assertOk('purge_pre', purgePre);

    // 2. partner 实名 (dev 通道)
    console.log('[2] simulate_realname (partner)...');
    const rnR = await callCloud(mp, 'user-login', { action: 'simulate_realname' }, PARTNER_OPENID);
    assertOk('simulate_realname', rnR);

    // 3. partner 签 W8 免责声明
    console.log('[3] sign_disclaimer W8 (partner)...');
    const sdR = await callCloud(mp, 'order-create', { action: 'sign_disclaimer', scene: SCENE }, PARTNER_OPENID);
    assertOk('sign_disclaimer', sdR);

    // 4. 发布需求 (user)
    console.log('[4] publish demand (user)...');
    const title = `e2e全链路_${Date.now()}`;
    const pubR = await callCloud(mp, 'demand-publish', {
      action: 'publish', scene: SCENE, title,
      description: 'e2e全链路测试',
      pricing_type: 'fixed', fixed_price_fen: 3000,
      content_options: ['排队代办'],
      start_time: Date.now() + 2 * 3600 * 1000, duration_h: 1,
      location: { name: '测试地点', address: '测试地点', latitude: 39.9042, longitude: 116.4074, city: '成都' },
      publish_location: { latitude: 39.9042, longitude: 116.4074 },
      project_attr: 'commercial', match_mode: 'broadcast',
      aa_tier: '0-50', aa_promise_checked: true, disclaimer_signed: true,
      headcount: 1, gender_pref: '不限',
      contact_phone: '13800000000', contact_phone_source: 'custom',
    }, USER_OPENID);
    const pubData = assertOk('publish', pubR);
    demandId = pubData && pubData._id;
    console.log(`  demand_id=${demandId}`);
    await sleep(2000);

    // 5. 接单 (partner)
    console.log('[5] create_from_take (partner)...');
    const takeR = await callCloud(mp, 'order-create', {
      action: 'create_from_take', demand_id: demandId,
      partner_location: { latitude: 39.9042, longitude: 116.4074, accuracy: 10 },
    }, PARTNER_OPENID);
    const takeData = assertOk('take', takeR);
    orderId = takeData && takeData.order_id;
    console.log(`  order_id=${orderId} status=${takeData && takeData.status}`);

    // 6. 四确认 (partner)
    console.log('[6] confirm_all (partner)...');
    const c1R = await callCloud(mp, 'order-action', { action: 'confirm_all', order_id: orderId }, PARTNER_OPENID);
    assertOk('confirm_all(partner)', c1R, `confirmed=${c1R.data && c1R.data.confirmed_count}/8`);

    // 7. 四确认 (user) → S0
    console.log('[7] confirm_all (user)...');
    const c2R = await callCloud(mp, 'order-action', { action: 'confirm_all', order_id: orderId }, USER_OPENID);
    const c2Data = assertOk('confirm_all(user)', c2R, `status=${c2R.data && c2R.data.status}`);
    if (c2Data.status !== 'S0') { console.error(`FAIL: 期望 S0, 实际 ${c2Data.status}`); process.exit(1); }

    // 8. 模拟支付 (user) → S2
    console.log('[8] mock_pay (user)...');
    const payR = await callCloud(mp, 'payment-mock', { action: 'mock_pay', order_id: orderId, aa_promise_checked: true }, USER_OPENID);
    const payData = assertOk('mock_pay', payR, `status=${payR.data && payR.data.status}`);
    if (payData.status !== 'S2') { console.error(`FAIL: 期望 S2, 实际 ${payData.status}`); process.exit(1); }

    // 9. 开始履约申请 (partner) → S2_6
    console.log('[9] start_apply (partner)...');
    const saR = await callCloud(mp, 'order-action', {
      action: 'start_apply', order_id: orderId,
      start_location: { latitude: 39.9042, longitude: 116.4074, accuracy: 10 },
      start_evidence: { photos: [{ file_id: 'cloud://e2e-mock-start.jpg' }] },
    }, PARTNER_OPENID);
    const saData = assertOk('start_apply', saR, `status=${saR.data && saR.data.status}`);
    if (saData.status !== 'S2_6') { console.error(`FAIL: 期望 S2_6, 实际 ${saData.status}`); process.exit(1); }

    // 10. 确认开始 (user) → S3
    console.log('[10] start_confirm (user)...');
    const scR = await callCloud(mp, 'order-action', { action: 'start_confirm', order_id: orderId }, USER_OPENID);
    const scData = assertOk('start_confirm', scR, `status=${scR.data && scR.data.status}`);
    if (scData.status !== 'S3') { console.error(`FAIL: 期望 S3, 实际 ${scData.status}`); process.exit(1); }

    // 11. 里程碑 ×3 (partner, 不传 note 绕过 msgSecCheck)
    for (let i = 1; i <= 3; i++) {
      console.log(`[11.${i}] milestone_submit ${i}/3 (partner)...`);
      const msR = await callCloud(mp, 'order-action', { action: 'milestone_submit', order_id: orderId }, PARTNER_OPENID);
      const msData = assertOk(`milestone_${i}`, msR, `milestone=${msR.data && msR.data.milestone}`);
      if (msData.milestone !== i) { console.error(`FAIL: 期望 milestone=${i}, 实际 ${msData.milestone}`); process.exit(1); }
    }

    // 12. 完毕申请 (partner) → S3_6
    console.log('[12] finish_apply (partner)...');
    const faR = await callCloud(mp, 'order-action', {
      action: 'finish_apply', order_id: orderId,
      finish_evidence: {
        photos: [{ file_id: 'cloud://e2e-mock-finish.jpg' }],
        partner_location: { latitude: 39.9042, longitude: 116.4074, accuracy: 10 },
      },
    }, PARTNER_OPENID);
    const faData = assertOk('finish_apply', faR, `status=${faR.data && faR.data.status}`);
    if (faData.status !== 'S3_6') { console.error(`FAIL: 期望 S3_6, 实际 ${faData.status}`); process.exit(1); }

    // 13. 确认完毕 (user) → S5
    console.log('[13] finish_confirm (user)...');
    const fcR = await callCloud(mp, 'order-action', { action: 'finish_confirm', order_id: orderId }, USER_OPENID);
    const fcData = assertOk('finish_confirm', fcR, `status=${fcR.data && fcR.data.status}`);
    if (fcData.status !== 'S5') { console.error(`FAIL: 期望 S5, 实际 ${fcData.status}`); process.exit(1); }

    // 14. 评价 (user) → S8
    console.log('[14] evaluation submit (user)...');
    const evR = await callCloud(mp, 'evaluation-submit', {
      action: 'submit', order_id: orderId, star: 5,
      content: 'e2e全链路测试评价',
    }, USER_OPENID);
    const evData = assertOk('evaluation', evR, `star=${evR.data && evR.data.star}`);

    // 15. 回读断言
    console.log('[15] order detail 回读断言...');
    await sleep(2000);
    const detR = await callCloud(mp, 'order-action', { action: 'detail', order_id: orderId }, USER_OPENID);
    const detData = assertOk('order_detail', detR);
    const finalStatus = detData.status;
    const msCurrent = (detData.milestone && detData.milestone.current) || 0;
    console.log(`  status=${finalStatus} milestone=${msCurrent}/3 total_fen=${detData.total_fen}`);
    if (finalStatus !== 'S8') { console.error(`FAIL: 最终状态期望 S8, 实际 ${finalStatus}`); process.exit(1); }
    if (msCurrent !== 3) { console.error(`FAIL: 里程碑期望 3/3, 实际 ${msCurrent}`); process.exit(1); }
    console.log('  PASS 最终订单 status=S8, milestone=3/3\n');

    // 16. 清理测试数据
    console.log('[16] purge_test_data...');
    // 先 dry-run 拿 actual_orders
    const dryR = await callCloud(mp, 'init-db', { action: 'purge_test_data', scope: 'all_istest' }, USER_OPENID);
    const actualOrders = (dryR.raw && dryR.raw.stats && dryR.raw.stats.order_main) || 0;
    const purgeR = await callCloud(mp, 'init-db', {
      action: 'purge_test_data', scope: 'all_istest', confirm: 'PURGE', expect_orders: actualOrders,
    }, USER_OPENID);
    assertOk('purge', purgeR);

    // 17. 切回 prod
    console.log('[17] force_set_env → prod...');
    const prodR = await callCloud(mp, 'init-db', { action: 'force_set_env', env: 'prod', reason: 'e2e-full-chain done', confirm: true }, USER_OPENID);
    assertOk('force_set_env(prod)', prodR);

    console.log('\n=== ALL PASS: 全链路 e2e 验证成功 (S1→S0→S2→S2_6→S3→S3_6→S5→S8) ===');
    process.exit(0);
  } catch (e) {
    console.error('FATAL:', e.message);
    // 异常时尝试切回 prod (不阻断)
    if (mp) {
      try {
        await callCloud(mp, 'init-db', { action: 'force_set_env', env: 'prod', reason: 'e2e-error-revert', confirm: true }, USER_OPENID);
        console.log('已尝试切回 prod');
      } catch (_) {}
    }
    process.exit(1);
  } finally {
    if (mp) { try { await mp.disconnect(); } catch (_) {} }
  }
})();
