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
  // G3 超时前提醒纯规则(S2_6/S3_6 窗口内 2 次, 2026-10-20): 规范源 → order-timer 本地副本
  'timeout_remind_rules.js': ['order-timer'],
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
    'order-action', 'order-create', 'partner-action', 'payment-mock', 'safety-report', 'user-login',
    'admin-web'
  ],
  // 密码/身份安全策略纯函数(2026-10-13 纳入): 密码登录防爆破锁定 + 紧急联系人冷却 + bootstrap CAS
  'security_policy.js': ['user-login', 'init-db', 'admin-action', 'admin-web'],
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
  // 题库兜底已在 S4 退役(2026-10-26)：题目 SSOT = questions 集合，exam_bank 仅保留科目 meta
  // 证书派生状态机/门禁单一规范源(2026-10-26 S2): partner-apply/order-create 做门禁, partner-action 发证;
  // S5 建 exam-action 后再加该消费方(同步改 sync-cert-state.ps1)
  'cert_state.js': ['partner-apply', 'order-create', 'partner-action'],
  // admin 登录单一规范源(2026-10-19 P2-6 重做): admin-web 本地直调(消除双冷启动 504) + admin-action 前置组;
  // 本模块内部 require('./security_policy') -> 两消费方均需 security_policy.js 副本(见上一项)
  'admin-login.js': ['admin-action', 'admin-web']
};

// KNOWN_DRIFT(2026-10-19): 已登记的「既有漂移」, 依 §10「只登记不手修」处理——
// 非阻断(不把回归门禁长期置红), 但每次运行都显式打印并计入 owed 统计, 避免静默遗漏; 修复须单独授权+同步+重新部署。
// F6 加固(2026-10-19): 每项豁免必须声明「期望的漂移性质」(occurrence + kind), 运行时逐项断言——
//   断言不成立即 hard fail, 堵住「登记后永久静默豁免」与「漂移已修复但登记未撤」两种失真(§22 G3)。
const KNOWN_DRIFT = {
  // occurrence: 'differs' = 期望副本存在且与规范源内容不同(漂移实际存在)
  // kind: 'subset-of-canonical' = 副本导出为规范源导出的严格子集(即旧版缺规范源新增的导出), 断言不硬编码具体函数名
  'heal.js': [
    { dir: 'demand-match', occurrence: 'differs', kind: 'subset-of-canonical' },
    { dir: 'order-create', occurrence: 'differs', kind: 'subset-of-canonical' }
  ]
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let fail = 0;
let owed = 0;
for (const [name, dirs] of Object.entries(SYNC_MAP)) {
  const src = path.join(SH, name);
  const known = (KNOWN_DRIFT[name] || []).map((e) => e && e.dir);
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
// 判定口径: _shared/* 只要在任一函数目录存在同名副本, 即视为「已部署共享资源」, 必须登记 SYNC_MAP;
//           无任何副本的文件 = 单测/mock/工具/README(sync 脚本本身), 天然跳过 —— 无需手工排除清单。
// F7 扩面(2026-10-19): 由「仅 .js」扩为「任意文件」——非 .js 共享资源(_shared/*.json 等)同样可能被复制进函数目录, 一并有守护。
const registered = new Set(Object.keys(SYNC_MAP));
const fnDirs = fs.readdirSync(CF).filter((d) => {
  const p = path.join(CF, d);
  return fs.statSync(p).isDirectory() && d !== '_shared' && fs.existsSync(path.join(p, 'index.js'));
});
for (const f of fs.readdirSync(SH)) {
  if (registered.has(f)) continue;
  const consumers = fnDirs.filter((d) => fs.existsSync(path.join(CF, d, f)));
  if (consumers.length > 0) {
    console.error(`[UNREGISTERED] _shared/${f} 已被 ${consumers.join(', ')} 引用, 但未登记 SYNC_MAP (登记 + 建 sync-*.ps1 + 复制本地副本)`);
    fail++;
  }
}

// ── F6(2026-10-19): KNOWN_DRIFT 逐项「漂移性质」断言 —— 豁免不是永久保护 ──
// 提取 module.exports 顶层导出标识符集合(浅层解析, 覆盖 { a, b } 与 { a: x } 两种写法)
function exportKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = src.lastIndexOf('module.exports');
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return new Set();
  let depth = 0;
  let close = -1;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { close = k; break; } }
  }
  if (close < 0) return null;
  const keys = new Set();
  const push = (s) => {
    const t = s.trim();
    if (!t) return;
    const m = t.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (m) keys.add(m[1]);
  };
  let d = 0;
  let cur = '';
  for (const c of src.slice(open + 1, close)) {
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    if (c === ',' && d === 0) { push(cur); cur = ''; continue; }
    cur += c;
  }
  push(cur);
  return keys;
}

let asserted = 0;
for (const [name, entries] of Object.entries(KNOWN_DRIFT)) {
  const src = path.join(SH, name);
  for (const e of entries) {
    if (!e || !e.dir || !e.kind || !e.occurrence) {
      console.error(`[KNOWN-DRIFT-ASSERT] ${name}: 豁免项缺少 dir/kind/occurrence 声明 → 拒绝静默豁免`);
      fail++;
      continue;
    }
    const dst = path.join(CF, e.dir, name);
    const exists = fs.existsSync(dst);
    const same = exists && fs.existsSync(src) && sha(src) === sha(dst);
    const actual = exists ? (same ? 'identical' : 'differs') : 'missing';
    const tag = `${e.dir}/${name}`;
    if (actual !== e.occurrence) {
      console.error(`[KNOWN-DRIFT-ASSERT] ${tag} 实际=${actual} 期望=${e.occurrence} → 登记失真(漂移已修复或性质变化, 请撤/改 KNOWN_DRIFT)`);
      fail++;
      continue;
    }
    if (e.kind === 'subset-of-canonical') {
      const ck = exportKeys(src);
      const dk = exportKeys(dst);
      if (!ck || !dk) {
        console.error(`[KNOWN-DRIFT-ASSERT] ${tag} 无法解析 module.exports → 断言不成立`);
        fail++;
        continue;
      }
      const extra = [...dk].filter((k) => !ck.has(k));
      if (extra.length || ck.size <= dk.size) {
        console.error(`[KNOWN-DRIFT-ASSERT] ${tag} 不满足「严格子集」性质 (副本多出: [${extra.join(', ')}] / 规范源 ${ck.size} ≤ 副本 ${dk.size})`);
        fail++;
        continue;
      }
      console.log(`[KNOWN-DRIFT-OK] ${tag} kind=subset-of-canonical (副本导出 ${dk.size} ⊆ 规范源 ${ck.size})`);
      asserted++;
      continue;
    }
    console.error(`[KNOWN-DRIFT-ASSERT] ${tag} 未知 kind='${e.kind}' → 拒绝静默豁免`);
    fail++;
  }
}

if (asserted) console.log(`KNOWN-DRIFT 漂移性质断言通过: ${asserted} 项`);
if (owed) console.warn(`KNOWN-DRIFT (owed, non-blocking): ${owed} entr(ies) — 待专项修复(§10 只登记不手修)`);
if (fail) { console.error(`SHARED SYNC CHECK FAILED: ${fail} problem(s)`); process.exit(1); }
console.log('SHARED SYNC ALL OK');
