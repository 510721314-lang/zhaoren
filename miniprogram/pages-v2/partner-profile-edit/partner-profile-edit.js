// 耍伴资料维护: bio/skills/highlights/资质证书/荣誉 其他 提交审核(后端 update_partner_profile)
// 资质证书/荣誉: 每条仅标题(titles), 图片为栏目级多图(photos 存云存储 fileID)
// 安全: 前端仅做表单与防抖, 内容安全/限频/并发幂等全部在云端(fail-closed)
// 图片上传: wx.chooseMedia → wx.cloud.uploadFile → 存 fileID, 随资料提交审核
const MEDIA_TITLE_MAX = 20;  // 资质/荣誉 标题条数上限
const MEDIA_PHOTO_MAX = 6;   // 资质/荣誉 图片张数上限
const MEDIA_TITLE_LEN = 20;  // 单条标题字数上限

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
    uploading: false
  },

  onLoad() {
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
          auditHistory: d.audit_history || []
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
    if (this.data.skills.length >= 10) return;
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
    if (this.data.highlights.length >= 3) {
      wx.showToast({ title: '最多 3 条服务亮点', icon: 'none' });
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
    if (this.data.qualTitles.length >= MEDIA_TITLE_MAX) {
      wx.showToast({ title: `最多 ${MEDIA_TITLE_MAX} 条`, icon: 'none' });
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
    if (this.data.honTitles.length >= MEDIA_TITLE_MAX) {
      wx.showToast({ title: `最多 ${MEDIA_TITLE_MAX} 条`, icon: 'none' });
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
    this.setData({ uploading: true });
    wx.showLoading({ title: '上传中…', mask: true });
    try {
      for (let i = 0; i < files.length; i++) {
        const name = String(files[i].tempFilePath || '').split('/').pop();
        const ext = (String(name.split('.').pop() || 'jpg')).toLowerCase();
        const cloudPath = `partner-cert/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
        const up = await wx.cloud.uploadFile({ cloudPath, filePath: files[i].tempFilePath });
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
    if (this.data.submitting || this.data.auditStatus === 'pending') return;
    const { bio, skills, highlights, qualTitles, qualPhotos, honTitles, honPhotos } = this.data;
    const hasMedia = (t, p) => t.length > 0 || p.length > 0;
    if (!bio.trim() && !skills.length && !highlights.length &&
        !hasMedia(qualTitles, qualPhotos) && !hasMedia(honTitles, honPhotos)) {
      wx.showToast({ title: '请至少填写一项', icon: 'none' });
      return;
    }
    this.setData({ submitting: true }); // debounce: 防双击
    callCloud('partner-action', {
      action: 'update_partner_profile',
      bio, skills, service_highlights: highlights,
      qual_titles: qualTitles, qual_photos: qualPhotos,
      hon_titles: honTitles, hon_photos: honPhotos
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