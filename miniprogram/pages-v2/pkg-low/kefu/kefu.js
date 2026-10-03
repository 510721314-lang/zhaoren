// pkg-low/kefu · 自建客服会话(无订单): 消息复用 IM 体系, 后台客服工作台可见可回
// 流程: kefu_open 拿会话(懒建) → kefu_messages 拉消息(清未读) → send_kefu 发送 → 5s 轮询新消息
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => {
    console.error('[cloud]', name, e && e.message);
    return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' };
  });
}

Page({
  data: {
    convId: '',
    loading: true,
    loadError: false,
    messages: [],
    input: '',
    sending: false,
    peerName: '平台客服'
  },

  onLoad() {
    this._t = null;
    this.openConv();
  },
  onShow() { this.startPoll(); },
  onHide() { this.stopPoll(); },
  onUnload() { this.stopPoll(); },

  async openConv() {
    const r = await callCloud('im-conv', { action: 'kefu_open' });
    if (!r.ok || !r.data || !r.data.conv) {
      this.setData({ loading: false, loadError: true });
      return;
    }
    const conv = r.data.conv;
    this.setData({
      convId: conv._id,
      peerName: (r.data.peer && r.data.peer.nickname) || '平台客服',
      loading: false,
      loadError: false
    });
    this.refreshMessages();
  },

  async refreshMessages() {
    if (!this.data.convId) return;
    const r = await callCloud('im-conv', { action: 'kefu_messages', conv_id: this.data.convId });
    if (r.ok && r.data) {
      this.setData({ messages: (r.data.list || []).map((m) => this.toUiMsg(m)) });
    }
  },

  // 渲染消息: user_kefu=用户右绿气泡 / kefu=客服左灰气泡; 客服回复可携带引用(quote 快照)
  toUiMsg(m) {
    const isMine = m.from_role === 'user_kefu';
    return {
      _id: m._id,
      mine: isMine,
      text: m.text || '',
      time: this.fmtTime(m.created_at),
      quote: m.quote && m.quote.text ? {
        fromLabel: m.quote.from_role === 'kefu' ? '客服' : m.quote.from_role === 'partner' ? '耍伴' : '用户',
        text: m.quote.text
      } : null
    };
  },

  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  startPoll() {
    this.stopPoll();
    this._t = setInterval(() => this.refreshMessages(), 5000);
  },
  stopPoll() { if (this._t) { clearInterval(this._t); this._t = null; } },

  onInput(e) { this.setData({ input: e.detail.value }); },

  async sendText() {
    const text = String(this.data.input || '').trim();
    if (!text || this.data.sending) return;
    this.setData({ sending: true });
    const r = await callCloud('im-send', { action: 'send_kefu', conv_id: this.data.convId, text });
    this.setData({ sending: false });
    if (r.ok) {
      this.setData({ input: '' });
      this.refreshMessages();
    } else {
      wx.showToast({ title: r.msg || '发送失败', icon: 'none' });
    }
  },

  onGoBack() { wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages-v2/index/index' }) }); }
});
