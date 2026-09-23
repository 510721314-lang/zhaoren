// pages-v2/realname · 实名认证(正式版流程, P0 手写签名+留证)
// 流程: 真实姓名+身份证(AES-256-GCM 加密落库) → 人脸核验(测试期 mock) → 阅读并同意《服务协议》《费用自理承诺书》
//       → 手写签名(白底 PNG 直传云存储) → user-login submit_realname(服务端复算 SHA-256 + 协议全文 hash 落留证)
// 门禁: 未实名禁止发布需求/接单(客户端 requireRealname + 服务端 demand-publish/order-create 双保险)
// 人脸正式版: admin_config.realname_face_mode 切 'wx' 后走微信官方人脸核验(类目资质审批后接入)
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    statusBarHeight: 20,
    submitting: false,
    done: false,
    doneInfo: null,        // { methodText, signedAtText }
    // 表单
    form: { real_name: '', idcard: '' },
    // 人脸
    faceMode: CONFIG.REALNAME.faceMode,   // mock(测试期) / wx(正式, 资质到位后切)
    faceDone: false,
    // 协议
    legal: { serviceAgreement: '', aaPromise: '' },
    legalLoaded: false,
    showAgreement: false,
    showPromise: false,
    agreed: false,
    // 其他
    isRedline: false
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    } catch (e) {}
    this._loadLegal();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    this._refreshDoneState();
  },

  // 已实名状态(登录态唯一来源: globalData/storage 的 userInfo, 由 user-login 写入)
  _refreshDoneState() {
    let u = null;
    try {
      const app = getApp();
      u = (app && app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo') || null;
    } catch (e) {}
    if (u && u.is_realname_done) {
      const methodText = u.realname_method === 'mock_face'
        ? '模拟人脸核验（测试期）'
        : (u.realname_method ? '人脸核验' : '');
      let signedAtText = '';
      if (u.realname_done_at) {
        const d = new Date(u.realname_done_at);
        signedAtText = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      }
      this.setData({ done: true, doneInfo: { methodText, signedAtText } });
    } else {
      this.setData({ done: false, doneInfo: null });
    }
  },

  // 协议全文: 与留证 hash 同源(云端 admin_config.legal_*); 失败走本地兜底
  _loadLegal() {
    callCloud('admin-action', { action: 'config_public' }).then((r) => {
      const d = (r && r.data) || {};
      const lp = d.legal_public || {};
      const rm = d.realname || {};
      this.setData({
        faceMode: rm.face_mode || CONFIG.REALNAME.faceMode,
        legal: {
          serviceAgreement: lp.service_agreement || CONFIG.LEGAL_FALLBACK.serviceAgreement,
          aaPromise: lp.aa_promise || CONFIG.LEGAL_FALLBACK.aaPromise
        },
        legalLoaded: true
      });
    }).catch(() => {
      this.setData({
        legal: {
          serviceAgreement: CONFIG.LEGAL_FALLBACK.serviceAgreement,
          aaPromise: CONFIG.LEGAL_FALLBACK.aaPromise
        },
        legalLoaded: true
      });
    });
  },

  onReserve() { redline.reserveNotice(); },

  // ── 表单输入 ──
  onNameInput(e) {
    this.setData({ 'form.real_name': e.detail.value || '' });
  },
  onIdcardInput(e) {
    const v = String(e.detail.value || '').replace(/\s/g, '').toUpperCase();
    this.setData({ 'form.idcard': v });
  },

  // ── 协议展开/收起 ──
  toggleAgreement() { this.setData({ showAgreement: !this.data.showAgreement }); },
  togglePromise() { this.setData({ showPromise: !this.data.showPromise }); },
  onAgreeChange(e) {
    this.setData({ agreed: (e.detail.value || []).length > 0 });
  },

  // ── 人脸核验 ──
  onFaceVerify() {
    if (this.data.faceDone) return;
    if (this.data.faceMode === 'wx') {
      // 正式版: 微信官方人脸核身(需类目资质审批, 上线前接入; 测试期不会走到这里)
      wx.showModal({
        title: '人脸核验',
        content: '正式人脸核验通道即将开放，请稍后再试。',
        showCancel: false
      });
      return;
    }
    wx.showModal({
      title: '模拟人脸核验（测试期）',
      content: '测试期人脸核验以模拟方式通过：不采集人脸信息，仅用于流程联调。正式上线后将切换为微信官方人脸核验。',
      confirmText: '模拟通过',
      cancelText: '取消',
      success: (r) => { if (r.confirm) this.setData({ faceDone: true }); }
    });
  },

  // ── 清除签名 ──
  onClearSign() {
    const sig = this.selectComponent('#sig');
    if (sig) sig.clear();
  },

  // ── 提交 ──
  _validate() {
    const f = this.data.form;
    const errs = [];
    if (!/^[\u4e00-\u9fa5A-Za-z·\s]{2,20}$/.test(String(f.real_name || '').trim())) {
      errs.push('请输入真实姓名(2-20位中文或字母)');
    }
    if (!/^\d{17}[\dX]$/.test(String(f.idcard || ''))) {
      errs.push('请输入18位有效身份证号');
    }
    if (!this.data.faceDone) errs.push('请先完成人脸核验');
    if (!this.data.agreed) errs.push('请阅读并同意《服务协议》与《费用自理承诺书》');
    return errs;
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const errs = this._validate();
    if (errs.length) {
      wx.showToast({ title: errs[0], icon: 'none' });
      return;
    }
    const sig = this.selectComponent('#sig');
    if (!sig || sig.isEmpty()) {
      wx.showToast({ title: '请手写签名后再提交', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中', mask: true });

    let fileID = '';
    try {
      const tempPath = await sig.exportPNG();
      fileID = await this._uploadSignature(tempPath);
      const f = this.data.form;
      const r = await callCloud('user-login', {
        action: 'submit_realname',
        real_name: String(f.real_name || '').trim(),
        idcard: String(f.idcard || ''),
        signature_file_id: fileID,
        docs_ack: true
      });
      wx.hideLoading();
      this.setData({ submitting: false });
      if (!r.ok || !r.data || !r.data.user) {
        // 服务端拒绝: 清掉刚上传的签名图, 避免孤儿文件
        this._cleanupUploaded(fileID);
        wx.showToast({ title: r.msg || '认证失败,请重试', icon: 'none', duration: 2500 });
        return;
      }
      // 持久化登录态(与登录流程一致: app.setLoginUser -> globalData + storage)
      try {
        const app = getApp();
        if (app && app.setLoginUser) app.setLoginUser(r.data.user);
      } catch (e) {}
      try { require('../../utils/bootstrap.js').clearRealnamePending(); } catch (e) {}
      this.setData({ done: true });
      this._refreshDoneState();
      wx.showToast({ title: '实名认证已通过', icon: 'success' });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 1200);
    } catch (e) {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (e && e.message === 'empty_signature') {
        wx.showToast({ title: '请手写签名后再提交', icon: 'none' });
        return;
      }
      console.error('[realname] submit fail:', e);
      wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    }
  },

  // 签名图直传云存储(白底 PNG)
  _uploadSignature(tempPath) {
    const rand = Math.random().toString(36).slice(2, 8);
    const cloudPath = 'sign_evidence/realname_' + Date.now() + '_' + rand + '.png';
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
        success: (up) => resolve(up.fileID),
        fail: (err) => reject(err)
      });
    });
  },

  _cleanupUploaded(fileID) {
    if (!fileID) return;
    try {
      wx.cloud.deleteFile({ fileList: [fileID] });
    } catch (e) {}
  }
});