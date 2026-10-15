// publish-validate 纯函数单测（拆分阶段1 C3，2026-10-15）· 从 publish.js 抽离的发布校验/工具函数全分支覆盖
const test = require('node:test');
const assert = require('node:assert');
const {
  detectSensitive, haversineKm, pad2, fmtDist,
  isPhoneOrLandline, defaultDisclaimer, buildDraftData, validatePublish
} = require('../../miniprogram/utils/publish-validate.js');

// ── B1 工具四函数 ──
test('detectSensitive：空值安全', () => {
  assert.strictEqual(detectSensitive(''), null);
  assert.strictEqual(detectSensitive(null), null);
  assert.strictEqual(detectSensitive(undefined), null);
});
test('detectSensitive：手机号/微信号命中，正常文案放行', () => {
  assert.strictEqual(detectSensitive('联系我 13812345678'), '内容包含手机号格式，请删除后重试');
  assert.strictEqual(detectSensitive('加我vx123'), '内容包含微信号信息，请删除后重试');
  assert.strictEqual(detectSensitive('加 V信 聊'), '内容包含微信号信息，请删除后重试');
  assert.strictEqual(detectSensitive('微信同号'), '内容包含微信号信息，请删除后重试');
  assert.strictEqual(detectSensitive('陪诊取药，全程陪同'), null);
});

test('haversineKm：同点 0、北京→上海约 1000+km、对称', () => {
  assert.strictEqual(haversineKm(39.9, 116.4, 39.9, 116.4), 0);
  const d = haversineKm(39.9, 116.4, 31.2, 121.5);
  assert.ok(d > 1000 && d < 1150, `京沪距离异常: ${d}`);
  assert.ok(Math.abs(haversineKm(39.9, 116.4, 31.2, 121.5) - haversineKm(31.2, 121.5, 39.9, 116.4)) < 1e-9);
});

test('pad2：个位数补零', () => {
  assert.strictEqual(pad2(0), '00');
  assert.strictEqual(pad2(9), '09');
  assert.strictEqual(pad2(23), '23');
});

test('fmtDist：空/非正→空串，米档/公里档', () => {
  assert.strictEqual(fmtDist(0), '');
  assert.strictEqual(fmtDist(-1), '');
  assert.strictEqual(fmtDist(undefined), '');
  assert.strictEqual(fmtDist(0.5), '500 米');
  assert.strictEqual(fmtDist(0.999), '999 米');           // round(999) 不进位
  assert.strictEqual(fmtDist(0.9996), '1000 米');         // round(999.6) 进位
  assert.strictEqual(fmtDist(1), '1.0 公里');
  assert.strictEqual(fmtDist(12.34), '12.3 公里');
});

// ── B2 电话格式 ──
test('isPhoneOrLandline：手机/座机/脏值', () => {
  assert.strictEqual(isPhoneOrLandline('13812345678'), true);
  assert.strictEqual(isPhoneOrLandline(' 13812345678 '), true);       // trim
  assert.strictEqual(isPhoneOrLandline('028-88888888'), true);        // 3 位区号
  assert.strictEqual(isPhoneOrLandline('010-12345678'), true);        // 3 位区号 8 位号
  assert.strictEqual(isPhoneOrLandline('12300000000'), false);        // 非 1[3-9] 开头
  assert.strictEqual(isPhoneOrLandline('028-12345'), false);          // 座机号太短
  assert.strictEqual(isPhoneOrLandline('abc'), false);
  assert.strictEqual(isPhoneOrLandline(null), false);
  assert.strictEqual(isPhoneOrLandline(undefined), false);
});

// ── B3 默认免责声明 ──
test('defaultDisclaimer：两类专属标题 + 默认兜底', () => {
  assert.strictEqual(defaultDisclaimer({ disclaimer_type: 'medical_disclaimer' }).title, '就医免责声明');
  assert.strictEqual(defaultDisclaimer({ disclaimer_type: 'online_disclaimer' }).title, '线上陪伴声明');
  assert.strictEqual(defaultDisclaimer({ disclaimer_type: 'general_disclaimer' }).title, '免责声明');
  assert.strictEqual(defaultDisclaimer({}).title, '免责声明');
  const d = defaultDisclaimer({ disclaimer_type: 'medical_disclaimer' });
  assert.ok(d.content.includes('生活协助性质'));
});

