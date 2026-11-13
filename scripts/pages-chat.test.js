// scripts/pages-chat.test.js —— 聊天页页面级单测（前端巨页分拆方案 阶段0 · chat 断言先行）
// 目标：为阶段A 拟外移域（confirmList 构建 / batch_blocked 单一真值 / s1Left 折算 / 状态 catch-up 弹窗 /
//       _handleOaConflict once 锚 / _handleApplyFail / applyNotices 域）建立守护断言
// 驱动方式标注：本文件用例为「可直接驱动」（onLoad→fetchData 云调用链 + 直调内部方法）；
//   showActionSheet / chooseLocation 分支由 C28/C30 通过 wx 桩注入覆盖（2026-11-13 补齐）。
const { test } = require('node:test');
const assert = require('node:assert');
const { createPage, sleep } = require('./mp-page-harness.js');
const { TM_TEMPLATES } = require('../miniprogram/config/enums.js');

const PAGE = 'pages-v2/chat/chat.js';
const ORD = 'c'.repeat(32);

// ── 夹具 ──
function convOpen(over) {
  return { ok: true, data: Object.assign({
    conv_id: 'conv1', order_id: ORD, order_no: 'ORD_T', scene: 'W8', scene_name: '跑腿代办',
    peer: { nickname: '对方' }, role: 'user', free_chat: false, chat_blocked: false, status: 'S1'
  }, over || {}) };
}
function conf(over) {
  return { ok: true, data: Object.assign({
    status: 'S1', all_confirmed: false,
    items: {
      time: { value: '2026-11-20 14:00', user_ok: false, partner_ok: false },
      location: { value: '市中心', user_ok: false, partner_ok: false },
      content: { value: '代买奶茶', user_ok: false, partner_ok: false },
      fee: { value: '30', user_ok: false, partner_ok: false }
    },
    s1_expire_at: Date.now() + 600000, server_now: Date.now(),
    s2_change_counts: { _total: 0, location: 0, content: 0 },
    batch_blocked: false, frozen: false, start_time: Date.now() + 86400000
  }, over || {}) };
}
const msgFx = () => ({ ok: true, data: { messages: [] } });

async function load(fixtures, extra) {
  const p = createPage(Object.assign({
    page: PAGE,
    fixtures: Object.assign({
      'im-conv:open': convOpen(),
      'im-conv:messages': msgFx(),
      'order-action:get_confirmation': conf(),
      'admin-action:config_public': { ok: true, data: {} }
    }, fixtures || {}),
    wx: { getWindowInfo: () => ({ statusBarHeight: 20 }) }
  }, extra || {}));
  p.inst.onLoad({ orderId: ORD });
  await sleep(60);
  return p;
}

// C1（可直接驱动）：载入云调用契约 —— im-conv:open 带 order_id，随后 get_confirmation + messages 并行
test('C1 聊天页载入云调用契约', async () => {
  const p = await load();
  try {
    assert.strictEqual(p.calls.cloud[0].name, 'im-conv');
    assert.strictEqual(p.calls.cloud[0].data.action, 'open');
    assert.strictEqual(p.calls.cloud[0].data.order_id, ORD);
    const names = p.calls.cloud.map((c) => c.name + ':' + c.data.action);
    assert.ok(names.includes('order-action:get_confirmation'), '应拉取四确认数据');
    assert.ok(names.includes('im-conv:messages'), '应拉取消息流');
    assert.strictEqual(p.inst.data.loadError, false);
    assert.strictEqual(p.inst.data.orderStatus, 'S1');
  } finally { p.restore(); }
});

// C2（可直接驱动）：confirmList 构建与角色镜像 —— partner 端 myOk=partner_ok / user 端 myOk=user_ok
test('C2 confirmList 角色镜像与计数', async () => {
  const items = {
    time: { value: '14:00', user_ok: true, partner_ok: false },
    location: { value: '市中心', user_ok: false, partner_ok: false },
    content: { value: '代买', user_ok: true, partner_ok: true },
    fee: { value: '30', user_ok: false, partner_ok: false }
  };
  const a = await load({ 'order-action:get_confirmation': conf({ items }) });
  try {
    const list = a.inst.data.confirmList;
    assert.strictEqual(list.length, 4);
    assert.strictEqual(list.find((x) => x.field === 'time').myOk, true);     // user 端 myOk=user_ok=true
    assert.strictEqual(list.find((x) => x.field === 'content').done, true);  // 双方已确认
    assert.strictEqual(a.inst.data.confirmedCount, 1); // both()=双方均确认，仅 content 满足
  } finally { a.restore(); }

  const b = await load({
    'order-action:get_confirmation': conf({ items }),
    'im-conv:open': convOpen({ role: 'partner' })
  });
  try {
    const list = b.inst.data.confirmList;
    assert.strictEqual(list.find((x) => x.field === 'time').myOk, false);    // partner 端看 partner_ok=false
    assert.strictEqual(list.find((x) => x.field === 'time').peerOk, true);   // 对方(user)已确认
    assert.strictEqual(list.find((x) => x.field === 'content').myOk, true);
  } finally { b.restore(); }
});

