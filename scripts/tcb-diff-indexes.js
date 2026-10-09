// 索引差异分析(2026-10-09): 设计台账(index_ledger.json) vs 云端实际(indexes-actual.json)
// 输出: ①缺失/不一致清单(stdout) ②可直接执行的建索引命令 create-missing.json(喂 scripts/tcb-exec.js)
// 用法: node scripts/tcb-diff-indexes.js [index_ledger.json] [indexes-actual.json] [输出cmd.json]
//   默认读取 .tmp-tcb/ 下三文件; 台账可用 node scripts/dump-index-ledger.js .tmp-tcb/index_ledger.json 生成
const fs = require('fs');
const path = require('path');

const ledgerFile = process.argv[2] || path.join(__dirname, '..', '.tmp-tcb', 'index_ledger.json');
const actualFile = process.argv[3] || path.join(__dirname, '..', '.tmp-tcb', 'indexes-actual.json');
const outCmdFile = process.argv[4] || path.join(__dirname, '..', '.tmp-tcb', 'create-missing.json');

const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
const actual = JSON.parse(fs.readFileSync(actualFile, 'utf8'));
const designIndexes = Array.isArray(ledger.indexes) ? ledger.indexes : [];

function normKey(keyObj) {
  return Object.entries(keyObj || {}).map(([k, v]) => k + ':' + (v && v.$numberInt ? v.$numberInt : v)).join(',');
}

const actualMap = {};
for (const [col, arr] of Object.entries(actual)) {
  actualMap[col] = (Array.isArray(arr) ? arr : []).filter((x) => x && x.name);
}

const missing = [];
const present = [];
for (const di of designIndexes) {
  const col = di.coll;
  const keyStr = normKey(di.keys);
  const list = actualMap[col];
  if (!list) { missing.push(Object.assign({}, di, { reason: '集合不存在(幽灵集合,跳过)' })); continue; }
  const hit = list.find((x) => x.name === di.name && normKey(x.key) === keyStr);
  const nameOnly = list.find((x) => x.name === di.name);
  if (hit) present.push(di);
  else if (nameOnly) missing.push(Object.assign({}, di, { reason: '同名不同键' }));
  else missing.push(Object.assign({}, di, { reason: '未建' }));
}

console.log('===== 设计索引核对 =====');
console.log(`设计 ${designIndexes.length} 条 | 已建 ${present.length} 条 | 缺失 ${missing.length} 条`);
for (const m of missing) {
  console.log(`[缺失] ${m.coll} | ${m.name} | ${normKey(m.keys)}${m.unique ? ' | UNIQUE' : ''} | ${m.reason}`);
}

const cmds = [];
for (const m of missing) {
  if (m.reason.indexOf('幽灵') >= 0) continue;
  const keys = {};
  for (const [k, v] of Object.entries(m.keys)) keys[k] = (v && v.$numberInt ? Number(v.$numberInt) : v);
  const idxDef = { key: keys, name: m.name, background: true };
  if (m.unique) idxDef.unique = true;
  cmds.push({ TableName: m.coll, CommandType: 'COMMAND', Command: JSON.stringify({ createIndexes: m.coll, indexes: [idxDef] }) });
}
fs.writeFileSync(outCmdFile, JSON.stringify(cmds, null, 2));
console.log(`\n建索引命令已生成: ${outCmdFile} (共 ${cmds.length} 条, 已跳过幽灵集合)`);
console.log(`执行: node scripts/tcb-exec.js "${outCmdFile}"`);