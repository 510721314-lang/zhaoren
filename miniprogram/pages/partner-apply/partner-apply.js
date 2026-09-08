// pages/partner-apply/partner-apply.js - 耍伴入驻申请
const { SCENE_LIST } = require('../../utils/constants.js');
const app = getApp();

Page({
  data: {
    scenes: SCENE_LIST,           // 5 个场景 + options
    selectedScenes: [],          // 选中的场景 code 数组
    sceneChecked: {},            // { W1: true, W2: false } WXML 勾选态用(不支持 indexOf)
    selectedOptions: {},         // { W1: ['挂号排队'], ... } 各场景下勾选的 options
    optionChecked: {},           // { W1: { '挂号排队': true } } WXML 子选项勾选态用
    sceneRates: {},              // { W1: 5000, W2: 3000, ... } 每场景时薪(分)
    rateMin: 30, rateMax: 100,    // slider 边界(元)
    agreementChecked: false,
    isSubmitting: false,
    // 状态
    applyStatus: null            // null | 'approved' | 'pending_review' | 'rejected'
  },

  onLoad() {
    this.checkExistingProfile();
  },

  // 检查是否已是耍伴
  checkExistingProfile() {
    wx.cloud.callFunction({
      name: 'partner-action',
      data: { action: 'my_profile' },
      success: (res) => {
        if (res.result && res.result.ok) {
          const p = res.result.data.profile;
          // 旧数据兼容:无 scene_rates 时按 rate_fen 给所有场景统一值
          let sceneRates = p.scene_rates || {};
          if (Object.keys(sceneRates).length === 0 && p.rate_fen) {
            (p.accept_scenes || []).forEach(s => { sceneRates[s] = p.rate_fen; });
          }
          // 勾选态 map(WXML 用属性访问,不用 indexOf)
          const sceneChecked = {};
          (p.accept_scenes || []).forEach(s => { sceneChecked[s] = true; });
          this.setData({
            applyStatus: p.status,
            selectedScenes: p.accept_scenes || [],
            sceneChecked,
            sceneRates
          });
          // 已 approved 自动跳中心页
          if (p.status === 'approved') {
            wx.showToast({ title: '你已是耍伴', icon: 'success' });
            setTimeout(() => {
              wx.redirectTo({ url: '/pages/partner-center/partner-center' });
            }, 800);
          }
        }
      }
    });
  },

  // 场景勾选
  onSceneToggle(e) {
    const code = e.currentTarget.dataset.code;
    const arr = this.data.selectedScenes.slice();
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
    this.setData({ selectedScenes: arr, sceneChecked: checked, sceneRates: rates });
  },

  // 单场景时薪滑条
  onSceneRateChange(e) {
    const code = e.currentTarget.dataset.code;
    const yuan = e.detail.value;
    const rates = Object.assign({}, this.data.sceneRates);
    rates[code] = yuan * 100;
    this.setData({ sceneRates: rates });
  },

  // 子选项勾选
  onOptionToggle(e) {
    const { code, option } = e.currentTarget.dataset;
    const map = Object.assign({}, this.data.selectedOptions);
    if (!map[code]) map[code] = [];
    const arr = map[code].slice();
    const idx = arr.indexOf(option);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(option);
    map[code] = arr;
    // 同步勾选态 map(WXML 用)
    const optChecked = Object.assign({}, this.data.optionChecked);
    if (!optChecked[code]) optChecked[code] = {};
    optChecked[code][option] = idx < 0;   // idx<0 表示原本未选,现在选中
    this.setData({ selectedOptions: map, optionChecked: optChecked });
  },

  // 协议勾选
  onAgreementToggle() {
    this.setData({ agreementChecked: !this.data.agreementChecked });
  },

  // 提交申请
  submitApply() {
    const { selectedScenes, sceneRates, agreementChecked } = this.data;
    if (selectedScenes.length === 0) {
      wx.showToast({ title: '请至少选一个场景', icon: 'none' });
      return;
    }
    // 校验每个场景都设置了时薪
    for (const s of selectedScenes) {
      if (!sceneRates[s]) {
        wx.showToast({ title: `请为场景设置时薪`, icon: 'none' });
        return;
      }
    }
    if (!agreementChecked) {
      wx.showToast({ title: '请勾选耍伴协议', icon: 'none' });
      return;
    }
    this.setData({ isSubmitting: true });
    wx.cloud.callFunction({
      name: 'partner-apply',
      data: {
        action: 'apply',
        accept_scenes: selectedScenes,
        scene_rates: sceneRates
      },
      success: (res) => {
        this.setData({ isSubmitting: false });
        if (res.result && res.result.ok) {
          const d = res.result.data;
          if (d.auto_approved) {
            wx.showToast({ title: '入驻成功', icon: 'success' });
            setTimeout(() => {
              wx.redirectTo({ url: '/pages/partner-center/partner-center' });
            }, 800);
          } else {
            this.setData({ applyStatus: 'pending_review' });
            wx.showToast({ title: '申请已提交,待审核', icon: 'none' });
          }
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '申请失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ isSubmitting: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  toAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=partner' });
  }
});