// ── B4 表单→草稿结构 ──
test('buildDraftData：计价/一口价/数组兜底', () => {
  const d1 = buildDraftData({ project_attr: 'commercial', pricing_type: 'fixed', fixed_price: '88', content_options: ['a', 'b'] });
  assert.strictEqual(d1.pricing_type, 'fixed');
  assert.strictEqual(d1.fixed_price, '88');
  assert.deepStrictEqual(d1.content_options, ['a', 'b']);
  const d2 = buildDraftData({ pricing_type: 'weird', fixed_price: undefined, content_options: 'not-array' });
  assert.strictEqual(d2.pricing_type, 'hourly');
  assert.strictEqual(d2.fixed_price, '');
  assert.deepStrictEqual(d2.content_options, []);
});
test('buildDraftData：时长三优先级与定位/金额兜底', () => {
  assert.strictEqual(buildDraftData({ duration_hours: 2 }).duration_hours, 2);
  assert.strictEqual(buildDraftData({ duration_custom: '4' }).duration_hours, 4);
  assert.strictEqual(buildDraftData({}).duration_hours, 3);
  const d = buildDraftData({ location_name: '春熙路', latitude: 30.1, longitude: 104.1, budget: '88.5' });
  assert.deepStrictEqual(d.location, { name: '春熙路', latitude: 30.1, longitude: 104.1 });
  assert.strictEqual(d.budget, 88.5);
  const d0 = buildDraftData({ budget: 'abc' });
  assert.deepStrictEqual(d0.location, { name: undefined, latitude: 0, longitude: 0 });
  assert.strictEqual(d0.budget, 0);
});
test('buildDraftData：其余字段透传不丢', () => {
  const d = buildDraftData({
    project_attr: 'public_welfare', scene_code: 'W9', title: 'T', description: 'D',
    service_date: '2026-10-25', service_time: '09:00', headcount: 2,
    aa_estimate: 'A', gender_pref: 'female', match_mode: 'smart'
  });
  assert.strictEqual(d.project_attr, 'public_welfare');
  assert.strictEqual(d.scene_code, 'W9');
  assert.strictEqual(d.title, 'T');
  assert.strictEqual(d.description, 'D');
  assert.strictEqual(d.service_date, '2026-10-25');
  assert.strictEqual(d.headcount, 2);
  assert.strictEqual(d.aa_estimate, 'A');
  assert.strictEqual(d.gender_pref, 'female');
  assert.strictEqual(d.match_mode, 'smart');
});

// ── B5 validatePublish ──
// 合法基线（W1 非 W9，商业小时价 100 元/h，成人，自用，账户已绑手机）
const F = (over) => Object.assign({
  scene_code: 'W1',
  content_options: ['陪诊'],
  title: '陪诊服务',
  description: '帮忙取药陪同就医',
  service_date: '2026-10-25',
  service_time: '09:00',
  duration_hours: 1,
  location_name: '成都春熙路',
  project_attr: 'commercial',
  pricing_type: 'hourly',
  budget: 100,
  aa_estimate: '双方AA'
}, over);
const C = (over) => Object.assign({
  petAuthChecked: false,
  isEditMode: false,
  useAccountPhone: true,
  contactPhone: '',
  accountPhoneMasked: '138****0000',
  publishType: 'self',
  proxyName: '',
  proxyRelation: '',
  proxyRelationNote: '',
  proxyPhone: '',
  proxyAuthChecked: false,
  userAge: 30
}, over);

test('validatePublish：合法基线零错误', () => {
  assert.deepStrictEqual(validatePublish(F(), C()), []);
});

test('validatePublish：8 个必填项逐个拦截（文案顺序）', () => {
  assert.deepStrictEqual(validatePublish(F({ scene_code: '' }), C()), ['请选择场景']);
  assert.deepStrictEqual(validatePublish(F({ content_options: [] }), C()), ['请选择服务内容']);
  assert.deepStrictEqual(validatePublish(F({ title: '' }), C()), ['请输入标题']);
  assert.deepStrictEqual(validatePublish(F({ description: '' }), C()), ['请输入描述']);
  assert.deepStrictEqual(validatePublish(F({ service_date: '' }), C()), ['请选择日期']);
  assert.deepStrictEqual(validatePublish(F({ service_time: '' }), C()), ['请选择时间']);
  assert.deepStrictEqual(validatePublish(F({ duration_hours: 0, duration_custom: '' }), C()), ['请选择时长']);
  assert.deepStrictEqual(validatePublish(F({ location_name: '' }), C()), ['请输入地点']);
  assert.deepStrictEqual(validatePublish(F({ aa_estimate: '' }), C()), ['请选择AA费用预估']);
});

test('validatePublish：商业一口价仅正整数', () => {
  const fixed = (over) => validatePublish(F(Object.assign({ pricing_type: 'fixed', budget: 0 }, over)), C());
  assert.deepStrictEqual(fixed({ fixed_price: '88' }), []);
  assert.ok(fixed({ fixed_price: '0' }).includes('请输入有效的一口价（正整数元）'));
  assert.ok(fixed({ fixed_price: '-5' }).includes('请输入有效的一口价（正整数元）'));
  assert.ok(fixed({ fixed_price: '88.5' }).includes('请输入有效的一口价（正整数元）'));
  assert.ok(fixed({ fixed_price: 'abc' }).includes('请输入有效的一口价（正整数元）'));
});

test('validatePublish：商业小时价预算区间 10-500；公益不校验预算', () => {
  assert.ok(validatePublish(F({ budget: 9 }), C()).some((m) => m.includes('预算需在10-500元/小时之间')));
  assert.ok(validatePublish(F({ budget: 501 }), C()).some((m) => m.includes('预算需在10-500元/小时之间')));
  assert.deepStrictEqual(validatePublish(F({ budget: 9, project_attr: 'public_welfare' }), C())
    .filter((m) => m.includes('预算')), []);
});

