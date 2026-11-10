// 配置默认值一致性门禁（2026-11-05，负债 N-3）
// 规范源：cloudfunctions/_shared/config_defaults.json
// 校验：①云函数副本（order-action / admin-action / order-timer）逐字段一致；②前端 config/index.js 的 MODIFY / S2_CHANGE 兜底一致
const fs = require('fs');
const path = require('path');

const root = process.env.RULES_ROOT ? path.resolve(process.env.RULES_ROOT) : path.resolve(__dirname, '..');
const canon = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions/_shared/config_defaults.json'), 'utf8'));

let fails = 0;
const bad = (msg) => { fails++; console.error('FAIL ' + msg); };

// 1) 云函数副本：应与规范源同源（只比较默认值常量的键值）
const COPIES = ['order-action', 'admin-action', 'order-timer'];
for (const d of COPIES) {
  const p = path.join(root, 'cloudfunctions', d, 'config_defaults.json');
  if (!fs.existsSync(p)) { bad(`[${d}] 缺少 config_defaults.json（先跑 sync-config-defaults.ps1）`); continue; }
  let c;
  try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { bad(`[${d}] JSON 解析失败: ${e.message}`); continue; }
  for (const grp of ['MODIFY_DEFAULTS', 'S2_CHANGE_DEFAULTS']) {
    for (const k of Object.keys(canon[grp])) {
      if (c[grp] && c[grp][k] !== canon[grp][k]) bad(`[${d}] ${grp}.${k} 副本=${c[grp][k]} 规范=${canon[grp][k]}`);
    }
  }
  console.log(`OK   [${d}] 默认值与规范源一致`);
}

// 2) 前端兜底：config/index.js 的 MODIFY / S2_CHANGE
let FE;
try { FE = require(path.join(root, 'miniprogram/config/index.js')); } catch (e) { bad(`[前端] config/index.js 载入失败: ${e.message}`); }
if (FE) {
  const m = FE.MODIFY || {};
  const md = canon.MODIFY_DEFAULTS;
  ['minLeadHours', 'maxTimes', 'maxSpanH', 'confirmMinutes'].forEach((k) => {
    if (m[k] !== md[k]) bad(`[前端] MODIFY.${k}=${m[k]} 规范=${md[k]}`);
  });
  const s = FE.S2_CHANGE || {};
  const sd = canon.S2_CHANGE_DEFAULTS;
  [['enabled', 'enabled'], ['bMinHours', 'bMinHours'], ['aMinHours', 'aMinHours'], ['aConfirmMin', 'aConfirmMin'], ['bConfirmMin', 'bConfirmMin'], ['perFieldMax', 'perFieldMax'], ['totalMax', 'totalMax']].forEach((p) => {
    const fe = s[p[0]];
    const want = sd[p[1]];
    // enabled 前端为布尔，规范源为 0/1
    const ok = p[0] === 'enabled' ? (!!fe === !!want) : fe === want;
    if (!ok) bad(`[前端] S2_CHANGE.${p[0]}=${fe} 规范=${want}`);
  });
  if (!fails) console.log('OK   [前端] MODIFY / S2_CHANGE 与规范源一致');
}

if (fails) { console.error(`\nCONFIG DEFAULTS FAILED: ${fails} 处不一致`); process.exit(1); }
console.log('CONFIG DEFAULTS OK: canonical + 3 云函数副本 + 前端兜底一致');
