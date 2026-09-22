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
    bufferOptions: PA.bufferOptions,
    bufferIndex: PA.bufferOptions.indexOf(PA.defaultBufferMin),
    subsidyPercent: CONFIG.WELFARE.partnerSubsidyRate * 100,
    form: {
      scenes: [],
      // 每周接单时段: {enabled, start, end} 为分钟数(0-1440); start > end 表示跨夜槽
      weeklySlots: {
        mon: { enabled: false, start: 540, end: 1080 },
        tue: { enabled: false, start: 540, end: 1080 },
        wed: { enabled: false, start: 540, end: 1080 },
        thu: { enabled: false, start: 540, end: 1080 },
        fri: { enabled: false, start: 540, end: 1080 },
        sat: { enabled: true,  start: 600, end: 1200 },
        sun: { enabled: true,  start: 600, end: 1200 }
      },
      minPrice: PA.defaultMinPrice,
      maxPrice: PA.defaultMaxPrice,
      maxDistance: PA.defaultDistance,
      genderPref: '不限',
      dailyLimit: PA.defaultDailyLimit,   // 只读: 平台统一设定(启动时由云端 config_public 覆盖)
      acceptWelfare: true,
      bufferMin: PA.defaultBufferMin
    },
    // 时段滑动条(半小时索引 0-48)与展示文本, 由 _syncSlots() 从 form.weeklySlots 派生
    slotIdx: {},
    slotText: {},
    slotsPerDay: PA.slotsPerDay,
    rateMinYuan: Math.round(PA.rateMinFen / 100),
    rateMaxYuan: Math.round(PA.rateMaxFen / 100),
    minPricePlaceholder: String(Math.round(PA.rateMinFen / 100)),
    maxPricePlaceholder: String(Math.round(PA.rateMaxFen / 100)),
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

  // ── 每周时段: 分钟数 ⇄ 半小时索引 / HH:mm 文本 ──
  fmtHalf(min) {
    const m = Math.max(0, Math.min(1440, Math.round(Number(min) || 0)));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return (h < 10 ? '0' + h : '' + h) + ':' + (mm < 10 ? '0' + mm : '' + mm);
  },
  // 旧本地缓存格式 'HH:mm-HH:mm' → 结构化 {enabled,start,end}
  parseLegacySlot(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.start === 'number' && typeof raw.end === 'number') {
      return { enabled: !!raw.enabled, start: raw.start, end: raw.end };
    }
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(raw.time || ''));
    if (!m) return null;
    return { enabled: !!raw.enabled, start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] };
  },
  // 从 form.weeklySlots 派生滑动条索引与展示文本
  _syncSlots() {
    const slots = this.data.form.weeklySlots || {};
    const idx = {};
    const txt = {};
    Object.keys(slots).forEach((k) => {
      const s = slots[k] || {};
      const start = Number(s.start) || 0;
      const end = Number(s.end) || 0;
      idx[k] = { start: Math.round(start / 30), end: Math.round(end / 30) };
      txt[k] = { start: this.fmtHalf(start), end: this.fmtHalf(end), cross: end < start };
    });
    this.setData({ slotIdx: idx, slotText: txt, dailyLimit: this.data.form.dailyLimit });
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

      // 本地缓存仅作离线兜底; 云端 profile 为 SSOT
      let local = {};
      try { local = wx.getStorageSync(STORAGE_KEY) || {}; } catch (e) {}

      // 每周接单时段: 云端 → 本地(兼容旧格式) → 页面默认
      let slots = null;
      const pickSlots = (src) => {
        if (!src || typeof src !== 'object') return null;
        const out = {};
        Object.keys(this.data.form.weeklySlots).forEach((k) => {
          const s = this.parseLegacySlot(src[k]);
          out[k] = s || Object.assign({}, this.data.form.weeklySlots[k]);
        });
        return out;
      };
      slots = pickSlots(p.weekly_slots) || pickSlots(local.weeklySlots) || this.data.form.weeklySlots;

      // 接单价格区间(元/小时): 云端存分; 未设置 → 本地 → 默认
      const minYuan = (p.accept_rate_min_fen !== null && p.accept_rate_min_fen !== undefined)
        ? Math.round(p.accept_rate_min_fen / 100)
        : (local.minPrice || PA.defaultMinPrice);
      const maxYuan = (p.accept_rate_max_fen !== null && p.accept_rate_max_fen !== undefined)
        ? Math.round(p.accept_rate_max_fen / 100)
        : (local.maxPrice || PA.defaultMaxPrice);

      this.setData({
        certifiedScenes: certifiedScenes,
        homeLocation: p.home_location || null,
        sceneRates: sceneRates,
        'form.scenes': scenes,
        'form.weeklySlots': slots,
        'form.minPrice': minYuan,
        'form.maxPrice': maxYuan,
        'form.maxDistance': local.maxDistance || PA.defaultDistance,
        'form.genderPref': local.genderPref || '不限',
        // 每日上限: 平台统一设定(启动时 config_public 覆盖 PARTNER_ACCEPT.dailyLimit), 耍伴端只读
        'form.dailyLimit': PA.dailyLimit || PA.defaultDailyLimit,
        'form.acceptWelfare': local.acceptWelfare !== false,
        'form.bufferMin': local.bufferMin || PA.defaultBufferMin,
        bufferIndex: PA.bufferOptions.indexOf(local.bufferMin || PA.defaultBufferMin),
        rateMinYuan: Math.round((PA.rateMinFen || 3000) / 100),
        rateMaxYuan: Math.round((PA.rateMaxFen || 10000) / 100),
        minPricePlaceholder: String(Math.round((PA.rateMinFen || 3000) / 100)),
        maxPricePlaceholder: String(Math.round((PA.rateMaxFen || 10000) / 100)),
        loading: false
      });
      this._syncSlots();
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
    const slots = Object.assign({}, this.data.form.weeklySlots);
    slots[k] = Object.assign({}, slots[k], { enabled: !slots[k].enabled });
    this.setData({ 'form.weeklySlots': slots });
    this._syncSlots();
  },

  // 时段滑动条: 控件值=半小时索引(0-48), 存回分钟数
  onWeekStartChange(e) {
    const k = e.currentTarget.dataset.key;
    const slots = Object.assign({}, this.data.form.weeklySlots);
    slots[k] = Object.assign({}, slots[k], { start: Number(e.detail.value) * 30 });
    this.setData({ 'form.weeklySlots': slots });
    this._syncSlots();
  },
  onWeekEndChange(e) {
    const k = e.currentTarget.dataset.key;
    const slots = Object.assign({}, this.data.form.weeklySlots);
    slots[k] = Object.assign({}, slots[k], { end: Number(e.detail.value) * 30 });
    this.setData({ 'form.weeklySlots': slots });
    this._syncSlots();
  },

  onMinPriceInput(e) {
    this.setData({ 'form.minPrice': Number(e.detail.value) || 0 });
  },

  onMaxPriceInput(e) {
    this.setData({ 'form.maxPrice': Number(e.detail.value) || 0 });
  },

  onDistanceChange(e) {
    this.setData({ 'form.maxDistance': e.detail.value });
  },

  onGenderTap(e) {
    this.setData({ 'form.genderPref': e.currentTarget.dataset.val });
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

    // 校验每个选中场景都有时薪(区间取 CONFIG, 服务端为准)
    const rates = this.data.sceneRates;
    const rateLoYuan = Math.round(PA.rateMinFen / 100);
    const rateHiYuan = Math.round(PA.rateMaxFen / 100);
    for (const s of form.scenes) {
      if (!rates[s] || rates[s] < PA.rateMinFen || rates[s] > PA.rateMaxFen) {
        wx.showToast({ title: `场景${s}时薪需${rateLoYuan}-${rateHiYuan}元`, icon: 'none' });
        return;
      }
    }

    // 校验接单价格区间(元/小时; 服务端会按平台边界再校验一次)
    const minYuan = Number(form.minPrice) || 0;
    const maxYuan = Number(form.maxPrice) || 0;
    if (minYuan < rateLoYuan || minYuan > rateHiYuan || maxYuan < rateLoYuan || maxYuan > rateHiYuan) {
      wx.showToast({ title: `单价区间需在${rateLoYuan}-${rateHiYuan}元/小时之间`, icon: 'none' });
      return;
    }
    if (minYuan > maxYuan) {
      wx.showToast({ title: '最低单价不能高于最高单价', icon: 'none' });
      return;
    }

    // 校验每周时段(启用日的起止不能相同; start > end 视为跨夜槽, 服务端已支持)
    const slotsPayload = {};
    for (const k of Object.keys(form.weeklySlots)) {
      const s = form.weeklySlots[k];
      slotsPayload[k] = { enabled: !!s.enabled, start: s.start, end: s.end };
      if (s.enabled && s.start === s.end) {
        const name = (this.data.weekLabels.find((w) => w.key === k) || {}).name || k;
        wx.showToast({ title: `${name}的起止时间不能相同`, icon: 'none' });
        return;
      }
    }

    wx.showLoading({ title: '保存中', mask: true });
    try {
      const r = await callCloud('partner-action', {
        action: 'update_config',
        accept_scenes: form.scenes,
        scene_rates: rates,
        home_location: this.data.homeLocation,
        weekly_slots: slotsPayload,
        accept_rate_min_fen: Math.round(minYuan * 100),
        accept_rate_max_fen: Math.round(maxYuan * 100)
      });
      wx.hideLoading();

      if (!r.ok) {
        wx.showToast({ title: r.msg || '保存失败', icon: 'none' });
        return;
      }

      // 本地缓存(离线首屏兜底; 云端 profile 为 SSOT)
      try {
        wx.setStorageSync(STORAGE_KEY, {
          weeklySlots: slotsPayload,
          minPrice: minYuan,
          maxPrice: maxYuan,
          maxDistance: form.maxDistance,
          genderPref: form.genderPref,
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
