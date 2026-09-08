// pages/partner-center/partner-center.js - 耍伴工作台
const { SCENE_LIST } = require('../../utils/constants.js');

Page({
  data: {
    profile: null,
    stats: null,
    scenes: SCENE_LIST,
    sceneChecked: {},             // { W1: true, ... } WXML 勾选态用(不支持 indexOf)
    sceneRates: {},               // { W1: 5000, ... } 每场景时薪(分)
    rateMin: 30, rateMax: 100,
    isSubmitting: false,
    hasLoaded: false
  },

  onLoad() { this.loadProfile(); },
  onShow() { if (this.data.hasLoaded) this.loadProfile(); },

  loadProfile() {
    wx.cloud.callFunction({
      name: 'partner-action',
      data: { action: 'my_profile' },
      success: (res) => {
        if (res.result && res.result.ok) {
          const { profile, stats } = res.result.data;
          if (profile.status !== 'approved') {
            wx.redirectTo({ url: '/pages/partner-apply/partner-apply' });
            return;
          }
          // 旧数据兼容:无 scene_rates 时按 rate_fen 给所有场景统一值
          let sceneRates = profile.scene_rates || {};
          if (Object.keys(sceneRates).length === 0 && profile.rate_fen) {
            (profile.accept_scenes || []).forEach(s => { sceneRates[s] = profile.rate_fen; });
          }
          // 勾选态 map(WXML 用属性访问,不用 indexOf)
          const sceneChecked = {};
          (profile.accept_scenes || []).forEach(s => { sceneChecked[s] = true; });
          this.setData({
            profile, stats, sceneRates, sceneChecked, hasLoaded: true
          });
        } else {
          wx.redirectTo({ url: '/pages/partner-apply/partner-apply' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  // 接单开关切换
  onSwitchToggle() {
    const next = !this.data.profile.accept_switch;
    wx.cloud.callFunction({
      name: 'partner-action',
      data: { action: 'set_switch', accept_switch: next },
      success: (res) => {
        if (res.result && res.result.ok) {
          const p = Object.assign({}, this.data.profile, { accept_switch: next });
          this.setData({ profile: p });
          wx.showToast({ title: next ? '已开启接单' : '已关闭接单', icon: 'success' });
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '切换失败', icon: 'none' });
        }
      }
    });
  },

  // 单场景时薪滑条
  onSceneRateChange(e) {
    const code = e.currentTarget.dataset.code;
    const yuan = e.detail.value;
    const rates = Object.assign({}, this.data.sceneRates);
    rates[code] = yuan * 100;
    this.setData({ sceneRates: rates });
  },

  // 场景切换
  onSceneToggle(e) {
    const code = e.currentTarget.dataset.code;
    const arr = (this.data.profile.accept_scenes || []).slice();
    const checked = Object.assign({}, this.data.sceneChecked);
    const rates = Object.assign({}, this.data.sceneRates);
    const idx = arr.indexOf(code);
    if (idx >= 0) {
      arr.splice(idx, 1);
      checked[code] = false;
      delete rates[code];   // 取消场景时移除其时薪
    } else {
      arr.push(code);
      checked[code] = true;
      if (!rates[code]) rates[code] = 5000;   // 默认 50 元
    }
    if (arr.length === 0) {
      wx.showToast({ title: '至少保留一个场景', icon: 'none' });
      return;
    }
    const p = Object.assign({}, this.data.profile, { accept_scenes: arr });
    this.setData({ profile: p, sceneChecked: checked, sceneRates: rates });
  },

  // 保存配置
  saveConfig() {
    const { sceneRates, profile } = this.data;
    // 校验每个场景都设置了时薪
    for (const s of profile.accept_scenes) {
      if (!sceneRates[s]) {
        wx.showToast({ title: '请为场景设置时薪', icon: 'none' });
        return;
      }
    }
    wx.cloud.callFunction({
      name: 'partner-action',
      data: {
        action: 'update_config',
        scene_rates: sceneRates,
        accept_scenes: profile.accept_scenes
      },
      success: (res) => {
        if (res.result && res.result.ok) {
          wx.showToast({ title: '已保存', icon: 'success' });
          this.loadProfile();
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' });
        }
      }
    });
  },

  // 去接单大厅(阶段4建,先占位)
  toHall() {
    wx.showToast({ title: '功能升级中,敬请期待', icon: 'none' });
  }
});
