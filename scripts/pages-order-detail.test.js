// scripts/pages-order-detail.test.js —— 订单详情页页面级单测（P2-2 阶段 2）
// 覆盖：详情契约 / 脱敏号原样透传（P3-3 批1）/ 三视角 nextStep 引导 / 终态无操作 / SOS 失败兜底 / 定位失败不阻断求助
const { test } = require('node:test');
const assert = require('node:assert');
const { createPage, sleep } = require('./mp-page-harness.js');

const PAGE = 'pages-v2/order-detail/order-detail.js';
const ORD = 'b'.repeat(32); // 32 位十六进制，符合页面 /^[a-f0-9]{32}$/i 校验

function detail(over) {
  return {
    ok: true,
    data: Object.assign({
      _id: ORD, order_no: 'ORD_TEST', status: 'S2', my_role: 'user', role: 'user',
      start_time: Date.now() + 3600 * 1000, amount_fen: 20000,
      scene: 'W8', service_date: '11-08', service_time: '10:00',
      created_at: Date.now(), contact_display: { who: 'partner', masked: '138****5386' }
    }, over || {})
  };
}

// 定位统一立即 fail：避免 getLocationSafe 的 8s 兜底定时器把测试挂住
async function load(fixtures, extra) {
  const p = createPage(Object.assign({
    page: PAGE,
    fixtures,
    wx: { getLocation: (o) => { if (o && typeof o.fail === 'function') o.fail({ errMsg: 'getLocation:fail' }); } }
  }, extra || {}));
  p.inst.onLoad({ orderId: ORD });
  await sleep(30);
  return p;
}

// O1：首个云调用必须是 order-action:detail 且带 order_id（页面数据单一入口）
test('O1 详情云调用契约', async () => {
  const p = await load({ 'order-action:detail': detail() });
  try {
    assert.strictEqual(p.calls.cloud[0].name, 'order-action');
    assert.strictEqual(p.calls.cloud[0].data.action, 'detail');
    assert.strictEqual(p.calls.cloud[0].data.order_id, ORD);
    assert.strictEqual(p.inst.data.loadError, false);
  } finally {
    p.restore();
  }
});

// O2：contact_display 由云端下发（掩码已在服务端生成），页面必须原样透传、不得二次脱敏
test('O2 脱敏联系号原样透传', async () => {
  const p = await load({ 'order-action:detail': detail() });
  try {
    assert.deepStrictEqual(p.inst.data.contactDisplay, { who: 'partner', masked: '138****5386' });
  } finally {
    p.restore();
  }
});

// O3：nextStep 三视角接线（S2 等待 / S5 去评价 / S3 耍伴提交里程碑）
test('O3 nextStep 视角引导', async () => {
  const a = await load({ 'order-action:detail': detail({ status: 'S2', my_role: 'user' }) });
  try {
    assert.strictEqual(a.inst.data.nextStep.title, '等待服务开始');
    assert.strictEqual(a.inst.data.nextStep.action, undefined);
  } finally {
    a.restore();
  }

  const b = await load({ 'order-action:detail': detail({ status: 'S5', my_role: 'user' }) });
  try {
    assert.strictEqual(b.inst.data.nextStep.action.key, 'eval');
  } finally {
    b.restore();
  }

  const c = await load({
    'order-action:detail': detail({
      status: 'S3', my_role: 'partner', role: 'partner',
      milestone: { current: 1, confirmed: [true, false, false], evidence: [] }
    })
  });
  try {
    assert.strictEqual(c.inst.data.nextStep.action.key, 'milestone');
    assert.match(c.inst.data.nextStep.action.text, /提交 60%/);
  } finally {
    c.restore();
  }
});

// O4：终态（S6 已取消 / S8 已评价）不得给出任何主操作
test('O4 终态无主操作', async () => {
  const a = await load({ 'order-action:detail': detail({ status: 'S6', my_role: 'user' }) });
  try {
    assert.strictEqual(a.inst.data.nextStep.title, '订单已取消');
    assert.strictEqual(a.inst.data.nextStep.action, undefined);
  } finally {
    a.restore();
  }

  const b = await load({ 'order-action:detail': detail({ status: 'S8', my_role: 'user' }) });
  try {
    assert.strictEqual(b.inst.data.nextStep.action, undefined);
  } finally {
    b.restore();
  }
});

