// PRD章节: 1.6.1 双身份 / 3.1.2 双信用分 / 3.11 账号注销 / 3.10 耍伴专区
// P1: 接云端 user-login, 删除 mock CURRENT_USER 依赖
const redline = require('../../utils/redline.js');
const CONFIG = require('../../config/index.js');
const { CREDIT_LEVEL } = require('../../config/enums.js');

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

function getLevel(score) {
  if (!score) return '未开通';
  const lv = CREDIT_LEVEL.find((l) => score >= l.min && score <= l.max);
  return lv ? `${lv.level} ${lv.name}` : '未评级';
}

Page({
  data: {
    // 初始空壳, onLoad 调云端后覆盖
    user: { avatar: '', nickname: '', phone: '', roles: [], is_realname_done: false, user_credit_score: 0, partner_credit_score: 0 },
    identity: 'user',       // user | partner
    userLevel: '',
    partnerLevel: '',
    orderEntries: [
      { key: 'pay', icon: '💳', name: '待支付', count: 0 },
      { key: 'doing', icon: '🧭', name: '进行中', count: 0 },
      { key: 'eval', icon: '⭐', name: '待评价', count: 0 },
      { key: 'after', icon: '🛟', name: '售后', count: 0 }
    ],
    funcList: [
      { key: 'emergency', icon: '🆘', name: '紧急联系人管理' },
      { key: 'myPublish', icon: '📋', name: '我的发布' },
      { key: 'privacy', icon: '🔏', name: '隐私设置' },
      { key: 'help', icon: '🎧', name: '帮助中心' },
      { key: 'about', icon: 'ℹ️', name: '关于我们' }
    ],
    partnerEntries: [
      { key: 'accept-config', icon: '⚙️', name: '接单配置' },
      { key: 'wallet', icon: '💰', name: '收入钱包' },
      { key: 'workbench', icon: '🧰', name: '耍伴工作台' }
    ],
    version: CONFIG.VERSION,
    isRedline: false
  },

  onLoad() {
    this.fetchUser();
  },

  onShow() {
    this.setData({ isRedline: redline.isInRedline() });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    // 每次进"我的"刷新一次(昵称/信用分可能变)
    this.fetchUser();
  },

  fetchUser() {
    callCloud('user-login', { action: 'login' }).then((r) => {
      if (!r.ok || !r.data || !r.data.user) {
        wx.showToast({ title: r.msg || '登录失败', icon: 'none' });
        return;
      }
      const u = r.data.user;
      const isPartner = (u.roles || []).indexOf('partner') >= 0;
      // is_realname_done 后端返回; face_verified MVP 暂未实现, 用 false 兜底
      const uiUser = Object.assign({}, u, {
        is_partner: isPartner,
        face_verified: false,
        has_active_order: false // 后端后续补
      });
      this.setData({
        user: uiUser,
        identity: isPartner ? 'partner' : 'user',
        userLevel: getLevel(u.user_credit_score),
        partnerLevel: getLevel(u.partner_credit_score)
      });
    }).catch(() => {
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  // U1 身份切换
  switchIdentity(e) {
    const target = e.currentTarget.dataset.role;
    if (target === this.data.identity) return;
    if (target === 'partner' && !this.data.user.is_partner) {
      wx.showToast({ title: '请先完成耍伴认证', icon: 'none' });
      return;
    }
    this.setData({ identity: target });
    wx.showToast({ title: target === 'partner' ? '已切换为耍伴身份' : '已切换为用户身份', icon: 'none' });
  },

  // U2 信用明细（简化：占位）
  onScoreDetail(e) {
    const role = e.currentTarget.dataset.role;
    wx.showToast({ title: `${role === 'user' ? '用户' : '耍伴'}信用明细页待接入`, icon: 'none' });
  },

  // U3 订单入口
  onOrderEntry() {
    wx.navigateTo({
      url: '/pages/order/order',
      fail: () => wx.showToast({ title: '订单列表待接入', icon: 'none' })
    });
  },

  // DEV: 联调跳转入口(上线前删除)
  onDevGoChat() {
    wx.showModal({
      title: 'DEV进入聊天页',
      editable: true,
      placeholderText: '粘贴订单_id(32位十六进制)',
      confirmText: '进入',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const id = String(res.content).trim();
        if (!/^[a-f0-9]{32}$/i.test(id)) {
          wx.showToast({ title: 'ID格式不正确', icon: 'none' });
          return;
        }
        wx.navigateTo({ url: '/pages-v2/chat/chat?orderId=' + id, fail: () => wx.showToast({ title: '跳转失败', icon: 'none' }) });
      },
      fail: () => wx.showToast({ title: '弹窗唤起失败', icon: 'none' })
    });
  },

  // DEV: 联调跳转入口(上线前删除)
  onDevGoOrderDetail() {
    wx.showModal({
      title: 'DEV进入订单详情',
      editable: true,
      placeholderText: '粘贴订单_id(32位十六进制)',
      confirmText: '进入',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const id = String(res.content).trim();
        if (!/^[a-f0-9]{32}$/i.test(id)) {
          wx.showToast({ title: 'ID格式不正确', icon: 'none' });
          return;
        }
        wx.navigateTo({ url: '/pages-v2/order-detail/order-detail?orderId=' + id, fail: () => wx.showToast({ title: '跳转失败', icon: 'none' }) });
      },
      fail: () => wx.showToast({ title: '弹窗唤起失败', icon: 'none' })
    });
  },

  // U4 功能列表
  onFuncTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'emergency') {
      wx.showToast({ title: '紧急联系人管理页待接入', icon: 'none' });
    } else if (key === 'myPublish') {
      wx.showToast({ title: '我的发布页待接入', icon: 'none' });
    } else if (key === 'privacy') {
      wx.showActionSheet({
        itemList: ['输入状态展示：开', '消息通知：开', '免打扰：关', '位置权限说明'],
        success: () => {},
        fail: () => {}
      });
    } else if (key === 'help') {
      wx.showToast({ title: '帮助中心待接入', icon: 'none' });
    } else if (key === 'about') {
      wx.showModal({ title: '关于找个人帮忙', content: `版本 ${this.data.version}\n安全第一 · 合规先行`, showCancel: false });
    }
  },

  // U5 耍伴专区 / 认证引导
  onPartnerEntry(e) {
    const key = e.currentTarget.dataset.key;
    wx.navigateTo({
      url: `/pages-v2/${key}/${key}`,
      fail: () => wx.showToast({ title: '该页面将在批次3上线', icon: 'none' })
    });
  },
  becomePartner() {
    wx.navigateTo({
      url: '/pages/partner-apply/partner-apply',
      fail: () => wx.showToast({ title: '耍伴认证页待接入', icon: 'none' })
    });
  },

  // U6 注销：二次确认 + 冷静期
  onLogout() {
    const days = CONFIG.LOGOUT_COOLDOWN_DAYS;
    wx.showModal({
      title: '账号注销',
      content: `注销后进入${days}天冷静期，期间登录可撤回申请；冷静期满后账号数据将被删除且不可恢复。确认注销吗？`,
      confirmText: '确认注销',
      confirmColor: '#fa5151',
      success: (res) => {
        if (res.confirm) {
          wx.showToast({ title: `注销申请已提交，${days}天冷静期生效`, icon: 'none', duration: 2500 });
        }
      }
    });
  }
});
