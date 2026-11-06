// scripts/pages-publish.test.js —— 发布页页面级单测（P2-2 阶段 2）
// 覆盖：联系号输入过滤 / 取号开关 / 表单校验拦截 / AA 承诺书弹窗 / 代发签字强制 / 公益计价豁免
const { test } = require('node:test');
const assert = require('node:assert');
const { createPage, sleep } = require('./mp-page-harness.js');

const PAGE = 'pages-v2/publish/publish.js';

// 一份可通过 validatePublish 的最小表单（字段口径见 utils/publish-validate.js）
function validForm(over) {
  return Object.assign({
    project_attr: 'commercial', pricing_type: 'hourly', fixed_price: '', budget: '50',
    scene_code: 'W8', content_options: ['陪同聊天'], title: '陪同就医', description: '陪同老人去医院就诊',
    service_date: '2026-11-10', service_time: '10:00', duration_hours: 3, duration_custom: '',
    location_name: '人民医院', latitude: 30.6, longitude: 104.0, headcount: 1,
    aa_estimate: '0-50', aa_custom: '', gender_pref: '不限', match_mode: 'broadcast'
  }, over || {});
}

function makePage(data) {
  return createPage({
    page: PAGE,
    fixtures: {},
    data: Object.assign({
      form: validForm(),
      disclaimerChecked: true,
      useAccountPhone: true,
      accountPhoneMasked: '138****5386',
      user: { age: 30 }
    }, data || {})
  });
}

// P1：联系手机号输入过滤 —— 非数字剔除、超长截断 11 位
test('P1 联系号输入过滤', () => {
  const p = makePage();
  try {
    p.inst.onContactPhoneInput({ detail: { value: '138-0000 1234abc99' } });
    assert.strictEqual(p.inst.data.contactPhone, '13800001234');
  } finally {
    p.restore();
  }
});

// P2：使用账户手机号开关（勾选数组语义）
test('P2 取号开关', () => {
  const p = makePage();
  try {
    p.inst.onUseAccountPhoneChange({ detail: { value: [] } });
    assert.strictEqual(p.inst.data.useAccountPhone, false);
    p.inst.onUseAccountPhoneChange({ detail: { value: ['1'] } });
    assert.strictEqual(p.inst.data.useAccountPhone, true);
  } finally {
    p.restore();
  }
});

// P3：校验失败即拦截 —— 只提示首条错误，不弹 AA、不发云
test('P3 表单校验拦截', async () => {
  const p = makePage({ form: validForm({ scene_code: '', content_options: [] }) });
  try {
    p.inst.onPublish();
    await sleep(10);
    assert.strictEqual(p.calls.toast[0].title, '请选择场景');
    assert.strictEqual(p.calls.modal.length, 0);
    assert.strictEqual(p.calls.cloud.length, 0);
  } finally {
    p.restore();
  }
});

// P4：AA 承诺书弹窗（平台不代收）—— 取消则不发云
test('P4 AA 承诺书弹窗与取消', async () => {
  const p = makePage();
  try {
    p.inst.onPublish();
    await sleep(10);
    assert.strictEqual(p.calls.modal.length, 1);
    assert.strictEqual(p.calls.modal[0].title, 'AA费用确认');
    assert.match(p.calls.modal[0].content, /平台不代收/);
    assert.strictEqual(p.calls.modal[0].confirmText, '确认发布');

    p.calls.modal[0].__cancel();
    await sleep(10);
    assert.strictEqual(p.calls.cloud.length, 0, '取消 AA 不应发起发布');
  } finally {
    p.restore();
  }
});

// P5：代他人发布必须有手写签字授权（附录A 第 6 条同源校验）
test('P5 代发缺签字拦截', async () => {
  const p = makePage({
    useAccountPhone: false,
    contactPhone: '13800001234',
    publishType: 'proxy',
    proxyName: '张阿姨',
    proxyRelation: '邻居',
    proxyPhone: '13900005678',
    proxyAuthChecked: false
  });
  try {
    p.inst.onPublish();
    await sleep(10);
    assert.strictEqual(p.calls.toast[0].title, '请完成《委托授权书》手写签字确认');
    assert.strictEqual(p.calls.modal.length, 0, '校验未过不应进入 AA 弹窗');
  } finally {
    p.restore();
  }
});

// P6：公益场景不校验商业计价（pricing_type=hourly + 空预算仍应放行到 AA 弹窗）
test('P6 公益计价豁免', async () => {
  const p = makePage({ form: validForm({ project_attr: 'charity', budget: '' }) });
  try {
    assert.deepStrictEqual(p.inst.validatePublish(p.inst.data.form), []);
    p.inst.onPublish();
    await sleep(10);
    assert.strictEqual(p.calls.modal[0].title, 'AA费用确认');
  } finally {
    p.restore();
  }
});
