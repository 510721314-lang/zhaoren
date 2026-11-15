// 系统配置
const { callCloud } = require('../../utils/cloud.js');

Page({
  data: {
    isAdmin: false, loading: true,
    config: null,
    blockWordInput: '',
    feeInput: ''
  },

  onLoad() {
    callCloud('admin-action', { action: 'admin_list' }).then((r) => {
      if (!r.ok) { wx.showToast({ title: '无权限', icon: 'none' }); setTimeout(() => wx.reLaunch({ url: '/pages-v2/index/index', fail: () => wx.showToast({ title: '返回首页失败', icon: 'none' }) }), 800); return; } // @VERIFIED 2026-11-08 已真机验证：非管理员进后台回首页
      this.setData({ isAdmin: true }); this.loadConfig();
    });
  },

  loadConfig() {
    callCloud('admin-action', { action: 'config_get' }).then((r) => {
      if (r.ok) {
        // 2026-11-15 M1: scene_list 金额页 JS 预计算(WXML 不支持函数调用), 分转元补零两位小数
        const cfg = r.data;
        if (Array.isArray(cfg.scene_list)) {
          cfg.scene_list = cfg.scene_list.map((s) => Object.assign({}, s, { rate_yuan_text: ((Number(s.default_rate_fen) || 0) / 100).toFixed(2) })); // @VERIFIED 2026-11-15 已模拟器自动化验证：9 场景 ¥0.00/h 数据/渲染一致（当前默认费率均为 0）
        }
        this.setData({ config: cfg, loading: false });
      }
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
