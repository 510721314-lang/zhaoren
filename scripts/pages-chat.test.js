// scripts/pages-chat.test.js —— 聊天页页面级单测（前端巨页分拆方案 阶段0 · chat 断言先行）
// 目标：为阶段A 拟外移域（confirmList 构建 / batch_blocked 单一真值 / s1Left 折算 / 状态 catch-up 弹窗 /
//       _handleOaConflict once 锚 / _handleApplyFail / applyNotices 域）建立守护断言
// 驱动方式标注：本文件全部用例为「可直接驱动」（onLoad→fetchData 云调用链 + 直调内部方法）；
//   需扩展 harness/桩驱动的项（轮询 tick、showActionSheet、chooseLocation）不列入，见方案 §三-阶段0
const { test } = require('node:test');
const assert = require('node:assert');
const { createPage, sleep } = require('./mp-page-harness.js');

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
    const pay = b.calls.modal.find((m) => String(m.title || '').indexOf('四项已全部确认') >= 0);
    assert.ok(pay, 'user 端应弹四项已全部确认');
    pay.__confirm();
    await sleep(20);
    assert.ok(b.calls.nav.some((n) => /pay\/pay\?orderId=/.test(n.url)), '确认后直达收银台');
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
