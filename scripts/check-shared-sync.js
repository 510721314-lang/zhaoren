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
  'partner_audit.js': ['partner-action', 'admin-action'],
  'no_show_rules.js': ['order-action', 'admin-action'],
  'order_state.js': ['order-action', 'order-timer'],
  'urge_rules.js': ['order-timer', 'order-action'],
  'credit_rules.js': ['evaluation-submit', 'order-timer'],
  // 手机号加密存储 + 确定性查询键(P0-3 整改): user-login 写入/查询, demand-publish/admin-action 读取真号
  'phone_crypt.js': ['user-login', 'demand-publish', 'admin-action'],
  // 日志/审计留痕(P1 整改): 此前为「各函数自包含副本」零漂移校验, 现纳入规范源统一守护
  'logger.js': [
    'admin-action', 'blog-action', 'demand-match', 'demand-publish', 'evaluation-submit', 'home-action',
    'im-conv', 'im-send', 'order-action', 'order-create', 'order-timer',
    'partner-action', 'partner-apply', 'payment-mock', 'safety-report', 'user-login'
  ],
  'audit.js': [
    'admin-action', 'blog-action', 'demand-publish', 'evaluation-submit', 'im-send',
    'order-action', 'order-create', 'partner-action', 'payment-mock', 'safety-report', 'user-login'
  ],
  // openid.js(安全关键, fail-closed 环境门控): 15 个函数共用规范源; 以下有意变体**显式排除**、不参与同步:
  //   admin-action(超集: 含 admin-web 网关密钥校验) / init-db(独立变体)
  'openid.js': [
    'blog-action', 'demand-match', 'demand-publish', 'evaluation-submit', 'home-action',
    'im-conv', 'im-send', 'order-action', 'order-create', 'order-timer',
    'partner-action', 'partner-apply', 'payment-mock', 'safety-report', 'user-login'
  ]
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
