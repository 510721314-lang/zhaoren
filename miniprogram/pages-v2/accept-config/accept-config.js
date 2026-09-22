// PRD章节: 3.2.2 接单配置 / R9 场景认证校验
// 接 partner-action 云函数: my_profile(拉) + update_config(存)
const CONFIG = require('../../config/index.js');
const redline = require('../../utils/redline.js');
const { getScene } = redline;
const { SCENES } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

const PA = CONFIG.PARTNER_ACCEPT;
const STORAGE_KEY = 'partner_local_cfg';

Page({
  data: {
    certifiedScenes: [],
    homeLocation: null,       // 耍伴日常位置 { name, address, latitude, longitude }
    sceneRates: {},           // { W1: 5000, ... } 元/分
    distanceRange: PA.distanceRange,
    dailyLimitRange: PA.dailyLimitRange,
    bufferOptions: PA.bufferOptions,
    bufferIndex: PA.bufferOptions.indexOf(PA.defaultBufferMin),
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: redline.PICKER_CLOSE,
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
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
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
      // 并行拉云端 profile + 动态场景列表
      const [r, sgRes] = await Promise.all([
        callCloud('partner-action', { action: 'my_profile' }),
        callCloud('home-action', { action: 'scene_groups' }).catch(() => ({ ok: false }))
      ]);
      if (!r.ok) {
        wx.showToast({ title: r.msg || '加载失败', icon: 'none' });
        this.setData({ loading: false, loadError: true });
        return;
      }
      const p = r.data.profile;
      const scenes = p.accept_scenes || [];
      const sceneRates = p.scene_rates || {};
      const examScores = p.exam_scores || {};

      // 动态场景列表 (运营后台可增删, home-action scene_groups 为 SSOT)
      const ICON_FB = { W1: '🏥', W2: '📚', W8: '🛠️', W10: '🚄', W11: '💬', W3: '🏋️', W4: '🎡', W7: '🫂', W9: '🐾' };
      const COLOR_FB = { W1: '#E8F1FF', W2: '#EDE8FF', W8: '#FFF3E0', W10: '#E0F5F4', W11: '#FFE9EC', W3: '#E8FFF0', W4: '#FFF0E8', W7: '#FFE8F3', W9: '#E8F5FF' };
      let dynCodes = [];
      if (sgRes.ok && sgRes.data && sgRes.data.scene_groups) {
        dynCodes = sgRes.data.scene_groups.map((g) => g.scene_code);
      }
      // 合并: 动态列表为 SSOT, SCENES 兜底 icon/color (两个去重)
      const sceneDefs = [];
      const seen = {};
      const pushScene = (code, name) => {
        if (seen[code]) return;
        seen[code] = true;
        const hc = getScene(code);
        sceneDefs.push({
          code,
          name: name || (hc ? hc.name : code),
          icon: hc ? hc.icon : (ICON_FB[code] || '📌'),
          color: hc ? hc.color : (COLOR_FB[code] || '#F5F5F5'),
          gb: hc ? hc.gb : false
        });
      };
      dynCodes.forEach((code, i) => pushScene(code, sgRes.data.scene_groups[i].scene_name));
      SCENES.forEach((s) => pushScene(s.code, s.name));

      const certifiedScenes = sceneDefs.map((s) => {
        const selected = scenes.indexOf(s.code) > -1;
        const hasExam = !!examScores[s.code];
        const examScore = Number(examScores[s.code]) || 0;
        return {
          ...s,
          selected,
          hasExam,
          examScore,
          examPassed: hasExam && examScore >= 80,
          examNeeded: hasExam
        };
      });
      // 同步到全局, 组件 getScene 动态兜底(存完整场景对象)
      try { const app = getApp(); if (app) app.globalData.availableScenes = sceneDefs; } catch (e) {}

      // 为已选场景补默认时薪（如果没有 scene_rates）
      for (const s of scenes) {
        if (!sceneRates[s]) sceneRates[s] = PA.defaultSceneRateFen; // 默认时薪来自 CONFIG, SSOT 可覆盖
      }

      // 本地非核心配置（时段/距离/偏好等）
      let local = {};
      try { local = wx.getStorageSync(STORAGE_KEY) || {}; } catch (e) {}

      this.setData({
        certifiedScenes: certifiedScenes,
        homeLocation: p.home_location || null,
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

  // 日常位置选点(chooseLocation gcj02, 保存时随 update_config 上传)
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

  onSceneToggle(e) {
    const code = e.currentTarget.dataset.code;
    const scenes = this.data.form.scenes.slice();
    const idx = scenes.indexOf(code);
    let selected = false;
    if (idx > -1) { scenes.splice(idx, 1); selected = false; }
    else { scenes.push(code); selected = true; }
    // 同步更新 certifiedScenes 里的 selected
    const certifiedScenes = this.data.certifiedScenes.map((s) => {
      if (s.code === code) return { ...s, selected };
      return { ...s, selected: scenes.indexOf(s.code) > -1 };
    });
    this.setData({ 'form.scenes': scenes, certifiedScenes });
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
        scene_rates: rates,
        home_location: this.data.homeLocation
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
  },
  onReserve() { wx.showModal({ title: 'Rest', content: 'Please stay safe', showCancel: false }); }
});