// C3（可直接驱动）：batch_blocked 服务端单一真值 + W9 本地兜底
test('C3 batch_blocked 单一真值', async () => {
  const a = await load({ 'order-action:get_confirmation': conf({ batch_blocked: true }) });
  try { assert.strictEqual(a.inst.data.batchBlocked, true); } finally { a.restore(); }
  const b = await load({ 'im-conv:open': convOpen({ scene: 'W9' }) });
  try { assert.strictEqual(b.inst.data.batchBlocked, true); } finally { b.restore(); }
});

// C4（可直接驱动）：s1Left 由服务端差值折算；非 S1 归零
test('C4 S1 倒计时折算与归零', async () => {
  const a = await load(); // s1_expire_at-server_now=600s
  try {
    assert.ok(a.inst.data.s1Left > 590 && a.inst.data.s1Left <= 600, 's1Left≈600, 实际 ' + a.inst.data.s1Left);
    assert.ok(a.inst.data.s1Text.length > 0);
  } finally { a.restore(); }
  const b = await load({ 'order-action:get_confirmation': conf({ status: 'S2', all_confirmed: true }) });
  try { assert.strictEqual(b.inst.data.s1Left, 0); } finally { b.restore(); }
});

// C5（可直接驱动）：S1 变更在途弹窗 + 幂等（同 d 二次 applyConfirmation 不重复弹）
test('C5 变更在途弹窗与幂等键', async () => {
  const c = conf({ pending_change: { field: 'location', old_value: '市中心', new_value: '城东',
    by_role: 'partner', reason: '临时有事', expire_at: Date.now() + 600000, can_respond: true, token: 'tk1' } });
  const p = await load({ 'order-action:get_confirmation': c });
  try {
    const hits = () => p.calls.modal.filter((m) => String(m.title || '').indexOf('对方申请变更') >= 0);
    assert.strictEqual(hits().length, 1, '首次应弹变更引导');
    assert.ok(p.inst.data.pendingChange && p.inst.data.pendingChange.can_respond);
    p.inst.applyConfirmation(c.data); // 同 d 二次
    await sleep(20);
    assert.strictEqual(hits().length, 1, '同 expire_at 二次不重复弹（跨页共用键语义）');
  } finally { p.restore(); }
});

// C6（可直接驱动）：S0 双端分流 —— partner 提示对方已确认；user 提示四项全齐且 __confirm 直达收银台
test('C6 S0 双端弹窗分流与去支付直达', async () => {
  const a = await load({
    'im-conv:open': convOpen({ role: 'partner', status: 'S0' }),
    'order-action:get_confirmation': conf({ status: 'S0', all_confirmed: true })
  });
  try {
    assert.ok(a.calls.modal.some((m) => String(m.title || '').indexOf('对方已确认') >= 0), 'partner 端应弹对方已确认');
  } finally { a.restore(); }

  const b = await load({
    'im-conv:open': convOpen({ role: 'user', status: 'S0' }),
    'order-action:get_confirmation': conf({ status: 'S0', all_confirmed: true })
  });
  try {
    const pay = b.calls.modal.filter((m) => String(m.title || '').indexOf('四项已全部确认') >= 0);
    assert.strictEqual(pay.length, 1, 'user 端应弹四项已全部确认（唯一性）');
    pay[0].__confirm();
    await sleep(20);
    assert.ok(b.calls.nav.some((n) => /pay\/pay\?orderId=/.test(n.url)), '确认后直达收银台');
    // 死代码复活哨兵：1b 先 mark(user_S0)，同条件「💳 订单支付」分支(L459-472)必须保持不可达
    assert.strictEqual(b.calls.modal.filter((m) => m.title === '💳 订单支付').length, 0, '不可达分支不得复活');
  } finally { b.restore(); }
});

// C7（可直接驱动）：_handleOaConflict once 锚 —— 首次弹「确认窗口已结束」，再次只 toast 不重复弹
test('C7 冲突出路弹窗幂等', async () => {
  const p = await load();
  try {
    p.inst._handleOaConflict({ code: 'oa_not_confirmable', msg: '确认窗口已结束' });
    const close = () => p.calls.modal.filter((m) => m.title === '确认窗口已结束').length;
    assert.strictEqual(close(), 1);
    p.inst._handleOaConflict({ code: 'oa_not_confirmable', msg: '确认窗口已结束' });
    await sleep(20);
    assert.strictEqual(close(), 1, 'once 锚生效，第二次不重复弹');
    // 非冲突码走通用失败弹窗（区分出路）
    p.inst._handleOaConflict({ code: 'oa_other', msg: '其他错误' });
    await sleep(20);
    assert.ok(p.calls.modal.some((m) => m.title === '确认失败'), '非冲突码走通用失败弹窗');
  } finally { p.restore(); }
});

