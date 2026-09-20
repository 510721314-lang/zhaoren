// PRD章节: 3.5 订单生命周期 / 3.5.2 13态状态机 / 3.5.3 改期 / 3.5.4 取消梯度退款 / 3.7 保险 / R1时间红线
// P0-4: 接云端 order-action detail, 删除 mock findOrder 依赖
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { SCENES, ORDER_STATUS, normalizeStatus } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 根据订单状态 + 当前视角角色, 计算下一步引导横幅
 * @param {object} order - refreshOrder 组装后的订单对象
 * @returns {{icon:string, title:string, subtitle:string, tone:'primary'|'info'|'warn'|'mute', action?:{key:string,text:string}}|null}
 */
function computeNextStep(order) {
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
        subtitle: `新时间: ${pm.new_date} ${pm.new_time} · ${pm.expire_at ? `${Math.round((pm.expire_at - Date.now()) / 3600000)}小时内` : '请'}确认`,
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

Page({
  data: {
    order: null,
    scene: null,
    statusInfo: null,
    countdownText: '',
    modifyPanelVisible: false,
    modifyUsedUp: false,
    extendPanelVisible: false,
    extendHours: 1,
    extendRefPriceFen: 0,
    extendReason: '',
    modifyReason: '',
    cancelTiers: CONFIG.CANCEL_REFUND,
    currentCancelIdx: 0,
    modifyDate: '',
    modifyTime: '',
    modifyDateMin: '',
    timeMaxRange: '',
    loading: false,
    loadError: false,
    loadErrorMsg: '',
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: redline.PICKER_CLOSE,
    modifyRuleText: `规则：提前${CONFIG.MODIFY.minLeadHours}小时以上/最多${CONFIG.MODIFY.maxTimes}次/${CONFIG.MODIFY.freeFirst ? '首次免费/' : ''}第二次收${CONFIG.MODIFY.secondFeeRate * 100}%手续费/幅度≤${CONFIG.MODIFY.maxSpanH}小时`,
    s35ResponseMin: CONFIG.SAFETY.s35ResponseMin,
    modifyConfirmH: CONFIG.MODIFY.confirmHours,
    insuranceWan: '',
    afterSaleDays: CONFIG.ORDER.afterSaleDays,
    // 安全中心: 进行中求助/最近报备/我的紧急联系人(由 safety-report status 填充)
    safety: { help_flag: false, active_sos: null, checkins: [], contacts: [] }
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad(options) {
    this.fetchData(options);
  },

  fetchData(options) {
    this.__orderId = (options && options.orderId) || '';
    this.__lastOptions = options || {};
    if (!/^[a-f0-9]{32}$/i.test(this.__orderId)) {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '缺少有效订单 ID' });
      return;
    }
    this.setData({ loading: true, loadError: false });
    callCloud('order-action', { action: 'detail', order_id: this.__orderId }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true, loadErrorMsg: r.msg || '加载失败' });
        return;
      }
      this.refreshOrder(r.data);
      this.setData({ loading: false });
      this.startCountdown();
      // 履约活跃状态拉取安全中心(求助/报备/紧急联系人), 其余状态不查
      const st = normalizeStatus(r.data.status);
      if (['S2', 'S3', 'S3_5', 'S4'].indexOf(st) >= 0) {
        this.fetchSafety();
      }
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请重试' });
    });
  },

  // 拉取安全中心状态(safety-report status: 仅订单参与方可读)
  fetchSafety() {
    callCloud('safety-report', { action: 'status', order_id: this.__orderId }).then((r) => {
      if (!r.ok || !r.data) return;
      const checkins = (r.data.checkins || []).map((c, i) => {
        const d = c.created_at ? new Date(c.created_at) : new Date();
        return {
          key: `${i}-${c.created_at || 0}`,
          text: (c.reporter_role === 'partner' ? '耍伴' : '发单人') + '已报备',
          time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
        };
      });
      this.setData({
        safety: {
          help_flag: !!r.data.help_flag,
          active_sos: r.data.active_sos || null,
          checkins,
          contacts: r.data.my_contacts || []
        }
      });
    }).catch(() => {});
  },

  reload() { this.fetchData(this.__lastOptions || {}); },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (this.data.order && this.data.order.order_id) {
      this.fetchData({ orderId: this.data.order.order_id });
    }
  },

  onUnload() { this.clearTimers(); },
  onHide() { this.clearTimers(); },

  refreshOrder(d) {
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
      const expireMs = (pe.expire_at || 0) - Date.now();
      const expireHours = Math.max(0, Math.round(expireMs / 3600000));
      pendingExtend = {
        add_hours: pe.add_hours,
        add_amount_fen: pe.add_amount_fen || 0,
        by_role: pe.by_role || '',
        reason: pe.reason || '',
        expire_at: pe.expire_at || 0,
        expire_text: expireMs > 0 ? `${expireHours}小时内确认` : '已超时',
        can_respond: !!d.role && !!pe.by_role && d.role !== pe.by_role
      };
    }
    const order = {
      _id: d.order_id,
      order_id: d.order_id,
      order_no: d.order_no,
      status: normalizeStatus(d.status),
      my_role: d.role || '',
      modify_count: d.modify_count || 0,
      pending_modify: pendingModify,
      pending_extend: pendingExtend,
      scene_code: d.scene,
      partner_name: d.partner_nickname,
      location: d.location || {},
      service_date: dt ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` : '',
      service_time: dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '',
      duration_hours: d.duration_h || 0,
      amount_fen: d.total_fen || 0,
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

    const scene = SCENES.find((s) => s.code === d.scene) || null;
    const statusInfo = ORDER_STATUS[order.status] || ORDER_STATUS.S1;
    // 改期次数以 detail 返回的 modify_count 为准
    const modifyUsedUp = (d.modify_count || 0) >= CONFIG.MODIFY.maxTimes;
    // 取消档位: detail 返回 start_time, 按 CONFIG.CANCEL_LEAD_HOURS 计算
    const serviceStart = new Date(st);
    const hoursLeft = (serviceStart - new Date()) / 3600000;
    let currentCancelIdx = 0;
    const [leadH1, leadH2] = CONFIG.CANCEL_LEAD_HOURS || [24, 2];
    if (hoursLeft > leadH1) currentCancelIdx = 0;
    else if (hoursLeft > leadH2) currentCancelIdx = 1;
    else currentCancelIdx = 2;
    this.setData({
      order,
      scene,
      statusInfo,
      modifyUsedUp,
      currentCancelIdx,
      amountYuan: ((order.amount_fen || 0) / 100).toFixed(2),
      modifyDateMin: this.fmtDate(new Date()),
      timeMaxRange: this.fmtDate(new Date(Date.now() + CONFIG.MODIFY.maxSpanH * 3600000)),
      nextStep
    });
  },

  clearTimers() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  startCountdown() {
    this.clearTimers();
    this._timer = setInterval(() => {
      const o = this.data.order;
      if (!o) return;
      // PRD 3.5.2：倒计时文案以 ORDER_STATUS.timeoutText 为唯一 SSOT
      const st = ORDER_STATUS[o.status];
      this.setData({ countdownText: st ? st.timeoutText : '' });
    }, 1000);
  },

  fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // O3 操作区
  // 用户端 S2: 查看履约准备 (弹窗展示履约信息 + 可选操作)
  onViewPrep() {
    const o = this.data.order || {};
    const now = Date.now();
    const startTs = o.service_start_ts || (o.service_date && o.service_time
      ? new Date(`${o.service_date}T${o.service_time.replace(/(\d{1,2}):(\d{2})/, (_, h, m) => `${h.padStart(2,'0')}:${m}`)}:00`).getTime()
      : 0);
    const diffMin = Math.max(0, Math.round((startTs - now) / 60000));
    const diffStr = diffMin < 60
      ? `还有 ${diffMin} 分钟开始`
      : diffMin < 1440
        ? `还有 ${Math.round(diffMin/60)} 小时 ${diffMin%60} 分钟开始`
        : `还有 ${Math.round(diffMin/1440)} 天开始`;

    wx.showModal({
      title: '📋 履约准备',
      content: [
        `耍伴：${o.partner_name || '耍伴'}`,
        `时间：${o.service_date || ''} ${o.service_time || ''}`,
        `地点：${o.location_name || o.location?.name || ''}`,
        `金额：¥${this.data.amountYuan || ''}`,
        `状态：${diffStr}`
      ].join('\n'),
      confirmText: '更多操作',
      cancelText: '关闭',
      success: (res) => {
        if (!res.confirm) return;
        wx.showActionSheet({
          itemList: ['💬 联系耍伴', '📅 发起改期', '📢 催促耍伴'],
          success: (r) => {
            if (r.tapIndex === 0) this.goChat();
            else if (r.tapIndex === 1) this.onModify();
            else if (r.tapIndex === 2) {
              // 催促耍伴: 后端写一条 system_notice 给耍伴
              wx.showLoading({ title: '发送中', mask: true });
              callCloud('order-action', {
                action: 'nudge_partner',
                order_id: o._id
              }).then((rr) => {
                wx.hideLoading();
                wx.showToast({ title: rr.ok ? '已通知耍伴' : (rr.msg || '发送失败'), icon: rr.ok ? 'success' : 'none' });
              }).catch(() => {
                wx.hideLoading();
                wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
              });
            }
          }
        });
      }
    });
  },

  onStartService() {
    const that = this;
    wx.showModal({
      title: '确认开始履约',
      content: '开始履约后进入安全保障期',
      confirmText: '开始',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'start_service', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已开始履约', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  onSafety() {
    // 安全报备(打卡报平安/定位追踪)仅在履约中开放; S2 待履约阶段引导先开始履约
    const st = this.data.order && this.data.order.status;
    if (st !== 'S3' && st !== 'S3_5' && st !== 'S4') {
      wx.showToast({ title: '开始履约后可安全报备', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/safety/safety?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '安全报备页打开失败', icon: 'none' })
    });
  },

  // 🆘 紧急求助(图5): 二次确认 → 高精度定位 → 云端记录并通知平台 → 弹联系人/110/120 直接拨打
  onSos() {
    const that = this;
    const alreadyActive = this.data.safety && this.data.safety.active_sos;
    wx.showModal({
      title: '🆘 紧急求助',
      content: alreadyActive
        ? '你已有进行中的求助。可直接拨打紧急联系人或 110/120，无需重复求助。'
        : '将记录你的实时位置并通知平台，随后可一键拨打紧急联系人或 110/120。确认发起？',
      confirmText: alreadyActive ? '去拨打' : '发起求助',
      cancelText: '取消',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        if (alreadyActive) {
          that._showCallSheet(that.data.safety.contacts || []);
          return;
        }
        wx.showLoading({ title: '提交中', mask: true });
        // 定位失败不阻断求助(云端允许无位置 SOS), 保证紧急场景可用
        wx.getLocation({
          type: 'gcj02',
          isHighAccuracy: true,
          highAccuracyExpireTime: 4000,
          success: (loc) => that._submitSos({ latitude: loc.latitude, longitude: loc.longitude }),
          fail: () => that._submitSos(null)
        });
      }
    });
  },

  _submitSos(loc) {
    const that = this;
    callCloud('safety-report', {
      action: 'sos',
      order_id: this.data.order._id,
      location: loc
    }).then((r) => {
      wx.hideLoading();
      if (!r.ok) {
        wx.showModal({
          title: '求助提交失败',
          content: (r.msg || '网络异常') + '，如遇紧急情况请直接拨打 110。',
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
      this.fetchSafety();
      that._showCallSheet((r.data && r.data.my_contacts) || []);
    }).catch(() => {
      wx.hideLoading();
      wx.showModal({
        title: '网络异常',
        content: '求助信息未送达，如遇紧急情况请直接拨打 110。',
        showCancel: false,
        confirmText: '知道了'
      });
    });
  },

  // 弹出可拨打清单: 我的紧急联系人 + 报警110 + 急救120
  _showCallSheet(contacts) {
    const list = (contacts || []).map((c) => `📞 ${c.name}${c.relation ? '(' + c.relation + ')' : ''}`);
    list.push('🚓 报警 110');
    list.push('🚑 急救 120');
    if (!(contacts && contacts.length)) {
      wx.showToast({ title: '未设置紧急联系人，可拨打110/120', icon: 'none', duration: 2200 });
    }
    wx.showActionSheet({
      itemList: list,
      success: (res) => {
        let phone = '';
        if (res.tapIndex < (contacts ? contacts.length : 0)) {
          phone = contacts[res.tapIndex].phone;
        } else if (res.tapIndex === (contacts ? contacts.length : 0)) {
          phone = '110';
        } else {
          phone = '120';
        }
        if (!phone) return;
        wx.makePhoneCall({
          phoneNumber: String(phone),
          fail: () => {}
        });
      },
      fail: () => {
        // 用户未选择拨打时, 若无联系人引导去添加
        if (!(contacts && contacts.length)) {
          wx.showModal({
            title: '添加紧急联系人',
            content: '建议提前设置 1-2 位紧急联系人，求助时可一键拨打。',
            confirmText: '去设置',
            cancelText: '稍后',
            success: (m) => {
              if (m.confirm) {
                wx.navigateTo({
                  url: '/pages-v2/contacts/contacts',
                  fail: () => wx.showToast({ title: '页面打开失败', icon: 'none' })
                });
              }
            }
          });
        }
      }
    });
  },

  // 里程碑提交: 耍伴在 S3 履约中逐步提交 30%→60%→100%
  onMilestoneSubmit() {
    const order = this.data.order;
    const next = (order.milestone && order.milestone.current || 0) + 1;
    if (next > 3) {
      wx.showToast({ title: '已提交到100%', icon: 'none' });
      return;
    }
    const that = this;
    wx.showModal({
      title: `提交履约进度 ${next * 30}%`,
      content: '提交后用户会收到通知，双方可继续履约',
      confirmText: '提交',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中', mask: true });
        callCloud('order-action', {
          action: 'milestone_submit',
          order_id: that.data.order._id,
          note: ''
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '提交失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: `已提交${r.data.label}`, icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // 加时申请: 内联时长选择 + 云函数算价 + showModal 二次确认
  onAddTime() {
    const order = this.data.order;
    if (!order || order.status !== 'S3') {
      wx.showToast({ title: '仅履约中可加时', icon: 'none' });
      return;
    }
    if (order.pending_extend) {
      wx.showToast({ title: '已有待确认的加时申请', icon: 'none' });
      return;
    }
    // 按原单价算参考价(仅展示, 以云端为准)
    const durationH = Number(order.duration_h) || 1;
    const totalFen = Number(order.total_fen) || 0;
    const hourRateFen = Math.round(totalFen / durationH);
    this.setData({
      extendPanelVisible: true,
      extendHours: 1,
      extendRefPriceFen: hourRateFen,
      extendReason: ''
    });
  },

  closeExtendPanel() { this.setData({ extendPanelVisible: false, extendReason: '' }); },

  onExtendHoursTap(e) {
    this.setData({ extendHours: Number(e.currentTarget.dataset.hours) });
  },

  onExtendReasonInput(e) {
    const v = (e.detail.value || '').slice(0, 200);
    this.setData({ extendReason: v });
  },

  submitExtend() {
    const that = this;
    const hours = Number(this.data.extendHours);
    if (!hours || hours < 1 || hours > 12) {
      wx.showToast({ title: '加时时长须为1-12小时', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '提交加时', mask: true });
    callCloud('order-action', {
      action: 'extend',
      order_id: this.data.order._id,
      add_hours: hours,
      reason: (this.data.extendReason || '').trim().slice(0, 200)
    }).then((r) => {
      wx.hideLoading();
      if (!r.ok) {
        wx.showToast({ title: r.msg || '加时申请失败', icon: 'none' });
        return;
      }
      that.setData({ extendPanelVisible: false });
      wx.showModal({
        title: '加时申请已提交',
        content: `+${hours}小时 · 加时金额 ¥${(r.data.add_amount_fen / 100).toFixed(2)}\n等待对方确认`,
        showCancel: false, confirmText: '知道了',
        fail: () => {},
        success: () => that.fetchData({ orderId: that.data.order._id })
      });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  // 对方发起的加时申请: 确认/拒绝
  onExtendConfirm() {
    const that = this;
    const pe = this.data.order && this.data.order.pending_extend;
    if (!pe) { wx.showToast({ title: '无待处理的加时申请', icon: 'none' }); return; }
    wx.showModal({
      title: '确认同意加时',
      content: `+${pe.add_hours}小时 · 加时金额 ¥${(pe.add_amount_fen / 100).toFixed(2)}\n确认后金额合并进结算`,
      confirmText: '同意',
      cancelText: '拒绝',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        const act = res.confirm ? 'extend_confirm' : 'extend_reject';
        wx.showLoading({ title: res.confirm ? '确认加时' : '拒绝加时', mask: true });
        callCloud('order-action', { action: act, order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: res.confirm ? '加时已确认' : '已拒绝加时', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // O4 改期: 内联卡(原生 date/time picker) + showModal 二次确认, 替代 bottom-sheet
  onModify() {
    if (this.data.modifyUsedUp) {
      wx.showToast({ title: '修改次数已用完', icon: 'none' });
      return;
    }
    // 默认带出订单原服务日期与时间
    this.setData({
      modifyPanelVisible: true,
      modifyDate: this.data.order.service_date || '',
      modifyTime: this.data.order.service_time || '',
      modifyReason: ''
    });
    // 上拉页面让改期操作面板进入显著位置
    setTimeout(() => {
      wx.pageScrollTo({ scrollTop: 999999, duration: 300 });
    }, 50);
  },

  closeModifyPanel() { this.setData({ modifyPanelVisible: false, modifyReason: '' }); },

  onModifyDateChange(e) {
    this.setData({ modifyDate: e.detail.value });
  },

  onModifyTimeChange(e) {
    const time = e.detail.value;
    // R1 校验：可服务区间以 CONFIG.TIME_REDLINE 为准
    if (!redline.isServiceTimeAllowed(time)) {
      wx.showToast({ title: `须满足时间红线${redline.DISPLAY_CLOSE}-${CONFIG.TIME_REDLINE.open}`, icon: 'none' });
      return;
    }
    this.setData({ modifyTime: time });
  },

  onModifyReasonInput(e) {
    const v = (e.detail.value || '').slice(0, 200);
    this.setData({ modifyReason: v });
  },

  // 组合 picker 的日期+时分 → 本地时间戳
  buildModifyTs() {
    const { modifyDate, modifyTime } = this.data;
    if (!modifyDate || !modifyTime) return 0;
    const dy = modifyDate.split('-').map(Number);
    const hm = modifyTime.split(':').map(Number);
    if (dy.length !== 3 || dy.some(isNaN) || hm.length !== 2 || hm.some(isNaN)) return 0;
    return new Date(dy[0], dy[1] - 1, dy[2], hm[0], hm[1], 0, 0).getTime();
  },

  submitModify() {
    const that = this;
    const { modifyDate, modifyTime } = this.data;
    if (!modifyDate || !modifyTime) {
      wx.showToast({ title: '请选择新的日期和时间', icon: 'none' });
      return;
    }
    const ts = this.buildModifyTs();
    if (!ts || isNaN(ts) || ts <= Date.now()) {
      wx.showToast({ title: '新时间无效', icon: 'none' });
      return;
    }
    if (ts - Date.now() < CONFIG.MODIFY.minLeadHours * 3600000) {
      wx.showToast({ title: `须提前${CONFIG.MODIFY.minLeadHours}小时申请改期`, icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认提交改期',
      content: `新服务时间：${modifyDate} ${modifyTime}\n提交后需耍伴${CONFIG.MODIFY.confirmHours}小时内确认`,
      confirmText: '确认',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        that.setData({ modifyPanelVisible: false });
        wx.showLoading({ title: '提交改期', mask: true });
        callCloud('order-action', {
          action: 'modify',
          order_id: that.data.order._id,
          new_start_time: ts,
          reason: (that.data.modifyReason || '').trim().slice(0, 200)
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '改期失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '改期申请已提交', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // S2_5 对方同意改期(云端校验仅非发起人可调)
  onModifyConfirm() {
    const that = this;
    const pm = this.data.order && this.data.order.pending_modify;
    wx.showModal({
      title: '同意改期',
      content: pm ? `确认将服务时间改为 ${pm.new_date} ${pm.new_time}？` : '确认同意本次改期？',
      confirmText: '同意',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'modify_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已同意改期', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // S2_5 对方拒绝改期 → 回原状态, 服务时间不变
  onModifyReject() {
    const that = this;
    wx.showModal({
      title: '拒绝改期',
      content: '拒绝后服务时间保持不变',
      confirmText: '拒绝',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'modify_reject', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已拒绝改期', icon: 'none' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  onFinishService() {
    const that = this;
    wx.showModal({
      title: '确认履约完成',
      content: '完成后订单进入评价期',
      confirmText: '完成',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'complete_service', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: `履约完成，${CONFIG.ORDER.evalWindowH}小时内可评价`, icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
          // 刷新后由 WXML 根据 order.status===S5 渲染"去评价"按钮
          // partner 完成后不自动跳评价, 只有 user 视角进 S5 才能点评价
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // S3.5 履约中断（PRD 3.5.2 nextActions: resume / confirm）
  onResumeService() {
    const that = this;
    wx.showLoading({ title: '处理中', mask: true });
    callCloud('order-action', { action: 'resume_service', order_id: this.data.order._id }).then((r) => {
      wx.hideLoading();
      if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
      wx.showToast({ title: '已恢复履约', icon: 'success' });
      that.fetchData({ orderId: that.data.order._id });
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
  },
  onToPartial() {
    const that = this;
    wx.showModal({
      title: '确认转部分完成',
      content: '转部分完成后将按实际比例结算',
      confirmText: '确认',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'partial_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已转部分完成裁定', icon: 'none' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // S4 比例确认
  onRatioConfirm() {
    const that = this;
    wx.showModal({
      title: '确认费用比例',
      content: '确认后订单进入评价期',
      confirmText: '确认',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        callCloud('order-action', { action: 'ratio_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '比例已确认', icon: 'success' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // S5 评价
  onEvaluate() {
    wx.navigateTo({
      url: `/pages-v2/evaluate/evaluate?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '评价页待接入', icon: 'none' })
    });
  },

  // S8 售后
  onComplaint() {
    const that = this;
    wx.showModal({
      title: '发起争议',
      content: '争议将提交管理员仲裁',
      confirmText: '提交',
      editable: true,
      placeholderText: '请简要说明争议原因',
      success(res) {
        if (!res.confirm) return;
        const reason = (res.content || '').trim();
        wx.showLoading({ title: '提交中', mask: true });
        callCloud('order-action', {
          action: 'complaint',
          order_id: that.data.order._id,
          reason
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { wx.showToast({ title: r.msg || '提交失败', icon: 'none' }); return; }
          wx.showToast({ title: '已进入争议处理', icon: 'none' });
          that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // O5 取消(wx.showModal 展示梯度退款规则, 替代 bottom-sheet)
  onCancel() {
    const that = this;
    const tier = this.data.cancelTiers[this.data.currentCancelIdx];
    const ruleLines = this.data.cancelTiers.map((t) => `· ${t.label}：退款${t.rate * 100}%`).join('\n');
    wx.showModal({
      title: '取消订单',
      content: `退款规则：\n${ruleLines}\n\n当前适用：${tier.label}，退款${tier.rate * 100}%`,
      confirmText: '确认取消',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '取消中', mask: true });
        callCloud('order-action', {
          action: 'cancel',
          order_id: that.data.order._id,
          reason: tier ? `按${tier.label}梯度退款` : ''
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.msg || '取消失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: tier ? `已取消·退款${tier.label}` : '已取消', icon: 'none', duration: 2000 });
          setTimeout(() => wx.navigateBack({ fail: () => {} }), 1500);
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // 跳支付
  // 引导横幅主操作: 把 computeNextStep 返回的 action.key 路由到已有 handler
  onNextStepTap() {
    const step = this.data.nextStep;
    if (!step || !step.action) return;
    const key = step.action.key;
    switch (key) {
      case 'pay': return this.goPay();
      case 'chat': return this.goChat();
      case 'milestone': return this.onMilestoneSubmit();
      case 'finish': return this.onFinishService();
      case 'safety': return this.onSafety();
      case 'resume': return this.onResumeService();
      case 'eval': return this.onEvaluate();
      case 'modify_respond':
        // 改期在途时同意/拒绝按钮在操作区已单独渲染, 这里滚到操作区提示
        wx.showToast({ title: '请在下方操作区确认', icon: 'none' });
        return;
      case 'extend_respond':
        // 加时在途时同意/拒绝按钮在操作区已单独渲染, 这里滚到操作区提示
        wx.showToast({ title: '请在下方操作区确认', icon: 'none' });
        return;
    }
  },

  goPay() {
    const that = this;
    const amt = this.data.amountYuan || '0.00';
    wx.showModal({
      title: '💳 订单支付',
      content: `订单金额：¥${amt}\n请在 30 分钟内完成支付，超时订单将自动取消`,
      confirmText: '确认支付',
      cancelText: '放弃支付',
      confirmColor: '#07C160',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return; // 放弃支付 → 留在当前页
        wx.navigateTo({
          url: `/pages-v2/pay/pay?orderId=${that.data.order._id}`,
          fail: () => wx.showToast({ title: '支付页待接入', icon: 'none' })
        });
      }
    });
  },

  // 跳聊天(Phase 1.5: 用 redirectTo 截断订单详情, 避免栈叠加)
  goChat() {
    wx.redirectTo({
      url: `/pages-v2/chat/chat?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '聊天页待接入', icon: 'none' })
    });
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
