// geo_guard.test.js · 阶段B(2026-10-14) 履约定位三层判定单测(零依赖 node:test)
// 被单测对象是前端纯函数模块 miniprogram/utils/geo-guard.js(沿用 _shared/order-view.test.js 的跨目录先例,
// 目的是让它进 `npm test`(仅扫 cloudfunctions/_shared/*.test.js)门禁)。
// 覆盖: no_site 兜底放行 / no_user_location / untrusted(精度缺失·<=0·超限) / misconfig(阈值缺失) / out_of_range / 距离边界 D===N / 优先级
const test = require('node:test');
const assert = require('node:assert');
const G = require('../../miniprogram/utils/geo-guard.js');

const SITE = { latitude: 31.2314, longitude: 121.4737 };          // 履约地(GCJ-02)
const USER = { latitude: 31.2304, longitude: 121.4737, accuracy: 20 };  // Δlat 0.001 ≈ 111m
const OPTS = { thresholdM: 200, accuracyMaxM: 50 };

test('三层判定: 站内(D<=N)且精度可信 → ok=true / reason=ok / 无提示', () => {
  const r = G.evaluatePosition({ user: USER, site: SITE, ...OPTS });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'ok');
  assert.strictEqual(r.tip, '');
  assert.ok(r.distanceM >= 100 && r.distanceM <= 125, `距离应为米制(实测 ${r.distanceM}m)`);
});

test('距离边界: D===N 判通过, D=N+1 判超距(阈值口径为 D<=N 可点击)', () => {
  const d = G.evaluatePosition({ user: USER, site: SITE, thresholdM: 999999, accuracyMaxM: 50 }).distanceM;
  assert.strictEqual(G.evaluatePosition({ user: USER, site: SITE, thresholdM: d, accuracyMaxM: 50 }).ok, true);
  const r = G.evaluatePosition({ user: USER, site: SITE, thresholdM: d - 1, accuracyMaxM: 50 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'out_of_range');
  assert.ok(r.tip.indexOf('履约地点') >= 0);
});

test('超距: D>N → out_of_range 且带确认地点文案', () => {
  // 履约地取 ~2km 外(约 Δlat 0.018), 精度须可信否则会先判 untrusted
  const far = { latitude: 31.2484, longitude: 121.4737, accuracy: 20 };
  const r = G.evaluatePosition({ user: far, site: SITE, ...OPTS });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'out_of_range');
  assert.ok(r.distanceM > 200);
});

test('精度边界: accuracy=50 可信, 51 判不可信', () => {
  assert.strictEqual(G.evaluatePosition({ user: { ...USER, accuracy: 50 }, site: SITE, ...OPTS }).ok, true);
  const r = G.evaluatePosition({ user: { ...USER, accuracy: 51 }, site: SITE, ...OPTS });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'untrusted');
  assert.ok(r.tip.indexOf('开阔处') >= 0);
});

test('精度缺失不得 fail-open: accuracy 0/undefined/NaN/字符串 一律判不可信', () => {
  [0, undefined, NaN, null, 'abc'].forEach((acc) => {
    const r = G.evaluatePosition({ user: { latitude: USER.latitude, longitude: USER.longitude, accuracy: acc }, site: SITE, ...OPTS });
    assert.strictEqual(r.ok, false, `accuracy=${String(acc)} 不应放行`);
    assert.strictEqual(r.reason, 'untrusted');
  });
});

test('阈值缺失不得 fail-open: thresholdM=0/undefined/NaN/null 一律不放行(misconfig)', () => {
  [0, undefined, NaN, null].forEach((th) => {
    const r = G.evaluatePosition({ user: USER, site: SITE, thresholdM: th, accuracyMaxM: 50 });
    assert.strictEqual(r.ok, false, `thresholdM=${String(th)} 不应放行`);
    assert.strictEqual(r.reason, 'misconfig');
  });
  // 对照组: 有效阈值(200m)仍按距离放行
  assert.strictEqual(G.evaluatePosition({ user: USER, site: SITE, ...OPTS }).ok, true);
});

test('未授权/取点失败: user=null → no_user_location(置灰+引导), 坐标非法同样归此', () => {
  const r = G.evaluatePosition({ user: null, site: SITE, ...OPTS });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_user_location');
  assert.ok(r.tip.indexOf('授权定位') >= 0);
  const r2 = G.evaluatePosition({ user: { latitude: NaN, longitude: 121.4737, accuracy: 20 }, site: SITE, ...OPTS });
  assert.strictEqual(r2.reason, 'no_user_location');
});

test('no_site 兜底放行: 履约地缺坐标/0,0 → ok=true + 无法校验文案(防存量订单被永久置灰)', () => {
  const cases = [null, undefined, {}, { latitude: 31.2 }, { latitude: 0, longitude: 0 }, { latitude: NaN, longitude: 121.4 }];
  cases.forEach((site) => {
    const r = G.evaluatePosition({ user: USER, site: site, ...OPTS });
    assert.strictEqual(r.ok, true, `site=${JSON.stringify(site)} 应放行`);
    assert.strictEqual(r.reason, 'no_site');
    assert.ok(r.tip.length > 0);
  });
});

test('优先级: 履约地无坐标优先于 未授权(user=null) → 仍放行(no_site)', () => {
  const r = G.evaluatePosition({ user: null, site: { latitude: 0, longitude: 0 }, ...OPTS });
  assert.strictEqual(r.reason, 'no_site');
  assert.strictEqual(r.ok, true);
});

test('hasSiteCoord 与后端 validLngLat 同口径(缺坐标/非数字/越界/成对 0,0 判无效)', () => {
  assert.strictEqual(G.hasSiteCoord(SITE), true);
  assert.strictEqual(G.hasSiteCoord({ latitude: 0, longitude: 0 }), false);
  assert.strictEqual(G.hasSiteCoord({ latitude: 31.2, longitude: 0 }), true);   // 单侧为 0 仍有效(仅排除成对 0,0)
  assert.strictEqual(G.hasSiteCoord(null), false);
  assert.strictEqual(G.hasSiteCoord({ latitude: 91, longitude: 121.4 }), false);       // 纬度越界
  assert.strictEqual(G.hasSiteCoord({ latitude: 31.2, longitude: 181 }), false);       // 经度越界
  assert.strictEqual(G.hasSiteCoord({ latitude: '31.2', longitude: '121.4' }), false); // 非数字
});

test('文案表: 异常文案齐备(含 misconfig)且 ok 无文案', () => {
  assert.ok(G.TIPS.no_user_location.length > 0);
  assert.ok(G.TIPS.untrusted.length > 0);
  assert.ok(G.TIPS.out_of_range.length > 0);
  assert.ok(G.TIPS.misconfig.length > 0);
  assert.strictEqual(G.TIPS.ok, '');
});
