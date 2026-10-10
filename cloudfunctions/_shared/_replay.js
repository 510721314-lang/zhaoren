// 等价性重放工具：拆分前录制 (event→result) 基线，拆分后重放比对，证明字节级等价。
// 用法见 tests/entry/ 下的录制与重放脚本。纯测试基建，不进入运行时。
const fs = require('fs');
const path = require('path');

function stableStringify(v) {
  // 归一化：把不确定字段（Date.now() 生成的时间戳、随机单号）剔除以保证可重放比对
  // 策略：对结果深拷贝，删除/置零已知非确定键；调用方也可提供 normalize。
  return JSON.stringify(v, (k, val) => {
    if (typeof val === 'string' && /^(WD|ORD|TX)[0-9a-f]+$/i.test(val)) return '<NOISE>';
    return val;
  });
}

function record(baselinePath, cases) {
  // cases: [{ name, buildSdk, event }]  → 跑 main，存 result
  const data = {};
  for (const c of cases) {
    data[c.name] = { event: c.event, result: c.run() };
  }
  fs.writeFileSync(baselinePath, JSON.stringify(data, null, 2));
  return data;
}

function replay(baselinePath, cases) {
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const diffs = [];
  for (const c of cases) {
    const b = base[c.name];
    if (!b) { diffs.push({ name: c.name, err: '基线缺失' }); continue; }
    const got = c.run();
    if (stableStringify(got) !== stableStringify(b.result)) {
      diffs.push({ name: c.name, expected: b.result, actual: got });
    }
  }
  return diffs;
}

module.exports = { record, replay, stableStringify };
