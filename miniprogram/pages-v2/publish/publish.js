// PRD章节: 3.3 需求发布 / 3.3.1 场景与撮合 / 3.5.1-V15 AA费用 / 1.5 公益 / R1时间红线 / R9场景白名单
const redline = require('../../utils/redline.js');
const { getScene } = redline;
const CONFIG = require('../../config/index.js');
const { SCENES, MATCH_MODE, CREDIT_LEVEL, AA_ESTIMATE_LABEL } = require('../../config/enums.js');

// 智能派单门槛 = L3 优质等级下限（PRD 3.1.2）
const L3_MIN = (CREDIT_LEVEL.find((l) => l.level === 'L3') || {}).min || 900;

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

// 敏感词检测：手机号/微信号
function detectSensitive(text) {
  if (!text) return null;
  const phone = text.match(/1[3-9]\d{9}/);
  if (phone) return '内容包含手机号格式，请删除后重试';
  const wechat = text.match(/[vV微][xX信]/);
  if (wechat) return '内容包含微信号信息，请删除后重试';
  return null;
}

// Haversine 球面距离(公里) · 与云函数口径一致, 用于发布前前置提示(服务端为准)
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 距离格式化: <1km 显示米, ≥1km 显示公里(1位小数)
function fmtDist(km) {
  if (!km || km <= 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} 米`;
  return `${km.toFixed(1)} 公里`;
}

// 逆地理编码: 经纬度 → 中文可读地址(腾讯地图 WebService; key 空则降级返回坐标字符串)
function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    const key = CONFIG.TENCENT_MAP_KEY;
    if (!key) { resolve(''); return; }
    wx.request({
      url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${key}`,
      timeout: 5000,
      success: (r) => {
        const data = r.data || {};
        if (data.status !== 0 || !data.result) {
          console.warn('[reverseGeocode] bad status:', data.status, data.message);
          resolve(''); return;
        }
        const addr = (data.result.formatted_addresses && data.result.formatted_addresses.recommend)
          || data.result.address || '';
        resolve(addr);
      },
      fail: (err) => { console.error('[reverseGeocode] wx.request fail:', err && err.errMsg); resolve(''); }
    });
  });
}

