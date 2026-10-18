// miniprogram/utils/order-view.js · 订单详情「纯映射」函数（批 5.4 从 order-detail.js 抽离）
// 设计：零副作用、不依赖 wx/云函数，可在 node 下单测。页面 order-detail.js 仅做编排与拉数。
// 抽离前后行为逐行一致；computeNextStep 增加可选 now 参数(默认 Date.now())以支持确定性单测，调用方不传即旧行为。
// @VERIFIED 2026-10-16 已真机验证：拆分阶段1 C1(buildModifyTs/buildPrepCountdown)+C2(buildOrderView/fmtDate) 随 1.6.7 iOS/Android 回归通过(REGISTRY #73/#74)

// 拆分阶段1 C2·A1(2026-10-15): buildOrderView 自 order-detail.js refreshOrder 逐字搬迁引入以下依赖
// redline.getScene 内部 getApp() 有 try/catch 回退 SCENES, node 下可安全 require(已实测)
const CONFIG = require('../config/index.js');
const { ORDER_STATUS, normalizeStatus } = require('../config/enums.js');
const { getScene } = require('./redline.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 根据订单状态 + 当前视角角色, 计算下一步引导横幅
 * @param {object} order - refreshOrder 组装后的订单对象
 * @param {number} [now] - 可选当前时间戳(单测注入), 默认 Date.now()
 * @returns {{icon:string, title:string, subtitle:string, tone:string, action?:{key:string,text:string}}|null}
 */
function computeNextStep(order, now = Date.now()) {
  const status = order.status;
  const role = order.my_role; // 'user' | 'partner' | ''
  const pm = order.pending_modify;
  const pe = order.pending_extend;

  // 加时在途: 优先级最高(比改期更高)
  if (pe) {
    if (pe.can_respond) {
      return {
        icon: '⏰',
        title: '对方申请加时',
        subtitle: `+${pe.add_hours}小时 · ¥${(pe.add_amount_fen / 100).toFixed(2)} · ${pe.expire_text}`,
        tone: 'primary',
        action: { key: 'extend_respond', text: '去确认' }
      };
    }
    return {
      icon: '⏳',
      title: '你发起了加时',
      subtitle: `等待${role === 'user' ? '耍伴' : '发单人'}确认 · +${pe.add_hours}小时 ¥${(pe.add_amount_fen / 100).toFixed(2)}`,
      tone: 'info'
    };
  }

  // 改期在途: 优先级最高
  if (pm) {
    if (pm.can_respond) {
      return {
        icon: '📅',
        title: '对方发起改期',
        subtitle: `新时间: ${pm.new_date} ${pm.new_time} · ${pm.expire_at ? `${Math.round((pm.expire_at - now) / 3600000)}小时内` : '请'}确认`,
        tone: 'primary',
        action: { key: 'modify_respond', text: '去确认' }
      };
    }
    return {
      icon: '⏳',
      title: '你发起了改期',
      subtitle: `等待${role === 'user' ? '耍伴' : '发单人'}确认 · 新时间: ${pm.new_date} ${pm.new_time}`,
      tone: 'info'
    };
  }

  // 按状态分支
  switch (status) {
    case 'S0':
      return role === 'user'
        ? { icon: '💳', title: '请立即支付', subtitle: '30 分钟内未支付订单自动取消', tone: 'warn', action: { key: 'pay', text: '去支付' } }
        : { icon: '⏳', title: '等待发单人支付', subtitle: '支付后订单自动进入待履约', tone: 'mute' };

    case 'S1':
      return {
        icon: '✅', title: '四确认未完成',
        subtitle: role === 'user' ? '进入聊天与耍伴一起确认时间/地点/内容/费用' : '进入聊天与发单人一起确认时间/地点/内容/费用',
        tone: 'primary', action: { key: 'chat', text: '进入聊天' }
      };

    case 'S2':
      return role === 'partner'
        ? { icon: '🚀', title: '准备履约', subtitle: '服务时间到达后点"开始履约"', tone: 'info' }
        : { icon: '🕐', title: '等待服务开始', subtitle: `服务时间 ${order.service_date} ${order.service_time}`, tone: 'mute' };

    case 'S2_6':
      // 履约双确认(2026-10-14 阶段C/D): 耍伴已发起到场申请, 等需求方确认
      return role === 'user'
        ? { icon: '⚠️', title: '对方开始履约申请 待你确认', subtitle: '耍伴已提交到场申请, 请及时处理', tone: 'warn' }
        : { icon: '⏳', title: '等待需求方确认', subtitle: '已提交到场申请, 对方确认后开始履约', tone: 'mute' };

    case 'S3_6':
      // 履约双确认(2026-10-15 阶段F): 耍伴已发起完毕确认, 等需求方确认/不确认
      return role === 'user'
        ? { icon: '⚠️', title: '对方履约完毕申请 待你确认', subtitle: '耍伴已提交完成凭证, 请及时处理', tone: 'warn' }
        : { icon: '⏳', title: '等待需求方确认', subtitle: '已发起完毕确认, 对方确认后订单完成', tone: 'mute' };

    case 'S3': {
      const partnerNext = order.nextPercent;
      if (role === 'partner') {
        return partnerNext
          ? { icon: '📍', title: '提交里程碑', subtitle: `下一节点 ${partnerNext}%, 需先提交 30% 再提 60% 再到 100%`, tone: 'primary', action: { key: 'milestone', text: `提交 ${partnerNext}%` } }
          : { icon: '✅', title: '里程碑 100%', subtitle: '点"履约完成"等待发单人评价', tone: 'primary', action: { key: 'finish', text: '履约完成' } };
      }
      return { icon: '🛡️', title: '履约进行中', subtitle: '如有异常可随时发起安全报备', tone: 'info', action: { key: 'safety', text: '安全报备' } };
    }

    case 'S3_5':
      return role === 'partner'
        ? { icon: '🛟', title: '履约中断', subtitle: '可点"恢复履约"或等发单人确认部分完成', tone: 'warn', action: { key: 'resume', text: '恢复履约' } }
        : { icon: '🛟', title: '履约中断', subtitle: '可确认部分完成等待耍伴补做, 或等待恢复', tone: 'warn' };

    case 'S5':
      return role === 'user'
        ? { icon: '⭐', title: '请评价耍伴', subtitle: '评价影响耍伴信用分, 请客观真实', tone: 'primary', action: { key: 'eval', text: '去评价' } }
        : { icon: '⏳', title: '等待发单人评价', subtitle: '评价完成后分成自动到账', tone: 'mute' };

    case 'S6':
      return { icon: '❌', title: '订单已取消', subtitle: '订单已取消(超时/主动取消), 可重新发布', tone: 'mute' };

    case 'S7':
      return { icon: '💰', title: '订单已退款', subtitle: '退款已退回原账户, 可重新下单', tone: 'info' };

    case 'S8':
      return { icon: '✅', title: '评价已完成', subtitle: '分成已结算, 售后窗口内可发起投诉', tone: 'success' };

    case 'S9':
      return { icon: '⏰', title: '评价超时', subtitle: '系统已默认 4 星评价, 分成已结算', tone: 'mute' };

    case 'S10':
    case 'S10_5':
      return { icon: '🛟', title: '售后处理中', subtitle: '等待客服介入, 请保持沟通畅通', tone: 'warn' };

    default:
      return null;
  }
}

// 组合 picker 的日期+时分 → 本地时间戳
// @VERIFIED 2026-10-13（随源文件 order-detail.js 文件级标记迁入；2026-10-15 拆分阶段1·A3 经书面批准自 L1361 逐字搬迁，唯一差异：this.data 解构改为两个形参）
function buildModifyTs(modifyDate, modifyTime) {
  if (!modifyDate || !modifyTime) return 0;
  const dy = modifyDate.split('-').map(Number);
  const hm = modifyTime.split(':').map(Number);
  if (dy.length !== 3 || dy.some(isNaN) || hm.length !== 2 || hm.some(isNaN)) return 0;
  return new Date(dy[0], dy[1] - 1, dy[2], hm[0], hm[1], 0, 0).getTime();
}

// 履约准备弹窗倒计时文案（分钟/小时/天三档）
// @VERIFIED 2026-10-13（随源文件 order-detail.js 文件级标记迁入；2026-10-15 拆分阶段1·A4 经书面批准自 onViewPrep L679-687 逐字搬迁，唯一差异：增加可选 now 参数支持确定性单测，调用方不传即旧行为）
function buildPrepCountdown(o, now = Date.now()) {
  const startTs = o.service_start_ts || (o.service_date && o.service_time
    ? new Date(`${o.service_date}T${o.service_time.replace(/(\d{1,2}):(\d{2})/, (_, h, m) => `${h.padStart(2,'0')}:${m}`)}:00`).getTime()
    : 0);
  const diffMin = Math.max(0, Math.round((startTs - now) / 60000));
  const diffStr = diffMin < 60
    ? `还有 ${diffMin} 分钟开始`
    : diffMin < 1440
      ? `还有 ${Math.round(diffMin/60)} 小时 ${diffMin%60} 分钟开始`
      : `还有 ${Math.round(diffMin/1440)} 天开始`;
  return diffStr;
}

// 日期 → YYYY-MM-DD（改期 picker 上下限用）
// @VERIFIED 2026-10-13（随源文件 order-detail.js 文件级标记迁入；2026-10-15 拆分阶段1·A2 经书面批准自 L642 逐字搬迁）
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 拆分阶段2c(2026-10-16): 到账通知时间戳(毫秒 → MM-DD HH:mm)自 order-detail.js __fmtNoticeTime 逐字迁入(用户裁定归属, §8.2 前置3)
// 原注释: fmtDate 已在拆分阶段1 C2·A2 外移 utils/order-view.js, 本页无残留调用
function fmtNoticeTime(ts) {
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// detail 原始返回 d → 页面 setData 视图 patch（13 键同形，逐键与旧 refreshOrder 内联实现一致）
// @VERIFIED 2026-10-13（随源文件 order-detail.js 文件级标记迁入；2026-10-15 拆分阶段1·A1 经书面批准自 refreshOrder L317-510 逐字搬迁；
// 唯一机械差异：①this.setData(x) 改 return x；②this.fmtDate 改模块内 fmtDate；③3 处时间源 Date.now()/new Date() 收敛为可选 now 参数，不传即旧行为）
function buildOrderView(d, now = Date.now()) {
  // detail 返回字段 → WXML 绑定字段
  const st = Number(d.start_time) || 0;
  const dt = st ? new Date(st) : null;
  // milestone: { current:0-3, confirmed:[bool,bool,bool], evidence:[...] }
  const ms = d.milestone || { current: 0, confirmed: [false, false, false], evidence: [] };
  const milestoneSteps = [
    { idx: 1, label: '30%', done: ms.current >= 1 },
    { idx: 2, label: '60%', done: ms.current >= 2 },
    { idx: 3, label: '100%', done: ms.current >= 3 }
  ];
  // 下一节点百分比: nextIdx 1→30%, 2→60%, 3→100%
  const nextPercent = ms.current >= 3 ? null : [30, 60, 100][ms.current];
  // C1 改期在途申请(云端点号状态经 normalizeStatus 归一化为下划线)
  const pm = d.pending_modify || null;
  let pendingModify = null;
  if (pm && pm.new_start_time) {
    const pdt = new Date(pm.new_start_time);
    pendingModify = {
      new_date: `${pdt.getFullYear()}-${pad(pdt.getMonth() + 1)}-${pad(pdt.getDate())}`,
      new_time: `${pad(pdt.getHours())}:${pad(pdt.getMinutes())}`,
      by_role: pm.by_role || '',
      reason: pm.reason || '',
      expire_at: pm.expire_at || 0,
      // 仅对方(非发起人)显示同意/拒绝按钮
      can_respond: !!d.role && !!pm.by_role && d.role !== pm.by_role
    };
  }
  // 加时在途申请(同改期)
  const pe = d.pending_extend || null;
  let pendingExtend = null;
  if (pe && pe.add_hours) {
    const expireMs = (pe.expire_at || 0) - now;
    // 剩余时限文案: 不足 1 小时按分钟显示(后台加时确认窗口默认 20 分钟, 分钟制), 否则按小时取整
    const expireMins = Math.max(0, Math.round(expireMs / 60000));
    const expireText = expireMins >= 60 ? `${Math.round(expireMins / 60)}小时内确认` : `${expireMins}分钟内确认`;
    pendingExtend = {
      add_hours: pe.add_hours,
      add_amount_fen: pe.add_amount_fen || 0,
      by_role: pe.by_role || '',
      reason: pe.reason || '',
      expire_at: pe.expire_at || 0,
      expire_text: expireMs > 0 ? expireText : '已超时',
      can_respond: !!d.role && !!pe.by_role && d.role !== pe.by_role
    };
  }
  // 改期结果(2026-10-12): 由云端返回的最近一次改期处理时间戳推导, 供双方详情页展示(不再仅发起方一次性 toast)
  const mcAt = Number(d.modify_confirmed_at) || 0;
  const mrAt = Number(d.modify_rejected_at) || 0;
  const modifyResult = (!mcAt && !mrAt) ? null
    : (mcAt >= mrAt
      ? { type: 'confirmed', text: '改期已确认，服务时间已更新' }
      : { type: 'rejected', text: '改期申请已被拒绝，服务时间不变' });
  // 投诉详情卡(2026-10-12): 云端 detail 回传 complaint(未发起过为 null), 时间统一格式化为 MM-DD HH:mm
  const cRaw = d.complaint || null;
  const fmtTs = (ts) => {
    const t = Number(ts);
    if (!t) return '';
    const dd = new Date(t);
    if (isNaN(dd.getTime())) return '';
    return `${pad(dd.getMonth() + 1)}-${pad(dd.getDate())} ${pad(dd.getHours())}:${pad(dd.getMinutes())}`;
  };
  const complaint = cRaw ? {
    status: cRaw.status || 'open',
    status_text: cRaw.status === 'withdrawn' ? '已撤回' : (cRaw.status === 'resolved' ? '平台已处理' : '处理中'),
    by_text: cRaw.by_role === 'system'
      ? '系统超时转入'
      : `${cRaw.mine ? '我' : '对方'}（${cRaw.by_role === 'user' ? '发单人' : '耍伴'}）`,
    reason: cRaw.reason || '',
    at_text: fmtTs(cRaw.at),
    withdrawn_at_text: fmtTs(cRaw.withdrawn_at),
    handled_at_text: fmtTs(cRaw.handled_at),
    result_note: cRaw.result_note || '',
    refund_text: Number(cRaw.refund_fen) > 0 ? (Number(cRaw.refund_fen) / 100).toFixed(2) : ''
  } : null;

  // 付款后信息全量展示(2026-10-12): 资金明细 / 退款 / 争议正交位 / 费用明细(老订单无这些字段 → 全 null 安全)
  const yuan = (fen) => (Number(fen || 0) / 100).toFixed(2);
  const SETTLE_TEXT = { pending: '待结算', ready: '可结算', done: '已结算' };
  const REFUND_SRC = { dispute: '争议裁决退款', cancel: '订单取消退款', no_show: '爽约赔付', partner: '耍伴赔付', system: '平台退款' };
  // 阶段G(2026-10-15): 新增履约双确认超时/连续拒绝/不确认转争议的两类 type 文案, 否则回退显示原始英文值
  const DISPUTE_TYPE = { complaint: '投诉', no_show: '爽约申诉', refund: '退款争议', start_timeout: '开始履约超时', finish_timeout: '完毕确认超时' };
  const fRaw = d.fund || null;
  const rRaw = d.refund || null;
  const dvRaw = d.dispute || null;
  const feeRaw = d.fees || null;
  const money = (fRaw && Number(fRaw.paid_fen) > 0) ? {
    paid_text: yuan(fRaw.paid_fen),
    refunded_text: yuan(fRaw.refunded_fen),
    settle_text: SETTLE_TEXT[fRaw.settle_state] || '',
    settled_at_text: fmtTs(fRaw.settled_at)
  } : null;
  const refundView = rRaw ? {
    amount_text: yuan(rRaw.fen),
    source_text: REFUND_SRC[rRaw.source] || rRaw.source || '',
    at_text: fmtTs(rRaw.at),
    no: rRaw.no || ''
  } : null;
  const disputeView = (dvRaw && dvRaw.state === 'open') ? {
    type_text: DISPUTE_TYPE[dvRaw.type] || dvRaw.type || '争议',
    opened_at_text: fmtTs(dvRaw.opened_at)
  } : null;
  const feesView = (feeRaw && (Number(feeRaw.fee_fen) > 0 || Number(feeRaw.partner_income_fen) > 0 || feeRaw.aa_tier)) ? {
    fee_text: yuan(feeRaw.fee_fen),
    income_text: yuan(feeRaw.partner_income_fen),
    aa_tier: feeRaw.aa_tier || ''
  } : null;
  // 履约留痕(需求B一期可视化, 2026-10-14): 现场照片(fileID 直供 <image src>, 与爽约证据同约定)+到场地址/时间, 双方可见
  const seRaw = d.service_start_evidence || null;
  const startEvidence = (seRaw && Array.isArray(seRaw.photos) && seRaw.photos.length) ? {
    photos: seRaw.photos.map((p) => (p && p.file_id) || '').filter(Boolean),
    address: (seRaw.partner_location && seRaw.partner_location.address) || '',
    at_text: fmtTs(seRaw.submitted_at || 0)
  } : null;
  // 阶段F(2026-10-15): 完毕确认的完成照片+定位(双方可见, 规范 §2.3 第4条), 结构同 start_evidence
  const fseRaw = d.service_finish_evidence || null;
  const finishEvidence = (fseRaw && Array.isArray(fseRaw.photos) && fseRaw.photos.length) ? {
    photos: fseRaw.photos.map((p) => (p && p.file_id) || '').filter(Boolean),
    address: (fseRaw.partner_location && fseRaw.partner_location.address) || '',
    at_text: fmtTs(fseRaw.submitted_at || 0)
  } : null;
  // 阶段C/D(2026-10-14): 需求方视角的耍伴联系信息(实名+脱敏号)与确认按钮文案
  const pc = d.partner_contact || null;
  const startConfirmText = (pc && (pc.real_name || pc.phone_mask))
    ? `确认耍伴（${pc.real_name || ''}${pc.real_name && pc.phone_mask ? ' · ' : ''}${pc.phone_mask || ''}）已到场`
    : '确认耍伴已到场';
  const order = {
    _id: d.order_id,
    order_id: d.order_id,
    order_no: d.order_no,
    demand_title: d.demand_title || '',                   // 需求标题(2026-10-16 新增展示, 服务端拆 demand.remark 下发)
    demand_desc: d.demand_desc || '',                     // 需求详细描述(同上)
    status: normalizeStatus(d.status),
    my_role: d.role || '',
    complaint,                                            // 投诉详情(原因全文/发起方/状态/处理结论/退款)
    money,                                                // 资金明细(实付/已退/结算状态)
    refund_view: refundView,                              // 退款(含非投诉路径的 S7 自助退)
    dispute_view: disputeView,                            // 争议处理中(投诉/爽约申诉) + 开启时间
    fees_view: feesView,                                  // 费用明细(平台服务费/耍伴收入/AA 档)
    can_withdraw_complaint: !!d.can_withdraw_complaint,   // 撤回投诉入口(仅发起人、平台受理前)
    frozen: !!d.frozen,                                   // 冻结位(2026-10-12): 在途争议/申诉期间隐藏投诉等推进入口
    start_evidence: startEvidence,                        // 履约留痕(2026-10-14): 开始履约现场照片+到场地址/时间
    finish_evidence: finishEvidence,                      // 阶段F(2026-10-15): 完毕确认完成照片+地址/时间(双方可见)
    user_confirm: d.user_confirm || null,                 // 需求B二期到场确认(2026-10-14): 原白名单漏映射, 致 WXML「你已确认到场」不显示
    urge: d.urge || null,                                 // Wave2 止血⑥: 催办信息(count/max/can_urge/auto_reminded/logs)
    modify_count: d.modify_count || 0,
    modify_result: modifyResult,
    pending_modify: pendingModify,
    pending_extend: pendingExtend,
    scene_code: d.scene,
    scene_content_text: ((d.content_options && d.content_options.length ? d.content_options : (d.content_option ? [d.content_option] : [])) || []).join('/'),
    partner_name: d.partner_nickname,
    partner_contact: pc,                                  // 阶段C/D: 需求方看耍伴实名+脱敏号(非需求方为 null)
    start_confirm_text: startConfirmText,                 // 阶段C/D: S2_6 需求方确认按钮文案
    location: d.location || {},
    service_date: dt ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` : '',
    service_time: dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '',
    duration_hours: d.duration_h || 0,
    amount_fen: d.total_fen || 0,
    tip_total_fen: d.tip_total_fen || 0,
    insurance: null, // detail 暂未返回保险, 先隐藏保险卡
    confirm: d.confirm,
    evaluation: d.evaluation,
    pay_expire_at: d.pay_expire_at,
    milestone: ms,
    milestoneSteps,
    nextPercent,
    canFinishService: ms.current >= 3
  };

  // 引导横幅: 根据 status + my_role + 特殊条件计算下一步
  const nextStep = computeNextStep(order);

  const scene = getScene(d.scene);
  const statusInfo = ORDER_STATUS[order.status] || ORDER_STATUS.S1;
  // 改期次数以 detail 返回的 modify_count 为准
  const modifyUsedUp = (d.modify_count || 0) >= CONFIG.MODIFY.maxTimes;
  // 取消档位: detail 返回 start_time, 按 CONFIG.CANCEL_LEAD_HOURS 计算
  const serviceStart = new Date(st);
  const hoursLeft = (serviceStart - new Date(now)) / 3600000;
  let currentCancelIdx = 0;
  const [leadH1, leadH2] = CONFIG.CANCEL_LEAD_HOURS || [24, 2];
  if (hoursLeft > leadH1) currentCancelIdx = 0;
  else if (hoursLeft > leadH2) currentCancelIdx = 1;
  else currentCancelIdx = 2;
  return {
    order,
    scene,
    statusInfo,
    modifyUsedUp,
    currentCancelIdx,
    tipEnabled: !!(CONFIG.PAYMENT && CONFIG.PAYMENT.tipEnabled),
    orderSummary: d.order_summary || null,
    amountYuan: ((order.amount_fen || 0) / 100).toFixed(2),
    tipTotalYuan: ((order.tip_total_fen || 0) / 100).toFixed(2),
    modifyDateMin: fmtDate(new Date(now)),
    timeMaxRange: fmtDate(new Date(now + CONFIG.MODIFY.maxSpanH * 3600000)),
    nextStep,
    finishingService: false
  };
}

module.exports = { computeNextStep, pad, buildModifyTs, buildPrepCountdown, fmtDate, buildOrderView, fmtNoticeTime };
