// utils/util.js 通用纯工具函数单测（技术债 P2-2 续作 · 2026-10-16）
// 仅固化既有行为，不修改运行时；被测模块零 wx/getApp 依赖，node 可直接 require
const test = require('node:test');
const assert = require('node:assert');
const {
  formatMoney,
  maskPhone,
  maskIdCard,
  timeAgo,
  debounce,
  haversineKm,
  estimateCommute
} = require('../../miniprogram/utils/util.js');

test('formatMoney 分转元：正常/零/进位', () => {
  assert.strictEqual(formatMoney(1000), '10.00');
  assert.strictEqual(formatMoney(1), '0.01');
  assert.strictEqual(formatMoney(10), '0.10');
  assert.strictEqual(formatMoney(99), '0.99');
  assert.strictEqual(formatMoney(0), '0.00');
});

test('formatMoney 空值与非法值兜底为 0.00', () => {
  assert.strictEqual(formatMoney(null), '0.00');
  assert.strictEqual(formatMoney(undefined), '0.00');
  assert.strictEqual(formatMoney(''), '0.00');
  assert.strictEqual(formatMoney('abc'), '0.00');
});

test('formatMoney 负数：固化既有截断行为（不四舍五入）', () => {
  assert.strictEqual(formatMoney(-100), '-1.00');
  assert.strictEqual(formatMoney(-105), '-2.05');
});

test('maskPhone 手机号脱敏与短串边界', () => {
  assert.strictEqual(maskPhone('13812341234'), '138****1234');
  assert.strictEqual(maskPhone('123'), '123'); // 不足 11 位原样返回（truthy 短串）
  assert.strictEqual(maskPhone(''), '');
  assert.strictEqual(maskPhone(null), '');
});

test('maskIdCard 身份证脱敏与短串边界', () => {
  assert.strictEqual(maskIdCard('510123199001011234'), '5101**********1234');
  assert.strictEqual(maskIdCard('12345'), '12345'); // 不足 18 位原样返回
  assert.strictEqual(maskIdCard(''), '');
});

test('timeAgo 空值返回空串', () => {
  assert.strictEqual(timeAgo(0), '');
  assert.strictEqual(timeAgo(null), '');
  assert.strictEqual(timeAgo(undefined), '');
});

test('timeAgo 各时间档（相对当前时刻）', () => {
  const now = Date.now();
  assert.strictEqual(timeAgo(now), '刚刚');
  assert.strictEqual(timeAgo(now - 61 * 1000), '1分钟前');
  assert.strictEqual(timeAgo(now - 3661 * 1000), '1小时前');
  assert.strictEqual(timeAgo(now - 90061 * 1000), '1天前');
  // 超过 30 天回退为 YYYY-MM-DD
  const old = now - 40 * 86400 * 1000;
  assert.match(timeAgo(old), /^\d{4}-\d{2}-\d{2}$/);
});

test('debounce 连调多次只在等待后触发一次', async () => {
  let count = 0;
  const f = debounce(() => { count++; }, 30);
  f(); f(); f();
  assert.strictEqual(count, 0);
  await new Promise((r) => setTimeout(r, 70));
  assert.strictEqual(count, 1);
});

test('haversineKm 同点为 0、北京-上海距离约 1000-1150km', () => {
  assert.ok(haversineKm(39.9042, 116.4074, 39.9042, 116.4074) < 1e-9);
  const d = haversineKm(39.9042, 116.4074, 31.2304, 121.4737);
  assert.ok(d > 1000 && d < 1150, `实测 ${d}`);
});

test('estimateCommute 0km 与 10km 五字段公式', () => {
  const z = estimateCommute(0);
  assert.deepStrictEqual(z, { distance_km: 0, walk_min: 0, bike_min: 0, bus_min: 0, drive_min: 0 });
  const t = estimateCommute(10);
  assert.deepStrictEqual(t, { distance_km: 10, walk_min: 120, bike_min: 40, bus_min: 30, drive_min: 20 });
});