// C8（可直接驱动）：applyNotices 域 —— respondHit 弹窗+震动 / 去重幂等 / modifyHit 引导
test('C8 applyNotices 弹窗域与去重', async () => {
  const p = await load();
  try {
    const list = [{ id: 'n1', type: 'extend_confirm', body: '对方已同意', created_at: 111 }];
    p.inst.applyNotices({ list });
    await sleep(20);
    assert.ok(p.calls.modal.some((m) => String(m.title || '').indexOf('对方已同意加时') >= 0), 'respondHit 弹窗');
    assert.ok(p.calls.wx.vibrateShort, '应震动');
    const modalCount = p.calls.modal.length;
    p.inst.applyNotices({ list }); // 同 id+created_at 二次 → 去重
    await sleep(20);
    assert.strictEqual(p.calls.modal.length, modalCount, '同通知二次不重复弹');

    const m2 = [{ id: 'n2', type: 'modify', title: '对方发起改期', body: '改期申请', created_at: 222 }];
    p.inst.applyNotices({ list: m2 });
    await sleep(20);
    assert.ok(p.calls.modal.some((m) => m.title === '对方发起改期'), 'modifyHit 弹窗引导处理');
  } finally { p.restore(); }
});

// C9（可直接驱动·审核补充）：commHit 分支 —— partner 端「订单沟通」弹窗 + 先记账再弹窗幂等（id+body 去重）
test('C9 commHit 弹窗与记账幂等', async () => {
  const p = await load({ 'im-conv:open': convOpen({ role: 'partner' }) });
  try {
    const n = { id: 'k1', type: 'modify', title: '订单沟通', body: '对方修改了费用' };
    p.inst.applyNotices({ list: [n] });
    await sleep(20);
    const hits = () => p.calls.modal.filter((m) => m.title === '对方发起沟通').length;
    assert.strictEqual(hits(), 1, 'partner 端应弹沟通引导');
    p.inst.applyNotices({ list: [n] });
    await sleep(20);
    assert.strictEqual(hits(), 1, '同 id+body 二次不重复弹（先记账再弹窗）');
  } finally { p.restore(); }
});

// C10（可直接驱动·审核补充）：同 id 异 created_at 必须再弹（编码 @VERIFIED L635 语义：去重键含 created_at）
test('C10 同 id 异 created_at 再弹', async () => {
  const p = await load();
  try {
    p.inst.applyNotices({ list: [{ id: 'n1', type: 'extend_confirm', body: '第一次同意', created_at: 111 }] });
    await sleep(20);
    const c1 = p.calls.modal.filter((m) => String(m.title || '').indexOf('对方已同意加时') >= 0).length;
    p.inst.applyNotices({ list: [{ id: 'n1', type: 'extend_confirm', body: '第二次同意(合并刷新 created_at)', created_at: 999 }] });
    await sleep(20);
    const c2 = p.calls.modal.filter((m) => String(m.title || '').indexOf('对方已同意加时') >= 0).length;
    assert.strictEqual(c1, 1);
    assert.strictEqual(c2, 2, 'writeNotice 合并复用 _id 刷新 created_at 场景必须二次提示');
  } finally { p.restore(); }
});

// C11（可直接驱动·审核补充）：_handleApplyFail 三分流 —— 窗口将尽关弹层给出路 / 次数上限 / 状态冲突刷新后通用失败
test('C11 applyFail 三分流', async () => {
  const p = await load();
  try {
    p.inst.setData({ editSheet: 'location' });
    p.inst._handleApplyFail({ code: 'oa_change_window_closed', msg: '' });
    await sleep(20);
    assert.strictEqual(p.inst.data.editSheet, '', '窗口将尽先关弹层');
    assert.ok(p.calls.modal.some((m) => m.title === '确认窗口即将结束'), '给「去逐项确认」出路');

    p.inst._handleApplyFail({ code: 'oa_change_limit', msg: '' });
    await sleep(20);
    assert.ok(p.calls.modal.some((m) => m.title === '变更次数已达上限'), '次数上限说明');

    const before = p.calls.cloud.filter((c) => c.data && c.data.action === 'get_confirmation').length;
    p.inst._handleApplyFail({ code: 'oa_change_pending', msg: '有在途变更' });
    await sleep(20);
    const after = p.calls.cloud.filter((c) => c.data && c.data.action === 'get_confirmation').length;
    assert.ok(after > before, '状态类冲突先刷新本地状态');
    assert.ok(p.calls.modal.some((m) => m.title === '提交失败' && /有在途变更/.test(m.content)), '服务端原文案');
  } finally { p.restore(); }
});

