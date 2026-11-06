// scripts/pages-pay.test.js —— 支付页页面级单测（P2-2 阶段 2）
// 覆盖：订单 ID 校验 / 金额分转元 / 加载失败态 / 状态与 AA 前置拦截 / 二次确认 / 防连点 / 支付失败回滚
const { test } = require('node:test');
const assert = require('node:assert');
const { createPage, sleep } = require('./mp-page-harness.js');

const PAGE = 'pages-v2/pay/pay.js';
const ORDER_ID = 'a'.repeat(32); // 32 位十六进制，符合页面 /^[a-f0-9]{32}$/i 校验

function cashier(over) {
  return {
    ok: true,
    data: Object.assign({
      order_no: 'ORD_TEST', status: 'S0', start_time: 0, duration_h: 3,
      total_fen: 12345, scene_code: 'W8', content_options: ['陪聊', '散步'],
      location: {}, pricing_type: 'hourly', need_aa_promise: false
    }, over || {})
  };
}

async function load(fixtures) {
  const p = createPage({ page: PAGE, fixtures });
  p.inst.onLoad({ orderId: ORDER_ID });
  await sleep(20);
  return p;
}

// Y1：非法订单 ID 直接落错误态，且不发云（避免用无效 ID 打云函数）
test('Y1 非法订单 ID 拦截', async () => {
  const p = createPage({ page: PAGE, fixtures: {} });
  p.inst.onLoad({ orderId: 'bad-id' });
  await sleep(10);
  try {
    assert.strictEqual(p.inst.data.loadError, true);
    assert.match(p.inst.data.loadErrorMsg, /缺少有效订单 ID/);
    assert.strictEqual(p.calls.cloud.length, 0);
  } finally {
    p.restore();
  }
});

// Y2：金额一律分整数，前端只做展示换算（附录A 第 7 条）
test('Y2 金额分转元换算', async () => {
  const p = await load({ 'payment-mock:cashier_info': cashier() });
  try {
    assert.strictEqual(p.inst.data.totalFen, 12345);
    assert.strictEqual(p.inst.data.serviceFee, '123.45');
    assert.strictEqual(p.inst.data.totalFee, '123.45');
    assert.strictEqual(p.inst.data.unitPriceYuan, '41.15'); // 12345 / 3h / 100
    assert.strictEqual(p.inst.data.loadError, false);
  } finally {
    p.restore();
  }
});

// Y3：收银台加载失败 → 错误态透传云端文案
test('Y3 加载失败态', async () => {
  const p = await load({ 'payment-mock:cashier_info': { ok: false, msg: '订单不存在' } });
  try {
    assert.strictEqual(p.inst.data.loadError, true);
    assert.strictEqual(p.inst.data.loadErrorMsg, '订单不存在');
  } finally {
    p.restore();
  }
});

// Y4：非 S0 状态不可支付（服务端裁决前的本地快速拦截）
test('Y4 非 S0 状态拦截', async () => {
  const p = await load({ 'payment-mock:cashier_info': cashier({ status: 'S2' }) });
  try {
    p.inst.onPay();
    assert.strictEqual(p.calls.toast[0].title, '订单当前状态不可支付');
    assert.strictEqual(p.calls.modal.length, 0);
    assert.strictEqual(p.calls.cloud.filter((c) => c.data.action === 'mock_pay').length, 0);
  } finally {
    p.restore();
  }
});

// Y5：需 AA 承诺书但未勾选 → 拦截（附录A 第 6 条）
test('Y5 AA 承诺书前置拦截', async () => {
  const p = await load({ 'payment-mock:cashier_info': cashier({ need_aa_promise: true }) });
  try {
    p.inst.onPay();
    assert.strictEqual(p.calls.toast[0].title, '请先勾选AA承诺书');
    assert.strictEqual(p.calls.modal.length, 0);
  } finally {
    p.restore();
  }
});

// Y6：二次确认 —— 取消不发支付；确认才发 mock_pay 并跳转订单详情
test('Y6 二次确认与支付跳转', async () => {
  const p = await load({ 'payment-mock:cashier_info': cashier(), 'payment-mock:mock_pay': { ok: true, data: { total_fen: 12345 } } });
  try {
    p.inst.onPay();
    assert.strictEqual(p.calls.modal.length, 1);
    p.calls.modal[0].__cancel();
    await sleep(10);
    assert.strictEqual(p.calls.cloud.filter((c) => c.data.action === 'mock_pay').length, 0, '取消不应发起支付');

    p.inst.onPay();
    p.calls.modal[1].__confirm();
    await sleep(20);
    const pays = p.calls.cloud.filter((c) => c.data.action === 'mock_pay');
    assert.strictEqual(pays.length, 1);
    assert.strictEqual(pays[0].data.order_id, ORDER_ID);
    assert.strictEqual(p.calls.nav[0].url, '/pages-v2/order-detail/order-detail?orderId=' + ORDER_ID);
  } finally {
    p.restore();
  }
});

// Y7：重入锁 —— paying 期间重复点击不产生第二次支付
test('Y7 防连点重入锁', async () => {
  const p = await load({ 'payment-mock:cashier_info': cashier(), 'payment-mock:mock_pay': { ok: true, data: {} } });
  try {
    p.inst.onPay();
    p.calls.modal[0].__confirm();
    p.inst.onPay(); // paying=true 时立即返回，不应再弹确认
    await sleep(20);
    assert.strictEqual(p.calls.modal.length, 1);
    assert.strictEqual(p.calls.cloud.filter((c) => c.data.action === 'mock_pay').length, 1);
  } finally {
    p.restore();
  }
});

// Y8：支付失败 → paying 复位 + 失败弹窗，不跳转
test('Y8 支付失败回滚', async () => {
  const p = await load({ 'payment-mock:cashier_info': cashier(), 'payment-mock:mock_pay': { ok: false, msg: '余额不足' } });
  try {
    p.inst.onPay();
    p.calls.modal[0].__confirm();
    await sleep(20);
    assert.strictEqual(p.inst.data.paying, false);
    const failModal = p.calls.modal[p.calls.modal.length - 1];
    assert.strictEqual(failModal.title, '支付失败');
    assert.strictEqual(failModal.content, '余额不足');
    assert.strictEqual(p.calls.nav.length, 0);
  } finally {
    p.restore();
  }
});
