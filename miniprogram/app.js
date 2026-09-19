// app.js - 找人帮忙 小程序入口
App({
  globalData: {
    userInfo: null,   // 登录后填充 { openid, nick, avatar, phone, role, creditScore, roles }
    role: 'guest',    // 'guest' | 'user' | 'partner' | 'admin'
    activeRole: 'user', // 当前界面身份 'user'(发单人) | 'partner'(耍伴), 仅影响展示
    orderTabRole: ''  // 跳订单 Tab 时预选角色的一次性通道
  },

  onLaunch() {
    // 初始化云开发 · 环境ID 来自 envList.js 唯一来源
    if (wx.cloud) {
      wx.cloud.init({
        env: require('./envList.js').CLOUD_ENV,
        traceUser: true
      });
    }
    // 恢复上次选择的界面身份
    const saved = wx.getStorageSync('active_role');
    if (saved === 'partner' || saved === 'user') {
      this.globalData.activeRole = saved;
    }
    // ── 恢复登录态: 从 storage 读 userInfo + role, 防止冷启动后 userInfo 恒 null ──
    try {
      const cached = wx.getStorageSync('userInfo');
      if (cached && cached.openid) {
        this.globalData.userInfo = cached;
        this.globalData.role = (cached.roles && cached.roles[0]) || 'user';
        this.syncTabBar();
      }
    } catch (e) {}
  },

  // 登录成功统一调用: 写 globalData + storage
  setLoginUser(user) {
    if (!user || !user.openid) return;
    this.globalData.userInfo = user;
    this.globalData.role = (user.roles && user.roles[0]) || 'user';
    wx.setStorageSync('userInfo', user);
    this.syncTabBar();
  },

  // 登出统一调用: 清 globalData + storage
  clearLoginUser() {
    this.globalData.userInfo = null;
    this.globalData.role = 'guest';
    try { wx.removeStorageSync('userInfo'); } catch (e) {}
    this.setActiveRole('user');
  },

  // 当前界面身份
  getActiveRole() {
    return this.globalData.activeRole || 'user';
  },

  // 切换界面身份(仅影响大厅/订单等页面展示, 不改云端权限)
  setActiveRole(role) {
    if (role !== 'user' && role !== 'partner') return;
    this.globalData.activeRole = role;
    wx.setStorageSync('active_role', role);
    this.syncTabBar();
  },

  // 按身份同步 tabBar 文案: 耍伴→「接单」, 发单人→「大厅」
  syncTabBar() {
    const text = this.getActiveRole() === 'partner' ? '接单' : '大厅';
    if (wx.setTabBarItem) {
      wx.setTabBarItem({ index: 1, text, fail: () => {} });
    }
  }
});
