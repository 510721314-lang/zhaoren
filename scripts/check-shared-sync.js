// scripts/check-shared-sync.js · 校验 _shared 规范源与各云函数本地副本 SHA-256 一致(防漂移)
// 微信云函数按单目录打包, 共享逻辑以「规范源 + sync 脚本复制」维护; 任何一侧漏同步即在此拦截。
// 运行: node scripts/check-shared-sync.js (CI / 本地均可; 回归门禁之一)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { detect: detectRenamedCopies } = require('./shared-copy-detect');

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
  // 手机号加密存储 + 确定性查询键(P0-3 整改): user-login 写入/查询, demand-publish/admin-action 读取真号,
  // safety-report 2026-11-10 补登记(此前 sync 脚本已含该目标但门禁漏登记 → 副本漂移永不报警)
  'phone_crypt.js': ['user-login', 'demand-publish', 'admin-action', 'safety-report'],
  // 日志/审计留痕(P1 整改): 此前为「各函数自包含副本」零漂移校验, 现纳入规范源统一守护
  'logger.js': [
    'admin-action', 'blog-action', 'demand-match', 'demand-publish', 'evaluation-submit', 'home-action',
    'im-conv', 'im-send', 'order-action', 'order-create', 'order-timer',
    'partner-action', 'partner-apply', 'payment-mock', 'safety-report', 'user-login'
  ],
  'audit.js': [
    'admin-action', 'blog-action', 'demand-publish', 'evaluation-submit', 'im-send',
    'order-action', 'order-create', 'partner-action', 'payment-mock', 'safety-report', 'user-login',
    'admin-web',
    // #4 全修(2026-11-14): generate_admin_web_key 补审计留痕, init-db 引入规范源副本(与 sync-audit.ps1 $dirs 同步登记)
    'init-db'
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
  'admin-login.js': ['admin-action', 'admin-web'],
  // admin_config 进程内缓存(2026-10-28 用量治理): 规范源 → 4 个高频读配置函数副本;
  //   消除「每次调用读 1 次 admin_config」(实测占 DB 请求 23.6%); 修改后跑 sync-config-cache.ps1
  'config_cache.js': ['order-action', 'order-timer', 'user-login', 'partner-action'],
  // 2026-11-05 N-3: 改期/S2 变更规则默认值唯一规范源，副本经 sync-config-defaults.ps1 同步
  'config_defaults.js': ['order-action', 'admin-action', 'order-timer'],
  'config_defaults.json': ['order-action', 'admin-action', 'order-timer'],
  // 订阅消息统一封装(2026-11-02 方案A): 授权/发送计数状态 + 唯一 send 入口;
  //   消费方 order-action(催办/沟通) / order-timer(抢单) / partner-action(授权计数)
  // 方案E(2026-11-14): payment-mock 支付成功发送「支付提醒」, 副本纳入同源守护
  'sub_msg.js': ['order-action', 'order-timer', 'partner-action', 'payment-mock']
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

// KNOWN_RENAMED(2026-11-02 P2-6 F5 收尾): 「改名副本」显式豁免表, 键为 `函数目录/相对路径`。
// 空表即「零豁免」; 如确需保留改名副本, 必须在此登记并写理由, 否则按 FAIL 拦截。
const KNOWN_RENAMED = {};

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

// ── F5(2026-11-02 P2-6 收尾): 「改名副本」盲区 —— M1/M2 只认同名文件 ──
// _shared/foo.js 被复制成 a/foo_v2.js 时 M1 判 0 消费方、SYNC_MAP 也无需登记, 副本漂移从此静默;
// 此处按内容 SHA 递归比对函数目录(含子目录), 与 _shared 某文件字节相同但路径不同即拦截。
const renamedHits = detectRenamedCopies(SH, CF, fnDirs);
for (const hit of renamedHits) {
  const key = `${hit.dir}/${hit.file}`;
  const known = KNOWN_RENAMED[key];
  if (known) { console.warn(`[RENAMED-COPY-KNOWN] ${key} ≡ _shared/${hit.canonical} (${known})`); continue; }
  console.error(`[RENAMED-COPY] ${key} 与 _shared/${hit.canonical} 内容完全相同但路径不同 → 改名副本未登记(改回同名副本 + SYNC_MAP, 或登记 KNOWN_RENAMED)`);
  fail++;
}
if (renamedHits.length === 0) console.log('[OK] 无改名副本(内容级扫描)');

// ── F8(2026-11-03 技术评审 B1): 「改名 + 内容漂移」双重逃逸 ──
// M1 只认「同名未登记」, F5 只认「与规范源字节完全相同的改名副本」; 若副本改名且内容也漂移, 两者同时不命中 → 静默漂移。
// 判据: 函数目录内任意 .js, 其 module.exports 顶层导出集合 ⊆ _shared/<某规范源> 的导出集合, 且非该规范源的同名副本、内容也不与之字节相同 → 疑似改名副本。
// 摸底(2026-11-03): 20 个函数目录 228 个 .js 全量扫描命中 0 条, 故按阻断处理; 确需保留请登记 KNOWN_RENAMED(键 `函数目录/相对路径`)。
function walkJs(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules') continue;
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walkJs(p, out);
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}
let copySuspects = 0;
for (const d of fnDirs) {
  for (const f of walkJs(path.join(CF, d))) {
    const base = path.basename(f);
    if (registered.has(base) || base === '_orig_baseline.js') continue; // 同名副本由 SYNC_MAP 校验; 基线快照非运行代码
    const keys = exportKeys(f);
    if (!keys || keys.size === 0) continue;
    const rel = `${d}/${path.relative(path.join(CF, d), f).replace(/\\/g, '/')}`;
    const hit = [...registered].find((cn) => {
      const ck = exportKeys(path.join(SH, cn));
      if (!ck || ck.size === 0) return false;
      if ([...keys].every((k) => ck.has(k))) return sha(f) !== sha(path.join(SH, cn)); // 字节相同 → 已由 F5 拦截
      return false;
    });
    if (!hit) continue;
    copySuspects++;
    const known = KNOWN_RENAMED[rel];
    if (known) { console.warn(`[COPY-SUSPECT-KNOWN] ${rel} ⊆ _shared/${hit} (${known})`); continue; }
    console.error(`[COPY-SUSPECT] ${rel} 导出集合 ⊆ _shared/${hit} 但文件名与内容均不同 → 疑似改名副本漂移(改回同名副本 + SYNC_MAP, 或登记 KNOWN_RENAMED)`);
    fail++;
  }
}
if (!copySuspects) console.log('[OK] 无「改名+漂移」疑似副本');

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
