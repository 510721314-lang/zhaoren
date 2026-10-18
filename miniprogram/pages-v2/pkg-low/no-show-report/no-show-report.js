// @VERIFIED 2026-10-13 已真机验证：爽约申诉链路(提交→举证→裁定→撤回) + 时间窗口径(S2/S3.5 + 约定开始时间≤now≤开始+48h) + 时间线倒序展示（依据：project_memory L35-36, L181）
// 爽约申诉/举证页(第三批 3B) · submit=提交申诉 / defense=被诉方举证
// 入参: orderId(submit), mode('submit'|'defense'), reportId(defense 必传)
// 提交走 order-action: no_show_report_submit / no_show_report_defense; 服务端为准(时限/上限/内容安全)
// 数值: CONFIG.NO_SHOW(启动被 config_public.no_show 覆盖, 本地仅兜底)
const CONFIG = require('../../../config/index.js');

const { callCloud } = require('../../../utils/cloud.js');

// 申诉原因选项(设计稿 §2.6)
const REASON_OPTIONS = ['未出现', '迟到超30分钟', '中途离开', '其他'];

Page({
  data: {
    mode: 'submit',
    orderId: '',
    reportId: '',
    reasonOptions: REASON_OPTIONS,
    reasonType: '',
    reason: '',
    files: [],
    maxFiles: 3,
    minLen: 10,
    uploading: false,
    submitting: false
  },

  onLoad(options) {
    const mode = options.mode === 'defense' ? 'defense' : 'submit';
    const ns = CONFIG.NO_SHOW || {};
    wx.setNavigationBarTitle({ title: mode === 'defense' ? '提交举证' : '报告爽约' });
    this.setData({
      mode,
      orderId: options.orderId || '',
      reportId: options.reportId || '',
      maxFiles: Number(ns.evidenceMax) || 3,
      minLen: Number(ns.reasonMinLen) || 10
    });
    if (mode === 'submit' && !this.data.orderId) {
      wx.showToast({ title: '缺少订单信息', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
    }
    if (mode === 'defense' && !this.data.reportId) {
      wx.showToast({ title: '缺少申诉记录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
    }
  },

  onPickReason(e) {
    this.setData({ reasonType: e.currentTarget.dataset.r || '' });
  },
  onReasonInput(e) {
    this.setData({ reason: e.detail.value });
  },

  // 照片: chooseMedia + uploadFile(与 partner-profile-edit 同款)
  onAddPhoto() {
    const max = this.data.maxFiles;
    const remain = max - this.data.files.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${max} 张图片`, icon: 'none' });
      return;
    }
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => this.doUpload(res.tempFiles || []),
      fail: () => {
        // 2026-10-18 补: 隐私指引审核中/用户拒绝等失败场景不再静默, 给出可见提示
        wx.showToast({ title: '图片选择失败，请检查权限', icon: 'none' });
      }
    });
  },
  async doUpload(files) {
    if (!files.length) return;
    this.setData({ uploading: true });
    wx.showLoading({ title: '上传中…', mask: true });
    try {
      for (let i = 0; i < files.length; i++) {
        const name = String(files[i].tempFilePath || '').split('/').pop();
        const ext = (String(name.split('.').pop() || 'jpg')).toLowerCase();
        const cloudPath = `no-show/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
        const up = await wx.cloud.uploadFile({ cloudPath, filePath: files[i].tempFilePath });
        const arr = [...this.data.files, up.fileID].slice(0, this.data.maxFiles);
        this.setData({ files: arr });
      }
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('[no-show upload]', e);
      wx.showToast({ title: '图片上传失败', icon: 'none' });
    }
    this.setData({ uploading: false });
  },
  onDelPhoto(e) {
    const i = Number(e.currentTarget.dataset.i);
    const files = this.data.files.slice();
    files.splice(i, 1);
    this.setData({ files });
  },
  onPreview(e) {
    const i = Number(e.currentTarget.dataset.i);
    wx.previewImage({ current: this.data.files[i], urls: this.data.files });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const { mode, orderId, reportId, reason, reasonType, files, minLen } = this.data;
    const text = String(reason || '').trim();
    if (mode === 'submit' && !reasonType) {
      wx.showToast({ title: '请选择申诉原因', icon: 'none' });
      return;
    }
    if (!text) {
      wx.showToast({ title: mode === 'defense' ? '请填写举证说明' : '请填写申诉说明', icon: 'none' });
      return;
    }
    if (mode === 'submit' && text.length < minLen) {
      wx.showToast({ title: `申诉说明至少 ${minLen} 字`, icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中…', mask: true });
    const r = mode === 'defense'
      ? await callCloud('order-action', {
          action: 'no_show_report_defense', report_id: reportId,
          defense_reason: text, defense_file_ids: files
        })
      : await callCloud('order-action', {
          action: 'no_show_report_submit', order_id: orderId,
          reason: text, reason_type: reasonType, evidence_file_ids: files
        });
    wx.hideLoading();
    this.setData({ submitting: false });
    if (!r.ok) {
      wx.showToast({ title: r.msg || '提交失败', icon: 'none', duration: 2500 });
      return;
    }
    wx.showToast({ title: mode === 'defense' ? '举证已提交' : '申诉已提交', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 1200);
  }
});