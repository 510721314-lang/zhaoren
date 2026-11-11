// PRD章节: 3.4 IM聊天 / 3.4.1.1 模板消息四确认 / 3.4.2 限制规则 / 3.4.4 消息留存
// P0-2: 全部接云端 —— im-conv(open/messages) + im-send(send_template/send_text)
//       + order-action(get_confirmation/confirm_item/change_apply/change_respond)
// 红线: 四确认完成前仅可发送系统模板消息(后端强制); 确认状态为双方8位模型, 双侧确认才算该项完成
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { TM_TEMPLATES } = require('../../config/enums.js');
const { getScene } = redline;

// 模板 id → 四确认字段(与后端 CONFIRM_FIELDS 一致)
const TM_FIELD = { TM1: 'time', TM2: 'location', TM3: 'content', TM4: 'fee' };

const { callCloud } = require('../../utils/cloud.js');
const once = require('../../utils/once-anchor.js');

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
    }).catch(() => {});
  },
  // 请求订阅授权(须在用户点按手势内调用, 否则微信拒绝); 授权结果落库 partner_profile.sub_msgs.confirm_comm(与接单设置页同口径)
  __requestCommSub() {
    if (this.__subReqDone || this.data.role !== 'partner' || this.data.orderStatus !== 'S1') return;
    const tmplId = this.__commTmplId || '';
    if (!tmplId) return;                                     // 未配模板 → 仅端内弹窗
    this.__subReqDone = true;
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        const accept = !!(res && res[tmplId] === 'accept');
        callCloud('partner-action', { action: 'sub_authorize', tmpl: 'confirm_comm', authorized: accept, count: accept ? 1 : 0 }).catch(() => {});
      },
      fail: () => {}
    });
  },

  // ───────── 四确认状态 ─────────
  applyConfirmation(d) {
    const items = d.items || {};
    const both = (f) => !!(items[f] && items[f].user_ok && items[f].partner_ok);
    const progress = {
      time: both('time'), location: both('location'),
      content: both('content'), fee: both('fee')
    };
    const count = [progress.time, progress.location, progress.content, progress.fee].filter(Boolean).length;
    // 2026-11-08: 四项常驻清单 —— 双方均可见「时间/地点/内容/费用」当前值与各自确认状态
    const CONF_META = [
      { f: 'time', cn: '时间', icon: '🕐' },
      { f: 'location', cn: '地点', icon: '📍' },
      { f: 'content', cn: '内容', icon: '📋' },
      { f: 'fee', cn: '费用', icon: '💰' }
    ];
    const isPartner = this.data.role === 'partner';
    const confirmList = CONF_META.map((m) => {
      const it = items[m.f] || {};
      const myOk = isPartner ? !!it.partner_ok : !!it.user_ok;
      const peerOk = isPartner ? !!it.user_ok : !!it.partner_ok;
      return {
        field: m.f, cn: m.cn, icon: m.icon,
        value: this.__changeValueText(m.f, it.value),
        myOk, peerOk, done: myOk && peerOk
      };
    });
    const wasUnlocked = this.data.unlocked;
    const unlocked = !!d.all_confirmed;
    const firstLoad = !this.__confLoaded;
    this.__confLoaded = true;
    // status 强制用后端返回值, 不做 || 兜底(后端不会返回空 status)
    const nextStatus = d.status && d.status !== this.data.orderStatus ? d.status : this.data.orderStatus;
    // 2026-11-09: S1 剩余窗口 —— 用服务端 s1_expire_at-server_now 差值折算本地截止时间, 抵消双端时钟偏差;
    // created_at 缺失(=0)不倒计时, 禁止 now 兜底
    if (d.s1_expire_at > 0 && d.server_now > 0) {
      this.__s1Deadline = Date.now() + (d.s1_expire_at - d.server_now);
    } else if (nextStatus !== 'S1') {
      this.__s1Deadline = 0;
    }
    const s1Left = (nextStatus === 'S1' && this.__s1Deadline) ? Math.max(0, Math.floor((this.__s1Deadline - Date.now()) / 1000)) : 0;
    // 加时/改期在途请求 → 醒目横幅(对方发起且未处理; 常驻至确认/拒绝/超时; 先给订单概要)
    const pm = d.pending_modify;
    const pe = d.pending_extend;
    let pendingBanner = null;
    if (pe && pe.can_respond) {
      pendingBanner = {
        type: 'extend', summary: this.__orderSummary(d),
        title: '⏰ 对方申请加时',
        body: `加时 ${pe.add_hours} 小时 · ¥${(pe.add_amount_fen / 100).toFixed(2)} · 点击去处理 ›`,
        canRespond: true
      };
    } else if (pm && pm.can_respond && nextStatus === 'S2_5') {
      pendingBanner = {
        type: 'modify', summary: this.__orderSummary(d),
        title: '📅 对方申请改期',
        body: `改至 ${this.fmtDateTime(pm.new_start_time)} · 点击去处理 ›`,
        canRespond: true
      };
    }
    // 2026-11-04: S1 变更协商在途态(对方接受才生效); 前端只展示必要字段
    const CHANGE_CN = { time: '时间', location: '地点', content: '内容', fee: '费用', other: '其他' };
    const pc = d.pending_change || null;
    const pendingChange = pc ? {
      field: pc.field,
      field_cn: CHANGE_CN[pc.field] || pc.field,
      old_text: this.__changeValueText(pc.field, pc.old_value),
      new_text: this.__changeValueText(pc.field, pc.new_value),
      by_role: pc.by_role || '',
      by_text: pc.by_role === 'user' ? '发单人' : '耍伴',
      reason: pc.reason || '',
      expire_text: pc.expire_at ? `${this.fmtDateTime(pc.expire_at)} 前反馈` : '请在 15 分钟内反馈',
      can_respond: !!pc.can_respond,
      token: pc.token || ''
    } : null;
    // 2026-11-10(评审修复): 付费后改期/改地点前置校验数据 —— get_confirmation 新增下发; 不读则新校验恒为假
    const s2c = d.s2_change_counts || {};
    const s2Counts = { total: Number(s2c._total) || 0, location: Number(s2c.location) || 0, content: Number(s2c.content) || 0 };
    this.setData({
      items,
      progress,
      confirmedCount: count,
      confirmList,
      unlocked,
      freeChat: unlocked || this.data.freeChat,
      orderStatus: nextStatus,
      startTime: Number(d.start_time) || this.data.startTime || 0,
      pendingBanner,
      pendingChange,
      frozen: !!d.frozen,
      s2Counts,
      s1Left,
      s1Text: s1Left > 0 ? this.__s1Text(s1Left) : '',
      // 2026-11-09: 轮询发现终态时同步停会话标记(im-conv.open 仅进页快照, 轮询期订单取消不会重推)
      chatBlocked: (nextStatus === 'S6' || nextStatus === 'S10') ? true : this.data.chatBlocked,
      // 2026-11-09: 特别授权判定以服务端下发 batch_blocked 为单一真值(本地 scene 判定仅兜底)
      batchBlocked: !!d.batch_blocked || this.data.batchBlocked,
      orderSummary: this.__orderSummary(d)
    }, () => {
      this.updateMsgStatuses();
      // 2026-11-10(用户反馈): 详情页带 s2 参数进入 → 状态/履约时间/变更次数已就绪, 直接进入改地点(只触发一次)
      if (this.__s2Auto && nextStatus === 'S2') {
        const autoField = this.__s2Auto;
        this.__s2Auto = '';
        this.startEdit(autoField);
      }
      // ── 状态提示 catch-up 模式: 每状态只提示一次, 不依赖轮询跳变/瞬时窗口(根治"提示不跳出/丢失"类问题) ──
      // 2026-10-30(§34): 状态提示幂等键落 Storage(once:status:<order_id>:<阶段>), 重进聊天页不再重复弹
      const stOid = this.data.orderId || '';
      const shown = (k) => once.has('status:' + stOid + ':' + k);
      const mark = (k) => once.mark('status:' + stOid + ':' + k);

      // 1) S0 耍伴端: 对方已确认, 待付款
      if (this.data.role === 'partner' && nextStatus === 'S0' && !shown('partner_S0')) {
        mark('partner_S0');
        wx.showModal({
          title: '📋 对方已确认',
          content: `${this.__orderSummary(d)}\n需求方已完成四项确认,订单进入待支付,等待需求方付款`,
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#07C160',
          fail: () => wx.showToast({ title: '对方已确认,待付款', icon: 'none' })
        });
      }
      // 1b) 2026-11-09 S0 需求方端: 四项已全部确认 → 弹窗引导完成支付(once 幂等, 点确定直达收银台)
      if (this.data.role === 'user' && nextStatus === 'S0' && !shown('user_S0')) {
        mark('user_S0');
        wx.showModal({
          title: '✅ 四项已全部确认',
          content: `${this.__orderSummary(d)}\n双方确认完毕,请完成支付后耍伴即开始履约`,
          showCancel: false,
          confirmText: '去支付',
          confirmColor: '#07C160',
          fail: () => wx.showToast({ title: '四项已确认,待支付', icon: 'none' }),
          success: (res) => {
            if (res.confirm) {
              // redirectTo: 全齐后聊天页使命已完成, 直达收银台(与"去履约"先例同模式)
              wx.redirectTo({
                url: `/pages-v2/pay/pay?orderId=${this.data.orderId}`,
                fail: (err) => {
                  console.error('[chat] redirectTo pay fail:', err && err.errMsg);
                  wx.showToast({ title: '支付页打开失败', icon: 'none' });
                }
              });
            }
          }
        });
      }
      // 1c) 2026-11-10(用户需求): 待我处理的变更 → 弹窗引导进入处理(once 按变更 token 幂等, 处理入口=本页变更卡片)
      const pcn = this.data.pendingChange;
      if (pcn && pcn.can_respond) {
        // 2026-11-10 评审 P0: 键去 token, 改 field:expire_at —— 与订单详情页共用同一 Storage 键, 避免跨页双弹
        const chKey = `change_${pcn.field}:${((d.pending_change || {}).expire_at) || 0}`;
        if (!shown(chKey)) {
          mark(chKey);
          wx.showModal({
            title: `对方申请变更「${pcn.field_cn}」`,
            content: `${pcn.old_text} → ${pcn.new_text}\n${pcn.expire_text}，请及时处理`,
            confirmText: '去处理',
            cancelText: '稍后',
            confirmColor: '#07C160',
            fail: () => wx.showToast({ title: '有变更待你处理', icon: 'none' })
          });
        }
      }
      // 2) S2 耍伴端: 对方已支付, 去履约
      if (this.data.role === 'partner' && nextStatus === 'S2' && !shown('partner_S2')) {
        mark('partner_S2');
        wx.showModal({
          title: '💰 对方已支付',
          content: `${this.__orderSummary(d)}\n对方已完成支付，请依约履约`,
          showCancel: true,
          confirmText: '去履约',
          cancelText: '知道了',
          confirmColor: '#07C160',
          fail: () => wx.showToast({ title: '对方已支付', icon: 'none' }),
          success: (res) => {
            if (res.confirm) {
              // 引导进入履约界面(订单详情页, S2 时可点"开始履约")
              wx.redirectTo({
                url: `/pages-v2/order-detail/order-detail?orderId=${this.data.orderId}`,
                fail: (err) => {
                  console.error('[chat] redirectTo order-detail fail:', err && err.errMsg);
                  wx.navigateBack({ fail: () => {} });
                }
              });
            }
          }
        });
      }
      // 3) S5 发布者端: 履约完成, 去评价
      if (this.data.role === 'user' && nextStatus === 'S5' && !shown('user_S5')) {
        mark('user_S5');
        wx.showModal({
          title: '🎉 履约完成',
          content: `${this.__orderSummary(d)}\n耍伴已完成履约，请对本次服务进行评价`,
          showCancel: true,
          confirmText: '去评价',
          cancelText: '稍后',
          confirmColor: '#07C160',
          fail: () => wx.showToast({ title: '履约完成，请评价', icon: 'none' }),
          success: (res) => {
            if (res.confirm) {
              wx.redirectTo({
                url: `/pages-v2/pkg-low/evaluate/evaluate?orderId=${this.data.orderId}`,
                fail: (err) => {
                  console.error('[chat] redirectTo evaluate fail:', err && err.errMsg);
                  wx.showToast({ title: '评价页打开失败,请从订单详情进入', icon: 'none', duration: 2500 });
                }
              });
            }
          }
        });
      }
      // 4) S0 发布者端: 订单支付(catch-up: 进入/轮询即弹, 不再限定"确认完成瞬间"或"非首次加载")
      if (this.data.role === 'user' && nextStatus === 'S0' && !shown('user_S0')) {
        mark('user_S0');
        wx.showModal({
          title: '💳 订单支付',
          content: `${this.__orderSummary(d)}\n四项确认已全部完成,订单进入待支付\n请在 30 分钟内完成支付,超时订单将自动取消`,
          confirmText: '支付',
          cancelText: '放弃支付',
          confirmColor: '#07C160',
          fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
          success: (res) => {
            if (res.confirm) this.goPay(); // 放弃支付 → 留在四确认完成窗口(顶部横幅可再次进入支付)
          }
        });
      }
      if (unlocked && !wasUnlocked) {
        wx.showToast({ title: '已解锁自由沟通,请遵守平台规则', icon: 'none', duration: 2000 });
      }
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
      const fastStatus = ['S0', 'S1', 'S2', 'S2_5'].indexOf(this.data.orderStatus) >= 0;
      if (this.__pollTick % (fastStatus ? 4 : 8) === 1) this.pollOrderChat();
    }, 15000);
  },
  stopPolling() {
    if (this.__pollTimer) { clearInterval(this.__pollTimer); this.__pollTimer = null; }
  },

  // ───────── 订单动态通知展示: 对方对订单的任何变动(接单/支付/改期/履约等)即时 toast 提示 ─────────
  // 幂等去重: 已提示过的通知不再重复(Storage once:chat_notice:<order_id> 持久化); 数据源为 chat_poll.notices(60s 一轮)
  // 2026-11-10(提示滞后): 去重键改为 id|created_at —— writeNotice 合并时复用同一 _id 并刷新 created_at, 仅按 id 会吞掉第二次同类事件
  // @VERIFIED 2026-11-10 已真机验证：通知去重键含 created_at，二次同类事件两次都提示
  applyNotices(d) {
    // 2026-10-30(§34): 通知/沟通提示幂等键落 Storage, 重进聊天页不再重复弹(§2 #88 已获放行: 文案与触发条件不变)
    const nOid = this.data.orderId || '';
    const shownIds = once.getMap('chat_notice:' + nOid);
    {
      if (!d || !d.list || !d.list.length) return;
      const fresh = d.list.filter((n) => n && n.id && !shownIds[n.id + '|' + (n.created_at || 0)]);
      if (!fresh.length) return;
      fresh.forEach((n) => { shownIds[n.id + '|' + (n.created_at || 0)] = 1; });
      once.putMap('chat_notice:' + nOid, shownIds);
      // 加时/改期被对方响应(同意/拒绝, 含超时自动拒绝): 震动 + 弹窗醒目提醒(该通知仅发起方会收到)
      const RESPOND_ALERT = {
        extend_confirm: '✅ 对方已同意加时',
        extend_reject: '❌ 对方已拒绝加时',
        modify_confirm: '✅ 对方已同意改期',
        modify_reject: '❌ 对方已拒绝改期',
        // 2026-11-04: 四确认变更协商的生效/拒绝结果(仅发起方收到)
        change_accept: '✅ 对方已接受变更',
        change_reject: '❌ 对方已拒绝变更'
      };
      const respondHit = fresh.find((n) => RESPOND_ALERT[n.type]);
      // 2026-11-10 评审 P0: 变更提醒收敛为单一来源(上方 1c token 键弹窗), 通知弹窗降级为横幅, 避免同轮双弹
      // 2026-11-10(3B): 收到「对方发起改期」→ 震动+弹窗引导进入处理(原仅顶部横幅, 易错过确认窗口)
      const modifyHit = !respondHit
        ? fresh.find((n) => n && n.type === 'modify' && String(n.title || '').indexOf('发起改期') >= 0)
        : null;
      // @VERIFIED 2026-10-18 已真机验证：#88 耍伴端四确认沟通即时提示（聊天页弹窗 + 微信订阅消息 confirm_comm 全链 ①-⑦ + 催办订阅复验）
      // 2026-10-17: 对方(发单人)在四确认面板提交修改/沟通 → 耍伴端醒目弹窗引导回到四确认(通知标题「订单沟通」)
      // 去重键取 id+body: 该通知被后续修改去重合并(同一 _id), 仅按 id 去重会漏掉"第二次改动"; 仅耍伴端提示(默认不做对称)
      const commShown = once.getMap('chat_comm:' + nOid);
      const commHit = (this.data.role === 'partner' && !respondHit)
        ? (d.list || []).find((n) => n && n.type === 'modify' && n.title === '订单沟通'
            && !commShown[n.id + '|' + (n.body || '')])
        : null;
      if (respondHit) {
        try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
        wx.showModal({
          title: RESPOND_ALERT[respondHit.type],
          content: respondHit.body || '',
          showCancel: false,
          confirmText: '知道了'
        });
      } else if (modifyHit) {
        try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
        wx.showModal({
          title: '对方发起改期',
          content: `${modifyHit.body || '对方申请变更服务时间'}\n请在倒计时内处理`,
          confirmText: '去处理',
          cancelText: '稍后',
          confirmColor: '#07C160',
          fail: () => {},
          success: (res) => { if (res.confirm) this.goOrderDetail(); }
        });
      } else if (commHit) {
        // 先记账再弹窗: 弹窗未关时下一轮轮询(5s)不会重复弹出
        commShown[commHit.id + '|' + (commHit.body || '')] = 1;
        once.putMap('chat_comm:' + nOid, commShown);
        try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
        wx.showModal({
          title: '对方发起沟通',
          content: `${commHit.body || '对方修改了确认项'}\n请回到上方四确认面板查看并重新确认`,
          confirmText: '去确认',
          cancelText: '稍后',
          confirmColor: '#07C160',
          fail: () => {},
          success: (res) => {
            if (res.confirm) wx.pageScrollTo({ scrollTop: 0, duration: 200 }); // 四确认面板在页面顶部
          }
        });
      } else {
        const key = fresh[0];
        const TITLE_OF = {
          accept: '有人接单了', paid: '对方已支付',
          confirm_done: '四确认完成,待支付', start: '耍伴已开始履约',
          finish: '履约已完成', milestone: '履约进度更新',
          cancel: '订单已取消', tip: '收到打赏'
        };
        const t = TITLE_OF[key.type] || key.title || '订单有新动态';
        if (t && t !== '订单沟通') wx.showToast({ title: String(t).slice(0, 12), icon: 'none', duration: 2500 });
      }
      // 同一轮 chat_poll 已带回最新四确认数据, 不再额外调用
    }
  },

  // ───────── C4 模板卡选项点击 ─────────
  onTmOption(e) {
    const { tm_id, option } = e.detail;
    const field = TM_FIELD[tm_id];
    if (!field) {
      // TM5 等无确认字段的模板
      wx.showToast({ title: '该模板无需确认', icon: 'none' });
      return;
    }
    if (this.data.chatBlocked) {
      wx.showToast({ title: '订单已取消/关闭,无法操作', icon: 'none' });
      return;
    }
    const positive = TM_TEMPLATES[tm_id] && TM_TEMPLATES[tm_id].options && TM_TEMPLATES[tm_id].options[0] === option;
    if (positive) this.confirmItem(field);
    else this.startEdit(field);
  },

  confirmItem(field) {
    // 2026-11-05: S2 已支付后确认位不再可改(异常数据兜底), 提前拦截避免"确认失败"弹窗
    if (this.data.orderStatus === 'S2') {
      wx.showToast({ title: '已支付,无需再确认', icon: 'none' });
      return;
    }
    // 2026-11-09: S1 窗口已尽前置拦截, 避免白提交后才收到冲突错误
    if (this.data.orderStatus === 'S1' && this.__s1Deadline && Date.now() >= this.__s1Deadline) {
      this._handleOaConflict({ code: 'oa_not_confirmable', msg: '确认窗口已结束' });
      return;
    }
    this.__requestCommSub();   // 2026-10-17: 点按手势内请求「对方发起沟通」订阅授权(耍伴端, 未配模板/已请求过则跳过)
    wx.showLoading({ title: '提交中', mask: true });
    callCloud('order-action', {
      action: 'confirm_item', order_id: this.data.orderId, item: field
    }).then((r) => {
      wx.hideLoading();
      if (!r.ok) {
        this._handleOaConflict(r);   // 2026-11-09: 状态冲突给出路, 不再死路弹窗
        return;
      }
      return this.refreshConfirmation();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  },

  // 2026-11-09: 四项常驻清单行内确认(不依赖模板卡); 四栅: S1/未确认/无变更在途/会话未停
  onConfirmRow(e) {
    const field = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field) || '';
    const it = (this.data.confirmList || []).find((x) => x.field === field);
    if (!field || !it) return;
    if (this.data.orderStatus !== 'S1') {
      wx.showToast({ title: '当前状态不可确认', icon: 'none' });
      return;
    }
    if (this.data.chatBlocked) {
      wx.showToast({ title: '订单已取消/关闭', icon: 'none' });
      return;
    }
    if (this.data.pendingChange) {
      wx.showToast({ title: '有变更待对方反馈', icon: 'none' });
      return;
    }
    if (it.myOk) {
      wx.showToast({ title: '该项已确认', icon: 'none' });
      return;
    }
    this.confirmItem(field);
  },

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

  // ───────── ⑥ 一键全部确认(需求发布者; 批量置本方四项确认位) ─────────
  // 后端 confirm_all 原子置本方 4 位 + version+1; 不定向消息, 不破坏"完成前仅模板消息"红线
  onConfirmAll() {
    if (this.data.chatBlocked) {
      wx.showToast({ title: '订单已取消/关闭,无法确认', icon: 'none' });
      return;
    }
    // 2026-11-09: 特别授权场景必须逐项确认, 不允许一键全部确认
    if (this.data.batchBlocked) {
      wx.showToast({ title: '该订单需逐项确认', icon: 'none' });
      return;
    }
    // 2026-11-05: S2 已支付后不再允许四确认操作（正常数据不会出现, 异常数据兜底）
    if (this.data.orderStatus === 'S2') {
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
        this.__requestCommSub();   // 2026-10-17: 同上(点按手势内请求订阅授权)
        wx.showLoading({ title: '提交中', mask: true });
        callCloud('order-action', {
          action: 'confirm_all', order_id: this.data.orderId
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            this._handleOaConflict(r);   // 2026-11-09: 状态冲突给出路, 不再死路弹窗
            return;
          }
          wx.showToast({ title: '已全部确认', icon: 'success' });
          // 一键确认只置数据层确认位, 不生成消息卡 → 补齐消息流缺失的确认卡, 让双方都看到全部4项
          this.__sendMissingConfirmCards().then(() => this.refreshConfirmation());
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常,请重试', icon: 'none' });
        });
      }
    });
  },

  // 一键确认后补齐消息流缺失的确认卡(confirm_all 只置确认位不产生消息卡; 串行补发, 避免消息乱序)
  __sendMissingConfirmCards() {
    const missing = Object.keys(TM_FIELD).filter((tmId) =>
      !this.data.messages.some((m) => m && m.msg_type === 'template' && m.tm_id === tmId));
    if (!missing.length) return Promise.resolve();
    return missing.reduce((chain, tmId) => chain
      .then(() => new Promise((r) => setTimeout(r, 300))) // 等 confirm_all 落库, 补卡状态取最新 items
      .then(() => this.sendTemplate(tmId)), Promise.resolve());
  },

  // ───────── 调整确认项(2026-11-04: 改为发起变更 change_apply, 对方接受后才改值并重置8位) ─────────
  // 2026-11-05: S2 已支付待履约另开「地点/内容」协商通道(费用/时间一律禁止, 时间走订单详情「申请改期」)
  startEdit(field) {
    const st = this.data.orderStatus;
    if (st !== 'S1' && st !== 'S2') {
      wx.showToast({ title: '订单当前状态不可修改', icon: 'none' });
      return;
    }
    if (st === 'S2' && field !== 'location' && field !== 'content') {
      wx.showToast({ title: field === 'time' ? '请到详情页申请改期' : '该阶段不可修改此项', icon: 'none' });
      return;
    }
    // 2026-11-05: S2 距履约不足后台下限(bMinHours)时，点「修改」立即提示，避免选完/填完提交才报错
    if (st === 'S2') {
      // 2026-11-10(评审修复+用户需求): 付费后改期/改地点前置判定 —— 不符合条件点按钮即给明确提示, 不进入编辑态
      // 顺序与服务端同口径(开关→冻结→时间窗→次数), 文案对齐服务端 msg
      if (!CONFIG.S2_CHANGE || CONFIG.S2_CHANGE.enabled === false) {
        wx.showModal({ title: '暂不可变更', content: '该阶段变更功能未开启', showCancel: false, confirmText: '知道了' });
        return;
      }
      if (this.data.frozen) {
        wx.showModal({ title: '暂不可变更', content: '订单争议处理中，暂不可变更', showCancel: false, confirmText: '知道了' });
        return;
      }
      const bMinH = (CONFIG.S2_CHANGE && CONFIG.S2_CHANGE.bMinHours) || 1;
      const startTs = Number(this.data.startTime) || 0;
      // 2026-11-08 评审修复: 履约时间缺失时原实现直接放行(fail-open), 用户白走选点/提交才被后端拒
      if (!startTs) {
        if (this.__s2RefreshTried) {
          wx.showModal({
            title: '订单信息未加载',
            content: '请下拉刷新后重试',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }
        // 先重取一次确认单; 取到时间则回到本方法继续原流程, 仍取不到则提示(只重试一次)
        this.__s2RefreshTried = true;
        wx.showLoading({ title: '加载中', mask: true });
        this.refreshConfirmation().then(() => {
          wx.hideLoading();
          this.startEdit(field);
          this.__s2RefreshTried = false;
        });
        return;
      }
      if (startTs - Date.now() < bMinH * 3600000) {
        wx.showModal({
          title: '暂不可修改',
          content: startTs <= Date.now()
            ? '已过约定履约时间，请按原信息履约或申请取消订单'
            : `距履约不足 ${bMinH} 小时，请按原信息履约或申请取消订单`,
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      // 次数上限(服务端同口径: 发起即计入, 被拒/超时同样消耗; 用量以云端下发为准, 禁止本地自增)
      const s2cfg = CONFIG.S2_CHANGE || {};
      const used = this.data.s2Counts || { total: 0, location: 0, content: 0 };
      const fieldCn = field === 'location' ? '地点' : '内容';
      if (used.total >= (s2cfg.totalMax || 2)) {
        wx.showModal({ title: '暂不可变更', content: `本单变更次数已达上限（${s2cfg.totalMax || 2} 次）`, showCancel: false, confirmText: '知道了' });
        return;
      }
      if (used[field] >= (s2cfg.perFieldMax || 1)) {
        wx.showModal({ title: '暂不可变更', content: `「${fieldCn}」变更次数已达上限（${s2cfg.perFieldMax || 1} 次）`, showCancel: false, confirmText: '知道了' });
        return;
      }
    }
    // 有在途变更时后端会拒绝(oa_change_pending), 前端提前拦截避免白提交
    if (this.data.pendingChange) {
      wx.showToast({ title: '有变更待对方反馈,暂不可改', icon: 'none' });
      return;
    }
    if (field === 'location') {
      wx.chooseLocation({
        success: (res) => {
          const value = {
            name: res.name || res.address || '服务地点',
            address: res.address || '',
            latitude: res.latitude,
            longitude: res.longitude,
            city: ''
          };
          this.applyChange('location', value);
        },
        // 2026-11-08 评审修复: 原实现无 fail, 定位被拒/地图失败时完全静默; 取消仍保持静默不扰民
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (/cancel/i.test(msg)) return;
          wx.showModal({
            title: '无法选择地点',
            content: '未获得定位权限或地图打开失败, 请在设置中开启定位后重试',
            showCancel: false,
            confirmText: '知道了'
          });
        }
      });
      return;
    }
    if (field === 'time') {
      const d = new Date(Date.now() + 24 * 3600 * 1000);
      this.setData({
        editSheet: 'time',
        editDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        editTimeHm: '10:00'
      });
      return;
    }
    if (field === 'content') {
      const cur = (this.data.items && this.data.items.content && Array.isArray(this.data.items.content.value))
        ? this.data.items.content.value : [];
      const opts = cur.map((name) => ({ name, checked: true }));
      this.setData({ editSheet: 'content', editContentOpts: opts });
      return;
    }
    if (field === 'fee') {
      const cur = (this.data.items && this.data.items.fee && this.data.items.fee.value) || 0;
      this.setData({ editSheet: 'fee', editFeeYuan: cur ? String(cur / 100) : '' });
    }
  },

  // 2026-11-05: S2 聊天页顶部「改地点/改内容」入口(仅这两项开放)
  onS2ChangeTap(e) {
    this.startEdit(e.currentTarget.dataset.field);
  },

  closeEditSheet() { this.setData({ editSheet: '' }); },

  onEditDate(e) { this.setData({ editDate: e.detail.value }); },
  onEditTimeHm(e) { this.setData({ editTimeHm: e.detail.value }); },
  onEditFeeInput(e) { this.setData({ editFeeYuan: e.detail.value }); },
  onEditContentChange(e) {
    const selected = e.detail.value || [];
    this.setData({
      editContentOpts: this.data.editContentOpts.map((o) =>
        Object.assign({}, o, { checked: selected.indexOf(o.name) >= 0 }))
    });
  },

  confirmEditTime() {
    const { editDate, editTimeHm } = this.data;
    if (!editDate || !editTimeHm) {
      wx.showToast({ title: '请选择日期和时间', icon: 'none' });
      return;
    }
    const [y, mo, d] = editDate.split('-').map(Number);
    const [h, mi] = editTimeHm.split(':').map(Number);
    const ts = new Date(y, mo - 1, d, h, mi, 0).getTime();
    if (!ts || ts <= Date.now()) {
      wx.showToast({ title: '服务时间必须是未来时间', icon: 'none' });
      return;
    }
    this.applyChange('time', ts);
  },

  confirmEditContent() {
    const value = this.data.editContentOpts.filter((o) => o.checked).map((o) => o.name);
    if (!value.length) {
      wx.showToast({ title: '请至少保留一项服务内容', icon: 'none' });
      return;
    }
    this.applyChange('content', value);
  },

  confirmEditFee() {
    const yuan = Number(this.data.editFeeYuan);
    if (!yuan || yuan <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    const fen = Math.round(yuan * 100);
    if (!Number.isInteger(fen) || fen <= 0) {
      wx.showToast({ title: '金额格式有误', icon: 'none' });
      return;
    }
    this.applyChange('fee', fen);
  },

  // TM5「特殊需求」输入 → other 变更(后端只记 extra_note, 不重置 8 位)
  onOtherInput(e) { this.setData({ otherText: e.detail.value }); },

  confirmEditOther() {
    const txt = String(this.data.otherText || '').trim();
    if (!txt) {
      wx.showToast({ title: '请填写特殊需求', icon: 'none' });
      return;
    }
    // 与后端 order_reason_max_len 同源(缺省 200)
    if (txt.length > CONFIG.ORDER.reasonMaxLen) {
      wx.showToast({ title: `最多 ${CONFIG.ORDER.reasonMaxLen} 字`, icon: 'none' });
      return;
    }
    this.applyChange('other', txt);
  },

  // 发起变更(后端 change_apply): 仅记录在途申请, 对方接受后才改值 + 重置 8 位
  // 2026-11-05: S2 走 s2_change_apply(仅地点/内容, 原因必填≥10字), 接受后只改该项、不重置确认位
  applyChange(field, value) {
    const isS2 = this.data.orderStatus === 'S2';
    // 2026-11-05 修复: 前端原先无条件先弹原因, 未改动也要求填原因; 服务端 oa_s2c_same 在原因校验之前, 本地提前拦截
    if (isS2 && this.__s2SameValue(field, value)) {
      wx.showToast({ title: '内容未变更,无需提交', icon: 'none' });
      return;
    }
    const submit = (reason, reasonType) => {
      const payload = { action: isS2 ? 's2_change_apply' : 'change_apply', order_id: this.data.orderId, field, value };
      if (isS2) { payload.reason = reason; payload.reason_type = reasonType; }
      wx.showLoading({ title: '提交中', mask: true });
      callCloud('order-action', payload).then((r) => {
        wx.hideLoading();
        if (!r.ok) {
          this._handleApplyFail(r);   // 2026-11-09: 分流 —— 窗口将尽给「逐项确认」出路
          return;
        }
        this.setData({ editSheet: '' });
        // 2026-11-10(用户需求): 发起成功弹窗引导进入处理界面(原仅 2 秒 toast 易错过);
        // 弹窗关闭后本页「变更」卡片即处理/查看入口, 同时刷新一次确认态
        wx.showModal({
          title: '变更申请已发出',
          content: '已通知对方处理。等待反馈期间暂停确认与修改，可在本页「变更」卡片查看进度。',
          showCancel: false,
          confirmText: '去查看',
          confirmColor: '#07C160',
          fail: () => wx.showToast({ title: '已提交,等待对方反馈', icon: 'none' })
        });
        return this.refreshConfirmation();
      }).catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常,请重试', icon: 'none' });
      });
    };
    if (!isS2) { submit(''); return; }
    // S2 变更：先选结构化原因类型（便于审计），再填不少于 10 字的具体说明
    const TYPE_OPTS = field === 'location'
      ? [{ k: 'location_change', t: '地点变动' }, { k: 'time_conflict', t: '时间冲突' }, { k: 'other', t: '其他' }]
      : [{ k: 'content_adjust', t: '内容调整' }, { k: 'time_conflict', t: '时间冲突' }, { k: 'other', t: '其他' }];
    wx.showActionSheet({
      itemList: TYPE_OPTS.map((o) => o.t),
      success: (a) => {
        const picked = TYPE_OPTS[a.tapIndex];
        if (!picked) return;
        wx.showModal({
          title: '变更原因',
          editable: true,
          placeholderText: '请具体说明（不少于10字），勿填“有事/测试”',
          confirmText: '提交',
          cancelText: '取消',
          success: (res) => {
            if (!res.confirm) return;
            const reason = String(res.content || '').trim();
            if (reason.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length < (CONFIG.ORDER.reasonMinLen || 10)) {
              wx.showToast({ title: '原因不少于10字', icon: 'none' });
              return;
            }
            submit(reason, picked.k);
          },
          fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' })
        });
      },
      fail: (e) => {
        if (e && /cancel/.test(e.errMsg || '')) return;
        wx.showToast({ title: '请选择原因类型', icon: 'none' });
      }
    });
  },

  // 在途变更: 对方反馈(接受=改值+重置8位; 拒绝=原值不变+确认位保留)
  onRespondChange(e) {
    const decision = e.currentTarget.dataset.decision;
    const pc = this.data.pendingChange;
    if (!pc) return;
    if (decision !== 'accept' && decision !== 'reject') return;
    const isAccept = decision === 'accept';
    // 2026-11-05: S2 变更走 s2_change_respond, 接受只改该项(其余确认位不动)
    const isS2 = this.data.orderStatus === 'S2';
    wx.showModal({
      title: isAccept ? '接受变更' : '拒绝变更',
      content: isAccept
        ? (isS2
          ? `「${pc.field_cn}」将改为 ${pc.new_text}。接受后按新信息履约，其余确认项不受影响。`
          : (pc.field === 'fee'
            ? `「${pc.field_cn}」将改为 ${pc.new_text}。接受后费用即确认生效，其余三项需重新确认。`
            : `「${pc.field_cn}」将改为 ${pc.new_text}。接受后四项确认全部重置，需双方重新确认。`))
        : `「${pc.field_cn}」保持原值 ${pc.old_text}，已完成的确认位不受影响。`,
      confirmText: isAccept ? '接受' : '拒绝',
      cancelText: '取消',
      confirmColor: isAccept ? '#07C160' : '#E64340',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中', mask: true });
        callCloud('order-action', {
          action: isS2 ? 's2_change_respond' : 'change_respond',
          order_id: this.data.orderId, decision, token: pc.token
        }).then((r) => {
          wx.hideLoading();
          if (!r.ok) {
            wx.showModal({ title: '处理失败', content: r.msg || '请稍后重试', showCancel: false });
            return;
          }
          const d = r.data || {};
          wx.showToast({
            title: !isAccept
              ? '已拒绝,原值不变'
              : (isS2 ? '已接受,信息已更新'
                : (pc.field === 'fee' ? '已接受,费用已确认'
                  : (d.bits_reset ? '已接受,四项已重置' : '已接受,已记录其他事项'))),
            icon: 'none', duration: 2000
          });
          return this.refreshConfirmation();
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常,请重试', icon: 'none' });
        });
      }
    });
  },

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
