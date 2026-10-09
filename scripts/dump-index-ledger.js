#!/usr/bin/env node
// 从 cloudfunctions/init-db/index.js 提取 INDEXES 数组，输出 JSON（备份用索引设计台账）
// 用法: node scripts/dump-index-ledger.js [输出路径，默认 stdout]
// 注意: wx-server-sdk 无 listIndexes API，此台账=设计源头；云端实际索引需控制台比对。deploy-log 已记录部分
//       手工增量（如 demand.grab_notify_pending 复合索引）不在 INDEXES 内，请人工追加到 tools/ 台账或本输出后。
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../cloudfunctions/init-db/index.js');
const outPath = process.argv[2];

if (!fs.existsSync(SRC)) {
  console.error('SRC not found: ' + SRC);
  process.exit(1);
}
const src = fs.readFileSync(SRC, 'utf8');

// 抓 const INDEXES = [ ... ];
const m = src.match(/const INDEXES\s*=\s*(\[[\s\S]*?\n\]);/);
if (!m) {
  console.error('INDEXES array not found in ' + SRC);
  process.exit(1);
}

// 安全求值（索引定义均为字面量，无函数调用）
let arr;
try {
  arr = eval('(' + m[1] + ')');
} catch (e) {
  console.error('eval INDEXES failed: ' + e.message);
  process.exit(1);
}
if (!Array.isArray(arr)) {
  console.error('INDEXES is not an array');
  process.exit(1);
}

const payload = {
  source: SRC,
  exported_at: new Date().toISOString(),
  note: '设计级索引台账(init-db INDEXES)。wx-server-sdk 无 listIndexes，不能读取云端实际索引；部署/恢复时人工在控制台按此清单核对。',
  count: arr.length,
  indexes: arr,
};

const json = JSON.stringify(payload, null, 2);
if (outPath) {
  fs.writeFileSync(outPath, json, 'utf8');
  process.stdout.write('ok ' + arr.length + ' indexes -> ' + outPath + '\n');
} else {
  process.stdout.write(json + '\n');
}