// scripts/check-shared-sync.js · 校验 _shared 规范源与各云函数本地副本 SHA-256 一致(防漂移)
// 微信云函数按单目录打包, 共享逻辑以「规范源 + sync 脚本复制」维护; 任何一侧漏同步即在此拦截。
// 运行: node scripts/check-shared-sync.js (CI / 本地均可; 回归门禁之一)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const SH = path.join(CF, '_shared');
const SYNC_MAP = {
  'take_rules.js': ['order-create', 'demand-publish', 'order-action', 'home-action', 'partner-apply', 'partner-action'],
  'money_rules.js': ['payment-mock', 'order-create', 'order-action'],
  'test_data.js': ['demand-publish', 'order-create', 'admin-action', 'init-db'],
  'partner_audit.js': ['partner-action', 'admin-action'],
  'no_show_rules.js': ['order-action', 'admin-action'],
  'order_state.js': ['order-action', 'order-timer'],
  'urge_rules.js': ['order-timer', 'order-action'],
  'credit_rules.js': ['evaluation-submit', 'order-timer'],
  // 场景中文名兜底映射(批3.1 单一源): 此前 8 处手抄副本, 收敛为一份常量 + 各函数副本
  'scene_meta.js': ['payment-mock', 'im-send', 'im-conv', 'demand-publish', 'order-action', 'admin-action', 'home-action'],
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
  // 密码/身份安全策略纯函数(2026-10-13 纳入): 密码登录防爆破锁定 + 紧急联系人冷却 + bootstrap CAS
  'security_policy.js': ['user-login', 'init-db', 'admin-action'],
  // openid.js(安全关键, fail-closed 环境门控): 2026-10-13 收敛为全量 17 个业务函数同源;
  //   原 admin-action 超集的网关密钥校验已上移其 index.js 包装层, init-db 变体已废弃合并
  'openid.js': [
    'blog-action', 'demand-match', 'demand-publish', 'evaluation-submit', 'home-action',
    'im-conv', 'im-send', 'order-action', 'order-create', 'order-timer',
    'partner-action', 'partner-apply', 'payment-mock', 'safety-report', 'user-login',
    'admin-action', 'init-db'
  ],
  // 补登记(2026-10-19, M1): canonical _shared/heal.js 含 healAuditLock(审核死锁治愈), partner-action 副本一致;
  // demand-match/order-create 为旧版副本(缺该函数) → 依 §10「只登记不手修」登记 KNOWN_DRIFT
  'heal.js': ['partner-action', 'demand-match', 'order-create'],
  // 题库单一规范源(2026-10-19 P2-5 重做): partner-action + admin-action 各持本地副本, require('./exam-fallback')
  'exam-fallback.js': ['partner-action', 'admin-action']
};

// KNOWN_DRIFT(2026-10-19): 已登记的「既有漂移」, 依 §10「只登记不手修」处理——
// 非阻断(不把回归门禁长期置红), 但每次运行都显式打印并计入 owed 统计, 避免静默遗漏; 修复须单独授权+同步+重新部署。
const KNOWN_DRIFT = {
  'heal.js': ['demand-match', 'order-create']
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let fail = 0;
let owed = 0;
for (const [name, dirs] of Object.entries(SYNC_MAP)) {
  const src = path.join(SH, name);
  const known = KNOWN_DRIFT[name] || [];
  if (!fs.existsSync(src)) { console.error(`[MISS] canonical _shared/${name}`); fail++; continue; }
  const h1 = sha(src);
  for (const d of dirs) {
    const dst = path.join(CF, d, name);
    if (!fs.existsSync(dst)) {
      if (known.includes(d)) { console.warn(`[KNOWN-DRIFT] ${d}/${name} missing (已登记, 待专项修复)`); owed++; continue; }
      console.error(`[MISS] ${d}/${name}`); fail++; continue;
    }
    const h2 = sha(dst);
    if (h1 !== h2) {
      if (known.includes(d)) { console.warn(`[KNOWN-DRIFT] ${d}/${name} differs (已登记, 待专项修复)`); owed++; continue; }
      console.error(`[DRIFT] ${d}/${name} differs from _shared/${name} (run sync-*.ps1)`); fail++;
    } else console.log(`[OK] ${d}/${name}`);
  }
}
// ── M1(2026-10-19): 自动发现「未登记的共享模块」, 堵住 fail-open ──
// 事故教训: 原实现只遍历 SYNC_MAP 已登记项 → 新增 _shared/*.js 时若漏登记, 校验静默通过,
// 跨目录 require 便一路绿灯上线并在云端 MODULE_NOT_FOUND 崩溃。此处改为 fail-closed 自动发现。
// 判定口径: _shared/*.js 只要在任一函数目录存在同名副本, 即视为「已部署共享模块」, 必须登记 SYNC_MAP;
//           无任何副本的文件 = 单测/mock/工具(release 不部署), 天然跳过 —— 无需手工排除清单。
const registered = new Set(Object.keys(SYNC_MAP));
const fnDirs = fs.readdirSync(CF).filter((d) => {
  const p = path.join(CF, d);
  return fs.statSync(p).isDirectory() && d !== '_shared' && fs.existsSync(path.join(p, 'index.js'));
});
for (const f of fs.readdirSync(SH)) {
  if (!f.endsWith('.js') || registered.has(f)) continue;
  const consumers = fnDirs.filter((d) => fs.existsSync(path.join(CF, d, f)));
  if (consumers.length > 0) {
    console.error(`[UNREGISTERED] _shared/${f} 已被 ${consumers.join(', ')} 引用, 但未登记 SYNC_MAP (登记 + 建 sync-*.ps1 + 复制本地副本)`);
    fail++;
  }
}

if (owed) console.warn(`KNOWN-DRIFT (owed, non-blocking): ${owed} entr(ies) — 待专项修复(§10 只登记不手修)`);
if (fail) { console.error(`SHARED SYNC CHECK FAILED: ${fail} problem(s)`); process.exit(1); }
console.log('SHARED SYNC ALL OK');
