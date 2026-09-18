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
    homeLocation: null, // { name, address, latitude, longitude } gcj02
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

  // 选择日常位置(注册时确定, 详情页据此展示距离与到达耗时)
  onChooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          homeLocation: {
            name: res.name || res.address || '所选位置',
            address: res.address || '',
            latitude: res.latitude,
            longitude: res.longitude
          }
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') > -1) return;
        wx.showToast({ title: '选点失败,请检查定位权限', icon: 'none' });
      }
    });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const selected = this.data.scenes.filter((s) => s.selected).map((s) => s.code);
    if (selected.length === 0) {
      wx.showToast({ title: '请至少选择一个场景', icon: 'none' });
      return;
    }
    if (!this.data.homeLocation) {
      wx.showToast({ title: '请选择日常位置', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '申请中...', mask: true });

    try {
      const r = await callCloud('partner-action', {
        action: 'apply',
        accept_scenes: selected,
        home_location: this.data.homeLocation
      });
      wx.hideLoading();
      if (r.ok) {
        const d = r.data || {};
        // 刷新用户态
        try {
          await callCloud('user-login', { action: 'peek_login' });
        } catch (_) {}
        wx.removeStorageSync('v2_login_ok');
        if (d.pending_review) {
          wx.showModal({
            title: '申请已提交',
            content: '耍伴入驻需管理员审核,审核通过后将自动开通接单权限,请耐心等待。',
            showCancel: false,
            confirmText: '我知道了',
            success: () => { wx.switchTab({ url: '/pages-v2/profile/profile' }); }
          });
        } else {
          wx.showToast({ title: '申请成功,已开通耍伴身份', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages-v2/profile/profile' });
          }, 800);
        }
      } else {
        wx.showToast({ title: r.msg || '申请失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      const msg = (e && (e.errMsg || e.message)) || '未知错误';
      console.error('[partner-apply] submit error:', e);
      wx.showModal({ title: '申请失败', content: String(msg).slice(0, 120), showCancel: false, confirmText: '我知道了' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages-v2/profile/profile' }) }); }
});
