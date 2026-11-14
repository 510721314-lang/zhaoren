// PRD章节: 3.4 IM聊天 / 3.4.1.1 模板消息四确认 / 3.4.2 限制规则 / 3.4.4 消息留存
// P0-2: 全部接云端 —— im-conv(open/messages) + im-send(send_template/send_text)
//       + order-action(get_confirmation/confirm_item/change_apply/change_respond)
// 红线: 四确认完成前仅可发送系统模板消息(后端强制); 确认状态为双方8位模型, 双侧确认才算该项完成
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { TM_TEMPLATES, TM_FIELD } = require('../../config/enums.js');
const { getScene } = redline;

const { callCloud } = require('../../utils/cloud.js');
const once = require('../../utils/once-anchor.js');
// 前端巨页分拆阶段A（归属表 v1.1）：四确认数据加工域 / 弹窗编排域外移（零行为变更，转发壳保持调用面不变）
const confirmFlow = require('../../utils/confirm-flow.js');
const chatNotice = require('../../utils/chat-notice.js');

Page({
  data: {
    statusBarHeight: 20,
    orderId: '',
    orderNo: '',
    scene: null,
    sceneName: '',
    counterpart: '',
    role: '',
    // 四确认原始 items {time:{value,user_ok,partner_ok},...}
    items: null,
    progress: { time: false, location: false, content: false, fee: false },
    confirmedCount: 0,
    // 2026-11-08: 四项确认常驻清单(双方均可见四项内容与各自确认进度, 不依赖模板卡是否已发)
    confirmList: [],
    unlocked: false,     // 四确认 4/4(双侧)
    freeChat: false,     // 后端允许自由文本
    chatBlocked: false,  // S6/S10
    batchBlocked: false, // 2026-11-09: 特别授权场景(W9 等)禁用一键全部确认
    s1Left: 0,           // 2026-11-09: S1 剩余秒数(轮询 tick 重算, 0=不显示倒计时条)
    s1Text: '',          // 2026-11-09: 倒计时展示文本(X分XX秒)
    orderStatus: '',
    startTime: 0,        // 2026-11-05: 履约开始时间戳(来自 get_confirmation), 供 S2 变更窗口前置拦截
    pendingBanner: null, // 加时/改期在途请求醒目横幅
    pendingChange: null, // 2026-11-04: S1 变更协商在途(时间/地点/内容/费用/其他), 对方接受后才生效
    s2MinH: (CONFIG.S2_CHANGE && CONFIG.S2_CHANGE.bMinHours) || 1, // 2026-11-05: S2 变更下限(文案随后台覆盖)
    s2Enabled: CONFIG.S2_CHANGE ? CONFIG.S2_CHANGE.enabled !== false : true,
    orderSummary: '',    // 订单概要(弹窗/横幅前置)
    messages: [],
    // C5 模板快捷键
    quickKeys: [
      { id: 'TM1', icon: '🕐', name: '时间' },
      { id: 'TM2', icon: '📍', name: '地点' },
      { id: 'TM3', icon: '📋', name: '内容' },
      { id: 'TM4', icon: '💰', name: '费用' },
      { id: 'TM5', icon: '✨', name: '其他' }
    ],
    otherUsedCount: 0,
    // C6 输入
    inputText: '',
    rateCooldown: 0,     // 私信频控倒计时(秒); >0 时发送按钮置灰
    // 编辑弹层: '' | 'time' | 'content' | 'fee' | 'other' (location 走 chooseLocation 无弹层)
    editSheet: '',
    editDate: '',
    editTimeHm: '',
    editFeeYuan: '',
    editContentOpts: [],
    otherText: '',      // TM5「特殊需求」文本(other 变更)
    // 滚动锚点
    scrollToView: '',
    loading: false,
    loadError: false,
    loadErrorMsg: '',
    isRedline: false,
    kefuResponseMin: CONFIG.IM.kefuResponseMin
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  // 2026-11-05: S2 变更入口文案与开关随 config_public 覆盖刷新(data() 初值仅为兜底)
  __refreshS2Text() {
    const c = CONFIG.S2_CHANGE || {};
    const patch = {};
    const h = c.bMinHours || 1;
    const enabled = c.enabled !== false;
    if (h !== this.data.s2MinH) patch.s2MinH = h;
    if (enabled !== this.data.s2Enabled) patch.s2Enabled = enabled;
    if (Object.keys(patch).length) this.setData(patch);
  },

  onLoad(options) {
    this.__refreshS2Text();
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
    this.__orderId = (options && options.orderId) || '';
    // 2026-11-10(用户反馈): 详情页「申请变更(地点/内容)」带 s2 参数跳转, 数据就绪后直达改地点
    this.__s2Auto = (options && options.s2) || '';
    this.__convId = '';
    this.__pollTimer = null;
    this.fetchData();
  },

  // @VERIFIED 2026-11-10 已真机验证：回前台立即补拉一次提示，不再等首个轮询 tick
  onShow() {
    this.__refreshS2Text();
    this.setData({ isRedline: redline.isInRedline() });
    this.startPolling();
    // 2026-11-10(提示滞后): 回前台立即补拉一次, 不再等首个 15s tick; 首次 onShow 由 onLoad.fetchData 覆盖, 跳过防双拉
    if (this.__resumed) this.pollOrderChat(); else this.__resumed = true;
  },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); this.clearRateTimer(); },

  // ───────── 数据加载 ─────────
  fetchData() {
    if (!/^[a-f0-9]{32}$/i.test(this.__orderId)) {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '缺少有效订单 ID,请从正确入口进入' });
      return;
    }
    this.setData({ loading: true, loadError: false });
    const orderId = this.__orderId;
    callCloud('im-conv', { action: 'open', order_id: orderId }).then((r) => {
      if (!r.ok) {
        this.setData({ loading: false, loadError: true, loadErrorMsg: r.msg || '会话打开失败' });
        return;
      }
      const d = r.data;
      this.__convId = d.conv_id;
      const scene = getScene(d.scene);
      this.setData({
        orderId: d.order_id,
        orderNo: d.order_no || '',
        scene,
        sceneName: d.scene_name || (scene ? scene.name : ''),
        counterpart: (d.peer && d.peer.nickname) || '',
        role: d.role || '',
        freeChat: !!d.free_chat,
        chatBlocked: !!d.chat_blocked,
        // 2026-11-09: 特别授权场景由 scene_list.batch_confirm 或 W9 兜底判定
        batchBlocked: !!((scene && (scene.code === 'W9' || scene.batchConfirm === false)) || d.scene === 'W9'),
        orderStatus: d.status || '',
        loading: false
      }, () => {
        // 系统事件条(本地展示)
        const sysMsg = {
          _id: 'sys_order_created', msg_type: 'system',
          content: `订单已创建(${d.order_no || ''}),请双方完成结构化四确认`,
          created_at: this.nowTime()
        };
        this.setData({ messages: [sysMsg] });
        return Promise.all([
          callCloud('order-action', { action: 'get_confirmation', order_id: orderId }),
          callCloud('im-conv', { action: 'messages', conv_id: d.conv_id })
        ]).then(([conf, msgs]) => {
          if (conf.ok) this.applyConfirmation(conf.data);
          if (msgs.ok) {
            this.renderMessages(msgs.data.messages);
            // 首次全量拉取后落增量游标(取已返回消息的最大 created_at, 避免用响应时间跳过并发新消息)
            this.__bumpMsgTs(msgs.data.messages);
          }
          this.scrollBottom();
          this.__maybeGuideConfirm(conf, msgs);
          this.__loadCommTmpl();
        });
      });
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请检查网络后重试' });
    });
  },

  // 订单概要文本(加时/改期横幅用): #订单号 · 场景 · ¥金额 · 服务时间
  __orderSummary(d) {
    const scene = getScene(d.scene);
    const parts = [];
    if (d.order_no) parts.push(`#${d.order_no}`);
    if (scene && scene.name) parts.push(scene.name);
    // 2026-11-10 修复: 金额保留两位小数(原 toFixed(0) 把 19.90 元显示成 ¥20)
    if (d.total_fen) parts.push(`¥${(d.total_fen / 100).toFixed(2)}`);
    if (d.start_time) parts.push(this.fmtDateTime(d.start_time));
    return parts.join(' · ');
  },

  // 首次进入四确认引导: 订单 S1 且双方都未发起过任何确认模板时, 引导先发起「时间」确认
  // 判断依据: 消息流里无 template 卡(发模板不写 order_confirmations, 以消息流为准)
  __maybeGuideConfirm(conf, msgs) {
    // 2026-10-30(§34): 引导幂等键落 Storage(once:guide:<order_id>:S1), 重进聊天页不再重复弹
    const guideKey = 'guide:' + (this.data.orderId || '') + ':S1';
    if (once.has(guideKey)) return;
    const d = (conf && conf.ok && conf.data) || null;
    const list = (msgs && msgs.ok && msgs.data && msgs.data.messages) || [];
    if (!d || d.status !== 'S1' || d.all_confirmed) return;
    if (list.some((m) => m && m.type === 'template')) return; // 已有确认卡, 不重复引导
    once.mark(guideKey);
    wx.showModal({
      title: '开始四确认',
      content: '订单已创建。请与对方逐项确认「时间／地点／内容／费用」: 点确定一次发齐四张确认卡, 双方逐项确认后进入待支付。',
      confirmText: '去确认',
      cancelText: '稍后',
      confirmColor: '#07C160',
      fail: () => {},
      success: (res) => {
        // 2026-11-08: 一次发齐四项确认卡(原仅发 TM1, 导致窗口内只看到「时间」一项)
        if (res.confirm) this.__sendAllConfirmTemplates();
      }
    });
  },

  // 2026-11-08: 串行发齐四项确认模板卡(时间/地点/内容/费用)。
  // 用 Promise 串行而非定时器, 保证消息流顺序稳定; 单项失败不阻断后续项。
  __sendAllConfirmTemplates() {
    const ids = ['TM1', 'TM2', 'TM3', 'TM4'];
    return ids.reduce((p, id) => p.then(() => this.sendTemplate(id).catch(() => {})), Promise.resolve());
  },

  reload() { this.fetchData(); },

  // 2026-10-17: 耍伴端「对方发起沟通」订阅消息(一次性订阅, 离端即时提醒): 进页静默拉模板 ID, 用户点按确认动作时再请求授权并落库
  // 未配模板/未授权一律静默降级 —— 端内弹窗(见 applyNotices)始终生效, 订阅消息仅作离端补充通道
  __loadCommTmpl() {
    if (this.data.role !== 'partner' || this.data.orderStatus !== 'S1') return;
    callCloud('admin-action', { action: 'config_public' }).then((r) => {
      const t = (r && r.ok && r.data && r.data.sub_msg && r.data.sub_msg.confirm_comm) || null;
      this.__commTmplId = (t && t.tmpl_id) || '';
      // 方案E(2026-11-14): 同批拉「支付提醒」模板 id, 与沟通授权共用同一手势
      const tp = (r && r.ok && r.data && r.data.sub_msg && r.data.sub_msg.paid) || null;
      this.__paidTmplId = (tp && tp.tmpl_id) || '';
    }).catch(() => {});
  },
  // 请求订阅授权(须在用户点按手势内调用, 否则微信拒绝); 授权结果落库 partner_profile.sub_msgs.confirm_comm(与接单设置页同口径)
  __requestCommSub() {
    if (this.__subReqDone || this.data.role !== 'partner' || this.data.orderStatus !== 'S1') return;
    // 方案E(2026-11-14): 单次手势同时请求「沟通/支付」两个模板(微信单次上限 3 个), 未配的项自动剔除
    const ids = [this.__commTmplId || '', this.__paidTmplId || ''].filter(Boolean);
    if (!ids.length) return;                                 // 未配任何模板 → 仅端内弹窗
    this.__subReqDone = true;
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => {
        // 方案E: 按 id 分别落库授权结果(id 与模板 key 的对应关系见 __commTmplId/__paidTmplId)
        const pairs = [[this.__commTmplId || '', 'confirm_comm'], [this.__paidTmplId || '', 'paid']];
        pairs.forEach((pair) => {
          const id = pair[0], key = pair[1];
          if (!id || !res || res[id] === undefined) return;
          const accept = res[id] === 'accept';
          callCloud('partner-action', { action: 'sub_authorize', tmpl: key, authorized: accept, count: accept ? 1 : 0 }).catch(() => {});
        });
      },
      fail: () => {}
    });
  },

  // ───────── 四确认状态 ─────────
  applyConfirmation(d) {
    // 前端巨页分拆阶段A（归属表 v1.1，零行为变更）：段1-6 数据加工域→utils/confirm-flow.js（返回 17 键 patch+实例态写回），
    // 段9-15 弹窗编排域→utils/chat-notice.js（保持 setData 回调内时序，约束②）；本函数为编排壳，@VERIFIED 标记随迁 chat-notice.js
    const view = confirmFlow.buildConfirmationView(this, d);
    this.setData(view.patch, () => {
      this.updateMsgStatuses();
      // 2026-11-10(用户反馈): 详情页带 s2 参数进入 → 状态/履约时间/变更次数已就绪, 直接进入改地点(只触发一次)
      if (this.__s2Auto && view.nextStatus === 'S2') {
        const autoField = this.__s2Auto;
        this.__s2Auto = '';
        this.startEdit(autoField);
      }
      chatNotice.runConfirmationPopups(this, d, view.nextStatus, view);
    });
  },

  refreshConfirmation() {
    return callCloud('order-action', { action: 'get_confirmation', order_id: this.data.orderId })
      .then((r) => {
        if (r.ok) this.applyConfirmation(r.data);
        // 如果后端返回的 status 和当前不同但没触发 setData(比如 applyConfirmation 里 nextStatus 没变化),
        // 也强制检查一次 orderStatus 是否需要更新
        if (r.ok && r.data && r.data.status && r.data.status !== this.data.orderStatus) {
          this.setData({ orderStatus: r.data.status });
        }
      }).catch(() => {});
  },

  // ───────── 消息渲染(增量合并 + 条件滚底) ─────────
  renderMessages(list) {
    const incoming = (list || []).map((m) => this.toUiMsg(m));
    // 增量合并: 保留系统消息 + 按 _id 去重追加
    const sysIdx = this.data.messages.findIndex((x) => x._id === 'sys_order_created');
    const sys = sysIdx >= 0 ? [this.data.messages[sysIdx]] : [];
    const sysIds = new Set(sys.map((s) => s._id));
    const existingIds = new Set(this.data.messages.map((m) => m._id).filter((x) => x !== 'sys_order_created'));
    const merged = sys.concat(this.data.messages.filter((m) => m._id !== 'sys_order_created'), incoming.filter((m) => !existingIds.has(m._id)));
    // 只在有新消息时滚底(用户上翻历史不被拉回)
    const shouldScroll = incoming.some((m) => !existingIds.has(m._id));
    this.setData({ messages: merged }, () => {
      this.updateMsgStatuses();
      if (shouldScroll) this.scrollBottom();
    });
  },

  toUiMsg(m) {
    const ui = {
      _id: m.msg_id,
      direction: m.is_mine ? 'out' : 'in',
      created_at: this.fmtTime(m.created_at)
    };
    if (m.type === 'template') {
      const field = TM_FIELD[m.template_id];
      const q = this.enrichedQuestion(m.template_id, field);
      return Object.assign(ui, {
        msg_type: 'template', tm_id: m.template_id,
        question: q, picked: '', status: 'pending'
      });
    }
    return Object.assign(ui, {
      msg_type: 'text', content: m.text, is_read: false
    });
  },

  // 把订单真实值注入模板卡问题文案(时间/地点/内容/费用)
  enrichedQuestion(tmId, field) {
    const tm = TM_TEMPLATES[tmId];
    if (!tm) return '';
    const items = this.data.items;
    if (!field || !items || !items[field]) return tm.question;
    const v = items[field].value;
    try {
      if (field === 'time' && v) {
        return `${tm.question}(${this.fmtDateTime(v)})`;
      }
      if (field === 'location' && v && v.name) {
        return `${tm.question}:${v.name}`;
      }
      if (field === 'content' && Array.isArray(v) && v.length) {
        return `${tm.question}:${v.join('、')}`;
      }
      if (field === 'fee' && v) {
        return `${tm.question}:合计 ${(Number(v) / 100).toFixed(0)} 元`;
      }
    } catch (e) {}
    return tm.question;
  },

  // 确认状态变化后,同步历史模板卡的状态/已选
  updateMsgStatuses() {
    const items = this.data.items;
    const role = this.data.role;
    if (!items || !role) return;
    const peerRole = role === 'user' ? 'partner' : 'user';
    const messages = this.data.messages.map((m) => {
      if (m.msg_type !== 'template') return m;
      const field = TM_FIELD[m.tm_id];
      if (!field || !items[field]) return m;
      const it = items[field];
      const myOk = !!it[role + '_ok'];
      const peerOk = !!it[peerRole + '_ok'];
      const positive = (TM_TEMPLATES[m.tm_id] && TM_TEMPLATES[m.tm_id].options && TM_TEMPLATES[m.tm_id].options[0]) || '';
      return Object.assign({}, m, {
        status: (myOk && peerOk) ? 'confirmed' : (myOk ? 'replied' : 'pending'),
        picked: myOk ? positive : ''
      });
    });
    this.setData({ messages });
  },

  refreshMessages() {
    if (!this.__convId) return Promise.resolve();
    return callCloud('im-conv', {
      action: 'messages', conv_id: this.__convId, after_ts: this.__lastMsgTs || 0
    })
      .then((r) => {
        if (r.ok) {
          this.renderMessages(r.data.messages);
          this.__bumpMsgTs(r.data.messages);
        }
      });
  },

  // 增量游标: 取本批消息最大 created_at(服务端 messages 支持 after_ts)
  __bumpMsgTs(list) {
    const max = (list || []).reduce((a, m) => Math.max(a, Number(m && m.created_at) || 0), this.__lastMsgTs || 0);
    if (max > (this.__lastMsgTs || 0)) this.__lastMsgTs = max;
  },

  // 订单侧低频轮询(四确认 + 通知合并 1 次调用), 由 startPolling 每 4 轮触发
  pollOrderChat() {
    if (!this.__orderId) return Promise.resolve();
    return callCloud('order-action', {
      action: 'chat_poll', order_id: this.__orderId, with_confirm: true, with_notice: true
    }).then((r) => {
      if (!r || !r.ok) return;
      const d = r.data || {};
      if (d.confirmation) this.applyConfirmation(d.confirmation);
      if (d.notices) this.applyNotices(d.notices);
    }).catch(() => {});
  },

  // ───────── 轮询(15s, 2026-10-26 用量治理第二轮) ─────────
  // 用量账: 消息 1 次/15s(240/时) + 四确认&通知(S0/S1/S2/S2_5 为 1 次/60s = 60/时, 其余 1 次/120s = 30/时)
  //   即 300 次/时(敏感状态) 或 270 次/时(其余状态); 对比原 3 次/8s(1,125/时) 仍低约 73%~76%
  startPolling() {
    this.stopPolling();
    if (!this.__orderId) return;
    this.__pollTick = 0;
    this.__pollTimer = setInterval(() => {
      if (this.data.loading || this.data.loadError) return;
      this.__pollTick += 1;
      // 2026-11-09: S1 倒计时随 tick 重算(复用 15s 轮询, 不新增定时器)
      if (this.data.orderStatus === 'S1' && this.__s1Deadline) {
        const left = Math.max(0, Math.floor((this.__s1Deadline - Date.now()) / 1000));
        if (left !== this.data.s1Left) this.setData({ s1Left: left, s1Text: this.__s1Text(left) });
      }
      this.refreshMessages();
      // 四确认/通知降频(首轮即拉): 通知有本地去重与横幅兜底
      // 2026-11-11(配额治理 R1): S0/S1/S2/S2_5 保持 60s(四确认与改期窗口对延迟敏感), 其余状态放宽到 120s
      // @VERIFIED 2026-11-11 已真机验证：S1 四确认 60s 内刷新、S3 加时全链路（S2.6 履约申请→加时申请→对方待确认弹窗）、消息 15s 不受影响
      const fastStatus = ['S0', 'S1', 'S2', 'S2_5'].indexOf(this.data.orderStatus) >= 0;
      if (this.__pollTick % (fastStatus ? 4 : 8) === 1) this.pollOrderChat();
    }, 15000);
  },
  stopPolling() {
    if (this.__pollTimer) { clearInterval(this.__pollTimer); this.__pollTimer = null; }
  },

  // ───────── 订单动态通知展示（实现外移 utils/chat-notice.js 分区二；@VERIFIED 2026-11-10/2026-10-18 两枚标记同迁；
  //    本函数为调用面不变的转发壳，wxml/轮询链调用点零改） ─────────
  applyNotices(d) {
    chatNotice.applyNotices(this, d);
  },

  // ───────── C4 模板卡选项点击（批次2a：确认链实现外移 utils/confirm-flow.js 分区二，本区仅留转发壳）─────────
  // 零行为变更：wxml 绑定名与调用面不变；@VERIFIED（onShow L108 / startPolling L408）不在本区
  onTmOption(e) { confirmFlow.onTmOption(this, e); },
  confirmItem(field) { confirmFlow.confirmItem(this, field); },
  onConfirmRow(e) { confirmFlow.onConfirmRow(this, e); },

  // 2026-11-09: 确认类操作命中状态冲突时, 刷新订单态并给一次性说明(修复死路弹窗)
  // 命中码=状态已流转/窗口已尽; 说明弹窗按 §34 幂等(once:s1close:<order_id>:S1), 重进不再重复弹, toast 兜底
  _handleOaConflict(r) {
    const code = (r && r.code) || '';
    if (['oa_not_confirmable', 'oa_not_editable', 'oa_status_conflict', 'oa_change_window_closed'].indexOf(code) < 0) {
      wx.showModal({ title: '确认失败', content: (r && r.msg) || '请稍后重试', showCancel: false, confirmText: '知道了' });
      return;
    }
    this.refreshConfirmation();
    const key = 's1close:' + (this.data.orderId || '') + ':S1';
    if (once.has(key)) {
      wx.showToast({ title: String((r && r.msg) || '订单状态已变化').slice(0, 14), icon: 'none' });
      return;
    }
    once.mark(key);
    wx.showModal({
      title: '确认窗口已结束',
      content: '四确认窗口已结束或订单状态已变化, 请以订单详情页最新状态为准。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#07C160',
      fail: () => {}
    });
  },

  // 2026-11-09: 变更提交失败分流 —— 窗口将尽关弹层并给「逐项确认」出路, 不再死路弹窗
  _handleApplyFail(r) {
    const code = (r && r.code) || '';
    if (code === 'oa_change_window_closed') {
      this.setData({ editSheet: '' });   // 先关弹层, 顶部常驻四确认清单立即可见可点
      this.refreshConfirmation();
      wx.showModal({
        title: '确认窗口即将结束',
        content: '剩余时间不足以完成变更协商。请在四项清单中逐项「确认」, 或取消订单释放需求。',
        confirmText: '去确认',
        cancelText: '我知道了',
        confirmColor: '#07C160',
        fail: () => {},
        success: (res) => {
          if (res.confirm) wx.showToast({ title: '请在清单中逐项确认', icon: 'none' });
        }
      });
      return;
    }
    if (code === 'oa_change_limit') {
      // 2026-11-10 修复: 次数文案改为跟随后台配置(原写死 2 次/4 次, 与默认 1 次/2 次冲突)
      const sc = CONFIG.S2_CHANGE || {};
      wx.showModal({ title: '变更次数已达上限', content: `每项最多变更${sc.perFieldMax || 1}次、整单最多${sc.totalMax || 2}次。如仍有分歧,可取消订单后重新发布需求。`, showCancel: false, confirmText: '知道了' });
      return;
    }
    // 状态类冲突先刷新本地状态再提示(文案来自服务端, 随状态更新)
    if (['oa_change_pending', 'oa_not_editable', 'oa_status_conflict', 'oa_s2c_window_closed'].indexOf(code) >= 0) {
      this.refreshConfirmation();
    }
    wx.showModal({ title: '提交失败', content: (r && r.msg) || '请稍后重试', showCancel: false, confirmText: '知道了' });
  },

  // ───────── ⑥ 一键全部确认（批次2a：实现在 confirm-flow.onConfirmAll）─────────
  onConfirmAll() { confirmFlow.onConfirmAll(this); },

  // 一键确认后补齐消息流缺失的确认卡(confirm_all 只置确认位不产生消息卡; 串行补发, 避免消息乱序)
  __sendMissingConfirmCards() {
    const missing = Object.keys(TM_FIELD).filter((tmId) =>
      !this.data.messages.some((m) => m && m.msg_type === 'template' && m.tm_id === tmId));
    if (!missing.length) return Promise.resolve();
    return missing.reduce((chain, tmId) => chain
      .then(() => new Promise((r) => setTimeout(r, 300))) // 等 confirm_all 落库, 补卡状态取最新 items
      .then(() => this.sendTemplate(tmId)), Promise.resolve());
  },

  // ───────── 调整确认项（批次2b：编辑/提交/响应链实现外移 utils/confirm-flow.js 分区二）─────────
  // 零行为变更：wxml 绑定名与调用面不变；applyChange 无外部调用点，不设壳（模块内自调）
  startEdit(field) { confirmFlow.startEdit(this, field); },
  onS2ChangeTap(e) { confirmFlow.onS2ChangeTap(this, e); },
  closeEditSheet() { confirmFlow.closeEditSheet(this); },
  onEditDate(e) { confirmFlow.onEditDate(this, e); },
  onEditTimeHm(e) { confirmFlow.onEditTimeHm(this, e); },
  onEditFeeInput(e) { confirmFlow.onEditFeeInput(this, e); },
  onEditContentChange(e) { confirmFlow.onEditContentChange(this, e); },
  confirmEditTime() { confirmFlow.confirmEditTime(this); },
  confirmEditContent() { confirmFlow.confirmEditContent(this); },
  confirmEditFee() { confirmFlow.confirmEditFee(this); },
  onOtherInput(e) { confirmFlow.onOtherInput(this, e); },
  confirmEditOther() { confirmFlow.confirmEditOther(this); },
  onRespondChange(e) { confirmFlow.onRespondChange(this, e); },

  // ───────── C5 模板快捷键 ─────────
  onQuickKey(e) {
    const tmId = e.currentTarget.dataset.id;
    if (this.data.chatBlocked) {
      wx.showToast({ title: '订单已取消/关闭,无法发送', icon: 'none' });
      return;
    }
    // 2026-11-04: 「其他」不再发空模板卡, 直接收集文本 → other 变更(仅 S1, 接受后不重置确认位)
    if (tmId === 'TM5') {
      if (this.data.orderStatus !== 'S1') {
        wx.showToast({ title: '当前状态不可提交特殊需求', icon: 'none' });
        return;
      }
      if (this.data.pendingChange) {
        wx.showToast({ title: '有变更待对方反馈,暂不可改', icon: 'none' });
        return;
      }
      this.setData({ editSheet: 'other', otherText: '' });
      return;
    }
    this.sendTemplate(tmId);
  },

  sendTemplate(tmId) {
    const { guardSwitch } = require('../../utils/bootstrap.js');
    if (!guardSwitch('im')) return Promise.resolve();
    return callCloud('im-send', {
      action: 'send_template', order_id: this.data.orderId, template_id: tmId
    }).then((r) => {
      if (!r.ok) {
        wx.showModal({ title: '发送失败', content: r.msg || '请稍后重试', showCancel: false });
        return;
      }
      const messages = this.data.messages.concat([this.toUiMsg(r.data.msg)]);
      this.setData({ messages }, () => {
        this.updateMsgStatuses();
        this.scrollBottom();
      });
      // TM5 使用计数 → 达阈值弹客服介入(wx.showModal 原生弹窗)
      if (tmId === 'TM5') {
        const otherUsedCount = this.data.otherUsedCount + 1;
        this.setData({ otherUsedCount });
        if (otherUsedCount >= CONFIG.IM.otherKefuThreshold) {
          this.askKefu();
        }
      }
    }).catch(() => {
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  },

  // ───────── 客服介入 ─────────
  askKefu() {
    wx.showModal({
      title: '申请客服介入',
      content: `您多次使用「其他」模板消息沟通，系统检测到双方可能需要平台协助。客服将在${CONFIG.IM.kefuResponseMin}分钟内接入会话，协助双方完成确认。`,
      confirmText: '申请介入',
      cancelText: '暂不需要',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        wx.showToast({ title: `已申请,客服将在${CONFIG.IM.kefuResponseMin}分钟内接入`, icon: 'none' });
      }
    });
  },

  // ───────── C6 自由输入(四确认后) ─────────
  onTextInput(e) { this.setData({ inputText: e.detail.value }); },

  // 频控倒计时(服务端 im_rate_limited 下发 retry_after 秒)
  startRateCooldown(sec) {
    this.clearRateTimer();
    this.setData({ rateCooldown: Math.max(1, parseInt(sec, 10) || 1) });
    this._rateTimer = setInterval(() => {
      const left = this.data.rateCooldown - 1;
      if (left <= 0) { this.clearRateTimer(); this.setData({ rateCooldown: 0 }); }
      else this.setData({ rateCooldown: left });
    }, 1000);
  },
  clearRateTimer() {
    if (this._rateTimer) { clearInterval(this._rateTimer); this._rateTimer = null; }
  },

  sendText() {
    const { guardSwitch } = require('../../utils/bootstrap.js');
    if (!guardSwitch('im')) return;
    const text = this.data.inputText.trim();
    if (!text) return;
    if (this.data.rateCooldown > 0) {
      wx.showToast({ title: `请稍候 ${this.data.rateCooldown} 秒再发送`, icon: 'none' });
      return;
    }
    if (!this.data.freeChat) {
      wx.showToast({ title: '四项确认完成前仅可发送模板消息', icon: 'none' });
      return;
    }
    callCloud('im-send', {
      action: 'send_text', order_id: this.data.orderId, text
    }).then((r) => {
      if (!r.ok) {
        wx.showToast({ title: r.msg || '发送失败', icon: 'none' });
        if (r.code === 'im_template_only') this.refreshConfirmation();
        // 命中频控: 启动本地倒计时与服务端窗口对齐
        if (r.code === 'im_rate_limited' && r.retry_after) this.startRateCooldown(r.retry_after);
        return;
      }
      this.setData({ inputText: '' });
      const messages = this.data.messages.concat([this.toUiMsg(r.data.msg)]);
      this.setData({ messages }, () => this.scrollBottom());
    }).catch(() => {
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  },

  // ───────── 待支付横幅 ─────────
  goPay() {
    if (this.data.orderStatus !== 'S0') return;
    wx.navigateTo({
      url: `/pages-v2/pay/pay?orderId=${this.data.orderId}`,
      fail: () => wx.showToast({ title: '打开失败，请稍后重试', icon: 'none' })
    });
  },

  // 2026-11-03(A+C·A): 左上 ‹ 恢复「返回上一页」语义。原实现误绑 goOrderDetail(redirectTo)，
  // 会销毁聊天页并强制落到订单详情，消息页→聊天后无法返回。
  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: '/pages-v2/index/index', fail: () => {} });
  },

  // ───────── C1 订单卡片入口 ─────────
  goOrderDetail() {
    if (!this.data.orderId) return;
    wx.redirectTo({
      url: `/pages-v2/order-detail/order-detail?orderId=${this.data.orderId}`,
      fail: () => wx.showToast({ title: '打开失败，请稍后重试', icon: 'none' })
    });
  },

  // ───────── 工具 ─────────
  nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  // 2026-11-05: S2 同值判定(与后端 action_change_s2 sameValue 同口径: 内容按集合比较, 地点按 name+经纬度)
  __s2SameValue(field, value) {
    const it = (this.data.items || {})[field] || {};
    const cur = it.value;
    if (field === 'content') {
      const a = Array.isArray(cur) ? cur.slice().sort() : [];
      const b = Array.isArray(value) ? value.slice().sort() : [];
      return a.length === b.length && a.every((x, i) => x === b[i]);
    }
    if (field === 'location') {
      if (!cur || !value) return false;
      return String(cur.name || '') === String(value.name || '')
        && Number(cur.latitude) === Number(value.latitude)
        && Number(cur.longitude) === Number(value.longitude);
    }
    return false;
  },
  fmtDateTime(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  // 2026-11-09: S1 倒计时文本(X分XX秒 / XX秒)
  __s1Text(left) {
    const mm = Math.floor(left / 60), ss = left % 60;
    return mm > 0 ? mm + '分' + (ss < 10 ? '0' : '') + ss + '秒' : ss + '秒';
  },
  // 2026-11-04: 变更值统一展示(时间/地点/内容/费用/其他), 旧值新值同口径
  __changeValueText(field, v) {
    if (field === 'time') return this.fmtDateTime(v) || '未设置';
    if (field === 'fee') return '¥' + (Number(v || 0) / 100).toFixed(2);
    if (field === 'location') return (v && v.name) ? String(v.name) : '未设置';
    if (field === 'content') {
      const arr = Array.isArray(v) ? v : (v ? [v] : []);
      return arr.length ? arr.join('/') : '未设置';
    }
    return String(v || '') || '未填写';
  },
  scrollBottom() {
    setTimeout(() => {
      const last = this.data.messages[this.data.messages.length - 1];
      this.setData({ scrollToView: last ? last._id : '' });
    }, 50);
  },
  onReserve() { require('../../utils/redline.js').reserveNotice(); }
});
