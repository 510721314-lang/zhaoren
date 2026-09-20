// PRD章节: 3.4 IM聊天 / 3.4.1.1 模板消息四确认 / 3.4.2 限制规则 / 3.4.4 消息留存
// P0-2: 全部接云端 —— im-conv(open/messages) + im-send(send_template/send_text)
//       + order-action(get_confirmation/confirm_item/update_item)
// 红线: 四确认完成前仅可发送系统模板消息(后端强制); 确认状态为双方8位模型, 双侧确认才算该项完成
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES, TM_TEMPLATES } = require('../../config/enums.js');

// 模板 id → 四确认字段(与后端 CONFIRM_FIELDS 一致)
const TM_FIELD = { TM1: 'time', TM2: 'location', TM3: 'content', TM4: 'fee' };

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

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
    unlocked: false,     // 四确认 4/4(双侧)
    freeChat: false,     // 后端允许自由文本
    chatBlocked: false,  // S6/S10
    orderStatus: '',
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
    // 编辑弹层: '' | 'time' | 'content' | 'fee' (location 走 chooseLocation 无弹层)
    editSheet: '',
    editDate: '',
    editTimeHm: '',
    editFeeYuan: '',
    editContentOpts: [],
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


  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
    this.__orderId = (options && options.orderId) || '';
    this.__convId = '';
    this.__pollTimer = null;
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    this.startPolling();
  },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); },

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
      const scene = SCENES.find((s) => s.code === d.scene) || null;
      this.setData({
        orderId: d.order_id,
        orderNo: d.order_no || '',
        scene,
        sceneName: d.scene_name || (scene ? scene.name : ''),
        counterpart: (d.peer && d.peer.nickname) || '',
        role: d.role || '',
        freeChat: !!d.free_chat,
        chatBlocked: !!d.chat_blocked,
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
          if (msgs.ok) this.renderMessages(msgs.data.messages);
          this.scrollBottom();
        });
      });
    }).catch(() => {
      this.setData({ loading: false, loadError: true, loadErrorMsg: '网络异常,请检查网络后重试' });
    });
  },

  reload() { this.fetchData(); },

  // ───────── 四确认状态 ─────────
  applyConfirmation(d) {
    const items = d.items || {};
    const both = (f) => !!(items[f] && items[f].user_ok && items[f].partner_ok);
    const progress = {
      time: both('time'), location: both('location'),
      content: both('content'), fee: both('fee')
    };
    const count = [progress.time, progress.location, progress.content, progress.fee].filter(Boolean).length;
    const wasUnlocked = this.data.unlocked;
    const unlocked = !!d.all_confirmed;
    const firstLoad = !this.__confLoaded;
    this.__confLoaded = true;
    // status 强制用后端返回值, 不做 || 兜底(后端不会返回空 status)
    const nextStatus = d.status && d.status !== this.data.orderStatus ? d.status : this.data.orderStatus;
    this.setData({
      items,
      progress,
      confirmedCount: count,
      unlocked,
      freeChat: unlocked || this.data.freeChat,
      orderStatus: nextStatus
    }, () => {
      this.updateMsgStatuses();
      if (unlocked && !wasUnlocked) {
        wx.showToast({ title: '已解锁自由沟通,请遵守平台规则', icon: 'none', duration: 2000 });
        // 四确认完成瞬间(非重进会话)且当前用户是付款方 → 自动弹出支付窗口;
        // 放弃支付则留在本页, 顶部待支付横幅可再次进入支付
        if (!firstLoad && this.data.role === 'user' && nextStatus === 'S0') {
          wx.showModal({
            title: '💳 订单支付',
            content: '四项确认已全部完成,订单进入待支付\n请在 30 分钟内完成支付,超时订单将自动取消',
            confirmText: '支付',
            cancelText: '放弃支付',
            confirmColor: '#07C160',
            fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
            success: (res) => {
              if (res.confirm) this.goPay(); // 放弃支付 → 留在四确认完成窗口
            }
          });
        }
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
    return callCloud('im-conv', { action: 'messages', conv_id: this.__convId })
      .then((r) => { if (r.ok) this.renderMessages(r.data.messages); });
  },

  // ───────── 轮询(5s) ─────────
  startPolling() {
    this.stopPolling();
    if (!this.__orderId) return;
    this.__pollTimer = setInterval(() => {
      if (this.data.loading || this.data.loadError) return;
      this.refreshMessages();
      this.refreshConfirmation();
    }, 5000);
  },
  stopPolling() {
    if (this.__pollTimer) { clearInterval(this.__pollTimer); this.__pollTimer = null; }
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
    wx.showLoading({ title: '提交中', mask: true });
    callCloud('order-action', {
      action: 'confirm_item', order_id: this.data.orderId, item: field
    }).then((r) => {
      wx.hideLoading();
      if (!r.ok) {
        wx.showModal({ title: '确认失败', content: r.msg || '请稍后重试', showCancel: false });
        return;
      }
      return this.refreshConfirmation();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  },

  // ───────── 调整确认项(update_item, 后端重置全部8位) ─────────
  startEdit(field) {
    if (this.data.orderStatus !== 'S1') {
      wx.showToast({ title: '订单当前状态不可修改', icon: 'none' });
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
          this.updateItem('location', value);
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
    this.updateItem('time', ts);
  },

  confirmEditContent() {
    const value = this.data.editContentOpts.filter((o) => o.checked).map((o) => o.name);
    if (!value.length) {
      wx.showToast({ title: '请至少保留一项服务内容', icon: 'none' });
      return;
    }
    this.updateItem('content', value);
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
    this.updateItem('fee', fen);
  },

  updateItem(item, value) {
    wx.showLoading({ title: '提交中', mask: true });
    callCloud('order-action', {
      action: 'update_item', order_id: this.data.orderId, item, value
    }).then((r) => {
      wx.hideLoading();
      if (!r.ok) {
        wx.showModal({ title: '修改失败', content: r.msg || '请稍后重试', showCancel: false });
        return;
      }
      this.setData({ editSheet: '' });
      wx.showToast({ title: '已修改,双方需重新确认', icon: 'none', duration: 2000 });
      return this.refreshConfirmation();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    });
  },

  // ───────── C5 模板快捷键 ─────────
  onQuickKey(e) {
    const tmId = e.currentTarget.dataset.id;
    if (this.data.chatBlocked) {
      wx.showToast({ title: '订单已取消/关闭,无法发送', icon: 'none' });
      return;
    }
    this.sendTemplate(tmId);
  },

  sendTemplate(tmId) {
    callCloud('im-send', {
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
  sendText() {
    const text = this.data.inputText.trim();
    if (!text) return;
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
      fail: () => wx.showToast({ title: '支付页即将开放', icon: 'none' })
    });
  },

  // ───────── C1 订单卡片入口 ─────────
  goOrderDetail() {
    if (!this.data.orderId) return;
    wx.redirectTo({
      url: `/pages-v2/order-detail/order-detail?orderId=${this.data.orderId}`,
      fail: () => wx.showToast({ title: '订单详情即将开放', icon: 'none' })
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
  fmtDateTime(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  scrollBottom() {
    setTimeout(() => {
      const last = this.data.messages[this.data.messages.length - 1];
      this.setData({ scrollToView: last ? last._id : '' });
    }, 50);
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
