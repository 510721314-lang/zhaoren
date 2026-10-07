// scripts/check-shared-sync.js · 校验 _shared 规范源与各云函数本地副本 SHA-256 一致(防漂移)
// 微信云函数按单目录打包, 共享逻辑以「规范源 + sync 脚本复制」维护; 任何一侧漏同步即在此拦截。
// 运行: node scripts/check-shared-sync.js (CI / 本地均可; 回归门禁之一)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SYNC_MAP = {
  'take_rules.js': ['order-create', 'demand-publish', 'order-action', 'home-action', 'partner-apply', 'partner-action'],
  'money_rules.js': ['payment-mock', 'order-create', 'order-action'],
  'test_data.js': ['demand-publish', 'order-create', 'admin-action', 'init-db'],
  'partner_audit.js': ['partner-action', 'admin-action']
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let fail = 0;
for (const [name, dirs] of Object.entries(SYNC_MAP)) {
  const src = path.join(ROOT, 'cloudfunctions', '_shared', name);
  if (!fs.existsSync(src)) { console.error(`[MISS] canonical _shared/${name}`); fail++; continue; }
  const h1 = sha(src);
  for (const d of dirs) {
    const dst = path.join(ROOT, 'cloudfunctions', d, name);
    if (!fs.existsSync(dst)) { console.error(`[MISS] ${d}/${name}`); fail++; continue; }
    const h2 = sha(dst);
    if (h1 !== h2) { console.error(`[DRIFT] ${d}/${name} differs from _shared/${name} (run sync-*.ps1)`); fail++; }
    else console.log(`[OK] ${d}/${name}`);
  }
}
if (fail) { console.error(`SHARED SYNC CHECK FAILED: ${fail} problem(s)`); process.exit(1); }
console.log('SHARED SYNC ALL OK');