Page({
  data: {
    statusBarHeight: 20,
    scenes: SCENES,
    matchModes: MATCH_MODE,
    durationOptions: CONFIG.DURATION_OPTIONS,
    // 档位值取 CONFIG.AA_OPTIONS，展示文案取 enums AA_ESTIMATE_LABEL（PRD 3.5.1 SSOT）
    aaOptions: CONFIG.AA_OPTIONS.map((v) => ({ value: v, label: AA_ESTIMATE_LABEL[v] })),
    user: {},  // peek_login 异步填充

    // 表单
    form: {
      project_attr: 'commercial',  // B2
      scene_code: '',               // B3
      content_options: [],          // B3.1 服务内容(子服务项)勾选, 至少 1 项最多 3 项
      title: '',                    // B4
      description: '',             // B4
      service_date: '',            // B5
      service_time: '',            // B5
      duration_hours: 3,           // B5
      duration_custom: '',
      location_name: '',           // B5
      latitude: 0,                 // B5 wx.chooseLocation 回填
      longitude: 0,                // B5
      headcount: 1,                // B6
      budget: '',                  // B6
      aa_estimate: '',             // B7
      aa_custom: '',               // B7 自定义
      gender_pref: '不限',        // B8
      match_mode: 'broadcast'      // B9
    },
    titleCount: 0,
    descCount: 0,

    // B3 免责声明(选场景时 wx.showModal 签署后置 true; 草稿恢复场景 onPublish 会补弹)
    disclaimerChecked: false,
    // B3.1 服务内容选择窗(免责声明通过后自动弹出)
    optionSheetVisible: false,
    optionList: [],  // [{ name, checked }] 当前场景的服务项 + 勾选态
    // B9 智能派单
    smartLocked: true,  // mock用户非L3且非会员 → 置灰
    // B10 自动保存
    autoSaveText: '',
    autoSaveSec: CONFIG.DRAFT.autoSaveSec,
    // B1 草稿箱
    draftBoxVisible: false,
    draftList: [],
    draftCount: 0,
    // 发布地址: 进入发布页即自动高精度定位, 只读不可手改(图3)
    publishLocation: null,   // {latitude, longitude, name, updatedAt:'HH:mm'}
    locating: false,
    // 两地址距离(km): 发布地址 ↔ 履约地址, 实时计算
    distanceKm: 0,
    distanceText: '',
    // 定向邀约(从耍伴详情"咨询/邀TA"进入): 锁定 direct 模式, 仅该耍伴可见可接
    directInvite: false,
    invitePartnerName: '',
    // 发布中
    publishing: false,
    // 编辑模式(修改需求): 标题与底部按钮随之切换
    isEditMode: false,
    navTitle: '发布需求',
    today: '',
    dateMax: '',
    isRedline: false,
    distanceMaxKm: CONFIG.PUBLISH.distanceMaxKm,
    // C 可运营参数（供 WXML 绑定）
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: redline.PICKER_CLOSE,
    titleMax: CONFIG.TITLE_MAX,
    descMax: CONFIG.DESC_MAX,
    draftExpireDays: CONFIG.DRAFT.expireDays,
    budgetPlaceholder: `${CONFIG.BUDGET_RANGE[0]}-${CONFIG.BUDGET_RANGE[1]}`,
    welfareText: `公益规则：每月${CONFIG.WELFARE.monthlyQuota}单额度 · 每人每月限${CONFIG.WELFARE.perUserQuota}单 · 耍伴按标准单价${CONFIG.WELFARE.partnerSubsidyRate * 100}%获得平台补贴`
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    this.fetchScenes();  // 动态拉场景列表(运营后台可增删, 硬编码 SCENES 仅兜底 icon/color)
  },

  async fetchScenes() {
    try {
      const r = await wx.cloud.callFunction({ name: 'home-action', data: { action: 'scene_groups' } }).then((res) => res.result || {});
      if (r.ok && r.data && r.data.scene_groups) {
        const ICON_FB = { W1: '🏥', W2: '📚', W8: '🛠️', W10: '🚄', W11: '💬', W3: '🏋️', W4: '🎡', W7: '🫂', W9: '🐾' };
        const COLOR_FB = { W1: '#E8F1FF', W2: '#EDE8FF', W8: '#FFF3E0', W10: '#E0F5F4', W11: '#FFE9EC', W3: '#E8FFF0', W4: '#FFF0E8', W7: '#FFE8F3', W9: '#E8F5FF' };
        const scenes = r.data.scene_groups.map((g) => {
          const hc = getScene(g.scene_code);
          const hard = hc && hc.disclaimer;
          // 场景专属免责声明: 云端 legal_scene_disclaimers(SSOT, 后台可改) 优先 → 硬编码 enums 兜底
          // ⚠️ 必须挂到场景对象上, 否则 setScene 会落到 _defaultDisclaimer 通用文案(所有场景同一段)
          const cloudText = g.scene_disclaimer_text || '';
          const disclaimer = cloudText
            ? { title: (hard && hard.title) || '免责声明', content: cloudText }
            : (hard || null);
          return {
            code: g.scene_code,
            name: g.scene_name,
            icon: hc ? hc.icon : (ICON_FB[g.scene_code] || '📌'),
            color: hc ? hc.color : (COLOR_FB[g.scene_code] || '#F5F5F5'),
            options: Array.isArray(g.scene_options) && g.scene_options.length
              ? g.scene_options.slice(0, 3)
              : (hc ? (hc.options || []).slice(0, 3) : []),
            gb: hc ? hc.gb : false,
            disclaimer_type: g.scene_disclaimer_type || (hc && hc.disclaimer_type) || 'general_disclaimer',
            disclaimer
          };
        });
        this.setData({ scenes });
        // 同步到全局, redline.js R9 白名单校验 + 组件 getScene 动态兜底(存完整场景对象)
        const app = getApp();
        if (app) app.globalData.availableScenes = scenes;
        // 场景预选中: onLoad 里拿到的 sceneCode 等这里 scenes 数据就绪后再触发
        if (this.__pendingSceneCode) {
          const code = this.__pendingSceneCode;
          this.__pendingSceneCode = null;  // 只触发一次
          setTimeout(() => this.setScene({ code }), 50);  // 微延迟等 setData 渲染
        }
      }
    } catch (e) { /* 网络异常保留硬编码兜底 */ }
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad(options) {
    // 平台总开关: 核心交易维护中 → 入口即提示并自动返回
    const { switchOn } = require('../../utils/bootstrap.js');
    if (!switchOn('access')) {
      wx.showModal({
        title: '功能维护中',
        content: '发布需求功能正在维护，请稍后再试。',
        showCancel: false,
        confirmText: '知道了',
        complete: () => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages-v2/square/square', fail: () => {} }) });
        }
      });
      return;
    }
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}

    // 编辑模式: 从需求详情携带 mode=edit & demand_id 进来
    if (options.mode === 'edit' && options.demand_id) {
      this.__editMode = true;
      this.__editDemandId = options.demand_id;
      wx.setNavigationBarTitle({ title: '修改需求' });
      this.setData({ isEditMode: true, navTitle: '修改需求' });
      // 拉需求详情回填表单
      wx.cloud.callFunction({
        name: 'demand-publish',
        data: { action: 'detail', demand_id: options.demand_id },
        success: (res) => {
          const r = res.result || {};
          if (!r.ok || !r.data) {
            wx.showToast({ title: '需求不存在', icon: 'none' });
            setTimeout(() => wx.navigateBack(), 1200);
            return;
          }
          const d = r.data;
          // 编辑模式静默回填: 不走 setScene(会弹免责声明+清空服务项+弹选择窗), 
          // 需求已发布过一次即已签署声明; 直接写 form 字段, 场景卡按 code 自动高亮, 服务项直接回填
          const dt = new Date(d.service_date + 'T' + (d.service_time || '00:00'));
          const pad = (n) => n < 10 ? '0' + n : '' + n;
          const h = dt.getHours(), m = dt.getMinutes();
          // 时长预设映射 + date/time 回填
          const durationPresets = [1, 2, 3, 4, 6, 8];
          const dur = durationPresets.includes(d.duration_hours) ? d.duration_hours : d.duration_hours;
          this.setData({
            'form.scene_code': d.scene_code || '',
            'form.content_options': Array.isArray(d.content_options) ? d.content_options : [],
            'form.project_attr': d.project_attr || 'commercial',
            'form.title': d.title || '',
            'form.description': d.description || '',
            'form.service_date': d.service_date,
            'form.service_time': pad(h) + ':' + pad(m),
            'form.duration_hours': dur,
            'form.duration_custom': d.duration_hours,
            'form.headcount': d.headcount || 1,
            'form.budget': d.budget ? String(d.budget) : '',
            'form.aa_estimate': d.aa_estimate || '0-50',
            'form.match_mode': d.match_mode || 'broadcast',
            'form.gender_pref': d.gender_pref || '不限',
            // 履约地点
            'form.location_name': (d.location && d.location.name) || '',
            'form.latitude': (d.location && d.location.latitude) || 0,
            'form.longitude': (d.location && d.location.longitude) || 0,
            titleCount: (d.title || '').length,
            descCount: (d.description || '').length,
            // 已发布需求视为已签署场景声明(编辑提交时不再重复弹)
            disclaimerChecked: true,
            // 已发布需求不能改发布地址(只读留痕)
            publishLocation: d.publish_location ? {
              latitude: d.publish_location.latitude,
              longitude: d.publish_location.longitude,
              name: d.publish_location.name || '原发布位置',
              updatedAt: ''
            } : null
          });
        },
        fail: () => {
          wx.showToast({ title: '加载需求失败', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 1200);
        }
      });
    }

    // 场景预选中: 存到 pending 等 fetchScenes 完成后再调 setScene
    // (onLoad 执行时 this.data.scenes 还是老数据, 直接 setScene 会 find 不到 → 不聚焦)
    if (options.sceneCode) {
      this.__pendingSceneCode = options.sceneCode;
    }
    // 定向邀约: 从耍伴详情"咨询/邀TA"携带 invitePartnerOpenid 进入
    if (options.invitePartnerOpenid) {
      this.invitePartnerOpenid = options.invitePartnerOpenid;
      this.setData({
        directInvite: true,
        invitePartnerName: options.invitePartnerName ? decodeURIComponent(options.invitePartnerName) : '',
        'form.match_mode': 'direct'
      });
      this._fetchInvitePartner(this.invitePartnerOpenid);
    }
    // 进入页面立即获取发布地址(真实GPS, 只读留痕) — 编辑模式跳过(原发布地址不可变)
    if (!this.__editMode) {
      this._locatePublish(false);
    }
    // 拉用户信息 (peek_login) 替代 CURRENT_USER
    wx.cloud.callFunction({
      name: 'user-login',
      data: { action: 'peek_login' },
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data && r.data.found && r.data.user) {
          const u = r.data.user;
          this.setData({
            user: u,
            smartLocked: (u.partner_credit_score || 0) < L3_MIN
          });
        }
      },
      fail: () => {}
    });
    // B5 日期范围
    const now = new Date();
    const todayStr = this.fmtDate(now);
    const max = new Date(now.getTime() + CONFIG.DATE_RANGE_DAYS * 86400000);
    this.setData({ today: todayStr, dateMax: this.fmtDate(max) });
    this.startAutoSave();
    // 草稿数量角标(静默拉取,失败不打扰) — 编辑模式不需要草稿
    if (!this.__editMode) {
      callCloud('demand-publish', { action: 'list_drafts' }).then((r) => {
        if (r.ok && r.data) this.setData({ draftCount: (r.data.list || []).length });
      }).catch(() => {});
    }
  },

  onUnload() {
    if (this._saveTimer) clearInterval(this._saveTimer);
  },

  noop() {},

  fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // ── B1 草稿箱 ──
  fmtTime(ts) {
    const d = new Date(ts);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
  // 表单 → 草稿存储结构(与 restoreDraft 读取字段一一对应)
  _buildDraftData() {
    const f = this.data.form;
    return {
      project_attr: f.project_attr,
      scene_code: f.scene_code,
      title: f.title,
      description: f.description,
      service_date: f.service_date,
      service_time: f.service_time,
      duration_hours: f.duration_hours || Number(f.duration_custom) || 3,
      location: { name: f.location_name, latitude: f.latitude || 0, longitude: f.longitude || 0 },
      headcount: f.headcount,
      budget: Number(f.budget) || 0,
      aa_estimate: f.aa_estimate,
      gender_pref: f.gender_pref,
      match_mode: f.match_mode
    };
  },
  // 云端保存草稿(手动存草稿与自动保存共用; draft_id 存在则更新)
  _saveDraftCloud(silent) {
    return callCloud('demand-publish', {
      action: 'save_draft',
      draft_id: this.__draftId || '',
      demand_data: this._buildDraftData()
    }).then((r) => {
      if (!r.ok) {
        if (!silent) wx.showToast({ title: r.msg || '草稿保存失败', icon: 'none' });
        return null;
      }
      if (r.data && r.data.draft_id) this.__draftId = r.data.draft_id;
      this.setData({
        autoSaveText: silent ? `${CONFIG.DRAFT.autoSaveSec}秒前` : '刚刚',
        draftCount: Math.max(this.data.draftCount, 1)
      });
      return r.data;
    }).catch(() => {
      if (!silent) wx.showToast({ title: '网络异常，保存失败', icon: 'none' });
      return null;
    });
  },
  openDraftBox() {
    this.setData({ draftBoxVisible: true });
    callCloud('demand-publish', { action: 'list_drafts' }).then((r) => {
      if (!r.ok) {
        wx.showToast({ title: r.msg || '草稿拉取失败', icon: 'none' });
        return;
      }
      const list = (r.data.list || []).map((d) => ({
        _id: d._id,
        demand_data: d.demand_data || {},
        saved_at: d.updated_at ? this.fmtTime(d.updated_at) : ''
      }));
      this.setData({ draftList: list, draftCount: list.length });
    }).catch(() => wx.showToast({ title: '网络异常', icon: 'none' }));
  },
  closeDraftBox() {
    this.setData({ draftBoxVisible: false });
  },
  restoreDraft(e) {
    const idx = e.currentTarget.dataset.index;
    const draft = this.data.draftList[idx];
    if (!draft) return;
    const d = draft.demand_data;
    this.__draftId = draft._id;  // 后续保存/自动保存更新同一条草稿
    this.setData({
      form: {
        project_attr: d.project_attr || 'commercial',
        scene_code: d.scene_code || '',
        content_options: Array.isArray(d.content_options) ? d.content_options : [],
        title: d.title || '',
        description: d.description || '',
        service_date: d.service_date || '',
        service_time: d.service_time || '',
        duration_hours: d.duration_hours || 3,
        duration_custom: '',
        location_name: d.location ? d.location.name : '',
        latitude: (d.location && d.location.latitude) || 0,
        longitude: (d.location && d.location.longitude) || 0,
        headcount: d.headcount || 1,
        budget: String(d.budget || ''),
        aa_estimate: d.aa_estimate || '',
        aa_custom: '',
        gender_pref: d.gender_pref || '不限',
        match_mode: d.match_mode || 'broadcast'
      },
      titleCount: (d.title || '').length,
      descCount: (d.description || '').length,
      draftBoxVisible: false
    });
    wx.showToast({ title: '草稿已恢复', icon: 'none' });
  },

  // ── B2 项目属性 ──
  setAttr(e) {
    const attr = e.currentTarget.dataset.attr;
    const form = Object.assign({}, this.data.form);
    form.project_attr = attr;
    // 公益 → 隐藏预算
    if (attr === 'public_welfare') {
      form.budget = '';
    }
    this.setData({ form });
  },

  // ── B3 场景选择 ──
  setScene(e) {
    const code = e.currentTarget ? e.currentTarget.dataset.code : e.code;
    // 优先从动态场景列表找, SCENES 兜底（编辑模式回填时可能还没拉动态列表）
    let scene = (this.data.scenes || []).find((s) => s.code === code) || getScene(code);
    if (!scene) return;
    const form = Object.assign({}, this.data.form);
    form.scene_code = code;
    // 每个场景都有对应免责声明 → wx.showModal 弹场景专属文案
    // 动态场景无完整 disclaimer.title/content 时用 disclaimer_type 通用文案兜底
    const disclaimerScene = scene.disclaimer ? scene : { disclaimer: this._defaultDisclaimer(scene) };
    this._showSceneDisclaimer(disclaimerScene,
      () => {
        // 换场景 → 清空旧场景的服务项选择, 并弹出服务内容选择窗
        form.content_options = [];
        this.setData({ form, disclaimerChecked: true });
        this._openOptionSheet(scene);
      },
      () => {
        // 不同意 → 取消场景选择
        form.scene_code = '';
        this.setData({ form, disclaimerChecked: false });
        wx.showToast({ title: '请同意免责声明后继续', icon: 'none' });
      }
    );
  },

  // ── B3.1 服务内容(子服务项)选择窗 ──
  // 点击场景卡 → 免责声明通过后自动弹出; 至少 1 项, 最多 3 项(与服务端 demand-publish 校验一致)
  _openOptionSheet(scene) {
    const opts = (scene && scene.options) || [];
    if (!opts.length) {
      // 场景未配服务项(理论上不会发生, 服务端要求 content_options 非空): 不弹窗, 发布时会提示
      this.setData({ optionSheetVisible: false, optionList: [] });
      return;
    }
    const chosen = this.data.form.content_options || [];
    this.setData({
      optionList: opts.map((name) => ({ name, checked: chosen.indexOf(name) >= 0 })),
      optionSheetVisible: true
    });
  },
  // 已选服务内容区点击 → 重新打开选择窗
  openOptionSheet() {
    const f = this.data.form;
    const scene = (this.data.scenes || []).find((s) => s.code === f.scene_code) || getScene(f.scene_code);
    this._openOptionSheet(scene);
  },
  closeOptionSheet() {
    this.setData({ optionSheetVisible: false });
  },
  toggleOption(e) {
    const name = e.currentTarget.dataset.name;
    const list = (this.data.optionList || []).map((o) => Object.assign({}, o));
    const idx = list.findIndex((o) => o.name === name);
    if (idx < 0) return;
    if (!list[idx].checked && list.filter((o) => o.checked).length >= 3) {
      wx.showToast({ title: '最多选择 3 项', icon: 'none' });
      return;
    }
    list[idx].checked = !list[idx].checked;
    this.setData({ optionList: list });
  },
  confirmOptions() {
    const chosen = (this.data.optionList || []).filter((o) => o.checked).map((o) => o.name);
    if (!chosen.length) {
      wx.showToast({ title: '请至少选择 1 项服务内容', icon: 'none' });
      return;
    }
    this.setData({ 'form.content_options': chosen, optionSheetVisible: false });
  },
  _defaultDisclaimer(scene) {
    const titleMap = { medical_disclaimer: '就医免责声明', online_disclaimer: '线上陪伴声明' };
    return {
      title: titleMap[scene.disclaimer_type] || '免责声明',
      content: '本平台提供的服务仅为生活协助性质，非专业资质服务。请双方确保真实身份与安全合规，遇紧急情况请立即报警或联系相关部门。平台与耍伴/发布者仅承担协助义务，因您自身原因造成的损失平台不承担责任。'
    };
  },
  // 场景免责声明统一弹窗（wx.showModal 真机稳定；onAgree/onReject 回调）
  _showSceneDisclaimer(scene, onAgree, onReject) {
    const d = scene && scene.disclaimer;
    if (!d) {
      // 无免责声明的场景直接视为通过（理论上一期 5 个场景都有）
      if (onAgree) onAgree();
      return;
    }
    wx.showModal({
      title: d.title,
      content: d.content,
      confirmText: '同意',
      cancelText: '不同意',
      success: (r) => {
        if (r.confirm) { if (onAgree) onAgree(); }
        else if (onReject) onReject();
      }
    });
  },
  // ── B4 标题/描述 ──
  onTitleInput(e) {
    let v = (e.detail.value || '').slice(0, CONFIG.TITLE_MAX);
    this.setData({ 'form.title': v, titleCount: v.length });
  },
  onDescInput(e) {
    let v = (e.detail.value || '').slice(0, CONFIG.DESC_MAX);
    this.setData({ 'form.description': v, descCount: v.length });
  },

  // ── B5 日期/时间/时长/地点 ──
  onDateChange(e) {
    this.setData({ 'form.service_date': e.detail.value });
  },
  onTimeChange(e) {
    const time = e.detail.value;
    // R1 校验：可服务区间以 CONFIG.TIME_REDLINE 为准
    if (!redline.isServiceTimeAllowed(time)) {
      wx.showToast({ title: `须满足时间红线${redline.DISPLAY_CLOSE}-${CONFIG.TIME_REDLINE.open}`, icon: 'none' });
      return;
    }
    this.setData({ 'form.service_time': time });
  },
  setDuration(e) {
    const val = Number(e.currentTarget.dataset.val);
    this.setData({ 'form.duration_hours': val, 'form.duration_custom': '' });
  },
  onDurationCustomInput(e) {
    const v = e.detail.value;
    this.setData({ 'form.duration_custom': v, 'form.duration_hours': 0 });
  },
  onLocationInput(e) {
    this.setData({ 'form.location_name': e.detail.value });
  },
  onLocationPick() {
    wx.chooseLocation({
      success: (res) => {
        const pub = this.data.publishLocation;
        const dist = (pub && Number(res.latitude) && Number(res.longitude))
          ? haversineKm(pub.latitude, pub.longitude, Number(res.latitude), Number(res.longitude))
          : 0;
        this.setData({
          'form.location_name': res.name || res.address,
          'form.latitude': res.latitude,
          'form.longitude': res.longitude,
          distanceKm: dist,
          distanceText: fmtDist(dist)
        });
      },
      fail: (err) => {
        // 用户主动取消不提示
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
        console.error('[onLocationPick] fail:', err);
        wx.showModal({
          title: '选点失败',
          content: (err && err.errMsg) || '请检查系统定位服务是否开启',
          showCancel: false
        });
      }
    });
  },

  // ── B6 人数/预算 ──
  decHeadcount() {
    if (this.data.form.headcount > CONFIG.HEADCOUNT[0]) {
      this.setData({ 'form.headcount': this.data.form.headcount - 1 });
    }
  },
  incHeadcount() {
    if (this.data.form.headcount < CONFIG.HEADCOUNT[1]) {
      this.setData({ 'form.headcount': this.data.form.headcount + 1 });
    }
  },
  onBudgetInput(e) {
    this.setData({ 'form.budget': e.detail.value });
  },

  // ── B7 AA费用 ──
  setAA(e) {
    const val = e.currentTarget.dataset.val;
    this.setData({ 'form.aa_estimate': val, 'form.aa_custom': '' });
  },
  onAACustomInput(e) {
    this.setData({ 'form.aa_custom': e.detail.value });
  },

  // ── B8 性别偏好 ──
  setGender(e) {
    this.setData({ 'form.gender_pref': e.currentTarget.dataset.val });
  },

  // ── B9 撮合模式 ──
  setMatchMode(e) {
    const code = e.currentTarget.dataset.code;
    // 从耍伴详情定向进入时锁定 direct, 不允许切换为其他模式
    if (this.invitePartnerOpenid) {
      wx.showToast({ title: '当前为定向邀约，仅该耍伴可接单', icon: 'none' });
      return;
    }
    if (code === 'smart' && this.data.smartLocked) {
      wx.showToast({ title: '智能派单为高信用耍伴/VIP会员专属', icon: 'none' });
      return;
    }
    // 手动选定向邀约: 弹确认明确告知不入公共大厅
    if (code === 'direct' && this.data.form.match_mode !== 'direct') {
      wx.showModal({
        title: '定向邀约说明',
        content: '定向邀约需求不会出现在公共大厅，只有指定的耍伴能看到并接单。请确保你已经在耍伴主页点击了「邀TA帮忙」。',
        confirmText: '知道了',
        showCancel: false
      });
    }
    this.setData({ 'form.match_mode': code });
  },

  // 定向邀约: 拉取受邀耍伴昵称用于横幅展示
  _fetchInvitePartner(openid) {
    callCloud('partner-action', { action: 'detail', partner_openid: openid }).then((r) => {
      if (r.ok && r.data && r.data.partner) {
        const p = r.data.partner;
        this.setData({ invitePartnerName: p.nickname || p.real_name || '指定耍伴' });
      }
    }).catch(() => {});
  },

  // ── 发布地址: 自动记录当前位置(网络定位), 用户不可手改, 仅可点击重新定位 ──
  _locatePublish(showToast) {
    if (this.data.locating) return;
    this.setData({ locating: true });
    wx.getLocation({
      type: 'gcj02',
      success: async (res) => {
        const now = new Date();
        const pub = {
          latitude: res.latitude,
          longitude: res.longitude,
          name: '当前位置',
          address: '',  // 逆地理编码回填, key 空则保持空
          updatedAt: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
        };
        const f = this.data.form;
        const dist = (Number(f.latitude) && Number(f.longitude))
          ? haversineKm(pub.latitude, pub.longitude, Number(f.latitude), Number(f.longitude))
          : 0;
        this.setData({
          locating: false,
          publishLocation: pub,
          distanceKm: dist,
          distanceText: fmtDist(dist)
        });
        // 逆地理编码(异步, 不阻塞页面; key 空则静默跳过)
        const addr = await reverseGeocode(pub.latitude, pub.longitude);
        if (addr) {
          this.setData({ 'publishLocation.address': addr });
        }
        if (showToast) wx.showToast({ title: '已重新定位', icon: 'success' });
      },
      fail: (err) => {
        this.setData({ locating: false });
        const msg = (err && err.errMsg) || 'unknown';
        if (/cancel/i.test(msg)) return;
        console.warn('[getLocation fail]', msg);
        // 权限被拒(含"不再询问") → 引导去设置开启, 恢复后自动重新定位
        if (/auth|deny|denied/i.test(msg)) {
          wx.showModal({
            title: '需要定位权限',
            content: '定位权限未开启, 是否前往设置开启?',
            confirmText: '去设置',
            cancelText: '手动选点',
            success: (r) => {
              if (!r.confirm) return this._offerManualPick();
              wx.openSetting({
                success: (s) => {
                  if (s.authSetting && s.authSetting['scope.userLocation']) {
                    this._locatePublish(true);
                  } else {
                    this._offerManualPick();
                  }
                },
                fail: () => this._offerManualPick()
              });
            }
          });
          return;
        }
        // 非权限类失败: 弹窗带出具体 errMsg, 现场可见根因
        this._offerManualPick(msg);
      }
    });
  },
  // 手动选点兜底弹窗(errMsg 附加展示, 便于现场定位根因)
  _offerManualPick(msg) {
    wx.showModal({
      title: '定位不可用',
      content: `定位失败(${msg || 'unknown'}), 是否在地图上手动选点?`,
      confirmText: '手动选点',
      cancelText: '跳过',
      success: (r) => {
        if (!r.confirm) return;
        wx.chooseLocation({
          success: async (loc) => {
            const now = new Date();
            const pub = {
              latitude: loc.latitude, longitude: loc.longitude,
              name: loc.name || '手动选点', address: loc.address || '',
              updatedAt: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
            };
            const f = this.data.form;
            const dist = (Number(f.latitude) && Number(f.longitude))
              ? haversineKm(pub.latitude, pub.longitude, Number(f.latitude), Number(f.longitude)) : 0;
            this.setData({ publishLocation: pub, distanceKm: dist, distanceText: fmtDist(dist) });
          },
          fail: () => wx.showToast({ title: '未选择位置', icon: 'none' })
        });
      }
    });
  },
  onRelocatePublish() {
    this._locatePublish(true);
  },

  // ── B10 自动保存(云端 upsert 草稿; 静默失败不打扰用户) ──
  startAutoSave() {
    this._saveTimer = setInterval(() => {
      const f = this.data.form;
      if (!f.title && !f.description) return;
      this._saveDraftCloud(true);
    }, CONFIG.DRAFT.autoSaveSec * 1000);
  },
  saveDraft() {
    const f = this.data.form;
    if (!f.title && !f.description) {
      wx.showToast({ title: '请先填写内容', icon: 'none' });
      return;
    }
    this._saveDraftCloud(false).then((d) => {
      if (d) wx.showToast({ title: `草稿已保存（有效期${CONFIG.DRAFT.expireDays}天）`, icon: 'success' });
    });
  },

  // ── B11 发布 ──
  onPublish() {
    if (this.data.publishing) return;
    const f = this.data.form;
    // 当前场景未签免责声明（如草稿恢复）→ 强制补弹场景专属免责声明
    const curScene = (this.data.scenes || []).find((s) => s.code === f.scene_code) || getScene(f.scene_code);
    if (curScene && !this.data.disclaimerChecked) {
      const disclaimer = curScene.disclaimer || this._defaultDisclaimer(curScene);
      this._showSceneDisclaimer({ disclaimer },
        () => {
          this.setData({ disclaimerChecked: true });
          this._continuePublish();
        },
        () => {
          wx.showToast({ title: '请同意免责声明后继续', icon: 'none' });
        }
      );
      return;
    }
    this._continuePublish();
  },
  // 实际执行 validate + AA 承诺书 wx.showModal(替代 bottom-sheet)
  _continuePublish() {
    const f = this.data.form;
    const errs = this.validatePublish(f);
    if (errs.length > 0) {
      wx.showToast({ title: errs[0], icon: 'none' });
      return;
    }
    const est = f.aa_estimate === 'custom' ? f.aa_custom : f.aa_estimate;
    wx.showModal({
      title: 'AA费用确认',
      content: `当前预估：${est}元\nAA（可能产生的额外费用）由双方线下自行协商结算，平台不代收、不担保、不仲裁：\n1. AA指交通费、餐费、门票等第三方费用，不含服务费；\n2. 平台不参与定价与结算；\n3. 因AA产生的纠纷，平台不承担调解、仲裁、赔偿责任。`,
      confirmText: this.__editMode ? '确认修改' : '确认发布',
      cancelText: this.__editMode ? '暂不修改' : '暂不发布',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (!res.confirm) return;
        this.confirmPublish();
      }
    });
  },

  validatePublish(f) {
    const errs = [];
    if (!f.scene_code) errs.push('请选择场景');
    if (!f.content_options || !f.content_options.length) errs.push('请选择服务内容');
    if (!f.title) errs.push('请输入标题');
    if (!f.description) errs.push('请输入描述');
    if (!f.service_date) errs.push('请选择日期');
    if (!f.service_time) errs.push('请选择时间');
    if (!f.duration_hours && !f.duration_custom) errs.push('请选择时长');
    if (!f.location_name) errs.push('请输入地点');
    if (f.project_attr === 'commercial') {
      const bv = redline.validateBudget(Number(f.budget), f.project_attr);
      if (!bv.ok) errs.push(bv.msg);
    }
    if (!f.aa_estimate) errs.push('请选择AA费用预估');
    // 敏感词
    const sen1 = detectSensitive(f.title);
    if (sen1) errs.push(sen1);
    const sen2 = detectSensitive(f.description);
    if (sen2) errs.push(sen2);
    // 18-22岁青年保护（文案由 redline 统一基于 CONFIG.YOUTH 返回）
    if (f.project_attr === 'commercial') {
      const dur = f.duration_hours || Number(f.duration_custom) || 0;
      const amount = Number(f.budget) * dur;
      const youth = redline.validateYouthAmount(amount, this.data.user.age);
      if (!youth.ok) {
        errs.push(`${youth.msg}，请缩短时长或降低费率`);
      }
    }
    return errs;
  },

  // 用户在 AA wx.showModal 确认后执行实际发布
  confirmPublish() {
    const { requireRealname, guardSwitch } = require('../../utils/bootstrap.js');
    if (!requireRealname('发布需求')) return;
    if (!guardSwitch('access')) return;
    const f = this.data.form;
    const durationH = f.duration_hours || Number(f.duration_custom) || 0;

    // 1. 发布地址必须为真实GPS(进入页面已自动定位); 未定位则 offer 手动选点
    let pub = this.data.publishLocation;
    if (!pub) {
      // getLocation 不可用时 offer chooseLocation 手动选点
      wx.showModal({
        title: '定位不可用',
        content: '无法自动获取发布地址, 是否在地图上手动选点?',
        confirmText: '手动选点',
        cancelText: '取消',
        success: (r) => {
          if (!r.confirm) return;
          wx.chooseLocation({
            success: (loc) => {
              pub = { latitude: loc.latitude, longitude: loc.longitude, name: loc.name || '手动选点', address: loc.address || '' };
              this.setData({ publishLocation: pub });
              this._doPublish(f, durationH, pub);
            },
            fail: () => wx.showToast({ title: '未选择位置,无法发布', icon: 'none' })
          });
        }
      });
      return;
    }

    // 2. 定向邀约校验: select 模式必须指定耍伴
    if (f.match_mode === 'direct' && !this.invitePartnerOpenid) {
      wx.showModal({
        title: '定向邀约缺少指定耍伴',
        content: '定向邀约模式需要指定一个已审核通过的耍伴, 或切换到广场广播模式。',
        confirmText: '切换广播',
        cancelText: '取消',
        success: (r) => {
          if (r.confirm) this.setData({ 'form.match_mode': 'broadcast' });
        }
      });
      return;
    }

    // 3. 前置距离校验: 发布位置 ↔ 履约地(有地图选点坐标时) ≤ 后台阈值, 服务端为最终准
    if (Number(f.latitude) && Number(f.longitude)) {
      const distKm = haversineKm(pub.latitude, pub.longitude, Number(f.latitude), Number(f.longitude));
      if (distKm > CONFIG.PUBLISH.distanceMaxKm) {
        wx.showModal({
          title: '距离超出允许范围',
          content: `你当前位置距履约地点约 ${Math.round(distKm)} 公里，超过 ${CONFIG.PUBLISH.distanceMaxKm} 公里。请确认履约地点，或到达当地后再发布。`,
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
    }

    this.setData({ publishing: true });
    this._doPublish(f, durationH, pub);
  },

  _doPublish(f, durationH, pubLoc) {
    // 服务内容: 用户在选择窗勾选(≥1 项, ≤3 项); 服务端 demand-publish 还会按场景 options 再校验一次
    const contentOptions = (f.content_options || []).slice(0, 3);

    // 服务开始时间 → 时间戳(本地时区组时间, 兼容 iOS; iOS 不支持 new Date('YYYY-MM-DDTHH:mm:ss'))
    const dateParts = String(f.service_date).split('-');
    const timeParts = String(f.service_time).split(':');
    const startTs = new Date(
      Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]),
      Number(timeParts[0]), Number(timeParts[1]) || 0, 0
    ).getTime();

    // 时薪 → 分（云函数 rate_fen 要求分单位）
    const rateFen = f.project_attr === 'public_welfare' ? 3000 : Math.round(Number(f.budget) * 100);

    // 履约地点坐标（如果用户选了点就有，否则兜底 0,0）
    const location = {
      name: f.location_name,
      address: f.location_name,
      latitude: f.latitude || 0,
      longitude: f.longitude || 0,
      city: '成都'
    };

    const params = {
      action: this.__editMode ? 'update' : 'publish',
      ...(this.__editMode ? { demand_id: this.__editDemandId } : {}),
      scene: f.scene_code,
      content_options: contentOptions,
      start_time: startTs,
      duration_h: durationH,
      location,
      // 发布地址: 新建时传真实GPS, 编辑模式传原发布地址(只读留痕不可改)
      publish_location: this.__editMode ? null : pubLoc,
      remark: `${f.title}｜${f.description}`,
      rate_fen: rateFen,
      aa_tier: f.aa_estimate,
      aa_promise_checked: true,
      disclaimer_signed: this.data.disclaimerChecked,
      match_mode: f.match_mode,
      target_openid: this.invitePartnerOpenid || '',
      draft_id: this.__draftId || ''
    };

    wx.cloud.callFunction({
      name: 'demand-publish',
      data: params,
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          const demandId = r.data._id;
          this.__draftId = null;
          this.invitePartnerOpenid = '';
          wx.showToast({
            title: this.__editMode
              ? '更新成功'
              : (f.match_mode === 'direct' ? '定向发布成功' : '发布成功'),
            icon: 'success'
          });
          setTimeout(() => {
            if (this.__editMode) {
              // 编辑成功 → 返回详情页(会自动 onShow 刷新)
              wx.navigateBack({ fail: () => {
                wx.redirectTo({ url: `/pages-v2/demand-detail/demand-detail?id=${demandId}` });
              }});
            } else {
              wx.redirectTo({
                url: `/pages-v2/demand-detail/demand-detail?id=${demandId}`,
                fail: () => {
                  wx.switchTab({
                    url: '/pages-v2/square/square',
                    fail: () => wx.showToast({ title: '发布成功，请在广场查看', icon: 'none' })
                  });
                }
              });
            }
          }, 800);
        } else {
          wx.showToast({ title: r.msg || '操作失败', icon: 'none', duration: 2500 });
          this.setData({ publishing: false });
        }
      },
      fail: (err) => {
        console.error('[confirmPublish] cloud fail:', err);
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
        this.setData({ publishing: false });
      }
    });
  },
  // 放弃修改(编辑模式): 二次确认后返回
  onGiveUpEdit() {
    wx.showModal({
      title: '放弃修改',
      content: '放弃本次修改？未保存的内容将丢失。',
      confirmText: '放弃修改',
      cancelText: '继续修改',
      success: (res) => {
        if (res.confirm) wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages-v2/square/square', fail: () => {} }) });
      }
    });
  },

  onReserve() { require('../../utils/redline.js').reserveNotice(); }
});
