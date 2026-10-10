// A/B 等价性比对：拆分前(_orig_baseline.js) vs 当前(index.js)，同输入深比较。
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1', PARTNER = 'o_partner_1', STRANGER = 'o_stranger';
const OID = 'a'.repeat(32);
const baseStore = () => ({
  admin_config: { global: { env: 'dev' } },
  order_main: { [OID]: { _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER, start_time: Date.now() - 60000, urge_count: 0 } },
  system_notice: {}, user_account: {}, demand: {}
});

const CASES = [
  { name: 'detail_ok', openid: USER, event: { action: 'detail', order_id: OID, mock_openid: USER } },
  { name: 'detail_not_found', openid: USER, store: { admin_config: { global: { env: 'dev' } }, order_main: {} }, event: { action: 'detail', order_id: OID, mock_openid: USER } },
  { name: 'detail_not_participant', openid: STRANGER, event: { action: 'detail', order_id: OID, mock_openid: STRANGER } },
  { name: 'my_orders_partner', openid: PARTNER, event: { action: 'my_orders', role: 'partner', filter: 'all', mock_openid: PARTNER } },
  { name: 'my_orders_user', openid: USER, event: { action: 'my_orders', role: 'user', filter: 'doing', mock_openid: USER } },
  { name: 'my_counts_user', openid: USER, event: { action: 'my_counts', role: 'user', mock_openid: USER } },
  { name: 'notice_list', openid: USER, event: { action: 'notice_list', limit: 20, mock_openid: USER } },
  { name: 'notice_poll_bad', openid: USER, event: { action: 'notice_poll', order_id: 'bad', mock_openid: USER } },
  { name: 'notice_read_all', openid: USER, event: { action: 'notice_read', mock_openid: USER } },
  { name: 'nudge_not_owner', openid: STRANGER, event: { action: 'nudge_partner', order_id: OID, mock_openid: STRANGER } },
  { name: 'cancel_not_participant', openid: STRANGER, event: { action: 'cancel', order_id: OID, mock_openid: STRANGER } },
  { name: 'get_conf_not_found', openid: USER, store: { admin_config: { global: { env: 'dev' } }, order_main: {} }, event: { action: 'get_confirmation', order_id: OID, mock_openid: USER } },
  { name: 'get_conf_not_participant', openid: STRANGER, event: { action: 'get_confirmation', order_id: OID, mock_openid: STRANGER } },
  { name: 'update_item_bad', openid: USER, event: { action: 'update_item', order_id: OID, item: 'xxx', mock_openid: USER } },
  { name: 'update_item_not_editable', openid: USER, event: { action: 'update_item', order_id: OID, item: 'time', mock_openid: USER } },
  { name: 'confirm_item_bad', openid: USER, event: { action: 'confirm_item', order_id: OID, item: 'bad', mock_openid: USER } },
  { name: 'confirm_all_not_participant', openid: STRANGER, event: { action: 'confirm_all', order_id: OID, mock_openid: STRANGER } },
  { name: 'cancel_not_participant', openid: STRANGER, event: { action: 'cancel', order_id: OID, mock_openid: STRANGER } },
  { name: 'cancel_status', openid: USER, event: { action: 'cancel', order_id: OID, mock_openid: USER } },
  { name: 'start_perm', openid: USER, event: { action: 'start_service', order_id: OID, mock_openid: USER } },
  { name: 'complete_status', openid: PARTNER, event: { action: 'complete_service', order_id: OID, mock_openid: PARTNER } },
  { name: 'ms_invalid', openid: USER, event: { action: 'milestone_confirm', order_id: OID, mock_openid: USER } },
  { name: 'resume_status', openid: PARTNER, event: { action: 'resume_service', order_id: OID, mock_openid: PARTNER } },
];

function loadWith(file, sdk) {
  let active = sdk;
  const orig = Module._load;
  Module._load = function (r) { if (r === 'wx-server-sdk') return active; return orig.apply(this, arguments); };
  const full = path.join(__dirname, '..', 'order-action', file);
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  Module._load = orig;
  return mod;
}

(async () => {
  let fails = 0;
  for (const c of CASES) {
    const st = c.store || baseStore();
    // 两个独立 sdk 实例，相同 store 快照
    const a = loadWith('_orig_baseline.js', makeSdk({ openid: c.openid, store: JSON.parse(JSON.stringify(st)) }));
    const b = loadWith('index.js', makeSdk({ openid: c.openid, store: JSON.parse(JSON.stringify(st)) }));
    const ra = await a.main(JSON.parse(JSON.stringify(c.event)), {});
    const rb = await b.main(JSON.parse(JSON.stringify(c.event)), {});
    try {
      assert.deepStrictEqual(normalize(rb), normalize(ra));
      console.log('OK  ', c.name);
    } catch (e) {
      fails++;
      console.log('FAIL', c.name);
      console.log('  expected:', JSON.stringify(ra));
      console.log('  actual  :', JSON.stringify(rb));
    }
  }
  console.log(fails === 0 ? `\nA/B EQUIVALENT: ${CASES.length} cases` : `\n${fails} diff(s)`);
  process.exit(fails);
})();

function normalize(v) {
  // 剔除非确定性：Date.now 时间戳 / 自增计数造成的差异不影响结构等价
  return JSON.parse(JSON.stringify(v, (k, val) => {
    if (typeof val === 'number' && val > 1e12) return '<ts>';
    return val;
  }));
}
