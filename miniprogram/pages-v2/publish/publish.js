// PRD章节: 3.3 需求发布 / 3.3.1 场景与撮合 / 3.5.1-V15 AA费用 / 1.5 公益 / R1时间红线 / R9场景白名单
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { SCENES, MATCH_MODE, CREDIT_LEVEL, AA_ESTIMATE_LABEL } = require('../../config/enums.js');
const { drafts: MOCK_DRAFTS } = require('../../mock/drafts.js');

// 智能派单门槛 = L3 优质等级下限（PRD 3.1.2）
const L3_MIN = (CREDIT_LEVEL.find((l) => l.level === 'L3') || {}).min || 900;

// 敏感词检测：手机号/微信号
function detectSensitive(text) {
  if (!text) return null;
  const phone = text.match(/1[3-9]\d{9}/);
  if (phone) return '内容包含手机号格式，请删除后重试';
  const wechat = text.match(/[vV微][xX信]/);
  if (wechat) return '内容包含微信号信息，请删除后重试';
  return null;
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

    // B3 免责声明
    disclaimerVisible: false,
    disclaimerChecked: false,
    // B9 智能派单
    smartLocked: true,  // mock用户非L3且非会员 → 置灰
    // B10 自动保存
    autoSaveText: '',
    autoSaveSec: CONFIG.DRAFT.autoSaveSec,
    // B1 草稿箱
    draftBoxVisible: false,
    draftList: MOCK_DRAFTS,
    draftCount: MOCK_DRAFTS.length,
    // AA确认弹窗
    aaSheetVisible: false,
    aaCommitChecked: false,
    // 发布中
    publishing: false,
    today: '',
    dateMax: '',
    isRedline: false,
    // C 可运营参数（供 WXML 绑定）
    redlineOpen: CONFIG.TIME_REDLINE.open,
    redlineClose: CONFIG.TIME_REDLINE.close,
    titleMax: CONFIG.TITLE_MAX,
    descMax: CONFIG.DESC_MAX,
    draftExpireDays: CONFIG.DRAFT.expireDays,
    budgetPlaceholder: `${CONFIG.BUDGET_RANGE[0]}-${CONFIG.BUDGET_RANGE[1]}`,
    welfareText: `公益规则：每月${CONFIG.WELFARE.monthlyQuota}单额度 · 每人每月限${CONFIG.WELFARE.perUserQuota}单 · 耍伴按标准单价${CONFIG.WELFARE.partnerSubsidyRate * 100}%获得平台补贴`
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
    if (options.sceneCode) {
      this.setScene({ code: options.sceneCode });
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
  openDraftBox() {
    this.setData({ draftBoxVisible: true });
  },
  closeDraftBox() {
    this.setData({ draftBoxVisible: false });
  },
  restoreDraft(e) {
    const idx = e.currentTarget.dataset.index;
    const draft = this.data.draftList[idx];
    if (!draft) return;
    const d = draft.demand_data;
    this.setData({
      form: {
        project_attr: d.project_attr || 'commercial',
        scene_code: d.scene_code || '',
        title: d.title || '',
        description: d.description || '',
        service_date: d.service_date || '',
        service_time: d.service_time || '',
        duration_hours: d.duration_hours || 3,
        duration_custom: '',
        location_name: d.location ? d.location.name : '',
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
    const scene = SCENES.find((s) => s.code === code);
    if (!scene) return;
    const form = Object.assign({}, this.data.form);
    form.scene_code = code;
    // 每个场景都有对应免责声明（与云函数 DISCLAIMER_TYPE_MAP 对齐）→ wx.showModal 弹场景专属文案
    this._showSceneDisclaimer(scene,
      () => { this.setData({ form, disclaimerChecked: true }); },
      () => {
        // 不同意 → 取消场景选择
        form.scene_code = '';
        this.setData({ form, disclaimerChecked: false });
        wx.showToast({ title: '请同意免责声明后继续', icon: 'none' });
      }
    );
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
  toggleDisclaimer() {
    this.setData({ disclaimerChecked: !this.data.disclaimerChecked });
  },
  closeDisclaimer() {
    if (!this.data.disclaimerChecked) {
      const form = Object.assign({}, this.data.form);
      form.scene_code = '';
      this.setData({ form, disclaimerVisible: false });
    } else {
      this.setData({ disclaimerVisible: false });
    }
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
      wx.showToast({ title: `须满足时间红线${CONFIG.TIME_REDLINE.close}-${CONFIG.TIME_REDLINE.open}`, icon: 'none' });
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
        this.setData({
          'form.location_name': res.name || res.address,
          'form.latitude': res.latitude,
          'form.longitude': res.longitude
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
    if (code === 'smart' && this.data.smartLocked) {
      wx.showToast({ title: '智能派单为高信用耍伴/VIP会员专属', icon: 'none' });
      return;
    }
    this.setData({ 'form.match_mode': code });
  },

  // ── B10 自动保存 ──
  startAutoSave() {
    this._saveTimer = setInterval(() => {
      const f = this.data.form;
      if (!f.title && !f.description) return;
      this.setData({ autoSaveText: `${CONFIG.DRAFT.autoSaveSec}秒前` });
    }, CONFIG.DRAFT.autoSaveSec * 1000);
  },
  saveDraft() {
    const f = this.data.form;
    if (!f.title && !f.description) {
      wx.showToast({ title: '请先填写内容', icon: 'none' });
      return;
    }
    wx.showToast({ title: `草稿已保存（有效期${CONFIG.DRAFT.expireDays}天）`, icon: 'success' });
  },

  // ── B11 发布 ──
  onPublish() {
    if (this.data.publishing) return;
    const f = this.data.form;
    // 当前场景未签免责声明（如草稿恢复）→ 强制补弹场景专属免责声明
    const curScene = SCENES.find((s) => s.code === f.scene_code);
    if (curScene && curScene.disclaimer && !this.data.disclaimerChecked) {
      this._showSceneDisclaimer(curScene,
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
  // 实际执行 validate + AA 弹窗
  _continuePublish() {
    const f = this.data.form;
    const errs = this.validatePublish(f);
    if (errs.length > 0) {
      wx.showToast({ title: errs[0], icon: 'none' });
      return;
    }
    this.setData({ aaSheetVisible: true });
  },

  validatePublish(f) {
    const errs = [];
    if (!f.scene_code) errs.push('请选择场景');
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

  // AA 弹窗
  toggleAACommit() {
    this.setData({ aaCommitChecked: !this.data.aaCommitChecked });
  },
  closeAASheet() {
    this.setData({ aaSheetVisible: false });
  },
  confirmPublish() {
    if (!this.data.aaCommitChecked) return;
    this.setData({ aaSheetVisible: false, publishing: true });
    const f = this.data.form;
    const durationH = f.duration_hours || Number(f.duration_custom) || 0;

    // 1. 先取发布地址 GPS（publish_location）
    wx.getLocation({
      type: 'gcj02',
      success: (loc) => {
        this._doPublish(f, durationH, {
          latitude: loc.latitude,
          longitude: loc.longitude,
          name: '当前位置',
          city: '成都'
        });
      },
      fail: (err) => {
        // 真机定位失败 → 提示用户但不阻塞（部分用户没开定位权限）
        console.warn('[confirmPublish] getLocation fail:', err);
        wx.showModal({
          title: '发布地址获取失败',
          content: '发布地址将使用履约地点代替，建议开启定位权限',
          confirmText: '继续发布',
          success: (r) => {
            if (r.confirm) {
              this._doPublish(f, durationH, null);
            } else {
              this.setData({ publishing: false });
            }
          },
          fail: () => {
            this.setData({ publishing: false });
          }
        });
      }
    });
  },

  _doPublish(f, durationH, pubLoc) {
    // 场景子服务选项（前端无单独选择 UI → 用场景全选兜底）
    const scene = SCENES.find((s) => s.code === f.scene_code);
    const contentOptions = scene && scene.options ? scene.options : [];

    // 服务开始时间 → 时间戳
    const startTs = new Date(`${f.service_date}T${f.service_time}:00`).getTime();

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
      action: 'publish',
      scene: f.scene_code,
      content_options: contentOptions,
      start_time: startTs,
      duration_h: durationH,
      location,
      publish_location: pubLoc || location,
      remark: `${f.title}｜${f.description}`,
      rate_fen: rateFen,
      aa_tier: f.aa_estimate,
      aa_promise_checked: this.data.aaCommitChecked,
      disclaimer_signed: this.data.disclaimerChecked,
      match_mode: f.match_mode
    };

    console.log('[confirmPublish] → demand-publish:', { action: 'publish', scene: params.scene });

    wx.cloud.callFunction({
      name: 'demand-publish',
      data: params,
      success: (res) => {
        const r = res.result || {};
        if (r.ok && r.data) {
          const demandId = r.data._id;
          wx.showToast({ title: '发布成功', icon: 'success' });
          setTimeout(() => {
            wx.redirectTo({
              url: `/pages-v2/demand-detail/demand-detail?id=${demandId}`,
              fail: () => {
                wx.redirectTo({
                  url: `/pages/match/match?demand_id=${demandId}`,
                  fail: () => wx.showToast({ title: '发布成功，请在广场查看', icon: 'none' })
                });
              }
            });
          }, 800);
        } else {
          wx.showToast({ title: r.msg || '发布失败', icon: 'none', duration: 2500 });
          this.setData({ publishing: false });
        }
      },
      fail: (err) => {
        console.error('[confirmPublish] cloud fail:', err);
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
        this.setData({ publishing: false });
      }
    });
  }
});