// C12（可直接驱动·审核补充）：四确认动作链栅门 —— onConfirmRow 四栅 + confirmItem 窗口已尽前置拦截
test('C12 确认动作链栅门', async () => {
  const p = await load();
  try {
    const tap = (field) => p.inst.onConfirmRow({ currentTarget: { dataset: { field } } });
    // 栅1：非 S1
    p.inst.setData({ orderStatus: 'S2' });
    tap('time');
    assert.ok(p.calls.toast.some((t) => /当前状态不可确认/.test(t.title)), '非 S1 拦截');
    // 栅2：pendingChange 在途
    p.inst.setData({ orderStatus: 'S1', pendingChange: { field: 'fee', can_respond: true } });
    tap('time');
    assert.ok(p.calls.toast.some((t) => /有变更待对方反馈/.test(t.title)), '在途变更拦截');
    // 栅3：myOk 已确认
    p.inst.setData({ pendingChange: null, confirmList: [{ field: 'time', myOk: true }] });
    tap('time');
    assert.ok(p.calls.toast.some((t) => /该项已确认/.test(t.title)), '已确认拦截');
    // 栅4：正常 → confirm_item 云调用
    p.inst.setData({ confirmList: [{ field: 'time', myOk: false }] });
    tap('time');
    await sleep(20);
    assert.ok(p.calls.cloud.some((c) => c.name === 'order-action' && c.data.action === 'confirm_item' && c.data.item === 'time'), '正常路径发 confirm_item');
    // S1 窗口已尽前置拦截（不发请求）
    const cnt = p.calls.cloud.filter((c) => c.data && c.data.action === 'confirm_item').length;
    p.inst.setData({ __x: 0 });
    p.inst.__s1Deadline = Date.now() - 1;
    p.inst.confirmItem('fee');
    await sleep(20);
    assert.strictEqual(p.calls.cloud.filter((c) => c.data && c.data.action === 'confirm_item').length, cnt, '窗口已尽不发请求');
    assert.ok(p.calls.modal.some((m) => m.title === '确认窗口已结束'), '转冲突说明弹窗');
  } finally { p.restore(); }
});

// C13（可直接驱动·审核补充）：onConfirmAll 三道闸（chatBlocked / batchBlocked / S2）
test('C13 一键确认三道闸', async () => {
  const p = await load();
  try {
    p.inst.setData({ chatBlocked: true });
    p.inst.onConfirmAll();
    assert.ok(p.calls.toast.some((t) => /订单已取消\/关闭,无法确认/.test(t.title)), '终态闸');
    p.inst.setData({ chatBlocked: false, batchBlocked: true });
    p.inst.onConfirmAll();
    assert.ok(p.calls.toast.some((t) => /需逐项确认/.test(t.title)), '特别授权闸');
    p.inst.setData({ batchBlocked: false, orderStatus: 'S2' });
    p.inst.onConfirmAll();
    assert.ok(p.calls.toast.some((t) => /已支付,无需再确认/.test(t.title)), 'S2 闸');
  } finally { p.restore(); }
});

// C14（可直接驱动·审核补充）：pendingBanner 横幅构建（extend / modify-S2_5 双分支）
test('C14 在途横幅构建', async () => {
  const pe = { can_respond: true, add_hours: 1, add_amount_fen: 3000 };
  const a = await load({ 'order-action:get_confirmation': conf({ pending_extend: pe }) });
  try {
    assert.strictEqual(a.inst.data.pendingBanner.type, 'extend');
    assert.strictEqual(a.inst.data.pendingBanner.canRespond, true);
    assert.ok(/加时 1 小时/.test(a.inst.data.pendingBanner.body));
  } finally { a.restore(); }
  const pm = { can_respond: true, new_start_time: Date.now() + 172800000 };
  const b = await load({ 'order-action:get_confirmation': conf({ status: 'S2_5', pending_modify: pm }) });
  try {
    assert.strictEqual(b.inst.data.pendingBanner.type, 'modify');
    assert.strictEqual(b.inst.data.orderStatus, 'S2_5');
  } finally { b.restore(); }
});

// C15（可直接驱动·审核补充）：S2/S5 catch-up 分支补全（含 S5 __confirm 直达评价页）
test('C15 S2/S5 状态 catch-up', async () => {
  const a = await load({
    'im-conv:open': convOpen({ role: 'partner', status: 'S2' }),
    'order-action:get_confirmation': conf({ status: 'S2', all_confirmed: true })
  });
  try {
    assert.ok(a.calls.modal.some((m) => String(m.title || '').indexOf('对方已支付') >= 0), 'S2 partner 引导去履约');
  } finally { a.restore(); }
  const b = await load({
    'im-conv:open': convOpen({ role: 'user', status: 'S5' }),
    'order-action:get_confirmation': conf({ status: 'S5', all_confirmed: true })
  });
  try {
    const ev = b.calls.modal.find((m) => String(m.title || '').indexOf('履约完成') >= 0);
    assert.ok(ev, 'S5 user 引导去评价');
    ev.__confirm();
    await sleep(20);
    assert.ok(b.calls.nav.some((n) => /evaluate\/evaluate\?orderId=/.test(n.url)), '确认后直达评价页');
  } finally { b.restore(); }
});

// C16（可直接驱动·审核补充）：幂等键名级断言（harness storage 留痕）—— s1close / chat_notice 键含 orderId 成分
test('C16 幂等键名级断言', async () => {
  const p = await load();
  try {
    p.inst._handleOaConflict({ code: 'oa_not_confirmable', msg: '确认窗口已结束' });
    await sleep(20);
    const keys = p.calls.storage.filter((s) => s.op === 'set').map((s) => s.key);
    assert.ok(keys.some((k) => String(k).indexOf('s1close:' + ORD + ':S1') >= 0), 's1close 键含 orderId（防键退化无 orderId）');
    p.inst.applyNotices({ list: [{ id: 'n1', type: 'accept', created_at: 5 }] });
    await sleep(20);
    const keys2 = p.calls.storage.filter((s) => s.op === 'set').map((s) => s.key);
    assert.ok(keys2.some((k) => String(k).indexOf('chat_notice:' + ORD) >= 0), '通知去重表键含 orderId');
  } finally { p.restore(); }
});

