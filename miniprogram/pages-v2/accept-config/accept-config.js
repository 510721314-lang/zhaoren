// PRD章节: 3.2.2 接单配置 / R9 场景认证校验
const CONFIG = require('../../config/index.js');
const { SCENES } = require('../../config/enums.js');
const { CURRENT_USER } = require('../../mock/users.js');
const redline = require('../../utils/redline.js');

const PA = CONFIG.PARTNER_ACCEPT;

Page({
  data: {
    // 已认证场景（多选仅显示已认证）
    certifiedScenes: [],
    // 可调区间（CONFIG SSOT）
    distanceRange: PA.distanceRange,
    dailyLimitRange: PA.dailyLimitRange,
    bufferOptions: PA.bufferOptions,
    bufferIndex: PA.bufferOptions.indexOf(PA.defaultBufferMin),
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: CONFIG.TIME_REDLINE.close,
    budgetPlaceholder: `${CONFIG.BUDGET_RANGE[0]}-${CONFIG.BUDGET_RANGE[1]}`,
    subsidyPercent: CONFIG.WELFARE.partnerSubsidyRate * 100,
    // 9项表单
    form: {
      scenes: [],                  // 场景多选
      weeklySlots: {               // 每周时段
        mon: { enabled: false, time: '09:00-18:00' },
        tue: { enabled: false, time: '09:00-18:00' },
        wed: { enabled: false, time: '09:00-18:00' },
        thu: { enabled: false, time: '09:00-18:00' },
        fri: { enabled: false, time: '09:00-18:00' },
        sat: { enabled: true,  time: '10:00-20:00' },
        sun: { enabled: true,  time: '10:00-20:00' }
      },
      minPrice: PA.defaultMinPrice, // 最低单价
      maxDistance: PA.defaultDistance,
      genderPref: '不限',           // 性别偏好
      dailyLimit: PA.defaultDailyLimit,
      acceptWelfare: true,          // 接受公益订单
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
    // 三态UI
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

  fetchData() {
    this.setData({ loading: true, loadError: false });
    setTimeout(() => {
      try {
        // 仅显示已认证场景
        const certified = (CURRENT_USER.certified_scenes || []).map((code) => SCENES.find((s) => s.code === code)).filter(Boolean);
        this.setData({
          certifiedScenes: certified,
          'form.scenes': CURRENT_USER.certified_scenes || [],
          loading: false
        });
      } catch (e) {
        this.setData({ loading: false, loadError: true });
      }
    }, 300);
  },

  reload() { this.fetchData(); },

  // 场景多选
  onSceneToggle(e) {
    const code = e.currentTarget.dataset.code;
    const scenes = this.data.form.scenes.slice();
    const idx = scenes.indexOf(code);
    if (idx > -1) scenes.splice(idx, 1);
    else scenes.push(code);
    this.setData({ 'form.scenes': scenes });
  },

  // 每周时段开关
  onWeekToggle(e) {
    const k = e.currentTarget.dataset.key;
    this.setData({ [`form.weeklySlots.${k}.enabled`]: !this.data.form.weeklySlots[k].enabled });
  },

  // 时段picker
  onWeekTimeChange(e) {
    const k = e.currentTarget.dataset.key;
    this.setData({ [`form.weeklySlots.${k}.time`]: e.detail.value });
  },

  // 最低单价
  onMinPriceInput(e) {
    this.setData({ 'form.minPrice': Number(e.detail.value) || 0 });
  },

  // 最大距离slider
  onDistanceChange(e) {
    this.setData({ 'form.maxDistance': e.detail.value });
  },

  // 性别偏好
  onGenderTap(e) {
    this.setData({ 'form.genderPref': e.currentTarget.dataset.val });
  },

  // 每日接单上限
  onDailyLimitChange(e) {
    this.setData({ 'form.dailyLimit': e.detail.value });
  },

  // 接受公益订单
  onWelfareToggle(e) {
    this.setData({ 'form.acceptWelfare': e.detail.value });
  },

  // 缓冲时间picker（selector 返回下标，映射为配置档位）
  onBufferChange(e) {
    const idx = Number(e.detail.value);
    const val = this.data.bufferOptions[idx];
    if (val) this.setData({ bufferIndex: idx, 'form.bufferMin': val });
  },

  // 保存
  onSave() {
    if (this.data.form.scenes.length === 0) {
      wx.showToast({ title: '请至少选择一个接单场景', icon: 'none' });
      return;
    }
    if (this.data.form.minPrice < CONFIG.BUDGET_RANGE[0]) {
      wx.showToast({ title: `最低单价不能低于${CONFIG.BUDGET_RANGE[0]}元`, icon: 'none' });
      return;
    }
    wx.showToast({ title: '配置已生效', icon: 'success' });
    setTimeout(() => wx.navigateBack({ fail: () => {} }), 1000);
  }
});
