// v2 耍伴申请 (最简版)
// 调 partner-action.apply: 加 roles + upsert partner_profile
// 成功后调 user-login.peek_login 刷新用户态 → switchTab 到我的
const CONFIG = require('../../../config/index.js');
const { SCENES } = require('../../../config/enums.js');

const { callCloud } = require('../../../utils/cloud.js');

Page({
  data: {
    chainBar: null,    // 批3c: 入驻链条(第 x/8 步); 非链内进入为 null
    scenes: [],        // [{ code, name, emoji, selected }]
    homeLocation: null, // { name, address, latitude, longitude } gcj02
    submitting: false,
    alreadyPartner: false,
    // 已提交状态回显(2026-10-21): 审核中/被驳回时不再让用户盲提交
    applyStatus: '',   // '' | 'pending_review' | 'rejected' | 'approved'
    rejectNote: ''
  },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  },


  onLoad(query) {
    // 批3c(2026-10-23): 从入驻链进入时展示步骤条(第 7/8 步), 并确保草稿档存在
    const chain = require('../../../utils/onboard-chain.js');
    this.setData({ chainBar: chain.barOf('apply', (query && query.from) || '') });
    if ((query && query.from) === 'chain') chain.ensureDraft();
    const user = wx.getStorageSync('user_info') || {};
    const roles = user.roles || [];
    const isPartner = roles.includes('partner');

    const scenes = SCENES.map((s) => ({
      code: s.code,
      name: s.name,
      emoji: s.emoji,
      selected: false
    }));
    this.setData({ scenes, alreadyPartner: isPartner });
  },

  onShow() {
    // 服务端权威状态: 审核中/驳回原因/已通过, 回显到顶部横幅
    require('../../../utils/take-order.js').fetchTakeReadiness('', true).then((rd) => {
      if (!rd || !rd.has_profile) return;
      this.setData({
        applyStatus: rd.profile_status || '',
        rejectNote: rd.review_note || '',
        alreadyPartner: rd.profile_status === 'approved' || rd.is_partner === true
      });
    }).catch(() => {});
  },

  onToggleScene(e) {
    const idx = e.currentTarget.dataset.index;
    const scenes = this.data.scenes;
    scenes[idx].selected = !scenes[idx].selected;
    this.setData({ scenes });
  },

  // 选择日常位置(注册时确定, 详情页据此展示距离与到达耗时)
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

  async onSubmit() {
    if (this.data.submitting) return;
    const selected = this.data.scenes.filter((s) => s.selected).map((s) => s.code);
    if (selected.length === 0) {
      wx.showToast({ title: '请至少选择一个场景', icon: 'none' });
      return;
    }
    if (!this.data.homeLocation) {
      wx.showToast({ title: '请选择日常位置', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '申请中...', mask: true });

    try {
      const r = await callCloud('partner-action', {
        action: 'apply',
        accept_scenes: selected,
        home_location: this.data.homeLocation
      });
      wx.hideLoading();
      if (r.ok) {
        const d = r.data || {};
        // 资格探针缓存失效(审核状态刚变)
        try { require('../../../utils/take-order.js').invalidateTakeReadiness(); } catch (_) {}
        // 刷新用户态
        try {
          await callCloud('user-login', { action: 'peek_login' });
        } catch (_) {}
        wx.removeStorageSync('v2_login_ok');
        if (d.pending_review) {
          wx.showModal({
            title: '申请已提交',
            content: '耍伴入驻需管理员审核,审核通过后将自动开通接单权限,请耐心等待。',
            showCancel: false,
            confirmText: '我知道了',
            success: () => { this._afterApply(); }
          });
        } else {
          // 导航先行、反馈后置: toast 放 success 回调, 消灭「toast+导航」竞态(灰度基础库回归过)
          wx.switchTab({
            url: '/pages-v2/profile/profile',
            success: () => {
              wx.showToast({ title: '申请成功,已开通耍伴身份', icon: 'success' });
              if ((this.data.chainBar || {}).index) require('../../../utils/onboard-chain.js').invalidateDraft();
            },
            fail: (err) => {
              console.error('[partner-apply] switchTab profile fail:', err && err.errMsg);
              wx.showToast({ title: '申请成功,已开通耍伴身份', icon: 'success' });
            }
          });
        }
      } else {
        // 服务端实名门禁(apply_not_realname): 给「去实名」按钮引导
        const bs = require('../../../utils/bootstrap.js');
        if (bs.isRealnameGateCode && bs.isRealnameGateCode(r.code)) {
          bs.showRealnameGuide(r.msg);
        } else {
          wx.showToast({ title: r.msg || '申请失败', icon: 'none' });
        }
      }
    } catch (e) {
      wx.hideLoading();
      const msg = (e && (e.errMsg || e.message)) || '未知错误';
      console.error('[partner-apply] submit error:', e);
      wx.showModal({ title: '申请失败', content: String(msg).slice(0, 120), showCancel: false, confirmText: '我知道了' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // 批3c(2026-10-23): 链内提交成功后 → 第 8 步「等待审核」(我的页); 同时失效草稿缓存
  _afterApply() {
    if ((this.data.chainBar || {}).index) require('../../../utils/onboard-chain.js').invalidateDraft();
    wx.switchTab({ url: '/pages-v2/profile/profile', fail: () => {} });
  },
  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages-v2/profile/profile' }) }); }
});
