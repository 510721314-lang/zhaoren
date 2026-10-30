// @VERIFIED 2026-10-13 已真机验证：订单详情时间线倒序 + 加时超时拒绝 + 投诉冻结位 + S2协商取消链双出口 + 角色可读化不暴露 openid（依据：project_memory L48-52, L71, L83-85, L182, L191）
// PRD章节: 3.5 订单生命周期 / 3.5.2 13态状态机 / 3.5.3 改期 / 3.5.4 取消梯度退款 / 3.7 保险 / R1时间红线
// P0-4: 接云端 order-action detail, 删除 mock findOrder 依赖
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { getScene } = redline;
const { ORDER_STATUS, normalizeStatus } = require('../../config/enums.js');

const { callCloud } = require('../../utils/cloud.js');
// 批 5.4: 纯映射函数(computeNextStep/pad)抽离到 utils/order-view.js, 可单测; 此处仅编排
// 拆分阶段1 C1(2026-10-15): buildModifyTs/buildPrepCountdown 同外移, 页面留薄代理/编排调用
// 拆分阶段1 C2(2026-10-15): buildOrderView(原 refreshOrder 映射主体)/fmtDate 外移; refreshOrder 仅留 setData+弹窗震动编排
const { computeNextStep, pad, buildModifyTs, buildPrepCountdown, buildOrderView, fmtNoticeTime } = require('../../utils/order-view.js');
// 阶段B(2026-10-14): 履约定位三层判定(纯函数, 单测在 _shared/geo_guard.test.js)
const { evaluatePosition } = require('../../utils/geo-guard.js');
// 拆分阶段2b(2026-10-16): 定位能力链路(定位判定/定位采集/逆地理)外移 utils/geo-wx.js(经用户书面批准逐字搬迁); 页面留同名薄代理
const { evalFulfillGeo, collectStartLocation, addrOf } = require('../../utils/geo-wx.js');
// 2026-10-27: 定位统一收口 getLocationSafe(8s 必收敛, Promise 永不悬空)
const { getLocationSafe } = require('../../utils/location.js');
// 拆分阶段2b(2026-10-16): 证据采集/上传(唯一 uploadFile 点)外移 utils/order-evidence.js(经用户书面批准逐字搬迁); 页面留同名薄代理
const { collectStartEvidence, uploadStartPhotos, uploadEvidenceOne } = require('../../utils/order-evidence.js');
// 拆分阶段2c(2026-10-16): 定时器/通知轮询(6 法)外移 utils/order-poll.js(经用户书面批准逐字搬迁); 页面留同名薄代理
const { clearTimers, startTipPoll, stopTipPoll, onTipNoticeTap, startCountdown, fetchTipList } = require('../../utils/order-poll.js');

