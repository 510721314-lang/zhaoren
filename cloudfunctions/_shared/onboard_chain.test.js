// cloudfunctions/_shared/onboard_chain.test.js
// 2026-10-23 批3c: 入驻八步链纯逻辑单测(不触网; wx 用桩)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// 动态 require(变量): 跨目录静态不可判, 仅触发 check-require-scope 的 WARN, 不阻断云函数打包
const CHAIN_PATH = path.resolve(__dirname, '../../miniprogram/utils/onboard-chain.js');

let navs = [];
global.wx = {
  redirectTo(o) { navs.push('redirect:' + o.url); if (o.success) o.success(); },
  navigateTo(o) { navs.push('navigate:' + o.url); },
  switchTab(o) { navs.push('switchTab:' + o.url); }
};
const chain = require(CHAIN_PATH);

test.beforeEach(() => { navs = []; });

test('八步顺序与设计 §1.3 一致', () => {
  assert.deepStrictEqual(chain.STEPS.map((s) => s.key), ['register', 'realname', 'ec', 'profile', 'config', 'exam', 'apply', 'review']);
  assert.strictEqual(chain.TOTAL, 8);
});

test('stepOf 返回 1-based 序号', () => {
  assert.deepStrictEqual(chain.stepOf('ec'), { key: 'ec', index: 3, total: 8, label: '紧急联系人' });
  assert.strictEqual(chain.stepOf('nope'), null);
});

test('云端拒绝码映射到步骤', () => {
  assert.strictEqual(chain.stepKeyOfCode('order_ec_required'), 'ec');
  assert.strictEqual(chain.stepKeyOfCode('order_base_exam_required'), 'exam');
  assert.strictEqual(chain.stepKeyOfCode('order_switch_off'), 'config');
  assert.strictEqual(chain.stepKeyOfCode('order_not_approved'), 'apply');
  assert.strictEqual(chain.stepKeyOfCode('unknown_code'), '');
});

test('missing 首项映射到步骤', () => {
  assert.strictEqual(chain.stepKeyOfMissing('realname'), 'realname');
  assert.strictEqual(chain.stepKeyOfMissing('ec'), 'ec');
  assert.strictEqual(chain.stepKeyOfMissing('role'), 'apply');
  assert.strictEqual(chain.stepKeyOfMissing('review_pending'), 'review');
  assert.strictEqual(chain.stepKeyOfMissing('credit_low'), '');
});

test('可接单者不进链', () => {
  assert.strictEqual(chain.canEnterChain({ can_take: true, missing: [] }), false);
  assert.strictEqual(chain.canEnterChain({ can_take: false, missing: ['ec'] }), true);
  assert.strictEqual(chain.canEnterChain(null), true);
});

test('entryKey: 缺项优先 > 草稿档 > 审核中 > 资料维护', () => {
  assert.strictEqual(chain.entryKey({ missing: ['realname'], profile_status: 'draft' }), 'realname');
  assert.strictEqual(chain.entryKey({ missing: ['ec'] }), 'ec');
  assert.strictEqual(chain.entryKey({ missing: ['base_exam'] }), 'exam');
  assert.strictEqual(chain.entryKey({ missing: [], profile_status: 'draft' }), 'profile');
  assert.strictEqual(chain.entryKey({ missing: [], profile_status: 'pending_review' }), 'review');
  assert.strictEqual(chain.entryKey({ missing: [] }), 'profile');
});

test('next 从当前步前进一步, 一律 redirectTo 且带 from=chain', () => {
  assert.strictEqual(chain.next('ec'), 'profile');
  assert.deepStrictEqual(navs, ['redirect:/pages-v2/pkg-low/partner-profile-edit/partner-profile-edit?from=chain']);
  navs = [];
  assert.strictEqual(chain.next('config'), 'exam');
  assert.deepStrictEqual(navs, ['redirect:/pages-v2/pkg-low/exam-status/exam-status?from=chain']);
});

test('next 到链尾(审核)走 switchTab, 避免栈深', () => {
  assert.strictEqual(chain.next('apply'), 'review');
  assert.deepStrictEqual(navs, ['switchTab:/pages-v2/profile/profile']);
});

test('next 未知 key 兜底回我的页', () => {
  assert.strictEqual(chain.next('nope'), 'done');
  assert.deepStrictEqual(navs, ['switchTab:/pages-v2/profile/profile']);
});

test('open 对 tab 页用 switchTab, 非 tab 用 redirectTo', () => {
  chain.open('review');
  assert.deepStrictEqual(navs, ['switchTab:/pages-v2/profile/profile']);
  navs = [];
  chain.open('contacts');
  assert.deepStrictEqual(navs, []);
  chain.open('ec');
  assert.deepStrictEqual(navs, ['redirect:/pages-v2/pkg-low/contacts/contacts?from=chain']);
});

test('barOf 仅 from=chain 时给步骤条', () => {
  assert.deepStrictEqual(chain.barOf('config', 'chain'), { index: 5, total: 8, label: '接单配置' });
  assert.strictEqual(chain.barOf('config', ''), null);
  assert.strictEqual(chain.barOf('config'), null);
});
