// 耍伴资料维护: bio/skills/highlights/资质证书/荣誉 其他 提交审核(后端 update_partner_profile)
// 资质证书/荣誉: 每条仅标题(titles), 图片为栏目级多图(photos 存云存储 fileID)
// 安全: 前端仅做表单与防抖, 内容安全/限频/并发幂等全部在云端(fail-closed)
// 图片上传: wx.chooseMedia → wx.cloud.uploadFile → 存 fileID, 随资料提交审核
// 图片张数与单张大小固定(安全上限, 不后台化)
const MEDIA_PHOTO_MAX = 6;   // 资质/荣誉 图片张数上限
const MEDIA_PHOTO_MAX_SIZE = 3 * 1024 * 1024; // 单张图片大小上限 3M
// 数量/字数限制默认值(与后端 PARTNER_LIMITS_FALLBACK 一致; 运行时被 admin-action config_public.partner_profile 覆盖)
const LIMITS_FALLBACK = {
  skills_max: 10, skills_len: 12,
  highlights_max: 3, highlight_len: 30,
  media_title_max: 20, media_len: 20
};

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => {
    console.error('[cloud]', name, e && e.message);
    return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' };
  });
}

Page({
  data: {
    bio: '',
    skills: [],
    highlights: [],
    skillInput: '',
    highlightInput: '',
    // 资质证书
    qualTitles: [],
    qualPhotos: [],
    qualInput: '',
    // 荣誉 其他
    honTitles: [],
    honPhotos: [],
    honInput: '',
    auditStatus: '',      // '' | pending | approved | rejected
    rejectReason: '',
    pendingBio: '',       // 本次待审核内容(提交后回显)
    pendingSkills: [],
    pendingHighlights: [],
    qualPending: { titles: [], photos: [] },  // 待审的资质证书(仅展示)
    honPending: { titles: [], photos: [] },    // 待审的荣誉(仅展示)
    auditHistory: [],     // 审核历史 [{at,result,by,reason}]
    submitting: false,
    uploading: false,
    // 数量/字数限制(初值=默认, 拉取 config_public 后覆盖; 供校验与 WXML 计数/maxlength 使用)
    limits: { ...LIMITS_FALLBACK }
  },

  onLoad() {
    // 并行拉取后台可配的资料限制(config_public.partner_profile), 失败走默认不漂移
    callCloud('admin-action', { action: 'config_public' }).then((r) => {
      const p = r && r.ok && r.data && r.data.partner_profile;
      if (p) {
        const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
        this.setData({
          limits: {
            skills_max: num(p.skills_max, 10),
            skills_len: num(p.skills_len, 12),
            highlights_max: num(p.highlights_max, 3),
            highlight_len: num(p.highlight_len, 30),
            media_title_max: num(p.media_title_max, 20),
            media_len: num(p.media_len, 20)
          }
        });
      }
    });
    // 回显当前已审核快照 + 审核状态 + 待审内容 + 审核历史
    callCloud('partner-action', { action: 'my_profile' }).then((res) => {
      if (res.ok && res.data && res.data.profile) {
        const d = res.data.profile;
        // 资质/荣誉编辑回显: 有待审则用待审(保留已提交未过审内容), 否则用已审快照
        const pick = (pending, snap) => {
          const p = pending || { titles: [], photos: [] };
          const s = snap || { titles: [], photos: [] };
          return (p.titles.length > 0 || p.photos.length > 0) ? p : s;
        };
        const qual = pick(d.qualifications_pending, d.qualifications);
        const hon = pick(d.honors_pending, d.honors);
        this.setData({
          bio: d.bio || '',
          skills: d.skills || [],
          highlights: d.service_highlights || [],
          qualTitles: qual.titles || [],
          qualPhotos: qual.photos || [],
          honTitles: hon.titles || [],
          honPhotos: hon.photos || [],
          auditStatus: d.profile_audit_status || '',
          rejectReason: d.profile_reject_reason || '',
          pendingBio: d.bio_pending || '',
          pendingSkills: d.skills_pending || [],
          pendingHighlights: d.highlights_pending || [],
          qualPending: d.qualifications_pending || { titles: [], photos: [] },
          honPending: d.honors_pending || { titles: [], photos: [] },
          // WXML {{}} 不能调 Page 方法: 时间在 JS 预计算为 timeStr (0a427a4 遗留修复)
          auditHistory: (d.audit_history || []).map((it) => ({ ...it, timeStr: this.fmtTime(it.at) }))
        });
      }
    });
  },

  onBioInput(e) { this.setData({ bio: e.detail.value }); },
  onSkillInput(e) { this.setData({ skillInput: e.detail.value }); },
  onHighlightInput(e) { this.setData({ highlightInput: e.detail.value }); },
  onQualInput(e) { this.setData({ qualInput: e.detail.value }); },
  onHonInput(e) { this.setData({ honInput: e.detail.value }); },

  // 审核历史时间格式化: 时间戳 → MM-DD HH:mm
  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  onAddSkill() {
    const v = (this.data.skillInput || '').trim();
    if (!v) return;
    if (this.data.skills.indexOf(v) >= 0) {
      wx.showToast({ title: '标签已存在', icon: 'none' });
      return;
    }
    if (this.data.skills.length >= this.data.limits.skills_max) {
      wx.showToast({ title: `最多 ${this.data.limits.skills_max} 个标签`, icon: 'none' });
      return;
    }
    this.setData({ skills: [...this.data.skills, v], skillInput: '' });
  },
  onRemoveSkill(e) {
    const i = Number(e.currentTarget.dataset.index);
    const arr = this.data.skills.slice();
    arr.splice(i, 1);
    this.setData({ skills: arr });
  },

  onAddHighlight() {
    const v = (this.data.highlightInput || '').trim();
    if (!v) return;
    if (this.data.highlights.length >= this.data.limits.highlights_max) {
      wx.showToast({ title: `最多 ${this.data.limits.highlights_max} 条服务亮点`, icon: 'none' });
      return;
    }
    this.setData({ highlights: [...this.data.highlights, v], highlightInput: '' });
  },
  onRemoveHighlight(e) {
    const i = Number(e.currentTarget.dataset.index);
    const arr = this.data.highlights.slice();
    arr.splice(i, 1);
    this.setData({ highlights: arr });
  },

  // ── 资质证书 / 荣誉 其他: 标题增删 ──
  onAddQual() {
    const v = (this.data.qualInput || '').trim();
    if (!v) return;
    if (this.data.qualTitles.length >= this.data.limits.media_title_max) {
      wx.showToast({ title: `最多 ${this.data.limits.media_title_max} 条`, icon: 'none' });
      return;
    }
    this.setData({ qualTitles: [...this.data.qualTitles, v], qualInput: '' });
  },
  onRemoveQual(e) {
    const i = Number(e.currentTarget.dataset.index);
    const arr = this.data.qualTitles.slice();
    arr.splice(i, 1);
    this.setData({ qualTitles: arr });
  },
  onAddHon() {
    const v = (this.data.honInput || '').trim();
    if (!v) return;
    if (this.data.honTitles.length >= this.data.limits.media_title_max) {
      wx.showToast({ title: `最多 ${this.data.limits.media_title_max} 条`, icon: 'none' });
      return;
    }
    this.setData({ honTitles: [...this.data.honTitles, v], honInput: '' });
  },
  onRemoveHon(e) {
    const i = Number(e.currentTarget.dataset.index);
    const arr = this.data.honTitles.slice();
    arr.splice(i, 1);
    this.setData({ honTitles: arr });
  },

  // ── 资质证书 / 荣誉 其他: 栏目级多图上传(存 fileID) ──
  chooseQualPhotos() { this.choosePhotos('qual'); },
  chooseHonPhotos() { this.choosePhotos('hon'); },
  // 点击图片查看大图(证件/荣誉图刚需)
  previewQualPhoto(e) {
    const photos = this.data.qualPhotos;
    const i = Number(e.currentTarget.dataset.index);
    wx.previewImage({ current: photos[i], urls: photos });
  },
  previewHonPhoto(e) {
    const photos = this.data.honPhotos;
    const i = Number(e.currentTarget.dataset.index);
    wx.previewImage({ current: photos[i], urls: photos });
  },
  choosePhotos(key) {
    const field = key + 'Photos';
    const prev = this.data[field] || [];
    const remain = MEDIA_PHOTO_MAX - prev.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${MEDIA_PHOTO_MAX} 张图片`, icon: 'none' });
      return;
    }
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => this.doUpload(key, res.tempFiles || [])
    });
  },
  async doUpload(key, files) {
    const field = key + 'Photos';
    const MAX_SIZE = MEDIA_PHOTO_MAX_SIZE; // 单张 3M 上限
    // 过滤超限图片(单张 > 3M): 提示并被跳过, 其余正常上传
    const oversized = files.filter((f) => (Number(f.size) || 0) > MAX_SIZE).length;
    const valid = files.filter((f) => (Number(f.size) || 0) <= MAX_SIZE);
    this.setData({ uploading: true });
    if (oversized > 0) {
      wx.showToast({ title: `${oversized} 张图片超过 3M 已忽略`, icon: 'none', duration: 2500 });
    } else {
      wx.showLoading({ title: '上传中…', mask: true });
    }
    try {
      for (let i = 0; i < valid.length; i++) {
        const name = String(valid[i].tempFilePath || '').split('/').pop();
        const ext = (String(name.split('.').pop() || 'jpg')).toLowerCase();
        const cloudPath = `partner-cert/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
        const up = await wx.cloud.uploadFile({ cloudPath, filePath: valid[i].tempFilePath });
        const arr = [...(this.data[field] || []), up.fileID].slice(0, MEDIA_PHOTO_MAX);
        this.setData({ [field]: arr });
      }
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('[upload]', e);
      wx.showToast({ title: '图片上传失败', icon: 'none' });
    }
    this.setData({ uploading: false });
  },
  onRemoveQualPhoto(e) { this.removePhoto('qual', e); },
  onRemoveHonPhoto(e) { this.removePhoto('hon', e); },
  removePhoto(key, e) {
    const field = key + 'Photos';
    const i = Number(e.currentTarget.dataset.index);
    const arr = (this.data[field] || []).slice();
    arr.splice(i, 1);
    this.setData({ [field]: arr });
  },

  onSubmit() {
    // 全量提交(等价"提交全部栏目"); 逐栏独立提交见 onSubmitField
    this.doSubmit({
      bio: this.data.bio, skills: this.data.skills, highlights: this.data.highlights,
      qual_titles: this.data.qualTitles, qual_photos: this.data.qualPhotos,
      hon_titles: this.data.honTitles, hon_photos: this.data.honPhotos
    });
  },
  // 每项独立提交: 只提交某栏目(其余栏目置空; 全局校验"该栏目有内容")
  // 全局 pending 锁保证此刻无其他栏目在审, 置空安全(未提交栏由 my_profile pick() 回显快照兜底)
  onSubmitField(e) {
    const which = e.currentTarget.dataset.which;
    const base = { bio: '', skills: [], highlights: [], qual_titles: [], qual_photos: [], hon_titles: [], hon_photos: [] };
    const has = (arr) => (arr && arr.length > 0);
    if (which === 'bio') base.bio = this.data.bio;
    else if (which === 'skills') base.skills = this.data.skills;
    else if (which === 'highlights') base.highlights = this.data.highlights;
    else if (which === 'qual') { base.qual_titles = this.data.qualTitles; base.qual_photos = this.data.qualPhotos; }
    else if (which === 'hon') { base.hon_titles = this.data.honTitles; base.hon_photos = this.data.honPhotos; }
    const empty = !base.bio.trim() && !base.skills.length && !base.highlights.length &&
      !has(base.qual_titles) && !has(base.qual_photos) && !has(base.hon_titles) && !has(base.hon_photos);
    if (empty) { wx.showToast({ title: '该栏目暂无内容可提交', icon: 'none' }); return; }
    this.doSubmit(base);
  },
  doSubmit(payload) {
    if (this.data.submitting) return;
    if (this.data.auditStatus === 'pending') {
      wx.showToast({ title: '资料正在审核中,请耐心等待', icon: 'none' });
      return;
    }
    this.setData({ submitting: true }); // debounce: 防双击
    callCloud('partner-action', {
      action: 'update_partner_profile',
      bio: payload.bio || '', skills: payload.skills || [], service_highlights: payload.highlights || [],
      qual_titles: payload.qual_titles || [], qual_photos: payload.qual_photos || [],
      hon_titles: payload.hon_titles || [], hon_photos: payload.hon_photos || []
    }).then((res) => {
      this.setData({ submitting: false });
      if (res.ok) {
        this.setData({ auditStatus: 'pending' });
        wx.showToast({ title: '已提交审核', icon: 'success' });
      } else {
        wx.showToast({ title: res.msg || '提交失败', icon: 'none' });
      }
    });
  }
});