// C17（可直接驱动·实施第0步）：applyConfirmation setData 键集合快照 —— confirm-flow 外移后 17 键不得多/少/改路径
test('C17 patch 键集合 17 键快照', async () => {
  const p = await load({
    'order-action:get_confirmation': conf({ pending_extend: { can_respond: true, add_hours: 1, add_amount_fen: 3000 } })
  });
  try {
    const patch = p.calls.setData.find((s) => s && 'confirmList' in s);
    assert.ok(patch, '应存在 applyConfirmation 的 setData patch');
    const EXPECT = ['items', 'progress', 'confirmedCount', 'confirmList', 'unlocked', 'freeChat', 'orderStatus',
      'startTime', 'pendingBanner', 'pendingChange', 'frozen', 's2Counts', 's1Left', 's1Text', 'chatBlocked', 'batchBlocked', 'orderSummary'];
    assert.deepStrictEqual(Object.keys(patch).sort(), EXPECT.slice().sort(), 'setData 键集合必须与快照逐键一致');
  } finally { p.restore(); }
});

// C18（可直接驱动·实施第0步）：弹窗调用点时序 —— 状态 catch-up 弹窗必须发生在 setData 回调内部（pcn 依赖 patch 已落 data）
test('C18 弹窗时序在 setData 回调内', async () => {
  const order2 = [];
  const q = await load({
    'order-action:get_confirmation': conf({ pending_change: { field: 'fee', old_value: '30', new_value: '50',
      by_role: 'partner', reason: '费用调整', expire_at: Date.now() + 600000, can_respond: true, token: 'tk9' } })
  }, {
    wx: { showModal(arg) { order2.push('modal:' + ((arg && arg.title) || '')); } }
  });
  try {
    order2.length = 0; // 载入期已有弹窗记录，清空后仅观察本次 applyConfirmation 的时序
    const orig = q.inst.setData.bind(q.inst);
    q.inst.setData = (patch, cb) => { order2.push('setData'); orig(patch, cb); };
    const c = conf({ pending_change: { field: 'fee', old_value: '30', new_value: '50',
      by_role: 'partner', reason: '费用调整', expire_at: Date.now() + 600000, can_respond: true, token: 'tk9' } });
    q.inst.applyConfirmation(c.data);
    const iSet = order2.indexOf('setData');
    const iModal = order2.findIndex((x) => x.startsWith('modal:对方申请变更'));
    assert.ok(iSet >= 0 && iModal > iSet, '变更弹窗必须晚于 setData 入栈（回调内时序）order=' + JSON.stringify(order2));
    const between = order2.slice(iSet + 1, iModal);
    assert.ok(between.every((x) => !x.startsWith('modal:')), 'setData 与弹窗之间无其他弹窗（单次 setData 单回调）');
  } finally { q.restore(); }
});

// ── 批次2b 前置补桩（归属表 v2.0 ⑧-1）：动作链外移前先钉住 onTmOption / confirm_all 成功支路 / 编辑提交链 / 响应链 ──
// C19：onTmOption 四支路 + TM_FIELD 双源哨兵（TM5 无字段 / chatBlocked / 正向→confirm_item / 负向→startEdit）
test('C19 onTmOption 四支路', async () => {
  const p = await load();
  try {
    p.inst.onTmOption({ detail: { tm_id: 'TM5', option: '其他' } });
    assert.ok(p.calls.toast.some((t) => /该模板无需确认/.test(t.title)), 'TM5 无确认字段');
    p.inst.setData({ chatBlocked: true });
    p.inst.onTmOption({ detail: { tm_id: 'TM1', option: TM_TEMPLATES.TM1.options[0] } });
    assert.ok(p.calls.toast.some((t) => /无法操作/.test(t.title)), '终态闸');
    p.inst.setData({ chatBlocked: false, orderStatus: 'S1' });
    p.inst.onTmOption({ detail: { tm_id: 'TM1', option: TM_TEMPLATES.TM1.options[0] } });
    await sleep(20);
    assert.ok(p.calls.cloud.some((c) => c.data && c.data.action === 'confirm_item' && c.data.item === 'time'), '正向→confirm_item');
    p.inst.onTmOption({ detail: { tm_id: 'TM1', option: '__非正向__' } });
    assert.strictEqual(p.inst.data.editSheet, 'time', '负向→进入编辑态（time 弹层）');
  } finally { p.restore(); }
});

