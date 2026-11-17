// tests/e2e/flow-publish-verify.js
// 第一阶段可行性验证（云函数回读版）：发布需求 → 云函数回读验证 → 记录待清理
// 说明: tcb 直读 DB 需 tcb CLI 登录（浏览器扫码，AI 不可代劳），
//       本版先用云函数回读验证「写→读」业务断言链路；
//       tcb 直读能力封装在 lib/tcb-db.js，待 tcb login 后可切换。
// 用法: node tests/e2e/flow-publish-verify.js
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

(async () => {
  let mp;
  const testTitle = `e2e测试_${Date.now()}`;
  let createdDemandId = null;
  try {
    console.log('=== 第一阶段：验证 e2e 业务断言链路（云函数回读版）===\n');

    // 1. 启动 DevTools
    console.log('[1/4] 启动 DevTools...');
    await startDevTools();
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
    if (!await waitForReady(mp, 30)) {
      console.error('FAIL: 30s 内项目未编译完成');
      process.exit(1);
    }
    console.log('  OK: DevTools 已就绪\n');

    // 2. 在小程序端调用 demand-publish 发布测试需求
    console.log('[2/4] 发布测试需求...');
    const publishResult = await mp.evaluate(async (testTitle) => {
      try {
        const r = await wx.cloud.callFunction({
          name: 'demand-publish',
          data: {
            action: 'publish',
            scene: 'W8',
            title: testTitle,
            description: 'e2e自动化测试需求',
            content: 'e2e自动化测试需求',
            pricing_type: 'fixed',
            fixed_price_fen: 3000,
            content_options: ['排队代办'],
            start_time: Date.now() + 2 * 3600 * 1000,
            duration_h: 1,
            location: { name: '测试地点', address: '测试地点', latitude: 39.9042, longitude: 116.4074, city: '成都' },
            publish_location: { latitude: 39.9042, longitude: 116.4074 },
            project_attr: 'commercial',
            match_mode: 'grab',
            aa_tier: '0-50',
            aa_promise_checked: true,
            disclaimer_signed: true,
            headcount: 1,
            gender_pref: '不限',
            contact_phone: '13800000000',
            contact_phone_source: 'custom',
          },
        });
        const result = r.result;
        return { result, ok: result && result.ok, data: result && result.data, err: result && (result.errMsg || result.msg) };
      } catch (e) {
        return { ok: false, err: e.message };
      }
    }, testTitle);
    console.log(`  发布结果: ok=${publishResult.ok}`);
    if (!publishResult.ok) {
      console.error(`FAIL: 发布失败 - ${publishResult.err}`);
      console.error(`  完整返回: ${JSON.stringify(publishResult.result)}`);
      process.exit(1);
    }
    createdDemandId = publishResult.data && publishResult.data._id;
    console.log(`  demand_id: ${createdDemandId}\n`);

    // 3. 云函数回读 demand 验证落库（替代 tcb 直读）
    console.log('[3/4] 云函数回读 demand 验证...');
    await new Promise(r => setTimeout(r, 2000));
    const queryResult = await mp.evaluate(async (demandId) => {
      try {
        const r = await wx.cloud.callFunction({
          name: 'demand-publish',
          data: { action: 'detail', demand_id: demandId },
        });
        const result = r.result;
        return { result, ok: result && result.ok, data: result && result.data, err: result && (result.errMsg || result.msg) };
      } catch (e) {
        return { ok: false, err: e.message };
      }
    }, createdDemandId);
    if (!queryResult.ok || !queryResult.data) {
      console.error(`FAIL: 回读失败 - ${queryResult.err}`);
      console.error(`  完整返回: ${JSON.stringify(queryResult.result)}`);
      process.exit(1);
    }
    const demand = queryResult.data;
    console.log(`  回读需求: _id=${demand._id}`);
    console.log(`  完整字段: ${JSON.stringify(demand).slice(0, 500)}`);
    console.log(`  scene=${demand.scene || demand.scene_code} title=${demand.title}`);
    console.log(`  is_test=${demand.is_test} status=${demand.status}`);

    const assertions = [
      ['_id 匹配', demand._id === createdDemandId],
      ['scene=W8', (demand.scene || demand.scene_code) === 'W8'],
      ['title 匹配', demand.title === testTitle],
      ['status 非空', !!demand.status],
    ];

    let allPass = true;
    for (const [name, pass] of assertions) {
      console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}`);
      if (!pass) allPass = false;
    }
    if (!allPass) {
      console.error('FAIL: 业务断言未全部通过');
      process.exit(1);
    }
    console.log('  OK: 所有业务断言通过\n');

    // 4. 清理提示
    console.log('[4/4] 清理说明...');
    console.log(`  测试需求 demand_id=${createdDemandId} 已创建`);
    console.log(`  清理需管理员调用 init-db purge_test_data(scope='all_istest', confirm='PURGE')`);
    console.log(`  或在云开发控制台手动删除 demand 集合中 title='${testTitle}' 的记录\n`);

    console.log('=== ALL PASS: 云函数回读业务断言链路验证成功 ===');
    console.log('=== 待 tcb login 后可切换 tcb 直读模式验证 ===\n');
    process.exit(0);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  } finally {
    if (mp) { try { await mp.disconnect(); } catch (_) {} }
  }
})();
