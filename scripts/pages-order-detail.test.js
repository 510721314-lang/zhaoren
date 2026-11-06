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
