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
    // 产品埋点: 启动事件
    require('./utils/report.js').report('app_launch', {});

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
    // S2 性能: 延后 3s 执行, 让出冷启动网络连接/云函数并发额度给首屏关键调用(square/peek_login);
    // 本地 CONFIG 全字段兜底, 延迟期间页面行为不受影响
    const bootstrap = require('./utils/bootstrap.js').bootstrap;
    setTimeout(() => {
      this.globalData.cloudReady.then(() => bootstrap()).catch(() => {});
    }, 3000);

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

  onShow() {
    // 2026-11-24 B 方案: 切回前台时查一次是否有未读「被选定」通知, 命中弹强制窗(不做定时轮询)
    try { require('./utils/select-confirmed-alert.js').checkOnce(); } catch (e) { console.warn('[select-alert] onShow 检查失败', e && e.message); }
  },

  // 统一等云就绪后再 callFunction(带 retry)
  // 用法: await app.cloudCall('home-action', {action:'square'});
  // S7 性能/安全: 读类 action 失败重试 2 次; 写类 action(支付/发消息/状态流转/提交类)一次不重试,
  //   防止超时后的重试风暴造成重复扣款/重复发消息/重复状态推进(真实支付接入后尤为关键);
  //   单次超时 4s → 6s, 给云函数冷启动一次完整机会, 减少误重试。可用 opts.retries 显式覆盖。
  cloudCall(name, data, opts) {
    opts = opts || {};
    // 写操作动词表(按下划线分词边界匹配); 新增写 action 命名须包含表内动词
    // @VERIFIED 2026-11-19 已真机验证：WRITE_RE 含 publish/like/unlike，断网失败不再自动重试 2 次（体验版 1.6.45）
    const WRITE_RE = /(^|_)(create|add|new|submit|save|update|set|edit|modify|change|respond|cancel|close|delete|remove|pay|tip|withdraw|refund|start|finish|complete|confirm|accept|take|reject|review|approve|offline|claim|apply|send|sign|checkin|report|resolve|nudge|extend|resume|complaint|sos|login|open|milestone|publish|like|unlike)(_|$)/;
    const action = data && data.action ? String(data.action) : '';
    const isWrite = WRITE_RE.test(action);
    const retries = opts.retries !== undefined ? opts.retries : (isWrite ? 0 : 2);
    const waitMs = opts.waitMs || 1500;     // 重试间隔
    const timeout = opts.timeout || 12000;  // 单次超时(2026-10-27: 6s→12s, 云函数含多段联表, 冷启动易触顶)

    return this.globalData.cloudReady.then(() => {
      return new Promise((resolve) => {
        let attempt = 0;
        // 统一注入设备摘要(审计留痕用; 覆盖走本封装的所有云函数调用)
        // 避免污染调用方 data 对象: 构造副本
        let sendData = data;
        try {
          const sys = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
          const device = `${sys.brand || ''} ${sys.model || ''}|${sys.system || ''}|${sys.platform || ''}`.trim().slice(0, 200);
          sendData = Object.assign({}, data, { device });
        } catch (e) { /* 取不到设备信息则不带 device */ }
        // 2026-11-09 P3-30: 超时重试复用同一在途调用, 不再重复发起(防读类配额放大)
        let callPromise = null;
        const doCall = () => {
          attempt++;
          const timer = setTimeout(() => {
            // 超时: 免费版 3s 硬限, 继续 retry(仅重新等待同一在途调用)
            if (attempt <= retries) {
              setTimeout(doCall, waitMs);
            } else {
              resolve({ ok: false, code: 'cloud_timeout', msg: '网络慢,请稍后再试' });
            }
          }, timeout);

          if (!callPromise) {
            callPromise = new Promise((res, rej) => {
              wx.cloud.callFunction({ name, data: sendData, success: res, fail: rej });
            });
          }
          callPromise.then((res) => {
            clearTimeout(timer);
            resolve(res.result || { ok: false, code: 'cloud_empty' });
          }).catch((err) => {
            clearTimeout(timer);
            console.error('[cloudCall fail]', name, 'attempt=' + attempt, err && err.errMsg);
            // 错误可观测性(P1 立项): 云函数调用失败进微信事件分析, 不阻塞业务
            try { require('./utils/report.js').report('cloud_call_fail', { name, attempt, errMsg: String((err && err.errMsg) || '').slice(0, 120) }); } catch (ee) {}
            callPromise = null;   // 已失败, 下一轮重试才发起新调用
            if (attempt <= retries) {
              setTimeout(doCall, waitMs);
            } else {
              resolve({ ok: false, code: 'cloud_error', msg: '网络异常,请检查网络' });
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
  },

  // 兜底: 微信自动恢复上次现场时偶发空路径/未知路径(如 page ""), 统一重定向首页,
  // 避免框架默认弹「页面不存在」错误页。仅 reLaunch 到已注册页面, 不会再触发本回调。
  onPageNotFound(res) {
    const path = (res && res.path) || '';
    console.warn('[onPageNotFound] path="' + path + '" → reLaunch 首页');
    wx.reLaunch({ url: '/pages-v2/index/index' });
  },

  // 全局错误上报(P1 立项, 2026-11-19 综合评审): 运行时 JS 错误 → 微信事件分析 + Console
  // 基础库 onError 签名兼容: 新版传 error 对象, 旧版传 (msg,url,line,col)
  onError(error) {
    const e = (error && typeof error === 'object') ? error : { message: String(error || '') };
    const msg = String(e.message || '').slice(0, 200);
    const stack = String(e.stack || '').slice(0, 400);
    // 错误分类(经验教训 389775: 区分 client_bug / network, 避免泛化 unknown)
    let type = 'unknown_error';
    if (/TypeError|ReferenceError|SyntaxError|is not a function|Cannot read|is undefined/i.test(msg)) type = 'client_bug';
    else if (/timeout|request:fail|网络/i.test(msg)) type = 'network';
    console.error('[app onError]', type, msg, stack);
    try { require('./utils/report.js').report('app_error', { type, msg, stack, t: Date.now() }); } catch (ee) { /* 上报失败绝不阻塞 */ }
  },

  // 全局未处理 Promise 拒绝上报: await 漏 catch / 异步链路断在拒绝态
  onUnhandledRejection(res) {
    const reason = (res && res.reason !== undefined) ? res.reason : '';
    const msg = String((reason && reason.message) || reason || '').slice(0, 200);
    console.error('[app unhandledRejection]', msg);
    try { require('./utils/report.js').report('app_unhandled_rejection', { msg, t: Date.now() }); } catch (ee) { /* 静默 */ }
  }
});