// C20：confirm_all 成功支路 —— 补卡（已有模板卡时不重发）→ 刷新确认态
test('C20 confirm_all 成功支路', async () => {
  const p = await load();
  try {
    p.inst.setData({
      orderStatus: 'S1', chatBlocked: false, batchBlocked: false,
      messages: ['TM1', 'TM2', 'TM3', 'TM4'].map((id) => ({ _id: 'm_' + id, msg_type: 'template', tm_id: id }))
    });
    const before = p.calls.cloud.filter((c) => c.data && c.data.action === 'get_confirmation').length;
    p.inst.onConfirmAll();
    const ev = p.calls.modal.filter((m) => m.title === '全部确认').pop();
    assert.ok(ev, '应弹二次确认');
    ev.__confirm();
    await sleep(50);
    assert.ok(p.calls.cloud.some((c) => c.data && c.data.action === 'confirm_all'), '应提交 confirm_all');
    assert.ok(p.calls.cloud.filter((c) => c.data && c.data.action === 'get_confirmation').length > before, '成功后刷新确认态');
    assert.ok(p.calls.toast.some((t) => /已全部确认/.test(t.title)), '成功 toast');
  } finally { p.restore(); }
});

// C21：B7 startEdit 履约时间缺失 → 只重取一次；仍为 0 弹「订单信息未加载」，取到则继续原流程
test('C21 startEdit 时间缺失 fail-safe 重取', async () => {
  const wxStub = { getWindowInfo: () => ({ statusBarHeight: 20 }), chooseLocation: () => {} };
  let n = 0;
  const mk = () => createPage({
    page: PAGE,
    fixtures: (name, data) => {
      if (name === 'im-conv' && data.action === 'open') return convOpen({ status: 'S2' });
      if (name === 'im-conv' && data.action === 'messages') return msgFx();
      if (name === 'order-action' && data.action === 'get_confirmation') {
        n += 1;
        return conf({ status: 'S2', start_time: 0, s2_change_counts: { _total: 0, location: 0, content: 0 } });
      }
      return { ok: true, data: {} };
    },
    wx: wxStub
  });
  const a = mk();
  try {
    a.inst.onLoad({ orderId: ORD });
    await sleep(60);
    a.inst.startEdit('location');
    await sleep(60);
    assert.strictEqual(n, 2, '只重取一次（首次载入 + 重取一次）');
    assert.ok(a.calls.modal.some((m) => m.title === '订单信息未加载'), '仍取不到时提示刷新');
  } finally { a.restore(); }

  // 取到时间 → 继续原流程（chooseLocation 桩被调用）
  let hit = 0;
  let m = 0;
  const b = createPage({
    page: PAGE,
    fixtures: (name, data) => {
      if (name === 'im-conv' && data.action === 'open') return convOpen({ status: 'S2' });
      if (name === 'im-conv' && data.action === 'messages') return msgFx();
      if (name === 'order-action' && data.action === 'get_confirmation') {
        m += 1;
        return conf({ status: 'S2', start_time: m >= 2 ? Date.now() + 86400000 : 0 });
      }
      return { ok: true, data: {} };
    },
    wx: { getWindowInfo: () => ({ statusBarHeight: 20 }), chooseLocation: () => { hit += 1; } }
  });
  try {
    b.inst.onLoad({ orderId: ORD });
    await sleep(60);
    b.inst.startEdit('location');
    await sleep(60);
    assert.strictEqual(hit, 1, '重取到履约时间后继续选点');
    assert.strictEqual(b.inst.__s2RefreshTried, false, '重取流程结束后复位（防无界递归）');
  } finally { b.restore(); }
});

// C22：B16 变更提交链 —— 原因类型 ActionSheet → 原因 ≥10 字 → s2_change_apply 载荷
test('C22 S2 变更原因链提交载荷', async () => {
  const modals = [];
  const p = createPage({
    page: PAGE,
    fixtures: {
      'im-conv:open': convOpen({ status: 'S2' }),
      'im-conv:messages': msgFx(),
      'order-action:get_confirmation': conf({ status: 'S2', start_time: Date.now() + 86400000 })
    },
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 20 }),
      showActionSheet: (arg) => { if (arg && arg.success) arg.success({ tapIndex: 0 }); },
      showModal(arg) {
        const rec = Object.assign({}, arg, {
          __confirm: () => { if (arg && arg.success) arg.success({ confirm: true, content: '服务内容需要调整为两项,请确认' }); }
        });
        modals.push(rec);
        return rec;
      }
    }
  });
  try {
    p.inst.onLoad({ orderId: ORD });
    await sleep(60);
    p.inst.setData({ editContentOpts: [{ name: '代买', checked: true }, { name: '排队', checked: true }] });
    p.inst.confirmEditContent();
    const ev = modals.filter((m) => m.title === '变更原因').pop();
    assert.ok(ev, '应弹原因说明');
    ev.__confirm();
    await sleep(30);
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 's2_change_apply').pop();
    assert.ok(call, '应提交 s2_change_apply');
    assert.deepStrictEqual(call.data.value, ['代买', '排队'], '内容载荷为选中项数组');
    assert.strictEqual(call.data.reason, '服务内容需要调整为两项,请确认');
    assert.ok(call.data.reason_type, '应带原因类型 key');
  } finally { p.restore(); }
});

