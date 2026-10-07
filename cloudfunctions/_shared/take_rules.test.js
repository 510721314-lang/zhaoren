// take_rules.js 接单/发布规则单测(零依赖 node:test)
// 覆盖: 东八区时间红线 / 自然日与星期 / 价格区间钳制 / 每周时段解析与覆盖 / Haversine 距离
// 运行: 根目录 `npm test`  或  `node --test cloudfunctions/_shared/take_rules.test.js`
const test = require('node:test');
const assert = require('node:assert');
const {
  CN_OFFSET_MS, DAY_MS, TAKE_MAX_DISTANCE_KM,
  cnDayStart, cnWeekday, isServiceTimeAllowed,
  readRateRange, suspendLeftDays, parseSlot, rangeInSlot, slotCovers,
  haversineKm
} = require('./take_rules');

// 东八区墙上时间 → 时间戳: 2026-10-06(周二) h:m CST
const cst = (h, m) => Date.UTC(2026, 9, 6, h, m) - CN_OFFSET_MS;
const cstD = (day, h, m) => Date.UTC(2026, 9, day, h, m) - CN_OFFSET_MS;

// ── isServiceTimeAllowed(默认红线: 06:00-24:00 可约) ──
test('红线: 06:00 整点放行(openMin 含边界)', () => {
  assert.strictEqual(isServiceTimeAllowed(cst(6, 0)), true);
});
test('红线: 05:59 拦截', () => {
  assert.strictEqual(isServiceTimeAllowed(cst(5, 59)), false);
});
test('红线: 23:59 放行 / 00:00 拦截', () => {
  assert.strictEqual(isServiceTimeAllowed(cst(23, 59)), true);
  assert.strictEqual(isServiceTimeAllowed(cst(0, 0)), false);
});
test('红线: 03:00 拦截(深夜核心禁区)', () => {
  assert.strictEqual(isServiceTimeAllowed(cst(3, 0)), false);
});
test('红线: close_min=0 → 全天开放(03:00 也放行)', () => {
  assert.strictEqual(isServiceTimeAllowed(cst(3, 0), { time_redline_close_min: 0 }), true);
});
test('红线: 自定义 open_min=480(08:00) → 07:00 拦截 08:00 放行', () => {
  const cfg = { time_redline_open_min: 480 };
  assert.strictEqual(isServiceTimeAllowed(cst(7, 0), cfg), false);
  assert.strictEqual(isServiceTimeAllowed(cst(8, 0), cfg), true);
});
test('红线: 非法配置回退默认(close=2000 越界→1440, open>=close→360)', () => {
  const bad = { time_redline_close_min: 2000, time_redline_open_min: 1500 };
  assert.strictEqual(isServiceTimeAllowed(cst(7, 0), bad), true);   // 回退后 360-1440 放行
  assert.strictEqual(isServiceTimeAllowed(cst(3, 0), bad), false);
});
test('红线: ts 传字符串数字也兼容', () => {
  assert.strictEqual(isServiceTimeAllowed(String(cst(12, 0))), true);
});

// ── cnDayStart / cnWeekday(东八区自然日) ──
test('cnDayStart: 当天 00:00 CST 即自然日起点', () => {
  assert.strictEqual(cnDayStart(cst(0, 0)), cst(0, 0));
});
test('cnDayStart: 前日 23:59 归前一日(跨午夜不串日)', () => {
  assert.strictEqual(cnDayStart(cstD(5, 23, 59)), cstD(5, 0, 0));
});
test('cnDayStart: +DAY_MS = 次日起点', () => {
  assert.strictEqual(cnDayStart(cst(8, 30) + DAY_MS), cstD(7, 0, 0));
});
test('cnWeekday: 纪元 0 = 1970-01-01 周四(不依赖运行时区)', () => {
  assert.strictEqual(cnWeekday(0), 'thu');
});
test('cnWeekday: 2026-10-06 = 周二, 10-07 = 周三', () => {
  assert.strictEqual(cnWeekday(cst(12, 0)), 'tue');
  assert.strictEqual(cnWeekday(cstD(7, 12, 0)), 'wed');
});
test('cnWeekday: 23:59 仍属当日, 00:00 归次日', () => {
  assert.strictEqual(cnWeekday(cst(23, 59)), 'tue');
  assert.strictEqual(cnWeekday(cstD(7, 0, 0)), 'wed');
});