// O5：SOS 云端失败 → 失败弹窗留痕，且不置 active_sos（不伪造求助中状态）
test('O5 SOS 提交失败兜底', async () => {
  const p = await load({
    'order-action:detail': detail({ status: 'S3', my_role: 'user' }),
    'safety-report:sos': { ok: false, msg: '无进行中订单' }
  });
  try {
    p.inst.onSos();
    p.calls.modal[0].__confirm();
    await sleep(30);
    const fail = p.calls.modal.find((m) => m.title === '求助提交失败');
    assert.ok(fail, '应弹出求助失败提示');
    assert.match(fail.content, /无进行中订单/);
    assert.ok(!(p.inst.data.safety && p.inst.data.safety.active_sos));
  } finally {
    p.restore();
  }
});

// ── 阶段B 触碰区断言（实施第 0 步，先于互斥锁/提交器外移）──
// O7：加时提交链 —— 时长/原因类型/原因字数三闸 + extend 载荷 + 成功刷新
test('O7 加时提交链', async () => {
  const p = await load({ 'order-action:detail': detail(), 'order-action:extend': { ok: true, data: { add_amount_fen: 3000 } } });
  try {
    p.inst.setData({ extendHours: 0 });
    p.inst.submitExtend();
    assert.ok(p.calls.toast.some((t) => /1-12小时/.test(t.title)), '时长闸');
    p.inst.setData({ extendHours: 2, extendReasonTypeIndex: 0, extendReason: '时间不够' });
    p.inst.submitExtend();
    assert.ok(p.calls.toast.some((t) => /原因不少于10字/.test(t.title)), '原因字数闸');
    const before = p.calls.cloud.filter((c) => c.data && c.data.action === 'detail').length;
    p.inst.setData({ extendReason: '临时有事情需要延长两小时处理' });
    p.inst.submitExtend();
    await sleep(20);
    const ev = p.calls.modal.filter((m) => m.title === '加时申请已提交').pop();
    assert.ok(ev, '成功弹窗');
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'extend').pop();
    assert.ok(call, '应有 extend 调用');
    assert.strictEqual(call.data.add_hours, 2);
    assert.ok(call.data.reason_type, '带原因类型');
    // 刷新链路用桩记录（避免 fetchData 的并行子拉取在测试结束后触碰已还原的 wx）
    let refreshed = 0;
    p.inst.fetchData = () => { refreshed += 1; };
    ev.__confirm();
    await sleep(10);
    assert.strictEqual(refreshed, 1, '成功后刷新详情');
  } finally { p.restore(); }
});