// C23：B17 变更响应链 —— accept → change_respond 载荷 + 成功后刷新
test('C23 变更响应 accept 载荷', async () => {
  const p = await load();
  try {
    p.inst.setData({
      orderStatus: 'S1',
      pendingChange: { field: 'content', field_cn: '内容', old_text: '甲', new_text: '乙', token: 'tk7', can_respond: true }
    });
    const before = p.calls.cloud.filter((c) => c.data && c.data.action === 'get_confirmation').length;
    p.inst.onRespondChange({ currentTarget: { dataset: { decision: 'accept' } } });
    const ev = p.calls.modal.filter((m) => m.title === '接受变更').pop();
    assert.ok(ev, '应弹接受确认');
    ev.__confirm();
    await sleep(30);
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'change_respond').pop();
    assert.ok(call, '应提交 change_respond');
    assert.strictEqual(call.data.decision, 'accept');
    assert.strictEqual(call.data.token, 'tk7');
    assert.ok(p.calls.cloud.filter((c) => c.data && c.data.action === 'get_confirmation').length > before, '成功后刷新');
  } finally { p.restore(); }
});

// C24：S2 同值前置拦截（D-4 留页依赖 __s2SameValue）—— 未变更不发请求、不弹原因
test('C24 S2 同值拦截', async () => {
  const p = await load({
    'im-conv:open': convOpen({ status: 'S2' }),
    'order-action:get_confirmation': conf({ status: 'S2', start_time: Date.now() + 86400000, items: {
      time: { value: '2026-11-20 14:00', user_ok: true, partner_ok: true },
      location: { value: '市中心', user_ok: true, partner_ok: true },
      content: { value: ['代买'], user_ok: true, partner_ok: true },
      fee: { value: '30', user_ok: true, partner_ok: true }
    } })
  });
  try {
    p.inst.setData({ editContentOpts: [{ name: '代买', checked: true }] });
    p.inst.confirmEditContent();
    await sleep(20);
    assert.ok(p.calls.toast.some((t) => /内容未变更/.test(t.title)), '同值应前置拦截');
    assert.strictEqual(p.calls.cloud.filter((c) => c.data && c.data.action === 's2_change_apply').length, 0, '不发请求');
    assert.strictEqual(p.calls.modal.filter((m) => m.title === '变更原因').length, 0, '不弹原因说明');
  } finally { p.restore(); }
});

// C25：非 S2 变更（S1 change_apply）—— 直接提交、不带 S2 原因字段
test('C25 S1 change_apply 载荷', async () => {
  const p = await load();
  try {
    p.inst.setData({ orderStatus: 'S1', pendingChange: null, otherText: '需要一把折叠椅' });
    p.inst.confirmEditOther();
    await sleep(30);
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'change_apply').pop();
    assert.ok(call, '应提交 change_apply');
    assert.strictEqual(call.data.field, 'other');
    assert.strictEqual(call.data.value, '需要一把折叠椅');
    assert.strictEqual(call.data.reason, undefined, '非 S2 不带原因字段');
    assert.strictEqual(call.data.reason_type, undefined);
  } finally { p.restore(); }
});

// C26：改时间提交（S1）—— 日期时间解析为时间戳 + change_apply 载荷
test('C26 改时间提交载荷', async () => {
  const p = await load();
  try {
    const d = new Date(Date.now() + 5 * 86400000);
    const pad2 = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 30, 0).getTime();
    p.inst.setData({ orderStatus: 'S1', editDate: dateStr, editTimeHm: '10:30' });
    p.inst.confirmEditTime();
    await sleep(30);
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'change_apply').pop();
    assert.ok(call, '应提交 change_apply');
    assert.strictEqual(call.data.field, 'time');
    assert.strictEqual(call.data.value, ts);
    // 缺字段闸
    p.inst.setData({ editDate: '', editTimeHm: '' });
    p.inst.confirmEditTime();
    assert.ok(p.calls.toast.some((t) => /请选择日期和时间/.test(t.title)), '缺字段闸');
    // 过去时间闸（2026-11-12 评审补强：原注释声称覆盖但无断言）
    const before = p.calls.cloud.filter((c) => c.data && c.data.action === 'change_apply').length;
    p.inst.setData({ editDate: '2020-01-01', editTimeHm: '10:30' });
    p.inst.confirmEditTime();
    assert.ok(p.calls.toast.some((t) => /必须是未来时间/.test(t.title)), '过去时间闸');
    assert.strictEqual(
      p.calls.cloud.filter((c) => c.data && c.data.action === 'change_apply').length, before,
      '闸门命中不得发请求'
    );
  } finally { p.restore(); }
});

// C27：改费用提交（S1）—— 元→分取整 + 非法金额闸
test('C27 改费用提交载荷', async () => {
  const p = await load();
  try {
    p.inst.setData({ orderStatus: 'S1', editFeeYuan: '25.5' });
    p.inst.confirmEditFee();
    await sleep(30);
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'change_apply').pop();
    assert.ok(call, '应提交 change_apply');
    assert.strictEqual(call.data.field, 'fee');
    assert.strictEqual(call.data.value, 2550, '元→分整数');
    const beforeZero = p.calls.cloud.filter((c) => c.data && c.data.action === 'change_apply').length;
    p.inst.setData({ editFeeYuan: '0' });
    p.inst.confirmEditFee();
    assert.ok(p.calls.toast.some((t) => /请输入有效金额/.test(t.title)), '非法金额闸');
    assert.strictEqual(
      p.calls.cloud.filter((c) => c.data && c.data.action === 'change_apply').length, beforeZero,
      '非法金额不得发请求'
    );
  } finally { p.restore(); }
});