Page({
  // ── §0 生命周期 & 启动加载 (onLoad / fetchData / refreshOrder / reload / onShow / onHide / onUnload) ──
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
    modifyReasonMax: Number(CONFIG.ORDER.reasonMaxLen) || 200,
    extendReasonMax: Number(CONFIG.ORDER.reasonMaxLen) || 200,
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
    // 阶段B(2026-10-14): 履约定位判定结果(仅 S2 耍伴侧; {ok,reason,distanceM,accuracy,tip}; null=未评估/非耍伴)
    geoGuard: null,
    // C 可运营参数（供 WXML 绑定）
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: redline.PICKER_CLOSE,
    modifyRuleText: `规则：提前${CONFIG.MODIFY.minLeadHours}小时以上/最多${CONFIG.MODIFY.maxTimes}次/${CONFIG.MODIFY.freeFirst ? '首次免费/' : ''}第二次收${CONFIG.MODIFY.secondFeeRate * 100}%手续费/幅度≤${CONFIG.MODIFY.maxSpanH}小时`,
    s35ResponseMin: CONFIG.SAFETY.s35ResponseMin,
    modifyConfirmH: CONFIG.MODIFY.confirmHours,
    orderSummary: null,  // 订单概要三行(沿用消息页 l1/l2/l3)
    tipNotices: [],      // 到账通知列表(多条依次展示, 每条含 text+time; 空列表不渲染)
    tipList: [],        // 打赏逐笔明细(时间+金额+备注, 双方可见)
    insuranceWan: '',
    afterSaleDays: CONFIG.ORDER.afterSaleDays,
    // 安全中心: 进行中求助/最近报备/我的紧急联系人(由 safety-report status 填充)
    safety: { help_flag: false, active_sos: null, checkins: [], contacts: [] },
    // 爽约申诉(第三批 3B): 本订单申诉列表 + 是否可发起申诉(服务端二次校验为准)
    noShowReports: [],
    canNoShowReport: false,
    noShowNotStarted: false,   // 约定开始时间未到: 不显示上报按钮, 改显示占位提示
    // 联系信息(过渡版, 2026-10-09): {who, masked, note} | null, 接单方且已支付后展示
    contactDisplay: null,
    // 订单动态时间线(2026-10-12): 全事件族(状态/投诉/爽约/改期/加时/里程碑/支付退款/催办), 双方可见
    timeline: []
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

  fetchData(options, silent) {
    this.__orderId = (options && options.orderId) || '';
    this.__lastOptions = options || {};
    if (!/^[a-f0-9]{32}$/i.test(this.__orderId)) {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '缺少有效订单 ID' });
      return;
    }
    if (!silent) this.setData({ loading: true, loadError: false });
    // 2026-10-15 F4: 返回刷新 Promise, 供写操作「loading 保持到刷新完成」(既有调用方不接返回值, 向后兼容)
    return callCloud('order-action', { action: 'detail', order_id: this.__orderId }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true, loadErrorMsg: r.msg || '加载失败' });
        return;
      }
      this.refreshOrder(r.data);
      // 2026-10-30: 耍伴 S2 页需「补充微信提醒额度」入口 → 预取 demand_urge 模板 ID(云端 config_public 为 SSOT, 会话内仅 1 次)
      if (r.data.my_role === 'partner' && normalizeStatus(r.data.status) === 'S2') this._ensureUrgeTmplId();
      // 联系信息(过渡版): 接单方且已支付后展示对方脱敏号(拨打为占位)
      this.setData({ contactDisplay: r.data.contact_display || null, loading: false });
      this.startCountdown();
      // 完成态停留时轮询到账通知(被打赏等)
      this.startTipPoll();
      // 履约活跃状态拉取安全中心(求助/报备/紧急联系人), 其余状态不查
      const st = normalizeStatus(r.data.status);
      if (['S2', 'S3', 'S3_5', 'S4'].indexOf(st) >= 0) {
        this.fetchSafety();
      }
      // 爽约申诉状态(在途/已完成阶段均可能已有记录)
      this.fetchNoShow(r.data);
      // 订单动态时间线(2026-10-12): 首屏后异步懒加载, 失败不阻断主流程
      if (!silent) this.fetchTimeline();
      // 阶段B(2026-10-14): 履约定位判定仅随「非静默」刷新评估(进页面/回前台), 避开通知轮询的静默刷新重复定位
      // 异常隔离(评审 C): 判定若抛错不得冒泡到外层 .catch, 否则整页被误置「网络异常」
      if (!silent) { try { this._evalFulfillGeo(); } catch (e) { /* 定位判定失败不阻断详情渲染 */ } }
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请重试' });
    });
  },

  // ── §3 工具函数 (_modal / _handleConflict: 页级操作互斥锁 + 状态冲突收敛) ──
  // 2026-10-15 F1 页级操作互斥锁: 替代裸 wx.showModal——连点会在弹窗渲染空窗堆叠两个 modal,
  // 首请求改状态+刷新换按钮后, 第二个 modal 的确认对新状态二次请求(被服务端 oa_*_status 拒绝)。
  // 入口(弹窗前)即拦; 取消/弹窗失败/业务 Promise 链结算后自动放锁。success 回调必须 return 其 Promise 链。
  // cancelIsAction: 取消键本身也是业务动作(如加时弹窗的「拒绝」)时置 true, 回调照常执行
  _modal(opts) {
    if (this._acting) return;
    this._acting = true;
    const release = () => { this._acting = false; };
    wx.showModal(Object.assign({}, opts, {
      success: (res) => {
        if (!res.confirm && !opts.cancelIsAction) { release(); return; }
        Promise.resolve().then(() => opts.success(res)).then(release, release);
      },
      fail: () => { release(); if (opts.fail) opts.fail(); }
    }));
  },

  // 2026-10-15 F2 状态冲突收敛: oa_*_status/oa_status_conflict 不直出含裸状态码的服务端文案,
  // 静默刷新订单(按钮按新状态重渲染)+友好提示; 命中返回 true(调用方不再弹 r.msg)
  _handleConflict(r) {
    if (r && r.code && /_status$|status_conflict/.test(r.code)) {
      this.fetchData({ orderId: (this.data.order && this.data.order._id) || this.__orderId });
      wx.showToast({ title: '订单状态已更新, 请刷新后重试', icon: 'none' });
      return true;
    }
    return false;
  },

  // ── §1 状态子拉取 (fetchSafety / fetchNoShow / fetchTimeline: detail 返回后并行拉取三个维度) ──
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

  // 爽约申诉状态(第三批 3B): 列表 + 本端是否可发起申诉(客户端仅体验判断, 服务端 S2/S3.5+时限+上限二次校验)
  fetchNoShow(d) {
    const st = normalizeStatus(d.status);
    if (['S2', 'S3', 'S3_5', 'S4', 'S5', 'S8', 'S9'].indexOf(st) < 0) {
      this.setData({ noShowReports: [], canNoShowReport: false, noShowNotStarted: false });
      return;
    }
    callCloud('order-action', { action: 'no_show_report_detail', order_id: this.__orderId }).then((r) => {
      if (!r.ok || !r.data) return;
      const ns = CONFIG.NO_SHOW || {};
      const now = Date.now();
      const start = Number(d.start_time) || 0;
      const list = (r.data.list || []).map((x) => {
        const dl = x.evidence_deadline ? new Date(x.evidence_deadline) : null;
        let statusText = '待对方举证';
        if (x.status === 'withdrawn') statusText = '已撤回';
        else if (x.status === 'decided') statusText = x.verdict === 'upheld' ? '已裁定：成立' : '已裁定：不成立';
        else if (x.status === 'defense') statusText = '对方已举证，待裁定';
        return Object.assign({}, x, {
          status_text: statusText,
          deadline_text: dl ? `${pad(dl.getMonth() + 1)}-${pad(dl.getDate())} ${pad(dl.getHours())}:${pad(dl.getMinutes())}` : '',
          reason_display: (x.reason_type ? `【${x.reason_type}】` : '') + (x.reason || ''),
          // 证据图片(fileID 可直接用于 <image src>) 与各环节时间(付款后信息全量展示)
          evidence: Array.isArray(x.evidence_file_ids) ? x.evidence_file_ids : [],
          defense_evidence: Array.isArray(x.defense_file_ids) ? x.defense_file_ids : [],
          defense_at_text: x.defense_at ? this.__fmtNoticeTime(x.defense_at) : '',
          decided_at_text: x.decided_at ? this.__fmtNoticeTime(x.decided_at) : '',
          withdrawn_at_text: x.withdrawn_at ? this.__fmtNoticeTime(x.withdrawn_at) : ''
        });
      });
      const myReports = (r.data.list || []).filter((x) => x.my_role === 'reporter').length;
      const statusOk = st === 'S2' || st === 'S3_5';
      // 2026-10-12 口径定稿(与后端 canSubmitReport 一致): 约定开始时间已过 且 未超 开始时间+reportWindowH;
      // 开始时间未到谈不上爽约 → 按钮不出现(改用占位提示), 后端 no_show_not_started 兜底
      const notStarted = start > 0 && now < start;
      const inWindow = start > 0 && now >= start && now <= start + (Number(ns.reportWindowH) || 48) * 3600000;
      const underLimit = myReports < (Number(ns.maxPerOrder) || 1);
      const notFrozen = !d.frozen;   // 冻结位唯一: 在途争议/申诉期间不再提供上报入口(后端 oa_order_frozen 兜底)
      this.setData({
        noShowReports: list,
        noShowNotStarted: statusOk && notStarted && underLimit && notFrozen,
        canNoShowReport: statusOk && inWindow && underLimit && notFrozen
      });
    }).catch(() => {});
  },

  // 订单动态时间线(2026-10-12): 懒加载 order-action.timeline(全事件族), 失败不阻断主流程
  fetchTimeline() {
    const oid = this.__orderId;
    if (!oid) return;
    callCloud('order-action', { action: 'timeline', order_id: oid }).then((r) => {
      if (!r.ok || !r.data || !Array.isArray(r.data.events)) return;
      const myRole = (this.data.order && this.data.order.my_role) || '';
      const ROLE_CN = { user: '发单人', partner: '耍伴', admin: '平台', system: '系统' };
      const ICON = { status: '🔄', complaint: '⚠️', no_show: '🚫', money: '💰', milestone: '📍', urge: '📢' };
      const list = r.data.events.map((e, i) => ({
        key: `${i}-${e.at || 0}-${e.type || ''}`,
        type: e.type || 'status',
        icon: ICON[e.type] || '•',
        label: e.label || '',
        detail: e.detail || '',
        // actor_role=本人 → "你"(双方口径一致); 其余按角色中文, 系统/平台不显示昵称(隐私)
        who: e.actor_role === myRole ? '你' : (ROLE_CN[e.actor_role] || ''),
        time: e.at ? this.__fmtNoticeTime(e.at) : ''
      }));
      this.setData({ timeline: list });
    }).catch(() => {});
  },

  // ── §2 爽约上报 & 申诉操作 (onNoShowReport / onNoShowDefense / onNoShowWithdraw / onComplaintWithdraw / onPreviewEvidence) ──
  // 发起爽约申诉(跳提交页; 服务端二次校验)
  onNoShowReport() {
    wx.navigateTo({
      url: `/pages-v2/pkg-low/no-show-report/no-show-report?mode=submit&orderId=${this.__orderId}`,
      fail: () => wx.showToast({ title: '页面跳转失败', icon: 'none' })
    });
  },

  // 爽约证据图片预览(2026-10-12): 证据用云存储 fileID, 直接 wx.previewImage
  // 拆分阶段3 A2(2026-10-17, 用户书面批准): 兼容两来源 —— 页面内卡(data-src/data-list) 与 components/evidence-card 的 triggerEvent('preview')(e.detail)
  onPreviewEvidence(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const dt = (e && e.detail) || {};
    const cur = dt.src || ds.src || '';
    const list = dt.list || ds.list || [];
    if (!cur) return;
    wx.previewImage({ current: cur, urls: (Array.isArray(list) && list.length) ? list : [cur] });
  },

  // 被诉方举证(跳举证页) + 里程碑4·文件1阶段4 ②a(2026-10-17): 兼容 components/no-show-card 的 triggerEvent('defense')(e.detail) 与页面内 data-id
  onNoShowDefense(e) {
    const reportId = ((e && e.detail && e.detail.id) || (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id)) || '';
    if (!reportId) return;
    wx.navigateTo({
      url: `/pages-v2/pkg-low/no-show-report/no-show-report?mode=defense&reportId=${reportId}&orderId=${this.__orderId}`,
      fail: () => wx.showToast({ title: '页面跳转失败', icon: 'none' })
    });
  },

  // 撤回申诉(2026-10-10): 入口仅申诉人、裁定前可见(can_withdraw 由服务端计算); 二次确认后调云端(服务端二次校验)
  // 里程碑4·文件1阶段4 ②a(2026-10-17): 兼容 components/no-show-card 的 triggerEvent('withdraw')(e.detail) 与页面内 data-id
  onNoShowWithdraw(e) {
    const reportId = ((e && e.detail && e.detail.id) || (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id)) || '';
    if (!reportId) return;
    wx.showModal({
      title: '撤回申诉',
      content: '撤回后不可恢复，该订单不可再次提交申诉',
      confirmText: '确认撤回',
      confirmColor: '#fa5151',
      success: (r) => {
        if (!r.confirm) return;
        callCloud('order-action', { action: 'no_show_report_withdraw', report_id: reportId }).then((res) => {
          if (!res || !res.ok) {
            wx.showToast({ title: (res && res.msg) || '撤回失败，请重试', icon: 'none' });
            return;
          }
          wx.showToast({ title: '申诉已撤回', icon: 'success' });
          this.reload();
        }).catch(() => wx.showToast({ title: '网络异常，请重试', icon: 'none' }));
      }
    });
  },

  // 撤回投诉(2026-10-10): 入口仅投诉发起人、平台受理前可见(can_withdraw_complaint 由服务端计算);
  // 撤回后订单回退到投诉前状态, 页面「争议处理中/售后处理中」随之消失
  onComplaintWithdraw() {
    wx.showModal({
      title: '撤回投诉',
      content: '撤回后平台不再介入，订单将恢复到投诉前的状态',
      confirmText: '确认撤回',
      confirmColor: '#fa5151',
      success: (r) => {
        if (!r.confirm) return;
        callCloud('order-action', { action: 'complaint_withdraw', order_id: this.__orderId }).then((res) => {
          if (!res || !res.ok) {
            wx.showToast({ title: (res && res.msg) || '撤回失败，请重试', icon: 'none' });
            return;
          }
          wx.showToast({ title: '投诉已撤回', icon: 'success' });
          this.reload();
        }).catch(() => wx.showToast({ title: '网络异常，请重试', icon: 'none' }));
      }
    });
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
    // 拆分阶段1 C2·A1(2026-10-15): detail→视图映射纯函数外移 buildOrderView(utils/order-view.js, 返回与旧 setData 同形 13 键 patch, 经书面批准自 @VERIFIED 逐字搬迁)
    // 本方法仅保留: setData + 待确认加时/改期弹窗震动编排 + 打赏明细拉取(以下 wx 段逐字未动)
    const patch = buildOrderView(d);
    const { order, statusInfo } = patch;
    this.setData(patch);
    // 醒目即时提醒: 有待自己确认的加时/改期时, 进页即弹 modal + 震动
    // 同单同类型只弹一次, 避免 onShow 轮询重复刷屏
    this.__pendingAlerted = this.__pendingAlerted || {};
    const _pe = order.pending_extend;
    const _pm = order.pending_modify;
    if (_pe && _pe.can_respond) {
      const key = `${order.order_id}|extend|${_pe.expire_at || 0}`;
      if (!this.__pendingAlerted[key]) {
        this.__pendingAlerted[key] = 1;
        try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
        wx.showModal({
          title: '⏰ 有待确认的加时申请',
          content: `对方申请加时 ${_pe.add_hours} 小时 · ¥${(_pe.add_amount_fen / 100).toFixed(2)}\n${_pe.expire_text}，超时自动拒绝`,
          confirmText: '去处理',
          cancelText: '稍后',
          success: (res) => {
            if (res.confirm) {
              wx.pageScrollTo({ selector: '.od__pending-banner', duration: 300 });
            }
          }
        });
      }
    } else if (_pm && _pm.can_respond) {
      const key = `${order.order_id}|modify|${_pm.expire_at || 0}`;
      if (!this.__pendingAlerted[key]) {
        this.__pendingAlerted[key] = 1;
        try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
        wx.showModal({
          title: '📅 有待确认的改期申请',
          content: `对方申请改至 ${_pm.new_date} ${_pm.new_time}\n${statusInfo.timeoutText || '请及时处理'}，超时自动拒绝`,
          confirmText: '去处理',
          cancelText: '稍后',
          success: (res) => {
            if (res.confirm) {
              wx.pageScrollTo({ selector: '.od__pending-banner', duration: 300 });
            }
          }
        });
      }
    }
    // 有打赏的订单拉逐笔明细(双方可见, 展示在打赏行下)
    if (order.tip_total_fen > 0) this.fetchTipList();
  },

  // ── §4 计时器 & 通知轮询 (clearTimers / startTipPoll / startCountdown / fetchTipList) ──
  clearTimers() {
    // 拆分阶段2c(2026-10-16): 定时器清理外移 utils/order-poll.js(经用户书面批准逐字搬迁); 薄代理保 onUnload/onHide 等调用点不变
    return clearTimers(this);
  },

  // 通知轮询: 停在订单详情页时每 8s 查本人该订单未读通知(多条递增展示)
  // - 全状态轮询: 耍伴停留等待对方确认时(改期/加时 S2_5), 需求方任何变动即时横幅+toast 提示
  // - 拉到新通知后静默刷新订单详情, 同步最新状态/新服务时间
  // 幂等去重: 已展示过的通知 id 不再重复展示(本地 Map 记忆)
  startTipPoll() {
    // 拆分阶段2c(2026-10-16): 通知轮询外移 utils/order-poll.js(经用户书面批准逐字搬迁); 薄代理保 this.startTipPoll() 调用点不变
    return startTipPoll(this);
  },

  stopTipPoll() {
    // 拆分阶段2c(2026-10-16): 外移 utils/order-poll.js(经用户书面批准逐字搬迁)
    return stopTipPoll(this);
  },

  // 点击单条横幅 → 标记该通知已读 + 移除(后续轮询不再带回)
  onTipNoticeTap(e) {
    // 拆分阶段2c(2026-10-16): 外移 utils/order-poll.js(经用户书面批准逐字搬迁); wxml bindtap 调用点不变
    return onTipNoticeTap(this, e);
  },

  startCountdown() {
    // 拆分阶段2c(2026-10-16): 倒计时外移 utils/order-poll.js(经用户书面批准逐字搬迁)
    return startCountdown(this);
  },

  // 到账通知时间戳(毫秒 → MM-DD HH:mm)（fmtDate 已在拆分阶段1 C2·A2 外移 utils/order-view.js, 本页无残留调用）
  __fmtNoticeTime(ts) {
    // 拆分阶段2c(2026-10-16): 纯格式化按用户裁定移 utils/order-view.js(fmtNoticeTime); 薄代理保 fetchNoShow/fetchTimeline 等调用点不变
    return fmtNoticeTime(ts);
  },

  // 💝 打赏逐笔明细(订单双方可见, 时间升序; 打赏成功后由 onTip 刷新触发重拉)
  fetchTipList() {
    // 拆分阶段2c(2026-10-16): 打赏明细外移 utils/order-poll.js(经用户书面批准逐字搬迁)
    return fetchTipList(this);
  },

  // 2026-10-30 耍伴端「补充微信提醒额度」: 懒取 demand_urge 模板 ID(config_public 为 SSOT, 会话内只请求 1 次)
  // 模板 ID 必须提前拿到: requestSubscribeMessage 只能在点击手势内同步调用, 不能先 await 网络再调
  _ensureUrgeTmplId() {
    if (this.__urgeTmplId !== undefined) return;
    this.__urgeTmplId = '';
    callCloud('admin-action', { action: 'config_public' }).then((r) => {
      const c = (r && r.ok && r.data && r.data.sub_msg && r.data.sub_msg.demand_urge) || null;
      this.__urgeTmplId = (c && c.tmpl_id) || '';
    }).catch(() => {});
  },

  // 2026-10-30 耍伴端: 补充 1 条「催办提醒」订阅额度(一次性订阅: 一次授权=一条消息, 用完需再补)
  onRefillUrgeSub() {
    const tmplId = this.__urgeTmplId || '';
    if (!tmplId) {
      wx.showToast({ title: '微信提醒暂未开通', icon: 'none' });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        if (!res || res[tmplId] !== 'accept') {
          wx.showToast({ title: '未获得微信订阅授权', icon: 'none' });
          return;
        }
        callCloud('partner-action', { action: 'sub_authorize', tmpl: 'demand_urge', authorized: true })
          .then((r) => wx.showToast({ title: r.ok ? '已补充1条微信提醒' : (r.msg || '操作失败'), icon: 'none' }))
          .catch(() => wx.showToast({ title: '网络异常，请重试', icon: 'none' }));
      },
      fail: () => wx.showToast({ title: '微信授权未完成', icon: 'none' })
    });
  },

  // ── §5 履约准备 & 定位判定 (onViewPrep / onStartService / onStartConfirm / _evalFulfillGeo / _collectStartLocation) ──
  // O3 操作区
  // 用户端 S2: 查看履约准备 (弹窗展示履约信息 + 可选操作)
  onViewPrep() {
    const o = this.data.order || {};
    // 拆分阶段1 C1·A4(2026-10-15): 倒计时文案纯计算外移 buildPrepCountdown; 弹窗/ActionSheet/催办 nudge_partner 编排仍留本页不动
    const diffStr = buildPrepCountdown(o);

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
        const urge = o.urge || { count: 0, max: 2, can_urge: true };
        const nudgeLabel = urge.can_urge ? `📢 催办 (${urge.count}/${urge.max})` : `📢 已催办 (${urge.count}/${urge.max})`;
        wx.showActionSheet({
          itemList: ['💬 联系耍伴', '📅 发起改期', nudgeLabel],
          success: (r) => {
            if (r.tapIndex === 0) this.goChat();
            else if (r.tapIndex === 1) this.onModify();
            else if (r.tapIndex === 2) {
              // 催办耍伴: 每单上限 urge_max 次（后端 CAS 兜底）；耍伴收站内+订阅（已授权时）
              if (!urge.can_urge) {
                wx.showToast({ title: `已达催办上限(${urge.max}次)`, icon: 'none' });
                return;
              }
              wx.showLoading({ title: '发送中', mask: true });
              callCloud('order-action', {
                action: 'nudge_partner',
                order_id: o._id
              }).then((rr) => {
                wx.hideLoading();
                if (rr.ok) {
                  // 2026-10-30: 按订阅发送结果区分文案(一次性订阅: 一次授权只对应 1 条微信提醒)
                  if (rr.data && rr.data.sub_sent === false) {
                    const subErr = String(rr.data.sub_err || '');
                    if (subErr === '43101' || subErr === 'NO_AUTH') {
                      // 额度用尽/对方未开提醒: 站内通知已送达, 用弹窗给出明确去处(替代一闪而过、无行动项的 toast)
                      wx.showModal({
                        title: '已催办 · 站内已送达',
                        content: '微信提醒每次授权只能发 1 条，对方需在小程序内重新开启。可先发消息提醒对方。',
                        confirmText: '去聊天',
                        cancelText: '知道了',
                        success: (m) => { if (m.confirm) this.goChat(); }
                      });
                    } else {
                      wx.showToast({
                        title: subErr === 'NO_TMPL' ? '已催办，微信提醒未开通' : '已催办，微信提醒发送失败',
                        icon: 'none'
                      });
                    }
                  } else {
                    // 成功: 明说"微信已送达", 避免用户误以为每次催办都会弹微信服务通知
                    wx.showToast({ title: '已催办，微信已送达', icon: 'none' });
                  }
                  this.fetchData({ orderId: o._id }, true);
                } else {
                  wx.showToast({ title: rr.msg || '发送失败', icon: 'none' });
                }
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

  // 阶段B(2026-10-14): 履约定位实时判定(仅 S2 耍伴侧) → 驱动「发起履约申请」按钮置灰与提示文案
  // 触发点: fetchData 非静默分支(进页面 onLoad / 回前台 onShow 均走此处), 不走 refreshOrder 以免被通知轮询复用
  _evalFulfillGeo() {
    // 拆分阶段2b(2026-10-16): 定位判定外移 utils/geo-wx.js(经用户书面批准逐字搬迁); 薄代理保 this._evalFulfillGeo() 调用点与 @VERIFIED 行为不变
    return evalFulfillGeo(this);
  },

  // @VERIFIED 2026-10-15 已真机验证：发起履约申请先拍照上传、成功才提交(凭证前置)，失败停留 S2 且不发通知；S3 阶段旧「拍摄现场照片」入口已移除
  onStartService() {
    const that = this;
    if (this.data.isRedline) {
      wx.showToast({ title: `夜间${redline.DISPLAY_CLOSE}-${CONFIG.TIME_REDLINE.open}暂停履约`, icon: 'none' });
      return;
    }
    // 阶段B 点击二次校验(规范 C4, 防御性): 置灰已由 WXML disabled 保证, 此处防「定位在点击瞬间变化」绕过
    const guard = this.data.geoGuard;
    if (guard && !guard.ok) {
      wx.showToast({ title: guard.tip || '当前不满足发起条件', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '发起履约申请',
      content: '需先拍摄 1~3 张现场照片上传存档(自动叠加服务端时间与地点水印), 照片上传成功后才发出到场申请',
      confirmText: '去拍照',
      success(res) {
        if (!res.confirm) return;
        // 凭证前置(2026-10-15 需求变更): 定位快照 → 现场照片上传 → 两步都成功才提交申请;
        // 任一步失败即停留 S2、不发系统通知, 提示耍伴重新上传(服务端同口径 fail-closed 校验)
        that._collectStartLocation(false, true).then((loc) => {
          if (!loc) return;   // 未授权/取点失败(内部已提示), 不发起请求
          wx.showLoading({ title: '准备中', mask: true });
          callCloud('order-action', { action: 'server_now' }).then((r) => {
            wx.hideLoading();
            const serverAt = (r && r.ok && r.data && r.data.server_time) || 0;
            that._collectStartEvidence(serverAt).then((ev) => {
              if (!ev) return;   // 采集/上传失败(内部已提示), 拒发起: 订单留 S2
              wx.showLoading({ title: '提交中', mask: true });
              callCloud('order-action', {
                action: 'start_apply', order_id: that.data.order._id, start_location: loc, start_evidence: ev
              }).then((r2) => {
                wx.hideLoading();
                if (!r2.ok) {
                  wx.showToast({ title: r2.msg || '操作失败', icon: 'none' });
                  return;
                }
                wx.showToast({ title: '已提交到场申请', icon: 'success' });
                that.fetchData({ orderId: that.data.order._id });
              }).catch(() => {
                wx.hideLoading();
                wx.showToast({ title: '网络异常', icon: 'none' });
              });
            });
          }).catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '网络异常', icon: 'none' });
          });
        });
      }
    });
  },

  // 阶段C-3(2026-10-14): 采集定位快照(纯定位, 不拍照)。
  // silent=true 时取点失败不弹提示(供可选留痕场景); withAddr=true 时附逆地理地址(存证用, 失败退回无地址)
  _collectStartLocation(silent, withAddr) {
    // 拆分阶段2b(2026-10-16): 定位采集外移 utils/geo-wx.js(经用户书面批准逐字搬迁); 薄代理保 this._collectStartLocation() 调用点不变
    return collectStartLocation(this, silent, withAddr);
  },

  // 阶段D(2026-10-14): 需求方「同意开始履约」→ S2_6→S3(可带用户定位留痕; 取不到定位不阻断)
  onStartConfirm() {
    const that = this;
    this._modal({
      title: '确认耍伴已到场',
      content: '确认后订单进入履约中, 耍伴将开始服务',
      confirmText: '确认',
      success(res) {
        if (!res.confirm) return;
        return that._collectStartLocation(true, false).then((loc) => {
          wx.showLoading({ title: '提交中', mask: true });
          const payload = { action: 'start_confirm', order_id: that.data.order._id };
          if (loc) payload.user_location = loc;
          return callCloud('order-action', payload).then((r) => {
            wx.hideLoading();
            if (!r.ok) {
              if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
              return;
            }
            wx.showToast({ title: '已确认, 履约开始', icon: 'success' });
            return that.fetchData({ orderId: that.data.order._id });
          }).catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '网络异常', icon: 'none' });
          });
        });
      }
    });
  },

  // 阶段D(2026-10-14): 需求方「不同意」→ S2_6→S2(耍伴 60 秒后可重发)
  onStartReject() {
    const that = this;
    this._modal({
      title: '不同意开始履约',
      content: '确认不同意? 耍伴 60 秒后可重新发起到场申请',
      confirmText: '不同意',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中', mask: true });
        return callCloud('order-action', { action: 'start_reject', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已拒绝', icon: 'none' });
          return that.fetchData({ orderId: that.data.order._id });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // ── §6 用户确认 & 证据采集 (onUserConfirm / _collectStartEvidence / _addrOf / _uploadEvidenceOne) ──
  // 需求B 二期(2026-10-14): 需求方到场定位确认(仅"确认"时要求定位; 不点不拦主流程)
  onUserConfirm() {
    const that = this;
    wx.showModal({
      title: '确认我已到场',
      content: '将获取你的实时位置并记录到场确认(仅本次确认时要求定位)',
      confirmText: '确认',
      success(res) {
        if (!res.confirm) return;
        // 2026-10-27: 改走 getLocationSafe(8s 必收敛), 超时按原拒绝分支提示
        getLocationSafe().then((loc) => {
          if (!loc.ok) {
            wx.showToast({ title: '确认到场需授权定位, 请开启后重试', icon: 'none' });
            return;
          }
          const at = Date.now();
          that._addrOf(loc.latitude, loc.longitude).then((addr) => {
            wx.showLoading({ title: '提交中', mask: true });
            callCloud('order-action', {
              action: 'user_confirm_start', order_id: that.data.order._id,
              user_confirm: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, address: addr, at }
            }).then((r) => {
              wx.hideLoading();
              if (!r.ok) { wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
              wx.showToast({ title: '已确认到场', icon: 'success' });
              that.fetchData({ orderId: that.data.order._id });
            }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
          });
        });
      }
    });
  },

  // 现场留痕采集(阶段E 复用需求B 上传链): 高精度定位(必须) + 1~3 张现场照片(客户端叠地址+时间水印后上传)
  // 返回 { photos:[{file_id,kind,at}], partner_location:{latitude,longitude,accuracy,address,at} };
  // 任一步被拒/失败返回 null → 不提交请求(开始履约申请 start_apply / 完毕确认 finish_apply 均凭证前置, 同口径 fail-closed)
  // 水印时间取服务端时间戳(规范 §F3): serverAt 由调用方先经 server_now 取得; 缺失时退回本地时间兜底
  _collectStartEvidence(serverAt, stage) {
    // 拆分阶段2b(2026-10-16): 证据采集/上传外移 utils/order-evidence.js(经用户书面批准逐字搬迁); 薄代理保 this._collectStartEvidence() 调用点不变
    return collectStartEvidence(this, serverAt, stage);
  },

  // 逆地理编码取可读地址(腾讯地图 key 来自 CONFIG); 无 key/请求失败回退坐标串
  _addrOf(lat, lng) {
    // 拆分阶段2b(2026-10-16): 逆地理外移 utils/geo-wx.js(经用户书面批准逐字搬迁; 阶段2 后续与 publish reverseGeocode 合一)
    return addrOf(lat, lng);
  },

  // 逐张叠水印(地址+时间)并上传云存储; 单张水印合成失败降级上传原图(不阻断履约)
  // L1-1/L1-2(2026-10-14): 并行上传 + 单张 15s 超时 + 失败仅重传该张(1 轮) + try/catch 全程兜底(loading 必收)
  async _uploadStartPhotos(files, ctx) {
    // 拆分阶段2b(2026-10-16): 逐张叠水印+并行上传外移 utils/order-evidence.js(经用户书面批准逐字搬迁); 薄代理保调用点不变
    return uploadStartPhotos(this, files, ctx);
  },

  // 单张留痕照片上传: 单次 15s 超时; 失败自动重试 1 次(仅该张, 不牵动其它张); 仍失败则 reject
  _uploadEvidenceOne(job) {
    // 拆分阶段2b(2026-10-16): 单张上传(唯一 wx.cloud.uploadFile 点)外移 utils/order-evidence.js(经用户书面批准逐字搬迁)
    return uploadEvidenceOne(job);
  },

  // ── §7 安全中心 & SOS (onSafety / onSos / _submitSos / _showCallSheet) ──
  onSafety() {
    // 安全报备(打卡报平安/定位追踪)仅在履约中开放; S2 待履约阶段引导先开始履约
    const st = this.data.order && this.data.order.status;
    if (st !== 'S3' && st !== 'S3_5' && st !== 'S4') {
      wx.showToast({ title: '开始履约后可安全报备', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages-v2/pkg-low/safety/safety?orderId=${this.data.order._id}`,
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
        // 2026-10-27: 改走 getLocationSafe(8s 必收敛), 超时也按无位置提交, 防 loading 遮罩卡死
        getLocationSafe().then((loc) => {
          that._submitSos(loc.ok ? { latitude: loc.latitude, longitude: loc.longitude } : null);
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
                  url: '/pages-v2/pkg-low/contacts/contacts',
                  fail: () => wx.showToast({ title: '页面打开失败', icon: 'none' })
                });
              }
            }
          });
        }
      }
    });
  },

  // ── §8 里程碑证据 (onMilestoneSubmit: 30% → 60% → 100% 逐步提交) ──
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

  // ── §9 加时 (onAddTime / submitExtend / onExtendConfirm + 面板辅助) ──
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
      extendIsFixed: order.pricing_type === 'fixed',
      extendReason: ''
    });
    // 2026-10-30: 加时面板在页面底部, 展开后滚到底部, 让「提交加时」区域立即可见(与改期面板 onModify 同款处理)
    setTimeout(() => {
      wx.pageScrollTo({ scrollTop: 999999, duration: 300 });
    }, 50);
  },

  closeExtendPanel() { this.setData({ extendPanelVisible: false, extendReason: '' }); },

  onExtendHoursTap(e) {
    this.setData({ extendHours: Number(e.currentTarget.dataset.hours) });
  },

  onExtendReasonInput(e) {
    const v = (e.detail.value || '').slice(0, this.data.extendReasonMax);
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
      reason: (this.data.extendReason || '').trim().slice(0, this.data.extendReasonMax)
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
    this._modal({
      title: '确认同意加时',
      content: `+${pe.add_hours}小时 · 加时金额 ¥${(pe.add_amount_fen / 100).toFixed(2)}\n确认后金额合并进结算`,
      confirmText: '同意',
      cancelText: '拒绝',
      // F1: 本弹窗取消键=「拒绝加时」业务动作而非放弃, 回调须照常执行
      cancelIsAction: true,
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        const act = res.confirm ? 'extend_confirm' : 'extend_reject';
        wx.showLoading({ title: res.confirm ? '确认加时' : '拒绝加时', mask: true });
        return callCloud('order-action', { action: act, order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: res.confirm ? '加时已确认' : '已拒绝加时', icon: 'success' });
          return that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // ── §10 改期 (onModify / submitModify / onModifyConfirm / onModifyReject + 面板辅助) ──
  // O4 改期: 内联卡(原生 date/time picker) + showModal 二次确认, 替代 bottom-sheet
  onModify() {
    // 2026-10-07 口径: 仅 S2(已支付待履约)可发起改期; S3 履约中/S3.5 中断均不可
    if (!this.data.order || this.data.order.status !== 'S2') {
      wx.showToast({ title: '当前状态不可申请改期', icon: 'none' });
      return;
    }
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
    const v = (e.detail.value || '').slice(0, this.data.modifyReasonMax);
    this.setData({ modifyReason: v });
  },

  // 组合 picker 的日期+时分 → 本地时间戳(拆分阶段1 C1·A3: 纯计算外移 utils/order-view.js, 此薄代理保 this.buildModifyTs() 调用点与 @VERIFIED 行为不变)
  buildModifyTs() {
    return buildModifyTs(this.data.modifyDate, this.data.modifyTime);
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
    this._modal({
      title: '确认提交改期',
      content: `新服务时间：${modifyDate} ${modifyTime}\n提交后需耍伴${CONFIG.MODIFY.confirmHours}小时内确认`,
      confirmText: '确认',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        that.setData({ modifyPanelVisible: false });
        wx.showLoading({ title: '提交改期', mask: true });
        return callCloud('order-action', {
          action: 'modify',
          order_id: that.data.order._id,
          new_start_time: ts,
          reason: (that.data.modifyReason || '').trim().slice(0, that.data.modifyReasonMax)
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '改期失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '改期申请已提交', icon: 'success' });
          return that.fetchData({ orderId: that.data.order._id });
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
    this._modal({
      title: '同意改期',
      content: pm ? `确认将服务时间改为 ${pm.new_date} ${pm.new_time}？` : '确认同意本次改期？',
      confirmText: '同意',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        return callCloud('order-action', { action: 'modify_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已同意改期', icon: 'success' });
          return that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // S2_5 对方拒绝改期 → 回原状态, 服务时间不变
  onModifyReject() {
    const that = this;
    this._modal({
      title: '拒绝改期',
      content: '拒绝后服务时间保持不变',
      confirmText: '拒绝',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        return callCloud('order-action', { action: 'modify_reject', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已拒绝改期', icon: 'none' });
          return that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // ── §11 完成 / 部分履约 / 恢复 (onFinishService / onToPartial / onResumeService / onRatioConfirm) ──
  // 阶段F(2026-10-15, 规范 §2.3): 耍伴「发起履约完毕确认」→ 先采集完成照片+定位(凭证前置), 再 S3→S3_6
  // 水印时间取服务端时间戳(规范 §F3); 旧 complete_service(no.13 直连 S3→S5)停用, 保留共存待收口
  onFinishService() {
    const that = this;
    this._modal({
      title: '发起履约完毕确认',
      content: '将先拍摄完成照片(带水印)与定位存档, 再提交给需求方确认',
      confirmText: '继续',
      success(res) {
        if (!res.confirm) return;
        // 乐观更新: 立即隐藏加时按钮 + 禁用完成按钮, 杜绝"已点完成却还能加时"的矛盾窗口
        that.setData({ finishingService: true });
        wx.showLoading({ title: '准备中', mask: true });
        return callCloud('order-action', { action: 'server_now' }).then((r) => {
          wx.hideLoading();
          const serverAt = (r && r.ok && r.data && r.data.server_time) || 0;
          return that._collectStartEvidence(serverAt, 'finish');
        }).then((ev) => {
          if (!ev) { that.setData({ finishingService: false }); return; } // 采集/上传失败已提示, 不发起
          wx.showLoading({ title: '提交中', mask: true });
          return callCloud('order-action', {
            action: 'finish_apply', order_id: that.data.order._id, finish_evidence: ev
          }).then((r2) => {
            wx.hideLoading();
            if (!r2.ok) {
              that.setData({ finishingService: false });
              if (!that._handleConflict(r2)) wx.showToast({ title: r2.msg || '操作失败', icon: 'none' });
              return;
            }
            require('../../utils/report.js').report('order_finish', { order_id: that.data.order._id });
            // F4(2026-10-15): loading 保持到详情刷新完成再反馈, 防慢网刷新空窗重复点击
            wx.showLoading({ title: '刷新中', mask: true });
            return that.fetchData({ orderId: that.data.order._id }).then(() => {
              wx.hideLoading();
              wx.showToast({ title: '已发起, 等待对方确认', icon: 'success' });
            });
          });
        }).catch(() => {
          wx.hideLoading();
          that.setData({ finishingService: false });
          wx.showToast({ title: '网络异常', icon: 'none' });
        });
      }
    });
  },

  // 阶段F(2026-10-15): 需求方「确认履约完毕」→ S3_6→S5(触发结算走既有链路)
  onFinishConfirm() {
    const that = this;
    this._modal({
      title: '确认履约完毕',
      content: '确认后订单完成, 将进入评价',
      confirmText: '确认',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中', mask: true });
        return callCloud('order-action', { action: 'finish_confirm', order_id: that.data.order._id }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          wx.showToast({ title: '已确认, 订单完成', icon: 'success' });
          return that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // 阶段F(2026-10-15): 需求方「不确认」→ S3_6→S3(耍伴 60 秒后可重发)
  // 阶段G补充(2026-10-15, 需求更正): 不确认后立即引导进入「与对方交流」(IM 会话页), 便于双方就履约分歧即时沟通
  onFinishReject() {
    const that = this;
    this._modal({
      title: '不确认履约完毕',
      content: '不确认后将进入与对方交流, 耍伴 60 秒后可重新发起完毕确认',
      confirmText: '不确认',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中', mask: true });
        const orderId = that.data.order._id;
        return callCloud('order-action', { action: 'finish_reject', order_id: orderId }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
          // F3(2026-10-15): 删除跳转成功后的跨页 toast「已进入交流」(聊天页内多余); 聊天后返回详情由 onShow 自动非静默刷新
          // navigateTo: 保留订单详情在栈, 聊天后返回可继续核对订单(不销毁当前页)
          wx.navigateTo({
            url: `/pages-v2/chat/chat?orderId=${orderId}`,
            fail: () => { that.fetchData({ orderId }); wx.showToast({ title: '已驳回', icon: 'none' }); }
          });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
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

  // ── §12 评价 & 打赏 (onEvaluate / onTip / __doTip) ──
  // S5 评价
  onEvaluate() {
    wx.navigateTo({
      url: `/pages-v2/pkg-low/evaluate/evaluate?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '页面加载失败', icon: 'none' })
    });
  },

  // 💝 打赏耍伴(仅 dev 下发 tipEnabled 时显示; 服务端 mock_tip 限 100-50000 分整)
  onTip() {
    const that = this;
    const orderId = this.data.order._id;
    const amountYuan = Number(this.data.amountYuan) || 0;
    wx.showActionSheet({
      itemList: ['6 元', '12 元', '25 元', '50 元', '自定义金额'],
      success(res) {
        if (res.tapIndex < 4) return that.__doTip(orderId, [6, 12, 25, 50][res.tapIndex] * 100, '');
        wx.showModal({
          title: '自定义打赏金额',
          editable: true,
          placeholderText: `1-500 元（建议不超过订单金额 ¥${amountYuan}）`,
          success(m) {
            if (!m.confirm) return;
            const v = Number(m.content);
            if (!Number.isFinite(v) || v < 1 || v > 500) {
              wx.showToast({ title: '请输入 1-500 元', icon: 'none' });
              return;
            }
            that.__doTip(orderId, Math.round(v * 100), '');
          }
        });
      }
    });
  },

  __doTip(orderId, amountFen, note) {
    wx.showLoading({ title: '打赏中', mask: true });
    callCloud('payment-mock', { action: 'mock_tip', order_id: orderId, amount_fen: amountFen, note }).then((r) => {
      wx.hideLoading();
      if (!r.ok) { wx.showToast({ title: r.msg || '打赏失败', icon: 'none' }); return; }
      wx.showToast({ title: '打赏已送达，感谢支持', icon: 'success' });
      // 刷新订单以回显 tip_total_fen
      this.fetchData({ orderId });
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常，请重试', icon: 'none' }); });
  },

  // ── §13 爽约申诉 & 售后纠纷 (onComplaint) ──
  // S8 售后
  onComplaint() {
    const that = this;
    this._modal({
      title: '发起争议',
      content: '争议将提交管理员仲裁',
      confirmText: '提交',
      editable: true,
      placeholderText: '请简要说明争议原因',
      success(res) {
        if (!res.confirm) return;
        const reason = (res.content || '').trim();
        wx.showLoading({ title: '提交中', mask: true });
        return callCloud('order-action', {
          action: 'complaint',
          order_id: that.data.order._id,
          reason
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '提交失败', icon: 'none' }); return; }
          wx.showToast({ title: '已进入争议处理', icon: 'none' });
          return that.fetchData({ orderId: that.data.order._id });
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
      }
    });
  },

  // ── §14 取消订单 & 梯度退款 (onCancel) ──
  // O5 取消(wx.showModal 展示梯度退款规则, 替代 bottom-sheet)
  onCancel() {
    const that = this;
    const tier = this.data.cancelTiers[this.data.currentCancelIdx];
    const ruleLines = this.data.cancelTiers.map((t) => `· ${t.label}：退款${t.rate * 100}%`).join('\n');
    this._modal({
      title: '取消订单',
      content: `退款规则：\n${ruleLines}\n\n当前适用：${tier.label}，退款${tier.rate * 100}%`,
      confirmText: '确认取消',
      confirmColor: '#fa5151',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '取消中', mask: true });
        return callCloud('order-action', {
          action: 'cancel',
          order_id: that.data.order._id,
          reason: tier ? `按${tier.label}梯度退款` : ''
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '取消失败', icon: 'none' });
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

  // ── §15 快捷跳转 (支付/聊天/电话/预约/下一步操作) ──
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
          fail: () => wx.showToast({ title: '页面加载失败', icon: 'none' })
        });
      }
    });
  },

  // 拨打占位(过渡版): 号码保护服务开通前提示; 二期接入虚拟号后改为真实拨打
  onCallPlaceholder() {
    wx.showToast({ title: '号码保护服务开通中，可先通过聊天沟通', icon: 'none' });
  },

  // 跳聊天(Phase 1.5: 用 redirectTo 截断订单详情, 避免栈叠加)
  goChat() {
    wx.redirectTo({
      url: `/pages-v2/chat/chat?orderId=${this.data.order._id}`,
      fail: () => wx.showToast({ title: '页面加载失败', icon: 'none' })
    });
  },
  onReserve() { require('../../utils/redline.js').reserveNotice(); }
});
