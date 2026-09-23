// app.js - 找人帮忙 小程序入口
const CLOUD_ENV = require('./envList.js').CLOUD_ENV;

App({
  globalData: {
    userInfo: null,
    role: 'guest',
    activeRole: 'user',
    orderTabRole: '',
    // 云初始化等待 Promise: 所有 callFunction 前 await this.globalData.cloudReady
    cloudReady: null
  },

  onLaunch() {
    // 云开发初始化: 返回 Promise, 所有云函数调用必须等它 resolve
    // 非局域网(4G/5G)下 WebSocket 握手比局域网慢 2-5x, 必须显式等待
    if (wx.cloud) {
      this.globalData.cloudReady = wx.cloud.init({
        env: CLOUD_ENV,
        traceUser: true
      });
    } else {
      this.globalData.cloudReady = Promise.resolve();
    }

    // SSOT: 异步拉 admin_config 覆盖本地 CONFIG, 失败静默降级
    const bootstrap = require('./utils/bootstrap.js').bootstrap;
    this.globalData.cloudReady.then(() => bootstrap()).catch(() => {});

    // 恢复上次选择的界面身份
    const saved = wx.getStorageSync('active_role');
    if (saved === 'partner' || saved === 'user') {
      this.globalData.activeRole = saved;
    }
    // 恢复登录态
    try {
      const cached = wx.getStorageSync('userInfo');
      if (cached && cached.openid) {
        this.globalData.userInfo = cached;
        this.globalData.role = (cached.roles && cached.roles[0]) || 'user';
        this.syncTabBar();
      }
    } catch (e) {}
  },

  // 统一等云就绪后再 callFunction(带 retry)
  // 用法: await app.cloudCall('home-action', {action:'square'});
  cloudCall(name, data, opts) {
    opts = opts || {};
    const retries = opts.retries || 2;      // 失败重试 2 次(总共 3 次)
    const waitMs = opts.waitMs || 1500;     // 重试间隔
    const timeout = opts.timeout || 4000;   // 单次超时(免费版 3s 硬限, 给 4s 留余量)

    return this.globalData.cloudReady.then(() => {
      return new Promise((resolve) => {
        let attempt = 0;
        // 统一注入设备摘要(审计留痕用; 覆盖走本封装的所有云函数调用)
        // 避免污染调用方 data 对象: 构造副本
        let sendData = data;
        try {
          const sys = wx.getSystemInfoSync();
          const device = `${sys.brand || ''} ${sys.model || ''}|${sys.system || ''}|${sys.platform || ''}`.trim().slice(0, 200);
          sendData = Object.assign({}, data, { device });
        } catch (e) { /* 取不到设备信息则不带 device */ }
        const doCall = () => {
          attempt++;
          const timer = setTimeout(() => {
            // 超时: 免费版 3s 硬限, 继续 retry
            if (attempt <= retries) {
              setTimeout(doCall, waitMs);
            } else {
              resolve({ ok: false, code: 'cloud_timeout', msg: '网络慢,请稍后再试' });
            }
          }, timeout);

          wx.cloud.callFunction({
            name, data: sendData,
            success: (res) => {
              clearTimeout(timer);
              resolve(res.result || { ok: false, code: 'cloud_empty' });
            },
            fail: (err) => {
              clearTimeout(timer);
              console.error('[cloudCall fail]', name, 'attempt=' + attempt, err && err.errMsg);
              if (attempt <= retries) {
                setTimeout(doCall, waitMs);
              } else {
                resolve({ ok: false, code: 'cloud_error', msg: '网络异常,请检查网络' });
              }
            }
          });
        };
        doCall();
      });
    });
  },

  setLoginUser(user) {
    if (!user || !user.openid) return;
    this.globalData.userInfo = user;
    this.globalData.role = (user.roles && user.roles[0]) || 'user';
    wx.setStorageSync('userInfo', user);
    this.syncTabBar();
  },

  clearLoginUser() {
    this.globalData.userInfo = null;
    this.globalData.role = 'guest';
    try { wx.removeStorageSync('userInfo'); } catch (e) {}
    this.setActiveRole('user');
  },

  getActiveRole() {
    return this.globalData.activeRole || 'user';
  },

  setActiveRole(role) {
    if (role !== 'user' && role !== 'partner') return;
    this.globalData.activeRole = role;
    wx.setStorageSync('active_role', role);
    this.syncTabBar();
  },

  syncTabBar() {
    const text = this.getActiveRole() === 'partner' ? '接单' : '大厅';
    if (wx.setTabBarItem) {
      wx.setTabBarItem({ index: 1, text, fail: () => {} });
    }
  }
});