test('validatePublish：W9 必须勾宠物授权；非 W9 不要求', () => {
  assert.deepStrictEqual(validatePublish(F({ scene_code: 'W9' }), C({ petAuthChecked: false })), ['请确认《宠物照料授权书》']);
  assert.deepStrictEqual(validatePublish(F({ scene_code: 'W9' }), C({ petAuthChecked: true })), []);
  assert.deepStrictEqual(validatePublish(F({ scene_code: 'W1' }), C({ petAuthChecked: false })), []);
});

test('validatePublish：联系手机三态 + 编辑模式跳过', () => {
  // 手动输入：空/错/对
  const manual = (overCtx, overF) => validatePublish(F(overF || {}), C(Object.assign({ useAccountPhone: false, accountPhoneMasked: '' }, overCtx)));
  assert.deepStrictEqual(manual({ contactPhone: '' }), ['请填写联系手机号']);
  assert.deepStrictEqual(manual({ contactPhone: '12345' }), ['请填写正确的 11 位联系手机号']);
  assert.deepStrictEqual(manual({ contactPhone: '13812345678' }), []);
  // 用账户手机但未绑定
  assert.deepStrictEqual(validatePublish(F(), C({ useAccountPhone: true, accountPhoneMasked: '' })), ['账户未绑定手机号，请手动填写联系手机号']);
  // 编辑模式跳过整条联系手机校验
  assert.deepStrictEqual(validatePublish(F(), C({ isEditMode: true, useAccountPhone: false, contactPhone: '' })), []);
});

test('validatePublish：代发 5 子项逐个拦截 + 手机/座机通过 + 非代发跳过', () => {
  const proxy = (overCtx) => C(Object.assign({
    publishType: 'proxy', proxyName: '李四', proxyRelation: '父母',
    proxyRelationNote: '', proxyPhone: '13900000000', proxyAuthChecked: true
  }, overCtx));
  assert.deepStrictEqual(validatePublish(F(), proxy({})), []);
  assert.deepStrictEqual(validatePublish(F(), proxy({ proxyPhone: '028-88888888' })), []);
  assert.ok(validatePublish(F(), proxy({ proxyName: '  ' })).includes('请填写被代发人姓名'));
  assert.deepStrictEqual(validatePublish(F(), proxy({ proxyRelation: '' })).filter((m) => m.includes('关系')), ['请选择与本人的关系']);
  assert.deepStrictEqual(validatePublish(F(), proxy({ proxyRelation: '其他', proxyRelationNote: '' })), ['请填写关系补充说明（20 字内）']);
  assert.deepStrictEqual(validatePublish(F(), proxy({ proxyRelation: '其他', proxyRelationNote: '邻居' })), []);
  assert.ok(validatePublish(F(), proxy({ proxyPhone: '   ' })).includes('请填写被代发人电话'));
  assert.ok(validatePublish(F(), proxy({ proxyPhone: '123' })).some((m) => m.includes('请填写正确的手机号')));
  assert.deepStrictEqual(validatePublish(F(), proxy({ proxyAuthChecked: false })), ['请完成《委托授权书》手写签字确认']);
  // 非代发：代理字段全空也不报错
  assert.deepStrictEqual(validatePublish(F(), C({ publishType: 'self' })), []);
});

test('validatePublish：敏感词标题/描述各自报错', () => {
  assert.deepStrictEqual(validatePublish(F({ title: 'call 13812345678' }), C()), ['内容包含手机号格式，请删除后重试']);
  assert.deepStrictEqual(validatePublish(F({ description: '加vx聊' }), C()), ['内容包含微信号信息，请删除后重试']);
});

test('validatePublish：18-22 岁单笔 200 元上限（小时价按时长累乘；一口价按面值；成人/公益不受限）', () => {
  // 青年 20 岁：100 元 × 1h = 100 通过；× 3h = 300 拦截
  assert.deepStrictEqual(validatePublish(F({ budget: 100, duration_hours: 1 }), C({ userAge: 20 })), []);
  assert.ok(validatePublish(F({ budget: 100, duration_hours: 3 }), C({ userAge: 20 })).some((m) => m.includes('200元')));
  // 一口价 300 元拦截、200 元通过
  assert.ok(validatePublish(F({ pricing_type: 'fixed', fixed_price: '300', budget: 0 }), C({ userAge: 20 })).some((m) => m.includes('200元')));
  assert.deepStrictEqual(validatePublish(F({ pricing_type: 'fixed', fixed_price: '200', budget: 0 }), C({ userAge: 20 })), []);
  // 30 岁不受限；公益单不走青年金额校验
  assert.deepStrictEqual(validatePublish(F({ budget: 100, duration_hours: 3 }), C({ userAge: 30 })), []);
  assert.deepStrictEqual(validatePublish(F({ project_attr: 'public_welfare', budget: 0, duration_hours: 3 }), C({ userAge: 20 })), []);
});

test('validatePublish：多错误按固定顺序累积（缺场景+缺标题同时存在）', () => {
  const errs = validatePublish(F({ scene_code: '', title: '' }), C());
  assert.strictEqual(errs[0], '请选择场景');
  assert.ok(errs.includes('请输入标题'));
});