// ── readRateRange(价格区间钳制) ──
test('价格: 资料未配置 → [null, null](不限)', () => {
  assert.deepStrictEqual(readRateRange({}, {}), [null, null]);
});
test('价格: 区间内原样通过', () => {
  assert.deepStrictEqual(readRateRange({ accept_rate_min_fen: 4000, accept_rate_max_fen: 8000 }, {}), [4000, 8000]);
});
test('价格: 低于平台下限钳到 3000', () => {
  assert.deepStrictEqual(readRateRange({ accept_rate_min_fen: 1000 }, {}), [3000, null]);
});
test('价格: 高于平台上限钳到 10000', () => {
  assert.deepStrictEqual(readRateRange({ accept_rate_max_fen: 20000 }, {}), [null, 10000]);
});
test('价格: admin 配置 0 是合法下限(不得被误当缺省 3000)', () => {
  const cfg = { rate_min_fen: 0, rate_max_fen: 50000 };
  assert.deepStrictEqual(readRateRange({ accept_rate_min_fen: 0, accept_rate_max_fen: 30000 }, cfg), [0, 30000]);
});
test('价格: min>max 异常数据自动对调', () => {
  assert.deepStrictEqual(readRateRange({ accept_rate_min_fen: 9000, accept_rate_max_fen: 4000 }, {}), [4000, 9000]);
});
test('价格: 单侧 null 不钳制另一侧', () => {
  assert.deepStrictEqual(readRateRange({ accept_rate_min_fen: 5000, accept_rate_max_fen: null }, {}), [5000, null]);
});
test('价格: 平台边界缺省 3000/10000', () => {
  assert.deepStrictEqual(readRateRange({ accept_rate_min_fen: 1000, accept_rate_max_fen: 99999 }, {}), [3000, 10000]);
});

// ── suspendLeftDays(断链②: 停用剩余天数; 仅拦新行为入口, 到期/缺值按 normal 放行) ──
const NOW = Date.UTC(2026, 9, 6, 12, 0);   // 固定 now, 保证取整判定精确
test('停用: 非 suspended / 空文档 一律 0', () => {
  assert.strictEqual(suspendLeftDays(null), 0);
  assert.strictEqual(suspendLeftDays({}), 0);
  assert.strictEqual(suspendLeftDays({ status: 'normal' }), 0);
  assert.strictEqual(suspendLeftDays({ status: 'frozen', suspend_until: NOW + DAY_MS }), 0);
  assert.strictEqual(suspendLeftDays({ status: 'banned', suspend_until: NOW + DAY_MS }), 0);
});
test('停用: 停用中向上取整, 最小 1 天', () => {
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: NOW + 7 * DAY_MS }, NOW), 7);
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: NOW + 6.5 * DAY_MS }, NOW), 7);
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: NOW + 1000 }, NOW), 1);
});
test('停用: 已到期 / 恰到期 / 缺 suspend_until / 非法值 → 0(按 normal 放行)', () => {
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: NOW - 1 }, NOW), 0);
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: NOW }, NOW), 0);
  assert.strictEqual(suspendLeftDays({ status: 'suspended' }, NOW), 0);
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: 'bad' }, NOW), 0);
});
test('停用: now 缺省用当前时间(不传第二个参数)', () => {
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: Date.now() + 2 * DAY_MS }), 2);
  assert.strictEqual(suspendLeftDays({ status: 'suspended', suspend_until: Date.now() - 1 }), 0);
});

// ── parseSlot(时段解析: 结构化 + 旧字符串格式) ──
test('parseSlot: 结构化 {start,end} 直读', () => {
  assert.deepStrictEqual(parseSlot({ start: 540, end: 1080, enabled: true }),
    { enabled: true, start: 540, end: 1080 });
});
test('parseSlot: 旧格式 {time:"09:00-18:00"} 折算分钟', () => {
  assert.deepStrictEqual(parseSlot({ time: '09:00-18:00', enabled: true }),
    { enabled: true, start: 540, end: 1080 });
});
test('parseSlot: enabled 缺省为 false', () => {
  assert.strictEqual(parseSlot({ start: 540, end: 1080 }).enabled, false);
});
test('parseSlot: 非法输入 → null(对象缺字段/乱串/非对象)', () => {
  assert.strictEqual(parseSlot({ foo: 1 }), null);
  assert.strictEqual(parseSlot({ time: 'abc' }), null);
  assert.strictEqual(parseSlot('09:00-18:00'), null);
  assert.strictEqual(parseSlot(null), null);
});

