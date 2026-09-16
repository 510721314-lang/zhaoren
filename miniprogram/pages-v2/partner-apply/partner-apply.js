// v2 耍伴申请 (最简版)
// 调 partner-action.apply: 加 roles + upsert partner_profile
// 成功后调 user-login.peek_login 刷新用户态 → switchTab 到我的
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    scenes: [],        // [{ code, name, emoji, selected }]
    submitting: false,
    alreadyPartner: false
  },

  onLoad() {
    const user = wx.getStorageSync('user_info') || {};
    const roles = user.roles || [];
    const isPartner = roles.includes('partner');

    const scenes = SCENES.map((s) => ({
      code: s.code,
      name: s.name,
      emoji: s.emoji,
      selected: false
    }));
    this.setData({ scenes, alreadyPartner: isPartner });
  },

  onToggleScene(e) {
    const idx = e.currentTarget.dataset.index;
    const scenes = this.data.scenes;
    scenes[idx].selected = !scenes[idx].selected;
    this.setData({ scenes });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const selected = this.data.scenes.filter((s) => s.selected).map((s) => s.code);
    if (selected.length === 0) {
      wx.showToast({ title: '请至少选择一个场景', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '申请中...', mask: true });

    try {
      const r = await callCloud('partner-action', { action: 'apply', accept_scenes: selected });
      wx.hideLoading();
      if (r.ok) {
        // 刷新用户态
        try {
          await callCloud('user-login', { action: 'peek_login' });
        } catch (_) {}
        wx.removeStorageSync('v2_login_ok');
        wx.showToast({ title: '申请成功,已开通耍伴身份', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages-v2/profile/profile' });
        }, 800);
      } else {
        wx.showToast({ title: r.msg || '申请失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      // 真机看不到 console, 直接把真实错误显示出来便于排查
      const msg = (e && (e.errMsg || e.message)) ? (e.errMsg || e.message) : '网络错误';
      wx.showToast({ title: msg.length > 20 ? msg.slice(0, 20) : msg, icon: 'none', duration: 3000 });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages-v2/profile/profile' }) }); }
});
