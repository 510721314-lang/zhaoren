// 系统配置
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => ({ ok: false, code: 'cloud_error', msg: '网络异常' }));
}

Page({
  data: {
    isAdmin: false, loading: true,
    config: null,
    blockWordInput: '',
    feeInput: ''
  },

  onLoad() {
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) { wx.showToast({ title: '无权限', icon: 'none' }); setTimeout(() => wx.redirectTo({ url: '/pages-v2/index/index' }), 800); return; }
      this.setData({ isAdmin: true }); this.loadConfig();
    });
  },

  loadConfig() {
    callCloud('admin-action', { action: 'config_get' }).then((r) => {
      if (r.ok) this.setData({ config: r.data, loading: false });
      else this.setData({ loading: false });
    });
  },

  onFeeInput(e) { this.setData({ feeInput: e.detail.value }); },
  saveFee() {
    const fee = parseInt(this.data.feeInput, 10);
    if (!Number.isInteger(fee) || fee < 0 || fee > 10000) { wx.showToast({ title: '0-10000整数', icon: 'none' }); return; }
    callCloud('admin-action', { action: 'config_set', platform_fee_rate_fen: fee }).then((r) => {
      wx.showToast({ title: r.ok ? '已保存' : (r.msg || '失败'), icon: 'none' });
      if (r.ok) this.loadConfig();
    });
  },

  onBlockWordInput(e) { this.setData({ blockWordInput: e.detail.value }); },
  addBlockWord() {
    const w = this.data.blockWordInput.trim();
    if (!w) return;
    callCloud('admin-action', { action: 'config_set', block_words_add: [w] }).then((r) => {
      wx.showToast({ title: r.ok ? '已添加' : (r.msg || '失败'), icon: 'none' });
      if (r.ok) { this.setData({ blockWordInput: '' }); this.loadConfig(); }
    });
  },
  removeBlockWord(e) {
    const w = e.currentTarget.dataset.word;
    callCloud('admin-action', { action: 'config_set', block_words_remove: [w] }).then((r) => {
      if (r.ok) this.loadConfig();
    });
  },

  toggleAutoApprove() {
    const next = !this.data.config.auto_approve_partner;
    callCloud('admin-action', { action: 'config_set', auto_approve_partner: next }).then((r) => {
      if (r.ok) this.loadConfig();
    });
  },

  togglePaymentVisible() {
    const next = !this.data.config.payment_visible;
    callCloud('admin-action', { action: 'config_set', payment_visible: next }).then((r) => {
      if (r.ok) this.loadConfig();
    });
  },

  onShareAppMessage() { return { title: '系统配置', path: '/pages-v2/index/index' }; }
});
