// 弱网幂等审计脚本 (Node, 无云凭据依赖)
// 背景: 微信弱网最危险 = 请求发出但响应丢失 -> 用户重试 -> 同一语义请求被重复提交
//      这等价于对云函数"重放"同一请求。本脚本静态审计各写链路是否有幂等/防重保护。
//   重点对象:
//     - 发布 demand-publish `publish`: 若无可重放幂等键(client_request_id/查重) -> FAIL(弱网可能重复建需求)
//     - 接单 order-create `create_from_take`: CAS(where status=matching -> update status=matched, 判 updated===1) -> 天然幂等
// 运行: node .trae/scripts/weaknet-idempotency-check.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';

function analyze(name, file, guards, isPublish) {
  const src = read(path.join(ROOT, file));
  if (!src) return { fn: name, status: 'SKIP', reason: '文件不存在', guards };
  const hit = guards.map((g) => ({ g, found: src.includes(g) })).filter((x) => x.found).map((x) => x.g);
  const cas = /updated\s*[=!]=?=?[^;{]*1|stats\.updated/.test(src);
  if (isPublish) {
    // 发布若既无 client_request_id 去重、也无"同 key 查重后再写"的幂等保护 -> FAIL
    const idem = hit.length > 0 || /client_request_id|request_id|dedup|endpoint.*hash/.test(src);
    return { fn: name, status: idem ? 'PASS' : 'FAIL', reason: idem ? '存在幂等保护' : '无幂等键/查重, 弱网重试可能重复建需求', guards: hit };
  }
  // 接单: CAS 是关键
  if (cas) return { fn: name, status: 'PASS', reason: 'CAS(status:matching->matched, 判updated===1)', guards: hit };
  return { fn: name, status: hit.length ? 'CHECK' : 'FAIL', reason: hit.length ? '有显式防重语义, 人工复核' : '未发现 CAS/防重, 弱网重试可能重复建单', guards: hit };
}

const results = [
  analyze('发布 demand-publish.publish', 'cloudfunctions/demand-publish/index.js',
    ['client_request_id', 'request_no'], true),
  analyze('接单 order-create.create_from_take', 'cloudfunctions/order-create/index.js',
    ['client_request_id', 'request_no'], false),
];

console.log('=== 弱网幂等审计 ===');
let fail = 0;
for (const r of results) {
  const icon = r.status === 'PASS' ? '[OK]   ' : r.status === 'FAIL' ? '[FAIL] ' : r.status === 'CHECK' ? '[CHECK]' : '[SKIP] ';
  console.log(`${icon} ${r.fn}`);
  console.log(`       原因: ${r.reason}`);
  if (r.guards.length) console.log(`       命中防重标记: ${r.guards.join(', ')}`);
  if (r.status === 'FAIL') fail++;
}
console.log('=================');
if (fail > 0) {
  console.log(`结论: ${fail} 项存在弱网重复写风险. 建议给发布链路补幂等键(draft_id+client_request_id 查重)后重测.`);
  process.exit(2);
} else {
  console.log('结论: 写链路均有幂等/CAS 保护, 弱网重放不产生脏数据.');
  process.exit(0);
}