// O8：改期提交链 —— 未变更/提前量/原因三闸 + modify 载荷
test('O8 改期提交链', async () => {
  const p = await load({ 'order-action:detail': detail(), 'order-action:modify': { ok: true, data: {} } });
  try {
    const f = new Date(Date.now() + 5 * 86400000);
    const y = f.getFullYear(), mo = f.getMonth() + 1, dd = f.getDate();
    const dateStr = `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const ts = new Date(y, mo - 1, dd, 10, 0, 0).getTime();
    p.inst.setData({ modifyDate: dateStr, modifyTime: '10:00', modifyReasonTypeIndex: 0, modifyReason: '临时有事情需要调整服务时间安排' });
    // 未变更闸：选回原时间
    p.inst.setData({ order: Object.assign({}, p.inst.data.order, { start_time: ts }) });
    p.inst.submitModify();
    assert.ok(p.calls.toast.some((t) => /与当前服务时间相同/.test(t.title)), '同值闸');
    assert.strictEqual(p.calls.cloud.filter((c) => c.data && c.data.action === 'modify').length, 0, '同值不发请求');
    // 正常提交
    p.inst.setData({ order: Object.assign({}, p.inst.data.order, { start_time: Date.now() + 86400000 * 30 }) });
    p.inst.submitModify();
    const ev = p.calls.modal.filter((m) => m.title === '确认提交改期').pop();
    assert.ok(ev, '应弹二次确认');
    ev.__confirm();
    await sleep(60);
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'modify').pop();
    assert.ok(call, '应提交 modify');
    assert.strictEqual(call.data.new_start_time, ts);
    assert.ok(call.data.reason && call.data.reason_type, '原因与类型必带');
  } finally { p.restore(); }
});

// O9：取消提交链 —— 梯度退款文案 + cancel 载荷（reason 取当前档位）
test('O9 取消提交链', async () => {
  const p = await load({ 'order-action:detail': detail(), 'order-action:cancel': { ok: true, data: {} } });
  const origSetTimeout = global.setTimeout;
  try {
    p.inst.setData({ currentCancelIdx: 0 });
    p.inst.onCancel();
    const ev = p.calls.modal.filter((m) => m.title === '取消订单').pop();
    assert.ok(ev, '应弹取消确认');
    assert.ok(/退款规则/.test(ev.content), '弹窗含梯度规则');
    // 取消成功后页面有 1.5s 延迟 navigateBack；测试期用同步桩替代并靠微任务排空，避免测试结束后定时器触碰已还原的 wx
    global.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
    ev.__confirm();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'cancel').pop();
    assert.ok(call, '应提交 cancel');
    const tier = p.inst.data.cancelTiers[0];
    assert.strictEqual(call.data.reason, `按${tier.label}梯度退款`);
    assert.ok(p.calls.toast.some((t) => /已取消/.test(t.title)), '成功 toast');
  } finally {
    global.setTimeout = origSetTimeout;
    p.restore();
  }
});

// O11：加时响应双出口 —— 同意/拒绝（取消键=业务动作）+ 无在途 toast
test('O11 加时同意/拒绝双出口', async () => {
  const p = await load({
    'order-action:detail': detail({ pending_extend: { add_hours: 1, add_amount_fen: 3000 } }),
    'order-action:extend_confirm': { ok: true, data: {} },
    'order-action:extend_reject': { ok: true, data: {} }
  });
  try {
    // 无在途
    p.inst.setData({ order: Object.assign({}, p.inst.data.order, { pending_extend: null }) });
    p.inst.onExtendConfirm();
    assert.ok(p.calls.toast.some((t) => /无待处理的加时申请/.test(t.title)), '无在途闸');
    // 同意
    p.inst.setData({ order: Object.assign({}, p.inst.data.order, { pending_extend: { add_hours: 1, add_amount_fen: 3000 } }) });
    p.inst.onExtendConfirm();
    const ev = p.calls.modal.filter((m) => m.title === '确认同意加时').pop();
    assert.ok(ev, '应弹加时确认');
    assert.strictEqual(ev.cancelIsAction, true, '取消键=拒绝业务动作');
    ev.__confirm();
    await sleep(30);
    assert.ok(p.calls.cloud.some((c) => c.data && c.data.action === 'extend_confirm'), '同意→extend_confirm');
    // 拒绝（第二次弹窗，取消键触发业务回调）
    p.inst.onExtendConfirm();
    const ev2 = p.calls.modal.filter((m) => m.title === '确认同意加时').pop();
    ev2.__cancel();
    await sleep(30);
    assert.ok(p.calls.cloud.some((c) => c.data && c.data.action === 'extend_reject'), '拒绝→extend_reject');
  } finally { p.restore(); }
});

// O12：改期同意/拒绝双出口（S2 协商取消链）
test('O12 改期同意/拒绝双出口', async () => {
  const pdt = new Date(Date.now() + 5 * 86400000);
  pdt.setHours(10, 5, 0, 0);
  const ts = pdt.getTime();
  const pad2 = (n) => String(n).padStart(2, '0');
  const expectTime = `${pdt.getFullYear()}-${pad2(pdt.getMonth() + 1)}-${pad2(pdt.getDate())} 10:05`;
  const p = await load({
    'order-action:detail': detail({ status: 'S2_5', pending_modify: { new_start_time: ts, by_role: 'user' }, role: 'partner', my_role: 'partner' }),
    'order-action:modify_confirm': { ok: true, data: {} },
    'order-action:modify_reject': { ok: true, data: {} }
  });
  try {
    p.inst.onModifyConfirm();
    const ev = p.calls.modal.filter((m) => m.title === '同意改期').pop();
    assert.ok(ev, '应弹同意改期');
    assert.ok(ev.content.indexOf(expectTime) >= 0, '文案带入新时间（buildOrderView 映射）');
    assert.strictEqual(ev.confirmText, '同意', '确认键文案');
    ev.__confirm();
    await sleep(30);
    assert.ok(p.calls.cloud.some((c) => c.data && c.data.action === 'modify_confirm'), '同意→modify_confirm');
    p.inst.onModifyReject();
    const ev2 = p.calls.modal.filter((m) => m.title === '拒绝改期').pop();
    assert.ok(ev2, '应弹拒绝改期');
    ev2.__confirm();
    await sleep(30);
    assert.ok(p.calls.cloud.some((c) => c.data && c.data.action === 'modify_reject'), '拒绝→modify_reject');
  } finally { p.restore(); }
});

// O13：取消档位切换 —— reason 随 currentCancelIdx 变化
test('O13 取消档位切换', async () => {
  const p = await load({ 'order-action:detail': detail(), 'order-action:cancel': { ok: true, data: {} } });
  const origSetTimeout = global.setTimeout;
  try {
    const idx = p.inst.data.cancelTiers.length > 1 ? 1 : 0;
    p.inst.setData({ currentCancelIdx: idx });
    p.inst.onCancel();
    const ev = p.calls.modal.filter((m) => m.title === '取消订单').pop();
    assert.ok(new RegExp(`当前适用：${p.inst.data.cancelTiers[idx].label}`).test(ev.content), '弹窗展示当前档位');
    global.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
    ev.__confirm();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'cancel').pop();
    assert.strictEqual(call.data.reason, `按${p.inst.data.cancelTiers[idx].label}梯度退款`);
  } finally {
    global.setTimeout = origSetTimeout;
    p.restore();
  }
});

// O14：冲突收敛 —— _handleConflict 命中时不弹 r.msg，静默刷新 + 固定 toast
test('O14 冲突收敛不直出服务端文案', async () => {
  const p = await load({
    'order-action:detail': detail({ pending_extend: { add_hours: 1, add_amount_fen: 3000 } }),
    'order-action:extend_confirm': { ok: false, code: 'oa_order_status', msg: 'oa_order_status' }
  });
  try {
    const before = p.calls.cloud.filter((c) => c.data && c.data.action === 'detail').length;
    p.inst.onExtendConfirm();
    p.calls.modal.filter((m) => m.title === '确认同意加时').pop().__confirm();
    await sleep(30);
    assert.ok(p.calls.toast.some((t) => /订单状态已更新, 请刷新后重试/.test(t.title)), '固定提示');
    assert.ok(!p.calls.toast.some((t) => /oa_order_status/.test(t.title)), '不直出裸状态码');
    assert.ok(p.calls.cloud.filter((c) => c.data && c.data.action === 'detail').length > before, '静默刷新');
  } finally { p.restore(); }
});

// O15：网络异常分支 —— hideLoading + 统一文案（不伪造成功）
test('O15 提交网络异常兜底', async () => {
  const p = await load({
    'order-action:detail': detail(),
    'order-action:extend': new Error('network down')
  });
  try {
    p.inst.setData({ extendHours: 2, extendReasonTypeIndex: 0, extendReason: '临时有事情需要延长两小时处理' });
    p.inst.submitExtend();
    await sleep(30);
    assert.ok(p.calls.toast.some((t) => /网络异常/.test(t.title)), '统一网络文案');
    assert.strictEqual(p.calls.modal.filter((m) => m.title === '加时申请已提交').length, 0, '失败不弹成功框');
  } finally { p.restore(); }
});

// O16：改期同意兜底 —— pending_modify 缺失时文案回落，不抛错
test('O16 改期同意无在途兜底', async () => {
  const p = await load({ 'order-action:detail': detail(), 'order-action:modify_confirm': { ok: true, data: {} } });
  try {
    p.inst.setData({ order: Object.assign({}, p.inst.data.order, { pending_modify: null }) });
    p.inst.onModifyConfirm();
    const ev = p.calls.modal.filter((m) => m.title === '同意改期').pop();
    assert.ok(ev, '应弹窗');
    assert.strictEqual(ev.content, '确认同意本次改期？', '无在途兜底文案');
  } finally { p.restore(); }
});

// O17：_modal 弹窗 fail 分支 —— 释放锁并执行 opts.fail（异常时不得永久锁死页面）
test('O17 _modal fail 释放与回调', async () => {
  const p = await load({ 'order-action:detail': detail() });
  try {
    let failHit = 0;
    p.inst._modal({ title: 'F', fail: () => { failHit += 1; } });
    assert.strictEqual(p.inst._acting, true, '入口置锁');
    p.calls.modal.filter((m) => m.title === 'F').pop().__fail();
    await sleep(10);
    assert.strictEqual(failHit, 1, 'opts.fail 被调用');
    assert.ok(!p.inst._acting, 'fail 后释放锁');
    p.inst._modal({ title: 'G', success: () => {} });
    assert.strictEqual(p.calls.modal.filter((m) => m.title === 'G').length, 1, '释放后可再次弹出');
  } finally { p.restore(); }
});

// O18：_modal 业务回调 reject —— then(release, release) 必须放锁
test('O18 业务 reject 放锁', async () => {
  const p = await load({ 'order-action:detail': detail() });
  try {
    p.inst._modal({ title: 'H', success: () => Promise.reject(new Error('biz fail')) });
    p.calls.modal.filter((m) => m.title === 'H').pop().__confirm();
    await sleep(20);
    assert.ok(!p.inst._acting, '业务失败后释放锁');
    p.inst._modal({ title: 'I', success: () => {} });
    assert.strictEqual(p.calls.modal.filter((m) => m.title === 'I').length, 1, '释放后可再次弹出');
  } finally { p.restore(); }
});

// O10：_modal 互斥 —— 弹窗未闭合前二次调用被丢弃；release 后可再次弹出；取消键非业务动作时不执行 success
test('O10 _modal 互斥与释放', async () => {
  const p = await load({ 'order-action:detail': detail() });
  try {
    p.inst._modal({ title: 'A', success: () => {} });
    p.inst._modal({ title: 'B', success: () => {} });
    assert.strictEqual(p.calls.modal.filter((m) => m.title === 'A').length, 1);
    assert.strictEqual(p.calls.modal.filter((m) => m.title === 'B').length, 0, '未释放时二次调用被丢弃');
    p.calls.modal.filter((m) => m.title === 'A').pop().__cancel();
    await sleep(10);
    p.inst._modal({ title: 'C', success: () => {} });
    assert.strictEqual(p.calls.modal.filter((m) => m.title === 'C').length, 1, '取消后释放可再次弹出');
    // 取消键=业务动作：cancelIsAction 时 success 仍执行且释放
    let hit = 0;
    p.calls.modal.filter((m) => m.title === 'C').pop().__cancel();
    await sleep(10);
    p.inst._modal({ title: 'D', cancelIsAction: true, success: () => { hit += 1; } });
    p.calls.modal.filter((m) => m.title === 'D').pop().__cancel();
    await sleep(10);
    assert.strictEqual(hit, 1, 'cancelIsAction 时取消键执行业务回调');
  } finally { p.restore(); }
});

// O6：定位失败不阻断求助（紧急优先，location 传 null 由云端容错）
test('O6 定位失败仍提交 SOS', async () => {
  const p = await load({
    'order-action:detail': detail({ status: 'S3', my_role: 'user' }),
    'safety-report:sos': { ok: true, data: { my_contacts: [] } }
  });
  try {
    p.inst.onSos();
    p.calls.modal[0].__confirm();
    await sleep(30);
    const sos = p.calls.cloud.filter((c) => c.name === 'safety-report' && c.data.action === 'sos');
    assert.strictEqual(sos.length, 1);
    assert.strictEqual(sos[0].data.location, null);
  } finally {
    p.restore();
  }
});
