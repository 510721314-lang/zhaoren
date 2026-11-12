'use strict';
// utils/confirm-flow.js —— chat 页四确认「数据加工域」（前端巨页分拆阶段A，归属表 v1.1 段1-6）
// 逐字搬迁自 pages-v2/chat/chat.js applyConfirmation L246-321（零行为变更）；
// 依赖经 page 首参 ctx 注入（先例 utils/order-poll.js）；禁止 require 页面（循环引用）
// 契约：buildConfirmationView(page, d) → { patch, nextStatus, wasUnlocked, unlocked }
//   - patch：17 键集合（快照守护见 scripts/pages-chat.test.js C17），fallback 合并在此侧完成（约束①）
//   - 实例态同步写回：page.__confLoaded / page.__s1Deadline（轮询 tick 与 confirmItem 窗口校验直读 page 实例，约束/代理A#1）
//   - 死代码随迁口径（阶段A 双代理审核收口 2026-11-12）：firstLoad 死变量经审核确认全文件零读取点，
//     按「登记弃置」处理不再随迁（补回徒增死代码）；「💳 订单支付」不可达分支随 chat-notice.js 原样随迁（方案 §三-阶段A⑤）

// 段1(原 L246-252) 进度位与计数 —— 真纯计算
function buildConfirmationView(page, d) {
  const items = d.items || {};
  const both = (f) => !!(items[f] && items[f].user_ok && items[f].partner_ok);
  const progress = {
    time: both('time'), location: both('location'),
    content: both('content'), fee: both('fee')
  };
  const count = [progress.time, progress.location, progress.content, progress.fee].filter(Boolean).length;
  // 段2(原 L254-270) 四项常驻清单 —— 双方均可见「时间/地点/内容/费用」当前值与各自确认状态
  const CONF_META = [
    { f: 'time', cn: '时间', icon: '🕐' },
    { f: 'location', cn: '地点', icon: '📍' },
    { f: 'content', cn: '内容', icon: '📋' },
    { f: 'fee', cn: '费用', icon: '💰' }
  ];
  const isPartner = page.data.role === 'partner';
  const confirmList = CONF_META.map((m) => {
    const it = items[m.f] || {};
    const myOk = isPartner ? !!it.partner_ok : !!it.user_ok;
    const peerOk = isPartner ? !!it.user_ok : !!it.partner_ok;
    return {
      field: m.f, cn: m.cn, icon: m.icon,
      value: page.__changeValueText(m.f, it.value),
      myOk, peerOk, done: myOk && peerOk
    };
  });
  // 段3(原 L271-284) 解锁位与 S1 剩余窗口
  const wasUnlocked = page.data.unlocked;
  const unlocked = !!d.all_confirmed;
  page.__confLoaded = true;
  // status 强制用后端返回值, 不做 || 兜底(后端不会返回空 status)
  const nextStatus = d.status && d.status !== page.data.orderStatus ? d.status : page.data.orderStatus;
  // 2026-11-09: S1 剩余窗口 —— 用服务端 s1_expire_at-server_now 差值折算本地截止时间, 抵消双端时钟偏差;
  // created_at 缺失(=0)不倒计时, 禁止 now 兜底
  if (d.s1_expire_at > 0 && d.server_now > 0) {
    page.__s1Deadline = Date.now() + (d.s1_expire_at - d.server_now);
  } else if (nextStatus !== 'S1') {
    page.__s1Deadline = 0;
  }
  const s1Left = (nextStatus === 'S1' && page.__s1Deadline) ? Math.max(0, Math.floor((page.__s1Deadline - Date.now()) / 1000)) : 0;
  // 段4(原 L286-303) 加时/改期在途请求 → 醒目横幅(对方发起且未处理; 常驻至确认/拒绝/超时; 先给订单概要)
  const pm = d.pending_modify;
  const pe = d.pending_extend;
  let pendingBanner = null;
  if (pe && pe.can_respond) {
    pendingBanner = {
      type: 'extend', summary: page.__orderSummary(d),
      title: '⏰ 对方申请加时',
      body: `加时 ${pe.add_hours} 小时 · ¥${(pe.add_amount_fen / 100).toFixed(2)} · 点击去处理 ›`,
      canRespond: true
    };
  } else if (pm && pm.can_respond && nextStatus === 'S2_5') {
    pendingBanner = {
      type: 'modify', summary: page.__orderSummary(d),
      title: '📅 对方申请改期',
      body: `改至 ${page.fmtDateTime(pm.new_start_time)} · 点击去处理 ›`,
      canRespond: true
    };
  }
  // 段5(原 L305-318) S1 变更协商在途态(对方接受才生效); 前端只展示必要字段
  const CHANGE_CN = { time: '时间', location: '地点', content: '内容', fee: '费用', other: '其他' };
  const pc = d.pending_change || null;
  const pendingChange = pc ? {
    field: pc.field,
    field_cn: CHANGE_CN[pc.field] || pc.field,
    old_text: page.__changeValueText(pc.field, pc.old_value),
    new_text: page.__changeValueText(pc.field, pc.new_value),
    by_role: pc.by_role || '',
    by_text: pc.by_role === 'user' ? '发单人' : '耍伴',
    reason: pc.reason || '',
    expire_text: pc.expire_at ? `${page.fmtDateTime(pc.expire_at)} 前反馈` : '请在 15 分钟内反馈',
    can_respond: !!pc.can_respond,
    token: pc.token || ''
  } : null;
  // 段6(原 L319-321) 付费后改期/改地点前置校验数据 —— get_confirmation 新增下发; 不读则新校验恒为假
  const s2c = d.s2_change_counts || {};
  const s2Counts = { total: Number(s2c._total) || 0, location: Number(s2c.location) || 0, content: Number(s2c.content) || 0 };
  // 段7 的 patch 装配（原 L322-341 setData 键集合，17 键快照守护；4 个「读旧值条件保留」键按 page.data 求值）
  const patch = {
    items,
    progress,
    confirmedCount: count,
    confirmList,
    unlocked,
    freeChat: unlocked || page.data.freeChat,
    orderStatus: nextStatus,
    startTime: Number(d.start_time) || page.data.startTime || 0,
    pendingBanner,
    pendingChange,
    frozen: !!d.frozen,
    s2Counts,
    s1Left,
    s1Text: s1Left > 0 ? page.__s1Text(s1Left) : '',
    // 2026-11-09: 轮询发现终态时同步停会话标记(im-conv.open 仅进页快照, 轮询期订单取消不会重推)
    chatBlocked: (nextStatus === 'S6' || nextStatus === 'S10') ? true : page.data.chatBlocked,
    // 2026-11-09: 特别授权判定以服务端下发 batch_blocked 为单一真值(本地 scene 判定仅兜底)
    batchBlocked: !!d.batch_blocked || page.data.batchBlocked,
    orderSummary: page.__orderSummary(d)
  };
  return { patch, nextStatus, wasUnlocked, unlocked };
}

module.exports = { buildConfirmationView };
