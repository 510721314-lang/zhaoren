// miniprogram/utils/order-view.js · 订单详情「纯映射」函数（批 5.4 从 order-detail.js 抽离）
// 设计：零副作用、不依赖 wx/云函数，可在 node 下单测。页面 order-detail.js 仅做编排与拉数。
// 抽离前后行为逐行一致；computeNextStep 增加可选 now 参数(默认 Date.now())以支持确定性单测，调用方不传即旧行为。

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
        ? { icon: '🙋', title: '确认耍伴到场', subtitle: '耍伴已到达履约点, 请在下方确认是否开始履约', tone: 'primary' }
        : { icon: '⏳', title: '等待需求方确认', subtitle: '已提交到场申请, 对方确认后开始履约', tone: 'mute' };

    case 'S3_6':
      // 履约双确认(2026-10-15 阶段F): 耍伴已发起完毕确认, 等需求方确认/不确认
      return role === 'user'
        ? { icon: '📸', title: '确认履约完毕', subtitle: '耍伴已提交完成照片与定位凭证, 请在下方确认', tone: 'primary' }
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

module.exports = { computeNextStep, pad, buildModifyTs, buildPrepCountdown };
