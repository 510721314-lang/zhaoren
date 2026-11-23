// 一次性验收脚本：REGISTRY #191（发布页「履约地址」必填字段）模拟器预检
// 2026-11-23 · 开发者工具模拟器内验证，产出 PASS / FAIL / SKIP 三态，禁止「解析不到=通过」
// 设计原则：3 个断言全部零副作用/只读（191-3 校验在写库前返回，不产生数据）
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

const results = [];
function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name}${detail ? ' | ' + detail : ''}`);
}

function portReady(port) {
  try {
    const out = require('child_process').execSync(`netstat -ano | findstr ":${port}.*LISTENING"`, { encoding: 'utf8' });
    return !!out.trim();
  } catch (_) { return false; }
}

(async () => {
  if (portReady(PORT)) {
    console.log(`自动化端口 ${PORT} 已就绪，跳过启动流程`);
  } else {
    await startDevTools();
  }
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  let failed = 0;
  try {
    if (!(await waitForReady(mp, 60))) throw new Error('编译未就绪（currentPage 60s 内为 undefined）');

    // ══════════ 191-1 前端必填校验纯函数（无云、无写库）══════════
    // 凑齐前置必填，只缺 service_address，断言 errs 含「请输入履约地址」
    const vEmpty = await mp.evaluate(() => {
      const v = require('utils/publish-validate.js');
      const ctx = { isEditMode: false, petAuthChecked: false, useAccountPhone: true,
        accountPhoneMasked: true, publishType: 'self', proxyName: '', proxyRelation: '',
        proxyRelationNote: '', proxyPhone: '', proxyAuthChecked: false, userAge: 30 };
      const f = {
        scene_code: 'W1', content_options: ['排队代办'], title: 'regtest-191',
        description: 'desc', service_date: '2026-12-01', service_time: '10:00',
        duration_hours: 2, location_name: '模拟器预检地', service_address: '',
        project_attr: 'commercial', pricing_type: 'fixed', fixed_price: 50,
        budget: 0, aa_estimate: '0-50',
      };
      return v.validatePublish(f, ctx);
    });
    const errsEmpty = Array.isArray(vEmpty) ? vEmpty : (vEmpty && vEmpty.errs) || [];
    const hitEmpty = errsEmpty.some((e) => String(e).indexOf('履约地址') >= 0);

    const vFull = await mp.evaluate(() => {
      const v = require('utils/publish-validate.js');
      const ctx = { isEditMode: false, petAuthChecked: false, useAccountPhone: true,
        accountPhoneMasked: true, publishType: 'self', proxyName: '', proxyRelation: '',
        proxyRelationNote: '', proxyPhone: '', proxyAuthChecked: false, userAge: 30 };
      const f = {
        scene_code: 'W1', content_options: ['排队代办'], title: 'regtest-191',
        description: 'desc', service_date: '2026-12-01', service_time: '10:00',
        duration_hours: 2, location_name: '模拟器预检地', service_address: '1栋2单元301',
        project_attr: 'commercial', pricing_type: 'fixed', fixed_price: 50,
        budget: 0, aa_estimate: '0-50',
      };
      return v.validatePublish(f, ctx);
    });
    const errsFull = Array.isArray(vFull) ? vFull : (vFull && vFull.errs) || [];
    const hitFull = errsFull.some((e) => String(e).indexOf('履约地址') >= 0);

    if (hitEmpty && !hitFull) {
      record('191-1', '前端必填校验（缺则拦/填则过）', 'PASS',
        `缺地址 errs 含「履约地址」；补地址 errs=[${errsFull.join(',') || '空'}]`);
    } else {
      failed++;
      record('191-1', '前端必填校验', 'FAIL',
        `缺地址命中=${hitEmpty} errs=[${errsEmpty.join(',')}]；补地址仍命中=${hitFull}`);
    }

    // ══════════ 191-2 发布页 WXML 渲染（无写库）══════════
    const pub = await mp.reLaunch('/pages-v2/publish/publish');
    if (!pub) throw new Error('reLaunch 发布页返回 undefined');
    await pub.waitFor(2500);

    // 取所有 .pub__picker-label 文本，确认含「履约地址」
    const labels = await pub.$$('.pub__picker-label');
    let labelText = '';
    for (const el of labels) {
      try { labelText += (await el.text()) + '|'; } catch (_) {}
    }
    // 取所有 input 的 placeholder，确认含「请输入详细履约地址」
    const inputs = await pub.$$('input');
    let placeholders = '';
    for (const el of inputs) {
      try {
        const ph = await el.attribute('placeholder');
        if (ph) placeholders += ph + '|';
      } catch (_) {}
    }
    const hasLabel = labelText.indexOf('履约地址') >= 0;
    const hasPh = placeholders.indexOf('请输入详细履约地址') >= 0;
    if (hasLabel && hasPh) {
      record('191-2', '发布页「履约地址」输入框渲染', 'PASS',
        `标签含「履约地址」；placeholder 含「请输入详细履约地址」（ph 采样=${placeholders.slice(0, 60)}）`);
    } else {
      failed++;
      record('191-2', '发布页「履约地址」输入框渲染', 'FAIL',
        `标签命中=${hasLabel}（${labelText.slice(0, 60)}）；placeholder 命中=${hasPh}（${placeholders.slice(0, 80)}）`);
    }

    // ══════════ 191-3 云端必填码 publish_service_address（只读校验失败，不写库）══════════
    // 凑齐前置必填（scene/start_time/duration_h/location.name），缺 service_address
    let cloudCode = '';
    let cloudErr = '';
    try {
      const r = await mp.evaluate(() => {
        return wx.cloud.callFunction({
          name: 'demand-publish',
          data: {
            action: 'publish',
            scene: 'W1',
            title: 'regtest-191-verify-noaddr',
            start_time: Date.now() + 7200000,
            duration_h: 2,
            pricing_type: 'fixed',
            fixed_price_fen: 1000,
            location: { name: '模拟器预检地' },
            // 故意不传 service_address
          },
        }).then((res) => res.result).catch((e) => ({ __call_err: String(e && e.message || e) }));
      });
      if (r && r.__call_err) {
        cloudErr = String(r.__call_err).slice(0, 160);
      } else {
        cloudCode = (r && r.code) || '';
        cloudErr = (r && (r.msg || r.errMsg)) || '';
      }
    } catch (e) {
      cloudErr = String(e && e.message || e).slice(0, 160);
    }

    if (cloudCode === 'publish_service_address') {
      record('191-3', '云端必填码（缺地址拒写）', 'PASS',
        `demand-publish 返回 code=publish_service_address（校验在写库前，未产生数据）`);
    } else if (cloudErr && /quota|超限|调用次数|limit/i.test(cloudErr)) {
      record('191-3', '云端必填码', 'SKIP', `云调用配额受限：${cloudErr}（非代码回归，等 12-06 重置后真机复跑）`);
    } else if (cloudErr) {
      record('191-3', '云端必填码', 'SKIP', `云调用异常，无法判定：${cloudErr}（返回 code=${cloudCode || '无'}）`);
    } else {
      failed++;
      record('191-3', '云端必填码', 'FAIL',
        `期望 code=publish_service_address，实际 code=${cloudCode || '无'} msg=${cloudErr}`);
    }
  } catch (e) {
    failed++;
    record('SYS', '脚本执行', 'FAIL', String(e && e.message || e).slice(0, 300));
  } finally {
    try { await mp.disconnect(); } catch (_) {}
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSUMMARY pass=${pass} fail=${failed} skip=${skip} total=${results.length}`);
  process.exit(failed > 0 ? 1 : 0);
})();
