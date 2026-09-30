// 耍伴资料维护: bio/skills/highlights 提交审核(后端 update_partner_profile)
// 安全: 前端仅做表单与防抖, 内容安全/限频/并发幂等全部在云端(fail-closed)
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
    auditStatus: '',      // '' | pending | approved | rejected
    rejectReason: '',
    pendingBio: '',       // 本次待审核内容(提交后回显)
    pendingSkills: [],
    pendingHighlights: [],
    auditHistory: [],     // 审核历史 [{at,result,by,reason}]
    submitting: false
  },

  onLoad() {
    // 回显当前已审核快照 + 审核状态 + 待审内容 + 审核历史
    callCloud('partner-action', { action: 'my_profile' }).then((res) => {
      if (res.ok && res.data && res.data.profile) {
        const d = res.data.profile;
        this.setData({
          bio: d.bio || '',
          skills: d.skills || [],
          highlights: d.service_highlights || [],
          auditStatus: d.profile_audit_status || '',
          rejectReason: d.profile_reject_reason || '',
          pendingBio: d.bio_pending || '',
          pendingSkills: d.skills_pending || [],
          pendingHighlights: d.highlights_pending || [],
          auditHistory: d.audit_history || []
        });
      }
    });
  },

  onBioInput(e) { this.setData({ bio: e.detail.value }); },
  onSkillInput(e) { this.setData({ skillInput: e.detail.value }); },
  onHighlightInput(e) { this.setData({ highlightInput: e.detail.value }); },

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

  onSubmit() {
    if (this.data.submitting || this.data.auditStatus === 'pending') return;
    const { bio, skills, highlights } = this.data;
    if (!bio.trim() && !skills.length && !highlights.length) {
      wx.showToast({ title: '请至少填写一项', icon: 'none' });
      return;
    }
    this.setData({ submitting: true }); // debounce: 防双击
    callCloud('partner-action', {
      action: 'update_partner_profile',
      bio, skills, service_highlights: highlights
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
