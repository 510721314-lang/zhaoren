#!/usr/bin/env node
// 守门脚本：用真实 mock SDK 逐个调用每个 action 过 index.js，断言「0 抛错」。
// 漏注入 / 缺 ctx 符号会在真实执行路径抛 ReferenceError（如之前 audit_init 的 col().count），
// 此处即捕获并报告。退出码 0=干净，非 0=有问题。
// 用法：node scripts/check-handlers.js
const path = require('path');
const Module = require('module');
const fs = require('fs');
const { makeSdk } = require(path.join(__dirname, '..', 'cloudfunctions', '_shared', '_mock_sdk'));

const ROOT = path.join(__dirname, '..');
const USER = 'o_user_1', PARTNER = 'o_partner_1', ADMIN = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
const OID = 'a'.repeat(32);
const clog = console.log; console.log = () => {}; // 静音 handler 内部日志

const baseStore = () => ({
  admin_config: { global: { env: 'dev' } },
  order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER, start_time: Date.now() - 60000, urge_count: 0 } },
  system_notice: {}, user_account: {}, demand: {},
});
const adminStore = () => ({
  admin_config: { global: { env: 'dev', admin_openids: [ADMIN] } },
  order_main: { [OID]: { _id: OID, order_no: 'ORD-TEST', status: 'S10', user_openid: USER, partner_openid: PARTNER } },
  platform_event: {}, config_history: {}, audit_log: {},
});

function loadMain(dir, sdk) {
  const full = path.join(ROOT, 'cloudfunctions', dir, 'index.js');
  const orig = Module._load;
  Module._load = function (r) { if (r === 'wx-server-sdk') return sdk; return orig.apply(this, arguments); };
  try { delete require.cache[require.resolve(full)]; return require(full); }
  finally { Module._load = orig; }
}
function enumActions(dir) {
  const out = [];
  const ad = path.join(ROOT, 'cloudfunctions', dir);
  for (const f of fs.readdirSync(ad).filter((x) => /^action_.*\.js$/.test(x))) {
    let m;
    try { delete require.cache[require.resolve(path.join(ad, f))]; m = require(path.join(ad, f)); } catch { continue; }
    for (const k of Object.keys(m)) if (typeof m[k] === 'function') out.push(k);
  }
  return out;
}

(async () => {
  const groups = [
    { dir: 'order-action', openid: USER, store: baseStore() },
    { dir: 'admin-action', openid: ADMIN, store: adminStore() },
  ];
  let fails = 0, total = 0;
  for (const g of groups) {
    for (const a of enumActions(g.dir)) {
      total++;
      const m = loadMain(g.dir, makeSdk({ openid: g.openid, store: JSON.parse(JSON.stringify(g.store)) }));
      try {
        await m.main({ action: a, order_id: OID, mock_openid: g.openid, page: 1, size: 5, limit: 20 }, {});
      } catch (e) {
        fails++;
        console.log = clog;
        console.log(`THROW ${g.dir} :: ${a} -> ${String((e && e.message) || e).split('\n')[0]}`);
        console.log = () => {};
      }
    }
  }
  console.log = clog;
  if (fails === 0) {
    console.log(`HANDLER-RUNTIME OK: ${total} actions invoked with no throw (no missing ctx injection)`);
    process.exit(0);
  } else {
    console.log(`HANDLER-RUNTIME FAIL: ${fails} throw(s) across ${total} actions`);
    process.exit(1);
  }
})();