// ── rangeInSlot([from,to) ⊆ [s,e); s>e 跨夜槽) ──
test('rangeInSlot: 常规槽内含/越界', () => {
  assert.strictEqual(rangeInSlot(600, 900, 540, 1080), true);
  assert.strictEqual(rangeInSlot(500, 900, 540, 1080), false);
  assert.strictEqual(rangeInSlot(600, 1100, 540, 1080), false);
});
test('rangeInSlot: 边界 [from,to) 含头含尾(to 可等于 e)', () => {
  assert.strictEqual(rangeInSlot(540, 1080, 540, 1080), true);
});
test('rangeInSlot: 跨夜槽 s>e = [s,1440)∪[0,e)', () => {
  assert.strictEqual(rangeInSlot(1300, 1440, 1200, 120), true);  // 前半段
  assert.strictEqual(rangeInSlot(0, 60, 1200, 120), true);       // 后半段
  assert.strictEqual(rangeInSlot(600, 700, 1200, 120), false);   // 白天不在槽内
});

// ── slotCovers(每周时段覆盖判定) ──
const MON = { enabled: true, start: 540, end: 1080 };  // 周一 09:00-18:00
test('slotCovers: 未配置 weekly → 不限制', () => {
  assert.strictEqual(slotCovers(undefined, 0, 1), true);
  assert.strictEqual(slotCovers(null, 0, 1), true);
});
test('slotCovers: 全部未启用 → 不限制(兼容老数据)', () => {
  assert.strictEqual(slotCovers({ mon: { enabled: false, start: 540, end: 1080 } }, 0, 1), true);
});
test('slotCovers: 启用日之外的时段 → 拒绝', () => {
  // 2026-10-06 为周二, 只启用了周一槽
  assert.strictEqual(slotCovers({ mon: MON }, cst(10, 0), cst(12, 0)), false);
});
test('slotCovers: 落在启用槽内 → 通过', () => {
  // 2026-10-05 为周一, 10:00-12:00 ∈ 09:00-18:00
  assert.strictEqual(slotCovers({ mon: MON }, cstD(5, 10, 0), cstD(5, 12, 0)), true);
});
test('slotCovers: 起点在槽前 → 拒绝', () => {
  assert.strictEqual(slotCovers({ mon: MON }, cstD(5, 8, 0), cstD(5, 10, 0)), false);
});
test('slotCovers: 旧字符串格式槽同样生效', () => {
  assert.strictEqual(slotCovers({ mon: { time: '09:00-18:00', enabled: true } },
    cstD(5, 10, 0), cstD(5, 12, 0)), true);
});
test('slotCovers: 跨午夜服务需次日槽也覆盖(前半 Mon 槽 + 后半 Tue 槽)', () => {
  const weekly = {
    mon: { enabled: true, start: 1200, end: 120 },   // 周一 20:00-02:00 跨夜槽
    tue: { enabled: true, start: 0, end: 360 }        // 周二 00:00-06:00
  };
  // 周一 22:00 → 周二 01:00
  assert.strictEqual(slotCovers(weekly, cstD(5, 22, 0), cstD(6, 1, 0)), true);
});
test('slotCovers: 跨午夜但次日未启用 → 拒绝', () => {
  const weekly = { mon: { enabled: true, start: 1200, end: 120 } };
  assert.strictEqual(slotCovers(weekly, cstD(5, 22, 0), cstD(6, 1, 0)), false);
});

// ── haversineKm ──
test('haversineKm: 同点距离为 0', () => {
  assert.strictEqual(haversineKm(30.5728, 104.0668, 30.5728, 104.0668), 0);
});
test('haversineKm: 纬度 1° ≈ 111.2km', () => {
  const km = haversineKm(0, 0, 1, 0);
  assert.ok(km > 110 && km < 112.5, `km=${km}`);
});
test('haversineKm: 成都→重庆 ≈ 265-275km(业务城市口径)', () => {
  const km = haversineKm(30.5728, 104.0668, 29.5630, 106.5516);
  assert.ok(km > 260 && km < 280, `km=${km}`);
});
test('haversineKm: 北京→上海 ≈ 1067km(长距离口径)', () => {
  const km = haversineKm(39.9042, 116.4074, 31.2304, 121.4737);
  assert.ok(km > 1050 && km < 1085, `km=${km}`);
});
test('haversineKm: 对跖点不产生 NaN(数值稳定)', () => {
  const km = haversineKm(0, 0, 0, 180);
  assert.ok(Number.isFinite(km) && km > 20000 && km < 20016, `km=${km}`);
});

// ── 常量 ──
test('TAKE_MAX_DISTANCE_KM 默认 50 公里', () => {
  assert.strictEqual(TAKE_MAX_DISTANCE_KM, 50);
});
test('CN_OFFSET_MS = +8 小时(与注释口径一致)', () => {
  assert.strictEqual(CN_OFFSET_MS, 8 * 3600 * 1000);
});
