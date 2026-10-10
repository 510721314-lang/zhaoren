// order-action 等价性重放：拆分前录制基线 → 拆分后重放 deepStrictEqual。
// 运行：node cloudfunctions/_shared/order-action.replay.js record   （生成基线）
//       node cloudfunctions/_shared/order-action.replay.js replay   （比对，退出码=差异数）
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');
const { record, replay } = require('./_replay');

const BASE = path.join(__dirname, '_baseline_order_action.json');
const USER = 'o_user_1', PARTNER = 'o_partner_1', STRANGER = 'o_stranger';
const OID = 'a'.repeat(32);

function store(extra = {}) {
  return {
    admin_config: { global: { env: 'dev' } },
    order_main: {
      [OID]: Object.assign({ _id: OID, status: 'S2', user_openid: USER, partner_openid: PARTNER, start_time: Date.now() - 60000, urge_count: 0 }, extra)
    }
  };
}

let activeSdk = null;
const orig = Module._load;
Module._load = function (r) { if (r === 'wx-server-sdk') return activeSdk; return orig.apply(this, arguments); };
function load(sdk) { activeSdk = sdk; delete require.cache[require.resolve('../order-action/index.js')]; return require('../order-action/index.js'); }

// 基线用例集（覆盖各 action 的正常/越权/边界；持续扩充直到 29 个全覆盖）
const CASES = [
  { name: 'nudge_not_owner', sdk: { openid: STRANGER }, event: { action: 'nudge_partner', order_id: OID, mock_openid: STRANGER } },
  { name: 'nudge_not_started', sdk: { openid: USER, storeExtra: { start_time: Date.now() + 3600000 } }, event: { action: 'nudge_partner', order_id: OID, mock_openid: USER } },
  { name: 'nudge_not_found', sdk: { openid: USER, empty: true }, event: { action: 'nudge_partner', order_id: OID, mock_openid: USER } },
  { name: 'nudge_bad_id', sdk: { openid: USER }, event: { action: 'nudge_partner', mock_openid: USER } },
  { name: 'nudge_ok', sdk: { openid: USER }, event: { action: 'nudge_partner', order_id: OID, mock_openid: USER } },
  { name: 'cancel_not_participant', sdk: { openid: STRANGER }, event: { action: 'cancel', order_id: OID, mock_openid: STRANGER } },
];

function buildCase(c) {
  const st = c.sdk.empty ? { admin_config: { global: { env: 'dev' } }, order_main: {} } : store(c.sdk.storeExtra);
  const sdk = makeSdk({ openid: c.sdk.openid, store: st });
  const { main } = load(sdk);
  return { name: c.name, run: () => main(c.event, {}) };
}

const mode = process.argv[2] || 'replay';
const cases = CASES.map(buildCase);
if (mode === 'record') {
  record(BASE, cases);
  console.log('recorded', cases.length, 'cases →', BASE);
} else {
  const diffs = replay(BASE, cases);
  if (!diffs.length) { console.log('REPLAY OK:', cases.length, 'cases equivalent'); process.exit(0); }
  console.log('REPLAY FAIL:', diffs.length, 'diff(s)');
  for (const d of diffs) console.log(JSON.stringify(d));
  process.exit(diffs.length);
}