// C28：改地点 chooseLocation —— 取消保持静默；定位被拒/地图失败给明确提示（2026-11-08 评审修复分支）
test('C28 改地点：取消静默 / 定位被拒提示', async () => {
  const reps = [];
  const p = createPage({
    page: PAGE,
    fixtures: {
      'im-conv:open': convOpen(),
      'im-conv:messages': msgFx(),
      'order-action:get_confirmation': conf(),
      'admin-action:config_public': { ok: true, data: {} }
    },
    wx: { getWindowInfo: () => ({ statusBarHeight: 20 }), chooseLocation: (o) => reps.push(o) }
  });
  try {
    p.inst.onLoad({ orderId: ORD });
    await sleep(60);
    const toastBefore = p.calls.toast.length;
    const modalBefore = p.calls.modal.length;
    p.inst.startEdit('location');
    assert.strictEqual(reps.length, 1, '应调用 chooseLocation');
    reps[0].fail({ errMsg: 'chooseLocation:fail cancel' });
    await sleep(10);
    assert.strictEqual(p.calls.toast.length, toastBefore, '取消保持静默');
    assert.strictEqual(p.calls.modal.length, modalBefore, '取消不弹窗');
    p.inst.startEdit('location');
    reps[1].fail({ errMsg: 'chooseLocation:fail auth deny' });
    await sleep(10);
    assert.ok(p.calls.modal.some((m) => m.title === '无法选择地点'), '定位被拒应明确提示');
  } finally { p.restore(); }
});

// C29：变更响应 reject 支路 —— change_respond decision=reject 载荷 + 「已拒绝,原值不变」文案
test('C29 变更响应 reject 载荷', async () => {
  const p = await load({ 'order-action:change_respond': { ok: true, data: { bits_reset: false } } });
  try {
    p.inst.setData({
      orderStatus: 'S1',
      pendingChange: { field: 'content', field_cn: '内容', old_text: '甲', new_text: '乙', token: 'tk9', can_respond: true }
    });
    p.inst.onRespondChange({ currentTarget: { dataset: { decision: 'reject' } } });
    const ev = p.calls.modal.filter((m) => m.title === '拒绝变更').pop();
    assert.ok(ev, '应弹拒绝确认');
    ev.__confirm();
    await sleep(30);
    const call = p.calls.cloud.filter((c) => c.data && c.data.action === 'change_respond').pop();
    assert.ok(call, '应提交 change_respond');
    assert.strictEqual(call.data.decision, 'reject');
    assert.strictEqual(call.data.token, 'tk9');
    assert.ok(p.calls.toast.some((t) => /已拒绝,原值不变/.test(t.title)), '拒绝成功文案');
  } finally { p.restore(); }
});

// C30：变更原因 ActionSheet —— 上限 6 项截断；取消静默；非取消失败提示（2026-11-11 配置化+slice 防呆）
test('C30 变更原因 ActionSheet 取消与截断', async () => {
  const CONFIG = require('../miniprogram/config/index.js');
  const sheets = [];
  const p = createPage({
    page: PAGE,
    fixtures: {
      'im-conv:open': convOpen({ status: 'S2' }),
      'im-conv:messages': msgFx(),
      'order-action:get_confirmation': conf({ status: 'S2', start_time: Date.now() + 86400000 })
    },
    wx: { getWindowInfo: () => ({ statusBarHeight: 20 }), showActionSheet: (arg) => sheets.push(arg) }
  });
  const oldTypes = CONFIG.ORDER.changeContentReasonTypes;
  try {
    CONFIG.ORDER.changeContentReasonTypes = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ k: 'k' + i, t: '类型' + i }));
    p.inst.onLoad({ orderId: ORD });
    await sleep(60);
    p.inst.setData({ orderStatus: 'S2', editContentOpts: [{ name: '代买', checked: true }] });
    p.inst.confirmEditContent();
    assert.strictEqual(sheets.length, 1, '应弹原因类型选择');
    assert.strictEqual(sheets[0].itemList.length, 6, 'ActionSheet 上限 6 项');
    const toastBefore = p.calls.toast.length;
    sheets[0].fail({ errMsg: 'showActionSheet:fail cancel' });
    await sleep(10);
    assert.strictEqual(p.calls.toast.length, toastBefore, '取消保持静默');
    p.inst.confirmEditContent();
    sheets[1].fail({ errMsg: 'showActionSheet:fail other' });
    await sleep(10);
    assert.ok(p.calls.toast.some((t) => /请选择原因类型/.test(t.title)), '非取消失败应提示');
  } finally {
    CONFIG.ORDER.changeContentReasonTypes = oldTypes;
    p.restore();
  }
});
