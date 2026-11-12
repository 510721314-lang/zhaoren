'use strict';
// utils/confirm-flow.js —— chat 页四确认域（前端巨页分拆阶段A，归属表 v1.1 段1-6 + v2.0 分区二动作链）
// 逐字搬迁自 pages-v2/chat/chat.js applyConfirmation L246-321（零行为变更）；
// 依赖经 page 首参 ctx 注入（先例 utils/order-poll.js）；禁止 require 页面（循环引用）
// 契约：buildConfirmationView(page, d) → { patch, nextStatus, wasUnlocked, unlocked }
//   - patch：17 键集合（快照守护见 scripts/pages-chat.test.js C17），fallback 合并在此侧完成（约束①）
//   - 实例态同步写回：page.__confLoaded / page.__s1Deadline（轮询 tick 与 confirmItem 窗口校验直读 page 实例，约束/代理A#1）
//   - 死代码随迁口径（阶段A 双代理审核收口 2026-11-12）：firstLoad 死变量经审核确认全文件零读取点，
//     按「登记弃置」处理不再随迁（补回徒增死代码）；「💳 订单支付」不可达分支随 chat-notice.js 原样随迁（方案 §三-阶段A⑤）

const { callCloud } = require('./cloud.js');
const { TM_TEMPLATES } = require('../config/enums.js');

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

// ── 分区二：四确认动作链（批次2a：B1-B3 + B5，逐字搬迁自 chat.js 424-491 / 550-595）──
// 零行为变更：方法内 this 引用已全部改为 page（含嵌套箭头回调，'use strict' 下裸 this 为 undefined）；
// 2a 期 startEdit 仍在页面，经 page.startEdit 调用（2b 外移后改模块内自调）；
// TM_FIELD 局部复制，与 chat.js:11 同源（D-1 裁定 2026-11-12）；本区不触碰 @VERIFIED onShow/startPolling。
const TM_FIELD = { TM1: 'time', TM2: 'location', TM3: 'content', TM4: 'fee' };

function onTmOption(page, e) {
  const { tm_id, option } = e.detail;
  const field = TM_FIELD[tm_id];
  if (!field) {
    // TM5 等无确认字段的模板
    wx.showToast({ title: '该模板无需确认', icon: 'none' });
    return;
  }
  if (page.data.chatBlocked) {
    wx.showToast({ title: '订单已取消/关闭,无法操作', icon: 'none' });
    return;
  }
  const positive = TM_TEMPLATES[tm_id] && TM_TEMPLATES[tm_id].options && TM_TEMPLATES[tm_id].options[0] === option;
  if (positive) confirmItem(page, field);
  else page.startEdit(field);
}

function confirmItem(page, field) {
  // 2026-11-05: S2 已支付后确认位不再可改(异常数据兜底), 提前拦截避免"确认失败"弹窗
  if (page.data.orderStatus === 'S2') {
    wx.showToast({ title: '已支付,无需再确认', icon: 'none' });
    return;
  }
  // 2026-11-09: S1 窗口已尽前置拦截, 避免白提交后才收到冲突错误
  if (page.data.orderStatus === 'S1' && page.__s1Deadline && Date.now() >= page.__s1Deadline) {
    page._handleOaConflict({ code: 'oa_not_confirmable', msg: '确认窗口已结束' });
    return;
  }
  page.__requestCommSub();   // 2026-10-17: 点按手势内请求「对方发起沟通」订阅授权(耍伴端, 未配模板/已请求过则跳过)
  wx.showLoading({ title: '提交中', mask: true });
  callCloud('order-action', {
    action: 'confirm_item', order_id: page.data.orderId, item: field
  }).then((r) => {
    wx.hideLoading();
    if (!r.ok) {
      page._handleOaConflict(r);   // 2026-11-09: 状态冲突给出路, 不再死路弹窗
      return;
    }
    return page.refreshConfirmation();
  }).catch(() => {
    wx.hideLoading();
    wx.showToast({ title: '网络异常,请重试', icon: 'none' });
  });
}

// 2026-11-09: 四项常驻清单行内确认(不依赖模板卡); 四栅: S1/未确认/无变更在途/会话未停
function onConfirmRow(page, e) {
  const field = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field) || '';
  const it = (page.data.confirmList || []).find((x) => x.field === field);
  if (!field || !it) return;
  if (page.data.orderStatus !== 'S1') {
    wx.showToast({ title: '当前状态不可确认', icon: 'none' });
    return;
  }
  if (page.data.chatBlocked) {
    wx.showToast({ title: '订单已取消/关闭', icon: 'none' });
    return;
  }
  if (page.data.pendingChange) {
    wx.showToast({ title: '有变更待对方反馈', icon: 'none' });
    return;
  }
  if (it.myOk) {
    wx.showToast({ title: '该项已确认', icon: 'none' });
    return;
  }
  confirmItem(page, field);
}

// ───────── ⑥ 一键全部确认(需求发布者; 批量置本方四项确认位) ─────────
// 后端 confirm_all 原子置本方 4 位 + version+1; 不定向消息, 不破坏"完成前仅模板消息"红线
function onConfirmAll(page) {
  if (page.data.chatBlocked) {
    wx.showToast({ title: '订单已取消/关闭,无法确认', icon: 'none' });
    return;
  }
  // 2026-11-09: 特别授权场景必须逐项确认, 不允许一键全部确认
  if (page.data.batchBlocked) {
    wx.showToast({ title: '该订单需逐项确认', icon: 'none' });
    return;
  }
  // 2026-11-05: S2 已支付后不再允许四确认操作（正常数据不会出现, 异常数据兜底）
  if (page.data.orderStatus === 'S2') {
    wx.showToast({ title: '已支付,无需再确认', icon: 'none' });
    return;
  }
  wx.showModal({
    title: '全部确认',
    content: '将一次性确认 时间/地点/内容/费用 四项。对方已确认的项将即时完成,全部完成即进入待支付。确认后如需修改将全部重置。',
    confirmText: '全部确认', // 上限 4 字符
    cancelText: '再想想',
    confirmColor: '#07C160',
    fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
    success: (res) => {
      if (!res.confirm) return;
      page.__requestCommSub();   // 2026-10-17: 同上(点按手势内请求订阅授权)
      wx.showLoading({ title: '提交中', mask: true });
      callCloud('order-action', {
        action: 'confirm_all', order_id: page.data.orderId
      }).then((r) => {
        wx.hideLoading();
        if (!r.ok) {
          page._handleOaConflict(r);   // 2026-11-09: 状态冲突给出路, 不再死路弹窗
          return;
        }
        wx.showToast({ title: '已全部确认', icon: 'success' });
        // 一键确认只置数据层确认位, 不生成消息卡 → 补齐消息流缺失的确认卡, 让双方都看到全部4项
        page.__sendMissingConfirmCards().then(() => page.refreshConfirmation());
      }).catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常,请重试', icon: 'none' });
      });
    }
  });
}

module.exports = { buildConfirmationView, onTmOption, confirmItem, onConfirmRow, onConfirmAll };
