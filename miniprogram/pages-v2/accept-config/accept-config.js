// PRD章节: 3.2.2 接单配置 / R9 场景认证校验
// 接 partner-action 云函数: my_profile(拉) + update_config(存)
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { callCloud } = require('../../utils/cloud.js');
const redline = require('../../utils/redline.js');

const PA = CONFIG.PARTNER_ACCEPT;
const STORAGE_KEY = 'partner_local_cfg';

Page({
  data: {
    certifiedScenes: [],
    sceneRates: {},           // { W1: 5000, ... } 元/分
    distanceRange: PA.distanceRange,
    dailyLimitRange: PA.dailyLimitRange,
    bufferOptions: PA.bufferOptions,
    bufferIndex: PA.bufferOptions.indexOf(PA.defaultBufferMin),
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: CONFIG.TIME_REDLINE.close,
    budgetPlaceholder: `${CONFIG.BUDGET_RANGE[0]}-${CONFIG.BUDGET_RANGE[1]}`,
    subsidyPercent: CONFIG.WELFARE.partnerSubsidyRate * 100,
    form: {
      scenes: [],
      weeklySlots: {
        mon: { enabled: false, time: '09:00-18:00' },
        tue: { enabled: false, time: '09:00-18:00' },
        wed: { enabled: false, time: '09:00-18:00' },
        thu: { enabled: false, time: '09:00-18:00' },
        fri: { enabled: false, time: '09:00-18:00' },
        sat: { enabled: true,  time: '10:00-20:00' },
        sun: { enabled: true,  time: '10:00-20:00' }
      },
      minPrice: PA.defaultMinPrice,
      maxDistance: PA.defaultDistance,
      genderPref: '不限',
      dailyLimit: PA.defaultDailyLimit,
      acceptWelfare: true,
      bufferMin: PA.defaultBufferMin
    },
    weekLabels: [
      { key: 'mon', name: '周一' },
      { key: 'tue', name: '周二' },
      { key: 'wed', name: '周三' },
      { key: 'thu', name: '周四' },
      { key: 'fri', name: '周五' },
      { key: 'sat', name: '周六' },
      { key: 'sun', name: '周日' }
    ],
    genderOptions: ['不限', '男', '女'],
    loading: false,
    loadError: false,
    isRedline: false
  },

  onLoad() {
    this.fetchData();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  async fetchData() {
    this.setData({ loading: true, loadError: false });
    try {
      // 拉云端 profile
      const r = await callCloud('partner-action', { action: 'my_profile' });
      if (!r.ok) {
        wx.showToast({ title: r.msg || '加载失败', icon: 'none' });
        this.setData({ loading: false, loadError: true });
        return;
      }
      const p = r.data.profile;
      const scenes = p.accept_scenes || [];
      const sceneRates = p.scene_rates || {};

      // 计算展示用的 certifiedScenes（只显示已选场景）
      const certified = scenes
        .map((code) => SCENES.find((s) => s.code === code))
        .filter(Boolean);

      // 本地非核心配置（时段/距离/偏好等）
      let local = {};
      try { local = wx.getStorageSync(STORAGE_KEY) || {}; } catch (e) {}

      this.setData({
        certifiedScenes: certified,
        sceneRates: sceneRates,
        'form.scenes': scenes,
        'form.weeklySlots': local.weeklySlots || this.data.form.weeklySlots,
        'form.minPrice': local.minPrice || PA.defaultMinPrice,
        'form.maxDistance': local.maxDistance || PA.defaultDistance,
        'form.genderPref': local.genderPref || '不限',
        'form.dailyLimit': local.dailyLimit || PA.defaultDailyLimit,
        'form.acceptWelfare': local.acceptWelfare !== false,
        'form.bufferMin': local.bufferMin || PA.defaultBufferMin,
        bufferIndex: PA.bufferOptions.indexOf(local.bufferMin || PA.defaultBufferMin),
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: true });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  reload() { this.fetchData(); },

  onSceneToggle(e) {
    const code = e.currentTarget.dataset.code;
    const scenes = this.data.form.scenes.slice();
    const idx = scenes.indexOf(code);
    if (idx > -1) scenes.splice(idx, 1);
    else scenes.push(code);
    this.setData({ 'form.scenes': scenes });
  },

  // 时薪输入（分→元 输入, 存分）
  onRateInput(e) {
    const code = e.currentTarget.dataset.code;
    const yuan = Number(e.detail.value) || 0;
    const fen = Math.round(yuan * 100);
    this.setData({ [`sceneRates.${code}`]: fen });
  },

  onWeekToggle(e) {
    const k = e.currentTarget.dataset.key;
    this.setData({ [`form.weeklySlots.${k}.enabled`]: !this.data.form.weeklySlots[k].enabled });
  },

  onWeekTimeChange(e) {
    const k = e.currentTarget.dataset.key;
    this.setData({ [`form.weeklySlots.${k}.time`]: e.detail.value });
  },

  onMinPriceInput(e) {
    this.setData({ 'form.minPrice': Number(e.detail.value) || 0 });
  },

  onDistanceChange(e) {
    this.setData({ 'form.maxDistance': e.detail.value });
  },

  onGenderTap(e) {
    this.setData({ 'form.genderPref': e.currentTarget.dataset.val });
  },

  onDailyLimitChange(e) {
    this.setData({ 'form.dailyLimit': e.detail.value });
  },

  onWelfareToggle(e) {
    this.setData({ 'form.acceptWelfare': e.detail.value });
  },

  onBufferChange(e) {
    const idx = Number(e.detail.value);
    const val = this.data.bufferOptions[idx];
    if (val) this.setData({ bufferIndex: idx, 'form.bufferMin': val });
  },

  async onSave() {
    const form = this.data.form;
    if (form.scenes.length === 0) {
      wx.showToast({ title: '请至少选择一个接单场景', icon: 'none' });
      return;
    }

    // 校验每个选中场景都有时薪
    const rates = this.data.sceneRates;
    for (const s of form.scenes) {
      if (!rates[s] || rates[s] < 3000 || rates[s] > 10000) {
        wx.showToast({ title: `场景${s}时薪需30-100元`, icon: 'none' });
        return;
      }
    }

    wx.showLoading({ title: '保存中', mask: true });
    try {
      const r = await callCloud('partner-action', {
        action: 'update_config',
        accept_scenes: form.scenes,
        scene_rates: rates
      });
      wx.hideLoading();

      if (!r.ok) {
        wx.showToast({ title: r.msg || '保存失败', icon: 'none' });
        return;
      }

      // 非核心字段存本地
      try {
        wx.setStorageSync(STORAGE_KEY, {
          weeklySlots: form.weeklySlots,
          minPrice: form.minPrice,
          maxDistance: form.maxDistance,
          genderPref: form.genderPref,
          dailyLimit: form.dailyLimit,
          acceptWelfare: form.acceptWelfare,
          bufferMin: form.bufferMin
        });
      } catch (e) {}

      wx.showToast({ title: '配置已生效', icon: 'success' });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 800);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  }
});
