// scripts/pages-workbench.test.js —— 工作台页面级单测（P2-2 阶段 1 试点，2026-11-07 用户批准）
// 覆盖：生命周期 → 云调用契约 / 服务端口径映射 / 旧字段兜底 / 资金分档按钮态 / 信用分单源 / 异常数据兜底 / 接单开关回滚 / 跳转
// 注：只加载页面对象做白盒断言，不修改 miniprogram 源码，不连网、不需开发者工具。
const { test } = require('node:test');
const assert = require('node:assert');
const { createPage, sleep } = require('./mp-page-harness.js');

const PAGE = 'pages-v2/workbench/workbench.js';

// 统一装载：调用 onLoad 后等一轮 Promise 链（页面内 6 次云调用均走微任务）
async function load(fixtures, extra) {
  const p = createPage(Object.assign({ page: PAGE, fixtures }, extra || {}));
  p.inst.onLoad();
  await sleep(20);
  return p;
}

// W1：onLoad 发起的云调用契约（函数名 + action 顺序固定，防止前后端 action 名漂移）
test('W1 onLoad 云调用契约 6 次且顺序固定', async () => {
  const p = await load({ 'user-login:peek_login': { ok: true, data: { found: false } } });
  try {
    const seq = p.calls.cloud.map((c) => c.name + ':' + (c.data && c.data.action));
    assert.deepStrictEqual(seq, [
      'user-login:peek_login',
      'payment-mock:balance_info',
      'payment-mock:income_list',
      'partner-action:my_profile',
      'order-action:my_orders',
      'order-action:my_orders'
    ]);
  } finally {
    p.restore();
  }
});

// W2：服务端口径优先（P2-12/13）—— today_pending 直接取值、week_income_fen 分转元保留两位
test('W2 today_pending / week_income_fen 口径映射', async () => {
  const p = await load({
    'user-login:peek_login': { ok: true, data: { found: false } },
    'payment-mock:balance_info': {
      ok: true,
      data: { today_pending: 2, week_income_fen: 12345, credit_level: 'L3', credit_score: 920 }
    }
  });
  try {
    assert.strictEqual(p.inst.data.todayCount, 2);
    assert.strictEqual(p.inst.data.weekIncomeYuan, '123.45');
    assert.strictEqual(p.inst.data.todaySummary.count, 2);
  } finally {
    p.restore();
  }
});

// W3：旧云端未升级时回退 total_completed / month_income_fen，避免灰度期显示 0
test('W3 旧字段兜底（total_completed / month_income_fen）与资金三档换算', async () => {
  const p = await load({
    'user-login:peek_login': { ok: true, data: { found: false } },
    'payment-mock:balance_info': {
      ok: true,
      data: { withdrawable_fen: 5000, splitting_fen: 1000, processing_fen: 250, total_completed: 7, month_income_fen: 99999 }
    }
  });
  try {
    assert.strictEqual(p.inst.data.todayCount, 7);
    assert.strictEqual(p.inst.data.weekIncomeYuan, '999.99');
    assert.deepStrictEqual(p.inst.data.fundAmountMap, {
      withdrawable: '50.00', splitting: '10.00', processing: '2.50'
    });
    assert.strictEqual(p.inst.data.fundAmount, '50.00');
  } finally {
    p.restore();
  }
});

// W4：资金 tab 按钮态 —— 切换只改 fundActive/fundAmount；点当前 tab 为空操作
test('W4 资金 tab 切换按钮态', async () => {
  const p = await load({
    'user-login:peek_login': { ok: true, data: { found: false } },
    'payment-mock:balance_info': { ok: true, data: { withdrawable_fen: 5000, splitting_fen: 1000, processing_fen: 250 } }
  });
  try {
    const ev = (key) => ({ currentTarget: { dataset: { key } } });
    p.inst.onFundTabTap(ev('splitting'));
    assert.strictEqual(p.inst.data.fundActive, 'splitting');
    assert.strictEqual(p.inst.data.fundAmount, '10.00');

    const before = p.calls.setData.length;
    p.inst.onFundTabTap(ev('splitting'));
    assert.strictEqual(p.calls.setData.length, before, '点当前 tab 不应触发 setData');

    p.inst.onFundTabTap(ev('processing'));
    assert.strictEqual(p.inst.data.fundAmount, '2.50');
  } finally {
    p.restore();
  }
});

// W5：信用分单源口径（P3-16）—— 有 partner_profile.score 用它；缺失时回退账户原值
test('W5 信用分/等级映射与回退', async () => {
  const a = await load({
    'user-login:peek_login': { ok: true, data: { found: false } },
    'payment-mock:balance_info': { ok: true, data: { credit_level: 'L3', credit_score: 920 } }
  });
  try {
    assert.strictEqual(a.inst.data.creditLevel, 'L3');
    assert.strictEqual(a.inst.data.creditScore, 920);
  } finally {
    a.restore();
  }

  const b = await load(
    {
      'user-login:peek_login': { ok: true, data: { found: false } },
      'payment-mock:balance_info': { ok: true, data: {} }
    },
    { data: { user: { partner_credit_score: 810 } } }
  );
  try {
    assert.strictEqual(b.inst.data.creditLevel, 'L1');
    assert.strictEqual(b.inst.data.creditScore, 810);
  } finally {
    b.restore();
  }
});

// W6：云端返回结构异常时不白屏 —— 落到 loadError 兜底态且不抛
test('W6 异常数据兜底 loadError', async () => {
  const p = await load({
    'user-login:peek_login': { ok: true, data: { found: false } },
    'order-action:my_orders': { ok: true, data: { list: 'boom' } }
  });
  try {
    assert.strictEqual(p.inst.data.loading, false);
    assert.strictEqual(p.inst.data.loadError, true);
  } finally {
    p.restore();
  }
});

// W7：接单开关乐观更新 + 云端失败回滚 + toast 文案
test('W7 接单开关失败回滚', async () => {
  const p = await load({
    'user-login:peek_login': { ok: true, data: { found: false } },
    'partner-action:set_switch': { ok: false, msg: '接单已暂停' }
  });
  try {
    assert.strictEqual(p.inst.data.acceptingOrders, true);
    p.inst.onAcceptToggle({ detail: { value: false } });
    await sleep(10);
    assert.strictEqual(p.inst.data.acceptingOrders, true, '失败后应回滚到原状态');
    assert.strictEqual(p.calls.toast.length, 1);
    assert.strictEqual(p.calls.toast[0].title, '接单已暂停');
  } finally {
    p.restore();
  }
});

// W8：待办卡/时间轴跳转 —— 有 id 带参进详情；无 id 走 toast 不跳转
test('W8 订单详情跳转与缺参兜底', async () => {
  const p = await load({ 'user-login:peek_login': { ok: true, data: { found: false } } });
  try {
    p.inst.goOrderDetail({ currentTarget: { dataset: { id: 'ORD_TEST_1' } } });
    assert.strictEqual(p.calls.nav.length, 1);
    assert.strictEqual(p.calls.nav[0].url, '/pages-v2/order-detail/order-detail?orderId=ORD_TEST_1');

    p.inst.goOrderDetail({ currentTarget: { dataset: {} } });
    assert.strictEqual(p.calls.nav.length, 1, '缺 id 不应跳转');
    assert.strictEqual(p.calls.toast[0].title, '订单参数缺失');
  } finally {
    p.restore();
  }
});
